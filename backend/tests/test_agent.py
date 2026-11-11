import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.agents.bifrost import BifrostClient, BifrostError
from app.agents.investigation import InvestigationError, SecurityInvestigator
from app.config import Settings, get_settings
from app.domain.scanning.service import AdvisoryServiceError, DependencyRecord, VulnerabilityRecord
from app.main import app
from tests.api_support import DatabaseBackedApiTestCase


class BifrostClientTests(unittest.TestCase):
    def test_sends_grounded_request_to_openai_compatible_gateway(self) -> None:
        captured = {}

        def respond(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["authorization"] = request.headers.get("Authorization")
            captured["payload"] = request.read().decode("utf-8")
            return httpx.Response(
                200,
                json={
                    "id": "gateway-response-1",
                    "model": "openai/gpt-test",
                    "choices": [{"message": {"content": "Evidence-backed explanation."}}],
                    "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
                },
            )

        client = BifrostClient(
            base_url="http://bifrost.test/openai",
            model="openai/gpt-test",
            virtual_key="server-side-test-key",
            transport=httpx.MockTransport(respond),
        )
        reply = asyncio.run(
            client.explain_finding(
                "Why is it vulnerable?",
                [{"source": "OSV.dev", "id": "GHSA-test", "aliases": [], "summary": "Test"}],
            )
        )

        self.assertEqual(captured["url"], "http://bifrost.test/openai/chat/completions")
        self.assertEqual(captured["authorization"], "Bearer server-side-test-key")
        self.assertIn("GHSA-test", captured["payload"])
        self.assertEqual(reply.answer, "Evidence-backed explanation.")
        self.assertEqual(reply.usage["total_tokens"], 20)
        self.assertEqual(reply.response_id, "gateway-response-1")

    def test_rejects_malformed_gateway_response(self) -> None:
        client = BifrostClient(
            base_url="http://bifrost.test/openai",
            model="openai/gpt-test",
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={})),
        )

        with self.assertRaises(BifrostError):
            asyncio.run(client.explain_finding("Question", [{"id": "GHSA-test"}]))

    def test_rejects_oversized_gateway_response(self) -> None:
        client = BifrostClient(
            base_url="http://bifrost.test/openai",
            model="openai/gpt-test",
            transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b"x" * 128_001)),
        )

        with self.assertRaises(BifrostError):
            asyncio.run(client.explain_finding("Question", [{"id": "GHSA-test"}]))


class SecurityInvestigatorTests(unittest.IsolatedAsyncioTestCase):
    async def test_passes_osv_evidence_to_bifrost_and_returns_source_separately(self) -> None:
        bifrost = AsyncMock()
        bifrost.explain_finding.return_value.answer = "The advisory affects this version."
        bifrost.explain_finding.return_value.model = "openai/gpt-test"
        bifrost.explain_finding.return_value.response_id = "response-1"
        bifrost.explain_finding.return_value.usage = {"total_tokens": 15}
        investigator = SecurityInvestigator(bifrost)
        dependency = DependencyRecord("lodash", "4.17.15", "npm", True)

        with patch(
            "app.agents.investigation.lookup_advisories",
            new=AsyncMock(
                return_value=[
                    [
                        VulnerabilityRecord(
                            id="GHSA-test",
                            aliases=["CVE-2025-0001"],
                            summary="Verified advisory",
                        )
                    ]
                ]
            ),
        ):
            result = await investigator.investigate(dependency, "Explain")

        bifrost.explain_finding.assert_awaited_once()
        sent_evidence = bifrost.explain_finding.await_args.args[1]
        self.assertEqual(sent_evidence[0]["id"], "GHSA-test")
        self.assertEqual(result.status, "evidence_reviewed")
        self.assertEqual(result.evidence[0]["source"], "OSV.dev")
        self.assertEqual(result.model, "openai/gpt-test")

    async def test_no_osv_match_does_not_call_bifrost(self) -> None:
        bifrost = AsyncMock()
        investigator = SecurityInvestigator(bifrost)
        dependency = DependencyRecord("safe-example", "1.2.3", "npm", True)

        with patch(
            "app.agents.investigation.lookup_advisories",
            new=AsyncMock(return_value=[[]]),
        ):
            result = await investigator.investigate(dependency, "Is this safe?")

        bifrost.explain_finding.assert_not_awaited()
        self.assertEqual(result.status, "no_advisory_returned")
        self.assertIsNone(result.model)

    async def test_gateway_failure_is_not_returned_as_an_explanation(self) -> None:
        bifrost = AsyncMock()
        bifrost.explain_finding.side_effect = BifrostError("Gateway error")
        investigator = SecurityInvestigator(bifrost)
        dependency = DependencyRecord("lodash", "4.17.15", "npm", True)

        with (
            patch(
                "app.agents.investigation.lookup_advisories",
                new=AsyncMock(
                    return_value=[
                        [VulnerabilityRecord(id="GHSA-test", aliases=[], summary="Verified")]
                    ]
                ),
            ),
            self.assertRaises(InvestigationError),
        ):
            await investigator.investigate(dependency, "Explain")


class AgentEndpointTests(DatabaseBackedApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.settings = Settings(
            bifrost_base_url="http://localhost:8080/openai",
            _env_file=None,
        )
        app.dependency_overrides[get_settings] = lambda: self.settings
        _, self.project_id, _ = self.create_project()

    def test_investigation_rejects_version_ranges(self) -> None:
        response = self.client.post(
            "/api/v1/agent/investigations",
            json={
                "project_id": self.project_id,
                "ecosystem": "npm",
                "package_name": "lodash",
                "version": "^4.17.15",
                "question": "Explain the advisory",
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_preflight_blocks_verified_advisory_when_bifrost_is_unavailable(self) -> None:
        bifrost = AsyncMock()
        bifrost.explain_finding.side_effect = BifrostError("Bifrost unavailable")
        with (
            patch(
                "app.api.routes.agent.lookup_advisories",
                new=AsyncMock(
                    return_value=[
                        [
                            VulnerabilityRecord(
                                id="GHSA-test",
                                aliases=["CVE-2025-0001"],
                                summary="Verified advisory",
                            )
                        ]
                    ]
                ),
            ),
            patch("app.api.routes.agent.BifrostClient", return_value=bifrost),
        ):
            response = self.client.post(
                "/api/v1/agent/preflight",
                json={
                    "project_id": self.project_id,
                    "ecosystem": "npm",
                    "package_name": "lodash",
                    "version": "4.17.15",
                },
            )

        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        self.assertEqual(result["decision"], "block")
        self.assertEqual(result["evidence"][0]["id"], "GHSA-test")
        self.assertEqual(result["explanation_status"], "unavailable")
        detail = self.client.get(
            f"/api/v1/agent/investigations/{result['investigation_id']}"
        )
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["evidence"][0]["id"], "GHSA-test")
        self.assertEqual(detail.json()["status"], "completed")

    def test_preflight_warns_on_untrusted_metadata_without_advisory(self) -> None:
        with patch(
            "app.api.routes.agent.lookup_advisories",
            new=AsyncMock(return_value=[[]]),
        ):
            response = self.client.post(
                "/api/v1/agent/preflight",
                json={
                    "project_id": self.project_id,
                    "ecosystem": "npm",
                    "package_name": "example-package",
                    "version": "1.2.3",
                    "metadata": {
                        "deprecated": "Use a maintained alternative",
                        "lifecycle_scripts": ["postinstall"],
                    },
                },
            )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["decision"], "warn")
        detail = self.client.get(
            f"/api/v1/agent/investigations/{response.json()['investigation_id']}"
        )
        self.assertEqual(detail.status_code, 200)
        self.assertIn(
            "registry.metadata_received",
            [event["event_type"] for event in detail.json()["events"]],
        )

    def test_python_preflight_uses_pypi_ecosystem_and_warns_for_yanked_releases(self) -> None:
        lookup = AsyncMock(return_value=[[]])
        with patch("app.api.routes.agent.lookup_advisories", lookup):
            response = self.client.post(
                "/api/v1/agent/preflight",
                json={
                    "project_id": self.project_id,
                    "ecosystem": "python",
                    "package_name": "example-package",
                    "version": "1.2.3",
                    "metadata": {
                        "registry": "https://pypi.org/",
                        "integrity": "sha256:" + ("a" * 64),
                        "yanked": True,
                    },
                },
            )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["decision"], "warn")
        dependency = lookup.await_args.args[0][0]
        self.assertEqual(dependency.ecosystem, "python")
        self.assertEqual(dependency.name, "example-package")
        detail = self.client.get(
            f"/api/v1/agent/investigations/{response.json()['investigation_id']}"
        )
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["ecosystem"], "python")

    def test_preflight_fails_closed_when_advisory_source_is_unavailable(self) -> None:
        with patch(
            "app.api.routes.agent.lookup_advisories",
            new=AsyncMock(side_effect=AdvisoryServiceError("OSV unavailable")),
        ):
            response = self.client.post(
                "/api/v1/agent/preflight",
                json={
                    "project_id": self.project_id,
                    "ecosystem": "npm",
                    "package_name": "example-package",
                    "version": "1.2.3",
                },
            )

        self.assertEqual(response.status_code, 502)
        history = self.client.get(
            f"/api/v1/agent/projects/{self.project_id}/investigations"
        )
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()[0]["status"], "failed")

    def test_investigation_returns_osv_evidence_when_no_match_exists(self) -> None:
        with patch(
            "app.agents.investigation.lookup_advisories",
            new=AsyncMock(return_value=[[]]),
        ):
            response = self.client.post(
                "/api/v1/agent/investigations",
                json={
                    "project_id": self.project_id,
                    "ecosystem": "npm",
                    "package_name": "example-package",
                    "version": "1.2.3",
                    "question": "Is it safe?",
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], "no_advisory_returned")
        self.assertTrue(response.json()["durable_history"])
        history = self.client.get(
            f"/api/v1/agent/investigations/{response.json()['id']}"
        )
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()["status"], "completed")
        self.assertEqual(
            [event["event_type"] for event in history.json()["events"]],
            [
                "authorization.allowed",
                "investigation.started",
                "advisory.no_match",
                "investigation.completed",
            ],
        )
        self.assertEqual(history.json()["question"], "Is it safe?")

    def test_investigation_uses_bifrost_only_with_osv_evidence(self) -> None:
        captured = {}
        real_bifrost_client = BifrostClient

        def respond(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["payload"] = request.read().decode("utf-8")
            return httpx.Response(
                200,
                json={
                    "id": "bifrost-run-1",
                    "model": "openai/gpt-test",
                    "choices": [{"message": {"content": "The evidence confirms a known advisory."}}],
                    "usage": {"total_tokens": 25},
                },
            )

        transport = httpx.MockTransport(respond)

        def build_mocked_client(**kwargs: str) -> BifrostClient:
            return real_bifrost_client(
                base_url=kwargs["base_url"],
                model=kwargs["model"],
                virtual_key=kwargs["virtual_key"],
                transport=transport,
            )

        with (
            patch(
                "app.agents.investigation.lookup_advisories",
                new=AsyncMock(
                    return_value=[
                        [
                            VulnerabilityRecord(
                                id="GHSA-test",
                                aliases=[],
                                summary="Verified test advisory",
                            )
                        ]
                    ]
                ),
            ),
            patch("app.api.routes.agent.BifrostClient", side_effect=build_mocked_client),
        ):
            response = self.client.post(
                "/api/v1/agent/investigations",
                json={
                    "project_id": self.project_id,
                    "ecosystem": "npm",
                    "package_name": "lodash",
                    "version": "4.17.15",
                    "question": "Explain the verified advisory",
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], "evidence_reviewed")
        self.assertEqual(response.json()["evidence"][0]["id"], "GHSA-test")
        self.assertEqual(response.json()["model"], "openai/gpt-test")
        self.assertTrue(response.json()["durable_history"])
        self.assertEqual(captured["url"], "http://localhost:8080/openai/chat/completions")
        self.assertIn("GHSA-test", captured["payload"])
        history = self.client.get(
            f"/api/v1/agent/projects/{self.project_id}/investigations"
        )
        self.assertEqual(history.status_code, 200)
        self.assertEqual(len(history.json()), 1)

    def test_project_membership_prevents_cross_tenant_investigation(self) -> None:
        self.set_user("other-user")

        response = self.client.post(
            "/api/v1/agent/investigations",
            json={
                "project_id": self.project_id,
                "ecosystem": "npm",
                "package_name": "lodash",
                "version": "4.17.15",
                "question": "Explain",
            },
        )

        self.assertEqual(response.status_code, 404)

    def test_investigation_history_is_not_visible_to_other_tenants(self) -> None:
        with patch(
            "app.agents.investigation.lookup_advisories",
            new=AsyncMock(return_value=[[]]),
        ):
            created = self.client.post(
                "/api/v1/agent/investigations",
                json={
                    "project_id": self.project_id,
                    "ecosystem": "npm",
                    "package_name": "example-package",
                    "version": "1.2.3",
                    "question": "Is it safe?",
                },
            )
        self.assertEqual(created.status_code, 201)
        self.set_user("other-user")

        detail = self.client.get(
            f"/api/v1/agent/investigations/{created.json()['id']}"
        )
        listed = self.client.get(
            f"/api/v1/agent/projects/{self.project_id}/investigations"
        )

        self.assertEqual(detail.status_code, 404)
        self.assertEqual(listed.status_code, 404)

    def test_upstream_failure_is_recorded_on_the_run(self) -> None:
        with patch(
            "app.agents.investigation.lookup_advisories",
            new=AsyncMock(side_effect=AdvisoryServiceError("OSV unavailable")),
        ):
            response = self.client.post(
                "/api/v1/agent/investigations",
                json={
                    "project_id": self.project_id,
                    "ecosystem": "npm",
                    "package_name": "lodash",
                    "version": "4.17.15",
                    "question": "Explain",
                },
            )

        self.assertEqual(response.status_code, 502)
        history = self.client.get(
            f"/api/v1/agent/projects/{self.project_id}/investigations"
        )
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()[0]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
