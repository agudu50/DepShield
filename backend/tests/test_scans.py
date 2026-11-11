import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.domain.scanning.service import (
    AdvisoryServiceError,
    DependencyRecord,
    ManifestError,
    VulnerabilityRecord,
    lookup_advisories,
    parse_manifest,
)
from app.main import app
from tests.api_support import DatabaseBackedApiTestCase


class ParseManifestTests(unittest.TestCase):
    def test_npm_reads_dependencies_from_all_sections(self) -> None:
        dependencies = parse_manifest(
            '{"dependencies":{"lodash":"4.17.15"},'
            '"devDependencies":{"vite":"^5.0.0"}}',
            "npm",
        )

        self.assertEqual([item.name for item in dependencies], ["lodash", "vite"])
        self.assertTrue(dependencies[0].exact_version)
        self.assertFalse(dependencies[1].exact_version)

    def test_python_marks_only_exact_pins_as_checkable(self) -> None:
        dependencies = parse_manifest(
            "requests==2.31.0\njinja2>=3.0\nflask[async]==3.0.0\n",
            "python",
        )

        self.assertEqual([item.name for item in dependencies], ["requests", "jinja2", "flask"])
        self.assertEqual([item.exact_version for item in dependencies], [True, False, True])

    def test_npm_v3_lockfile_includes_nested_and_scoped_transitive_packages(self) -> None:
        dependencies = parse_manifest(
            """{
              "lockfileVersion": 3,
              "packages": {
                "": {"name": "app"},
                "node_modules/lodash": {"version": "4.17.15"},
                "node_modules/@scope/root": {"version": "1.0.0"},
                "node_modules/@scope/root/node_modules/lodash": {"version": "3.10.1"}
              }
            }""",
            "npm",
            "lockfile",
        )

        self.assertEqual(
            [(item.name, item.version) for item in dependencies],
            [("@scope/root", "1.0.0"), ("lodash", "3.10.1"), ("lodash", "4.17.15")],
        )

    def test_npm_v1_lockfile_includes_nested_versions(self) -> None:
        dependencies = parse_manifest(
            '{"lockfileVersion":1,"dependencies":{"parent":{"version":"1.0.0",'
            '"dependencies":{"child":{"version":"2.0.0"}}}}}',
            "npm",
            "lockfile",
        )

        self.assertEqual(
            [(item.name, item.version) for item in dependencies],
            [("child", "2.0.0"), ("parent", "1.0.0")],
        )

    def test_python_uv_and_pipfile_lockfiles_are_supported(self) -> None:
        uv_dependencies = parse_manifest(
            '[[package]]\nname = "requests"\nversion = "2.31.0"\n'
            '[[package]]\nname = "demo"\nversion = "1.0.0"\n'
            'source = { editable = "." }\n',
            "python",
            "lockfile",
        )
        pipfile_dependencies = parse_manifest(
            '{"default":{"requests":{"version":"==2.31.0"}},'
            '"develop":{"pytest":{"version":"==8.0.0"}}}',
            "python",
            "lockfile",
        )
        empty_uv_dependencies = parse_manifest(
            'version = 1\nrequires-python = ">=3.11"\n',
            "python",
            "lockfile",
        )

        self.assertEqual([(item.name, item.version) for item in uv_dependencies], [("requests", "2.31.0")])
        self.assertEqual(
            [(item.name, item.version) for item in pipfile_dependencies],
            [("pytest", "8.0.0"), ("requests", "2.31.0")],
        )
        self.assertEqual(empty_uv_dependencies, [])

    def test_invalid_manifest_is_rejected(self) -> None:
        with self.assertRaises(ManifestError):
            parse_manifest("{not json}", "npm")

    def test_manifest_size_limit_is_enforced(self) -> None:
        with self.assertRaises(ManifestError):
            parse_manifest(" " * 1_000_001, "npm")


class _MockOsvResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict[str, object]:
        return self.payload


class _MockOsvClient:
    def __init__(self, payload: dict[str, object], *, timeout: float = 10.0) -> None:
        self.response = _MockOsvResponse(payload)
        self.timeout = timeout
        self.request: tuple[str, dict[str, object]] | None = None

    async def __aenter__(self) -> "_MockOsvClient":
        return self

    async def __aexit__(
        self, exc_type: object, exc: object, traceback: object
    ) -> None:
        del exc_type, exc, traceback

    async def post(self, url: str, *, json: dict[str, object]) -> _MockOsvResponse:
        self.request = (url, json)
        return self.response


class AdvisoryLookupTests(unittest.IsolatedAsyncioTestCase):
    async def test_withdrawn_osv_advisories_are_not_reported_as_active(self) -> None:
        client = _MockOsvClient(
            {
                "results": [
                    {
                        "vulns": [
                            {"id": "GHSA-active"},
                            {
                                "id": "GHSA-withdrawn",
                                "withdrawn": "2025-01-01T00:00:00Z",
                            },
                        ]
                    }
                ]
            }
        )
        with patch("app.domain.scanning.service.httpx.AsyncClient", return_value=client):
            advisories = await lookup_advisories(
                [
                    DependencyRecord(
                        name="demo",
                        version="1.0.0",
                        ecosystem="npm",
                        exact_version=True,
                    )
                ]
            )

        self.assertEqual([item.id for item in advisories[0]], ["GHSA-active"])

    async def test_invalid_osv_withdrawn_field_fails_closed(self) -> None:
        client = _MockOsvClient(
            {"results": [{"vulns": [{"id": "GHSA-invalid", "withdrawn": True}]}]}
        )
        with patch("app.domain.scanning.service.httpx.AsyncClient", return_value=client):
            with self.assertRaises(AdvisoryServiceError):
                await lookup_advisories(
                    [
                        DependencyRecord(
                            name="demo",
                            version="1.0.0",
                            ecosystem="npm",
                            exact_version=True,
                        )
                    ]
                )


class ScanEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_scan_returns_advisories_and_range_status(self) -> None:
        mock_advisories = AsyncMock(
            return_value=[
                [VulnerabilityRecord(id="GHSA-test", aliases=["CVE-2025-0001"], summary="Test advisory")],
                [],
            ]
        )
        with patch("app.api.routes.scans.lookup_advisories", mock_advisories):
            response = self.client.post(
                "/api/scans",
                json={
                    "project_name": "demo",
                    "ecosystem": "npm",
                    "manifest": '{"dependencies":{"lodash":"4.17.15","vite":"^5.0.0"}}',
                },
            )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["dependency_count"], 2)
        self.assertEqual(result["checked_count"], 1)
        self.assertEqual(result["unpinned_count"], 1)
        self.assertEqual(result["vulnerability_count"], 1)
        self.assertEqual(result["dependencies"][0]["vulnerabilities"][0]["id"], "GHSA-test")
        self.assertEqual(result["dependencies"][1]["status"], "version_range")
        mock_advisories.assert_awaited_once()

    def test_versioned_scan_route_is_available(self) -> None:
        mock_advisories = AsyncMock(return_value=[[]])
        with patch("app.api.routes.scans.lookup_advisories", mock_advisories):
            response = self.client.post(
                "/api/v1/scans",
                json={
                    "project_name": "demo",
                    "ecosystem": "npm",
                    "manifest": '{"dependencies":{"safe-example":"1.2.3"}}',
                },
            )

        self.assertEqual(response.status_code, 200)

    def test_invalid_manifest_returns_validation_error(self) -> None:
        response = self.client.post(
            "/api/scans",
            json={"project_name": "demo", "ecosystem": "npm", "manifest": "{not json}"},
        )

        self.assertEqual(response.status_code, 422)

    def test_advisory_service_failure_is_not_reported_as_a_successful_scan(self) -> None:
        mock_advisories = AsyncMock(side_effect=AdvisoryServiceError("OSV unavailable"))
        with patch("app.api.routes.scans.lookup_advisories", mock_advisories):
            response = self.client.post(
                "/api/scans",
                json={
                    "project_name": "demo",
                    "ecosystem": "npm",
                    "manifest": '{"dependencies":{"lodash":"4.17.15"}}',
                },
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "OSV unavailable")

    def test_legacy_path_based_scan_endpoint_is_not_exposed(self) -> None:
        response = self.client.get("/scan", params={"project_path": "C:/private"})

        self.assertEqual(response.status_code, 404)


class ProjectScanHistoryTests(DatabaseBackedApiTestCase):
    def test_initial_empty_inventory_still_creates_assessment(self) -> None:
        _, project_id, _ = self.create_project()
        lookup = AsyncMock(return_value=[])
        with patch("app.api.routes.scans.lookup_advisories", lookup):
            response = self.client.put(
                f"/api/v1/projects/{project_id}/inventory",
                json={"manager": "npm", "packages": []},
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["dependency_count"], 0)
        self.assertIsNotNone(response.json()["scan"])
        self.assertEqual(response.json()["scan"]["dependency_count"], 0)
        lookup.assert_awaited_once_with([])
        inventory = self.client.get(f"/api/v1/projects/{project_id}/inventory")
        self.assertEqual(inventory.status_code, 200)
        self.assertEqual(inventory.json()["packages"], [])

    def test_project_scan_is_saved_and_history_is_tenant_scoped(self) -> None:
        _, project_id, _ = self.create_project()
        with patch(
            "app.api.routes.scans.lookup_advisories",
            new=AsyncMock(
                return_value=[
                    [VulnerabilityRecord(id="GHSA-test", aliases=[], summary="Test advisory")]
                ]
            ),
        ):
            created = self.client.post(
                f"/api/v1/projects/{project_id}/scans",
                json={
                    "ecosystem": "npm",
                    "manifest": '{"dependencies":{"lodash":"4.17.15"}}',
                },
            )

        self.assertEqual(created.status_code, 201)
        result = created.json()
        self.assertEqual(result["project_id"], project_id)
        self.assertEqual(result["vulnerability_count"], 1)

        listed = self.client.get(f"/api/v1/projects/{project_id}/scans")
        detailed = self.client.get(f"/api/v1/scans/{result['id']}")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.json()], [result["id"]])
        self.assertEqual(detailed.json()["dependencies"][0]["vulnerabilities"][0]["id"], "GHSA-test")

        self.set_user("unrelated-user")
        self.assertEqual(self.client.get(f"/api/v1/projects/{project_id}/scans").status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/scans/{result['id']}").status_code, 404)

    def test_inventory_sync_scans_only_added_or_updated_packages(self) -> None:
        _, project_id, _ = self.create_project()
        lookup = AsyncMock(side_effect=[[[]], [[], []]])
        initial = {"manager": "npm", "packages": [{"name": "left-pad", "version": "1.3.0"}]}
        with patch("app.api.routes.scans.lookup_advisories", lookup):
            first = self.client.put(
                f"/api/v1/projects/{project_id}/inventory",
                json=initial,
            )
            unchanged = self.client.put(
                f"/api/v1/projects/{project_id}/inventory",
                json=initial,
            )
            updated = self.client.put(
                f"/api/v1/projects/{project_id}/inventory",
                json={
                    "manager": "npm",
                    "packages": [
                        {"name": "left-pad", "version": "1.3.1"},
                        {"name": "new-package", "version": "2.0.0"},
                    ],
                },
            )

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["changed_count"], 1)
        self.assertEqual(unchanged.status_code, 200, unchanged.text)
        self.assertEqual(unchanged.json()["changed_count"], 0)
        self.assertIsNone(unchanged.json()["scan"])
        self.assertEqual(first.json()["revision"], unchanged.json()["revision"])
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["changed_count"], 2)
        self.assertEqual(updated.json()["removed_count"], 1)
        self.assertEqual(updated.json()["scan"]["dependency_count"], 2)
        self.assertEqual(lookup.await_count, 2)

        inventory = self.client.get(f"/api/v1/projects/{project_id}/inventory")
        self.assertEqual(inventory.status_code, 200)
        self.assertEqual(
            {(item["name"], item["version"]) for item in inventory.json()["packages"]},
            {("left-pad", "1.3.1"), ("new-package", "2.0.0")},
        )

        history = self.client.get(f"/api/v1/projects/{project_id}/scans")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(len(history.json()), 2)

    def test_inventory_sync_is_project_scoped(self) -> None:
        _, project_id, _ = self.create_project()
        request = {
            "manager": "npm",
            "packages": [{"name": "left-pad", "version": "1.3.0"}],
        }
        with patch(
            "app.api.routes.scans.lookup_advisories",
            new=AsyncMock(return_value=[[]]),
        ):
            created = self.client.put(
                f"/api/v1/projects/{project_id}/inventory",
                json=request,
            )
        self.assertEqual(created.status_code, 200)

        self.set_user("unrelated-user")
        denied = self.client.put(
            f"/api/v1/projects/{project_id}/inventory",
            json=request,
        )
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(
            self.client.get(f"/api/v1/projects/{project_id}/inventory").status_code,
            404,
        )

    def test_uv_inventory_sync_assesses_python_packages_incrementally(self) -> None:
        _, project_id, _ = self.create_project()
        lookup = AsyncMock(return_value=[[]])
        with patch("app.api.routes.scans.lookup_advisories", lookup):
            response = self.client.put(
                f"/api/v1/projects/{project_id}/inventory",
                json={
                    "manager": "uv",
                    "packages": [{"name": "example-package", "version": "1.2.3"}],
                },
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["scan"]["ecosystem"], "python")
        self.assertEqual(response.json()["scan"]["checked_count"], 1)
        self.assertEqual(lookup.await_args.args[0][0].ecosystem, "python")


if __name__ == "__main__":
    unittest.main()
