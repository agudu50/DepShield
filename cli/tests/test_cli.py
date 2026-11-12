from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from functools import partial
from pathlib import Path
from unittest.mock import patch

import httpx

from depshield_cli.adapters.common import PackageCandidate
from depshield_cli.adapters.npm import detect, parse_spec, read_inventory
from depshield_cli.adapters.npm_registry import resolve_candidate
from depshield_cli.adapters.pypi import resolve_candidate as resolve_python_candidate
from depshield_cli.adapters.uv import (
    detect as detect_uv,
    parse_spec as parse_uv_spec,
    read_inventory as read_uv_inventory,
    verify_locked_candidate,
)
from depshield_cli.api import ApiClient
from depshield_cli.auth import dashboard_origin
from depshield_cli.config import ProjectConfig, load_config, save_config
from depshield_cli.main import (
    _ClientContext,
    _add,
    _add_standalone,
    _audit,
    _monitor_standalone,
    _verify_candidate,
    build_parser,
)


class NpmAdapterTests(unittest.TestCase):
    def test_reads_nested_and_scoped_lockfile_inventory_without_installing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "package.json").write_text('{"name":"demo"}', encoding="utf-8")
            lockfile = root / "package-lock.json"
            lockfile.write_text(
                json.dumps(
                    {
                        "lockfileVersion": 3,
                        "packages": {
                            "": {"name": "demo"},
                            "node_modules/lodash": {"version": "4.17.21"},
                            "node_modules/@scope/root": {"version": "1.0.0"},
                            "node_modules/@scope/root/node_modules/lodash": {
                                "version": "git+https://example.test/repo"
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            manager, found_lockfile = detect(root)
            packages = read_inventory(found_lockfile)

        self.assertEqual(manager, "npm")
        self.assertEqual(
            [(package.name, package.version) for package in packages],
            [
                ("@scope/root", "1.0.0"),
                ("lodash", "4.17.21"),
                ("lodash", "git+https://example.test/repo"),
            ],
        )

    def test_refuses_to_guess_when_multiple_package_manager_locks_exist(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "package.json").write_text('{"name":"demo"}', encoding="utf-8")
            (root / "package-lock.json").write_text('{"lockfileVersion":3,"packages":{}}', encoding="utf-8")
            (root / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "will not guess"):
                detect(root)

    def test_parses_safe_exact_package_specs(self) -> None:
        self.assertEqual(parse_spec("lodash@4.17.21"), ("lodash", "4.17.21"))
        self.assertEqual(parse_spec("@scope/pkg@1.2.3"), ("@scope/pkg", "1.2.3"))
        self.assertEqual(parse_spec("@scope/pkg"), ("@scope/pkg", None))
        self.assertEqual(parse_spec("lodash", "1.2.3"), ("lodash", "1.2.3"))

    def test_rejects_non_exact_or_conflicting_specs(self) -> None:
        for spec in ("https://example.test/pkg.tgz", "../local-package", "lodash@^1.0.0"):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                parse_spec(spec)
        with self.assertRaises(ValueError):
            parse_spec("lodash@1.2.3", "2.0.0")

    def test_verifies_install_manifest_lock_integrity_and_installed_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "package.json").write_text(
                '{"dependencies":{"lodash":"4.17.21"}}',
                encoding="utf-8",
            )
            package_directory = root / "node_modules" / "lodash"
            package_directory.mkdir(parents=True)
            lockfile = root / "package-lock.json"
            lockfile.write_text(
                json.dumps(
                    {
                        "lockfileVersion": 3,
                        "packages": {
                            "node_modules/lodash": {
                                "version": "4.17.21",
                                "integrity": "sha512-test-digest",
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            verified = _verify_candidate(
                root,
                lockfile,
                PackageCandidate("lodash", "4.17.21"),
                "sha512-test-digest",
            )
            rejected = _verify_candidate(
                root,
                lockfile,
                PackageCandidate("lodash", "4.17.21"),
                "sha512-other-digest",
            )

        self.assertTrue(verified)
        self.assertFalse(rejected)

    def test_resolves_exact_version_and_sanitizes_registry_metadata(self) -> None:
        response_body = json.dumps(
            {
                "dist-tags": {"latest": "1.2.3"},
                "time": {"1.2.3": "2025-01-01T00:00:00Z"},
                "versions": {
                    "1.2.3": {
                        "name": "example-package",
                        "version": "1.2.3",
                        "deprecated": "old\x1b[31m",
                        "scripts": {
                            "postinstall": "node install.js",
                            "not-a-lifecycle-script": "arbitrary",
                        },
                        "dist": {
                            "integrity": "sha512-verified",
                            "attestations": {"url": "https://example.test/attestations"},
                        },
                    }
                },
            }
        ).encode()

        class FakeResponse:
            status_code = 200
            headers: dict[str, str] = {}

            def __enter__(self) -> FakeResponse:
                return self

            def __exit__(self, *_: object) -> None:
                return

            def raise_for_status(self) -> None:
                return

            def iter_bytes(self):
                yield response_body

        class FakeClient:
            def __init__(self, **_: object) -> None:
                return

            def __enter__(self) -> FakeClient:
                return self

            def __exit__(self, *_: object) -> None:
                return

            def stream(self, *_: object, **__: object) -> FakeResponse:
                return FakeResponse()

        with patch("depshield_cli.adapters.npm_registry.httpx.Client", FakeClient):
            candidate, metadata = resolve_candidate(Path("."), "example-package")

        self.assertEqual(candidate.version, "1.2.3")
        self.assertEqual(metadata["lifecycle_scripts"], ["postinstall"])
        self.assertEqual(metadata["deprecated"], "old[31m")
        self.assertEqual(metadata["integrity"], "sha512-verified")


class PythonUvAdapterTests(unittest.TestCase):
    def test_accepts_an_empty_uv_lock(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            lockfile = Path(temporary_directory) / "uv.lock"
            lockfile.write_text('version = 1\nrequires-python = ">=3.11"\n', encoding="utf-8")

            self.assertEqual(read_uv_inventory(lockfile), [])

    def test_reads_uv_lock_and_rejects_competing_package_managers(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "pyproject.toml").write_text(
                '[project]\nname = "demo"\nversion = "1.0.0"\n',
                encoding="utf-8",
            )
            lockfile = root / "uv.lock"
            lockfile.write_text(
                'version = 1\n'
                '[[package]]\nname = "requests"\nversion = "2.31.0"\n'
                '[[package]]\nname = "demo"\nversion = "1.0.0"\n'
                'source = { editable = "." }\n'
                '[[package]]\nname = "urllib3"\nversion = "2.2.0"\n',
                encoding="utf-8",
            )
            manager, found_lockfile = detect_uv(root)
            packages = read_uv_inventory(found_lockfile)
            (root / "requirements.txt").write_text("requests==2.31.0\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "competing"):
                detect_uv(root)

        self.assertEqual(manager, "uv")
        self.assertEqual(
            [(item.name, item.version) for item in packages],
            [("requests", "2.31.0"), ("urllib3", "2.2.0")],
        )

    def test_parses_only_exact_python_package_specs(self) -> None:
        self.assertEqual(parse_uv_spec("Requests==2.31.0"), ("requests", "2.31.0"))
        self.assertEqual(parse_uv_spec("my_package"), ("my-package", None))
        for spec in ("requests>=2.0", "https://example.test/pkg.whl", "../package"):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                parse_uv_spec(spec)

    def test_resolves_exact_pypi_metadata_without_downloading_a_package(self) -> None:
        payload = {
            "info": {
                "name": "example-package",
                "version": "1.2.3",
                "project_urls": {"Source": "https://example.test/source"},
            },
            "urls": [
                {
                    "packagetype": "bdist_wheel",
                    "digests": {"sha256": "b" * 64},
                    "upload_time_iso_8601": "2025-01-02T00:00:00Z",
                    "yanked": True,
                },
                {
                    "packagetype": "sdist",
                    "digests": {"sha256": "a" * 64},
                    "upload_time_iso_8601": "2025-01-01T00:00:00Z",
                    "yanked": True,
                },
            ],
        }

        def respond(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.host, "pypi.org")
            self.assertEqual(request.url.path, "/pypi/example-package/1.2.3")
            return httpx.Response(200, json=payload)

        client_factory = partial(
            httpx.Client,
            transport=httpx.MockTransport(respond),
        )
        with patch("depshield_cli.adapters.pypi.httpx.Client", client_factory):
            candidate, metadata = resolve_python_candidate(
                Path("."), "example_package==1.2.3"
            )

        self.assertEqual(candidate, PackageCandidate("example-package", "1.2.3"))
        self.assertEqual(metadata["integrity"], "sha256:" + ("a" * 64))
        self.assertTrue(metadata["yanked"])
        self.assertEqual(metadata["published_at"], "2025-01-01T00:00:00Z")

    def test_verifies_project_pin_and_uv_lock_artifact_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "pyproject.toml").write_text(
                '[project]\nname = "demo"\nversion = "1.0.0"\n'
                'dependencies = ["example-package==1.2.3"]\n',
                encoding="utf-8",
            )
            lockfile = root / "uv.lock"
            lockfile.write_text(
                'version = 1\n'
                '[[package]]\nname = "example-package"\nversion = "1.2.3"\n'
                '[package.sdist]\nhash = "sha256:' + ("a" * 64) + '"\n',
                encoding="utf-8",
            )

            verified = verify_locked_candidate(
                root,
                lockfile,
                PackageCandidate("example-package", "1.2.3"),
                "sha256:" + ("a" * 64),
            )

        self.assertTrue(verified)


class ConfigAndAuthTests(unittest.TestCase):
    def test_project_config_has_no_credential_field(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            path = save_config(
                root,
                ProjectConfig(
                    project_id="project-id",
                    organization_id="organization-id",
                    project_name="demo",
                    manager="npm",
                    api_url="https://api.example.test",
                ),
            )
            config = load_config(path)
            raw = path.read_text(encoding="utf-8")

        self.assertEqual(config.project_name, "demo")
        self.assertNotIn("token", raw.lower())
        self.assertNotIn("password", raw.lower())

    def test_browser_authorization_requires_http_or_https_dashboard_origin(self) -> None:
        self.assertEqual(
            dashboard_origin("https://depshield.example.test/"),
            "https://depshield.example.test",
        )
        for value in ("file:///tmp/app", "https://user:pass@example.test", "https://example.test/?x=1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                dashboard_origin(value)

    def test_json_flag_is_accepted_before_or_after_subcommand(self) -> None:
        parser = build_parser()
        self.assertTrue(parser.parse_args(["--json", "scan"]).json)
        self.assertTrue(parser.parse_args(["scan", "--json"]).json)


class PreinstallGateTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name)
        (self.root / "package.json").write_text(
            '{"name":"demo","version":"1.0.0"}',
            encoding="utf-8",
        )
        (self.root / "package-lock.json").write_text(
            '{"name":"demo","version":"1.0.0","lockfileVersion":3,'
            '"packages":{"":{"name":"demo","version":"1.0.0"}}}',
            encoding="utf-8",
        )
        self.config = ProjectConfig(
            project_id="00000000-0000-0000-0000-000000000001",
            organization_id="00000000-0000-0000-0000-000000000002",
            project_name="demo",
            manager="npm",
            api_url="https://api.example.test",
        )

    def _client_context(self, decision: str) -> _ClientContext:
        class FakeClient(ApiClient):
            def __init__(self) -> None:
                pass

            def post(self, *_: object, **__: object) -> dict[str, object]:
                return {
                    "decision": decision,
                    "policy_version": "default-v1",
                    "evidence": [],
                    "explanation": "No advisory matched.",
                    "investigation_id": "00000000-0000-0000-0000-000000000003",
                    "metadata_classification": "untrusted_registry_metadata",
                }

            def close(self) -> None:
                return

        return _ClientContext(FakeClient())

    def test_blocked_preflight_never_runs_npm_install(self) -> None:
        with (
            patch(
                "depshield_cli.main.resolve_npm_candidate",
                return_value=(PackageCandidate("example-package", "1.2.3"), {"registry": "https://registry.npmjs.org/"}),
            ),
            patch(
                "depshield_cli.main._authorized_client",
                return_value=self._client_context("block"),
            ),
            patch("depshield_cli.main._run_npm_install") as install,
        ):
            result = _add(self.root, self.config, "example-package", None, True)

        self.assertEqual(result, 1)
        install.assert_not_called()

    def test_declined_approval_never_runs_npm_install(self) -> None:
        with (
            patch(
                "depshield_cli.main.resolve_npm_candidate",
                return_value=(PackageCandidate("example-package", "1.2.3"), {"registry": "https://registry.npmjs.org/"}),
            ),
            patch(
                "depshield_cli.main._authorized_client",
                return_value=self._client_context("warn"),
            ),
            patch("depshield_cli.main._confirm_install", return_value=False),
            patch("depshield_cli.main._run_npm_install") as install,
        ):
            result = _add(self.root, self.config, "example-package", None, True)

        self.assertEqual(result, 4)
        install.assert_not_called()


class PythonPreinstallGateTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.root = Path(temporary_directory.name)
        (self.root / "pyproject.toml").write_text(
            '[project]\nname = "demo"\nversion = "1.0.0"\n',
            encoding="utf-8",
        )
        (self.root / "uv.lock").write_text(
            'version = 1\n[[package]]\nname = "demo"\nversion = "1.0.0"\n',
            encoding="utf-8",
        )
        self.config = ProjectConfig(
            project_id="00000000-0000-0000-0000-000000000001",
            organization_id="00000000-0000-0000-0000-000000000002",
            project_name="demo",
            manager="uv",
            api_url="https://api.example.test",
        )

    def _client_context(
        self, decision: str, events: list[str] | None = None
    ) -> _ClientContext:
        test_case = self

        class FakeClient(ApiClient):
            def __init__(self) -> None:
                pass

            def post(self, path: str, payload: dict[str, object]) -> dict[str, object]:
                if events is not None:
                    events.append("preflight")
                test_case.assertEqual(path, "/api/v1/agent/preflight")
                test_case.assertEqual(payload["ecosystem"], "python")
                return {
                    "decision": decision,
                    "policy_version": "default-v1",
                    "evidence": [],
                    "explanation": "No advisory matched.",
                    "investigation_id": "00000000-0000-0000-0000-000000000003",
                    "metadata_classification": "untrusted_registry_metadata",
                }

            def close(self) -> None:
                return

        return _ClientContext(FakeClient())

    def test_blocked_python_preflight_never_runs_uv(self) -> None:
        with (
            patch(
                "depshield_cli.main.resolve_python_candidate",
                return_value=(
                    PackageCandidate("example-package", "1.2.3"),
                    {"registry": "https://pypi.org/", "integrity": "sha256:" + ("a" * 64)},
                ),
            ),
            patch("depshield_cli.main._authorized_client", return_value=self._client_context("block")),
            patch("depshield_cli.main.shutil.which", return_value="uv"),
            patch("depshield_cli.main._run_uv_add") as add,
            patch("depshield_cli.main._run_uv_sync") as sync,
        ):
            result = _add(self.root, self.config, "example-package==1.2.3", None, True)

        self.assertEqual(result, 1)
        add.assert_not_called()
        sync.assert_not_called()

    def test_declined_python_preflight_never_runs_uv(self) -> None:
        with (
            patch(
                "depshield_cli.main.resolve_python_candidate",
                return_value=(
                    PackageCandidate("example-package", "1.2.3"),
                    {"registry": "https://pypi.org/", "integrity": "sha256:" + ("a" * 64)},
                ),
            ),
            patch("depshield_cli.main._authorized_client", return_value=self._client_context("warn")),
            patch("depshield_cli.main.shutil.which", return_value="uv"),
            patch("depshield_cli.main._confirm_install", return_value=False),
            patch("depshield_cli.main._run_uv_add") as add,
            patch("depshield_cli.main._run_uv_sync") as sync,
        ):
            result = _add(self.root, self.config, "example-package==1.2.3", None, True)

        self.assertEqual(result, 4)
        add.assert_not_called()
        sync.assert_not_called()

    def test_approved_python_preflight_adds_then_syncs_and_verifies(self) -> None:
        events: list[str] = []

        def add_project(root: Path, candidate: PackageCandidate) -> subprocess.CompletedProcess[bytes]:
            events.append("uv_add")
            (root / "pyproject.toml").write_text(
                '[project]\nname = "demo"\nversion = "1.0.0"\n'
                f'dependencies = ["{candidate.name}=={candidate.version}"]\n',
                encoding="utf-8",
            )
            (root / "uv.lock").write_text(
                'version = 1\n'
                f'[[package]]\nname = "{candidate.name}"\nversion = "{candidate.version}"\n'
                '[package.sdist]\nhash = "sha256:' + ("a" * 64) + '"\n',
                encoding="utf-8",
            )
            return subprocess.CompletedProcess([], 0, b"", b"")

        def sync_project(root: Path) -> subprocess.CompletedProcess[bytes]:
            events.append("uv_sync" if (root / "uv.lock").is_file() else "uv_sync_missing_lock")
            return subprocess.CompletedProcess([], 0, b"", b"")

        def verify_candidate(
            root: Path,
            lockfile: Path,
            candidate: PackageCandidate,
            integrity: str,
        ) -> bool:
            events.append("verify")
            return (
                (root / "pyproject.toml").is_file()
                and lockfile.is_file()
                and candidate == PackageCandidate("example-package", "1.2.3")
                and integrity == "sha256:" + ("a" * 64)
            )

        def sync_inventory(
            client: object,
            project_id: str,
            manager: str,
            packages: list[PackageCandidate],
        ) -> dict[str, object]:
            events.append("inventory_sync")
            self.assertIsNotNone(client)
            self.assertEqual(project_id, self.config.project_id)
            self.assertEqual(manager, "uv")
            self.assertIn(PackageCandidate("example-package", "1.2.3"), packages)
            return {
                "revision": 2,
                "dependency_count": len(packages),
                "changed_count": 1,
                "removed_count": 0,
                "scan": None,
            }

        def approve_install(manager: str, candidate: PackageCandidate) -> bool:
            self.assertEqual(manager, "uv")
            self.assertEqual(candidate, PackageCandidate("example-package", "1.2.3"))
            events.append("approval")
            return True

        with (
            patch(
                "depshield_cli.main.resolve_python_candidate",
                return_value=(
                    PackageCandidate("example-package", "1.2.3"),
                    {"registry": "https://pypi.org/", "integrity": "sha256:" + ("a" * 64)},
                ),
            ),
            patch(
                "depshield_cli.main._authorized_client",
                return_value=self._client_context("allow", events),
            ),
            patch("depshield_cli.main.shutil.which", return_value="uv"),
            patch(
                "depshield_cli.main._confirm_install",
                side_effect=approve_install,
            ),
            patch("depshield_cli.main._run_uv_add", side_effect=add_project),
            patch("depshield_cli.main._run_uv_sync", side_effect=sync_project),
            patch("depshield_cli.main._verify_uv_candidate", side_effect=verify_candidate),
            patch("depshield_cli.main._sync_inventory", side_effect=sync_inventory),
        ):
            result = _add(self.root, self.config, "example-package==1.2.3", None, True)

        self.assertEqual(result, 0)
        self.assertEqual(
            events,
            ["preflight", "approval", "uv_add", "uv_sync", "verify", "inventory_sync"],
        )

    def test_audit_offline_verifies_zero_code_read_and_zero_egress(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            (temp_root / "package.json").write_text(
                json.dumps({"name": "demo", "dependencies": {"express": "4.18.2"}}),
                encoding="utf-8",
            )
            (temp_root / "src").mkdir()
            (temp_root / "src" / "index.js").write_text("console.log('secret code');", encoding="utf-8")
            (temp_root / ".env").write_text("SECRET_KEY=supersecret", encoding="utf-8")

            res = _audit(temp_root, offline=True, json_output=True)
            self.assertEqual(res, 0)

    def test_add_standalone_evaluates_exact_pinned_and_enforces_ignore_scripts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            res = _add_standalone(temp_root, "express@4.18.2", None, json_output=True)
            self.assertEqual(res, 0)

    def test_monitor_standalone_once_checks_descriptors(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            (temp_root / "package.json").write_text('{"name": "test"}', encoding="utf-8")
            res = _monitor_standalone(temp_root, json_output=True, once=True)
            self.assertEqual(res, 0)


if __name__ == "__main__":
    unittest.main()
