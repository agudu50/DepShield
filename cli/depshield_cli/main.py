from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import tomllib
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from depshield_cli.adapters.common import PackageCandidate
from depshield_cli.adapters.npm import (
    detect as detect_npm,
    parse_spec as parse_npm_spec,
    read_inventory as read_npm_inventory,
)
from depshield_cli.adapters.npm_registry import resolve_candidate as resolve_npm_candidate
from depshield_cli.adapters.pypi import resolve_candidate as resolve_python_candidate
from depshield_cli.adapters.uv import (
    detect as detect_uv,
    parse_spec as parse_uv_spec,
    read_inventory as read_uv_inventory,
    verify_locked_candidate,
)
from depshield_cli.api import ApiClient, ApiError
from depshield_cli.auth import delete_token, get_token, receive_browser_token, store_token
from depshield_cli.config import ProjectConfig, find_config, load_config, save_config

DEFAULT_API_URL = "http://localhost:8000"
DEFAULT_DASHBOARD_URL = "http://localhost:5173"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="depshield")
    parser.add_argument("--version", action="version", version="depshield 0.1.0")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")
    commands = parser.add_subparsers(dest="command", required=True)

    login_parser = commands.add_parser("login", help="Authorize this CLI in the browser")
    login_parser.add_argument("--api-url", default=os.environ.get("DEPSHIELD_API_URL", DEFAULT_API_URL))
    login_parser.add_argument(
        "--dashboard-url",
        default=os.environ.get("DEPSHIELD_DASHBOARD_URL", DEFAULT_DASHBOARD_URL),
    )

    init_parser = commands.add_parser("init", help="Register this supported project with DepShield")
    init_parser.add_argument("--project-root", type=Path, default=Path.cwd())
    init_parser.add_argument("--name", help="DepShield project name (defaults to folder name)")
    init_parser.add_argument("--api-url", default=os.environ.get("DEPSHIELD_API_URL", DEFAULT_API_URL))
    init_parser.add_argument(
        "--dashboard-url",
        default=os.environ.get("DEPSHIELD_DASHBOARD_URL", DEFAULT_DASHBOARD_URL),
    )

    commands.add_parser("scan", help="Synchronize and assess the current dependency lockfile")
    commands.add_parser("status", help="Show project and API status")
    commands.add_parser("monitor", help="Watch supported dependency files in the foreground")

    add_parser = commands.add_parser("add", help="Check a package before installing it")
    add_parser.add_argument("package", help="Package name and optional exact version")
    add_parser.add_argument("--version", help="Exact package version")

    explain_parser = commands.add_parser("explain", help="Show a saved finding or investigation")
    explain_parser.add_argument("finding_or_package")

    fix_parser = commands.add_parser("fix", help="Propose a safe remediation")
    fix_parser.add_argument("finding")

    commands.add_parser("report", help="Show the latest saved scan report")
    commands.add_parser("logout", help="Remove this CLI token from the OS credential store")
    for subparser in commands.choices.values():
        subparser.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return _dispatch(args)
    except (ApiError, OSError, RuntimeError, TimeoutError, ValueError) as exc:
        _error(str(exc), args.json)
        return 2


def _dispatch(args: argparse.Namespace) -> int:
    if args.command == "login":
        return _login(args.api_url, args.dashboard_url, args.json)
    if args.command == "init":
        return _init(args)
    if args.command == "logout":
        return _logout(args.json)
    if args.command == "fix":
        _output(
            {
                "status": "not_available",
                "message": (
                    "DepShield has no verified fix candidate for this finding yet. "
                    "No manifest, lockfile, or installed package was modified."
                ),
            },
            args.json,
        )
        return 2

    root, config = _load_project_config(Path.cwd())
    if args.command == "scan":
        return _scan(root, config, args.json)
    if args.command == "status":
        return _status(root, config, args.json)
    if args.command == "monitor":
        return _monitor(root, config, args.json)
    if args.command == "add":
        return _add(root, config, args.package, args.version, args.json)
    if args.command == "explain":
        return _explain(config, args.finding_or_package, args.json)
    if args.command == "report":
        return _report(config, args.json)
    raise ValueError(f"Unknown command: {args.command}")


def _login(api_url: str, dashboard_url: str, json_output: bool) -> int:
    _validate_api_url(api_url)
    token = receive_browser_token(dashboard_url)
    store_token(api_url.rstrip("/"), token)
    _output({"status": "authorized", "api_url": api_url.rstrip("/")}, json_output)
    return 0


def _logout(json_output: bool) -> int:
    config_data = find_config(Path.cwd())
    api_url = (
        load_config(config_data[1]).api_url
        if config_data
        else os.environ.get("DEPSHIELD_API_URL", DEFAULT_API_URL)
    )
    delete_token(api_url.rstrip("/"))
    _output({"status": "logged_out"}, json_output)
    return 0


def _init(args: argparse.Namespace) -> int:
    root = args.project_root.resolve()
    manager, lockfile = _detect_project(root)
    packages = _read_inventory(manager, lockfile)
    api_url = args.api_url.rstrip("/")
    _validate_api_url(api_url)
    token = get_token(api_url)
    if not token:
        token = receive_browser_token(args.dashboard_url)
        store_token(api_url, token)

    project_metadata = (
        _read_package_json(root)
        if manager == "npm"
        else _read_python_project(root)
    )
    metadata_name = project_metadata.get("name")
    project_name = (
        args.name
        or (metadata_name if isinstance(metadata_name, str) and metadata_name.strip() else None)
        or root.name
    )
    return _register_project(
        root,
        manager,
        packages,
        project_name,
        api_url,
        token,
        args.json,
    )


def _register_project(
    root: Path,
    manager: str,
    packages: list[PackageCandidate],
    project_name: str,
    api_url: str,
    token: str,
    json_output: bool,
) -> int:
    client = ApiClient(api_url, token)
    try:
        organizations = client.get("/api/v1/organizations")
        if not isinstance(organizations, list):
            raise ApiError("DepShield returned an invalid organization list")
        organization = _select_organization(client, organizations)
        projects = client.get(f"/api/v1/organizations/{organization['id']}/projects")
        if not isinstance(projects, list):
            raise ApiError("DepShield returned an invalid project list")
        project = next(
            (item for item in projects if isinstance(item, dict) and item.get("name") == project_name),
            None,
        )
        if project is None:
            project = client.post(
                f"/api/v1/organizations/{organization['id']}/projects",
                {"name": project_name},
            )
        if not isinstance(project, dict) or not isinstance(project.get("id"), str):
            raise ApiError("DepShield returned an invalid project registration")

        config = ProjectConfig(
            project_id=project["id"],
            organization_id=organization["id"],
            project_name=project_name,
            manager=manager,
            api_url=api_url,
        )
        config_path = save_config(root, config)
        inventory = _sync_inventory(client, project["id"], manager, packages)
    finally:
        client.close()

    _output(
        {
            "status": "initialized",
            "project": project_name,
            "project_id": project["id"],
            "config": str(config_path),
            "dependency_count": inventory["dependency_count"],
            "changed_count": inventory["changed_count"],
            "removed_count": inventory["removed_count"],
            "assessment": inventory.get("scan"),
        },
        json_output,
    )
    return 0


def _select_organization(client: ApiClient, organizations: list[Any]) -> dict[str, Any]:
    valid_organizations = [
        item for item in organizations if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]
    if not valid_organizations:
        name = input("No organization exists. Name for a new organization: ").strip()
        if not name:
            raise ValueError("Organization name cannot be blank")
        organization = client.post("/api/v1/organizations", {"name": name})
        if not isinstance(organization, dict) or not isinstance(organization.get("id"), str):
            raise ApiError("DepShield returned an invalid organization")
        return organization
    if len(valid_organizations) == 1:
        return valid_organizations[0]
    print("Choose a DepShield organization:")
    for index, organization in enumerate(valid_organizations, 1):
        print(f"  {index}. {organization.get('name', 'Unnamed organization')}")
    choice = _read_choice(len(valid_organizations))
    return valid_organizations[choice - 1]


def _scan(root: Path, config: ProjectConfig, json_output: bool) -> int:
    manager, lockfile = _detect_project(root)
    _ensure_project_manager(manager, config)
    packages = _read_inventory(manager, lockfile)
    with _authorized_client(config) as client:
        result = _sync_inventory(client, config.project_id, manager, packages)
    _output(result, json_output)
    return 0


def _sync_inventory(
    client: ApiClient,
    project_id: str,
    manager: str,
    packages: list[PackageCandidate],
) -> dict[str, Any]:
    result = client.put(
        f"/api/v1/projects/{project_id}/inventory",
        {
            "manager": manager,
            "packages": [{"name": item.name, "version": item.version} for item in packages],
        },
    )
    if not isinstance(result, dict) or any(
        not isinstance(result.get(key), int) or isinstance(result.get(key), bool)
        for key in ("revision", "dependency_count", "changed_count", "removed_count")
    ):
        raise ApiError("DepShield returned an invalid inventory synchronization response")
    if result.get("scan") is not None and not isinstance(result.get("scan"), dict):
        raise ApiError("DepShield returned an invalid inventory assessment")
    return result


def _status(root: Path, config: ProjectConfig, json_output: bool) -> int:
    manager, lockfile = _detect_project(root)
    _ensure_project_manager(manager, config)
    packages = _read_inventory(manager, lockfile)
    with _authorized_client(config) as client:
        organizations = client.get("/api/v1/organizations")
        scans = client.get(f"/api/v1/projects/{config.project_id}/scans")
    if not isinstance(organizations, list) or not isinstance(scans, list):
        raise ApiError("DepShield returned an invalid status response")
    result = {
        "project": config.project_name,
        "project_id": config.project_id,
        "manager": manager,
        "lockfile": str(lockfile),
        "dependency_count": len(packages),
        "organization_count": len(organizations),
        "last_scan": scans[0] if scans else None,
        "api_url": config.api_url,
    }
    _output(result, json_output)
    return 0


def _monitor(root: Path, config: ProjectConfig, json_output: bool) -> int:
    manager, _ = _detect_project(root)
    _ensure_project_manager(manager, config)
    watched = _watched_files(root)
    snapshot = _file_snapshot(watched)
    retry_after = 0.0
    print(f"Monitoring {root}; press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
            current = _file_snapshot(watched)
            if current == snapshot or time.monotonic() < retry_after:
                continue
            time.sleep(0.5)
            current = _file_snapshot(watched)
            if current == snapshot:
                continue
            try:
                watched = _watched_files(root)
                stable_before = _file_snapshot(watched)
                if stable_before != current:
                    continue
                updated_manager, updated_lockfile = _detect_project(root)
                _ensure_project_manager(updated_manager, config)
                inventory = _read_inventory(updated_manager, updated_lockfile)
                stable_after = _file_snapshot(watched)
                if stable_after != stable_before:
                    continue
                with _authorized_client(config) as client:
                    result = _sync_inventory(client, config.project_id, updated_manager, inventory)
                _output(
                    {
                        "status": "synchronized",
                        "dependency_count": result["dependency_count"],
                        "changed_count": result["changed_count"],
                        "removed_count": result["removed_count"],
                    },
                    json_output,
                )
                snapshot = stable_after
                retry_after = 0.0
            except ApiError as exc:
                _error(str(exc), json_output)
                retry_after = time.monotonic() + 5.0
            except (OSError, ValueError) as exc:
                _error(str(exc), json_output)
                snapshot = current
                retry_after = 0.0
    except KeyboardInterrupt:
        print("Monitoring stopped.")
    return 0


def _add(
    root: Path,
    config: ProjectConfig,
    package_spec: str,
    requested_version: str | None,
    json_output: bool,
) -> int:
    manager, lockfile = _detect_project(root)
    _ensure_project_manager(manager, config)
    executable_name = "npm" if manager == "npm" else "uv"
    if shutil.which(executable_name) is None:
        raise RuntimeError(
            f"{executable_name} was not found; no preflight or installation was attempted"
        )
    if manager == "npm":
        package_name, parsed_version = parse_npm_spec(package_spec, requested_version)
        candidate, metadata = resolve_npm_candidate(
            root, package_name, parsed_version or requested_version
        )
        ecosystem = "npm"
    else:
        package_name, parsed_version = parse_uv_spec(package_spec, requested_version)
        candidate, metadata = resolve_python_candidate(
            root, package_name, parsed_version or requested_version
        )
        ecosystem = "python"
    with _authorized_client(config) as client:
        preflight = client.post(
            "/api/v1/agent/preflight",
            {
                "project_id": config.project_id,
                "ecosystem": ecosystem,
                "package_name": candidate.name,
                "version": candidate.version,
                "metadata": metadata,
            },
        )
    if (
        not isinstance(preflight, dict)
        or preflight.get("decision") not in {"allow", "warn", "block"}
        or not isinstance(preflight.get("evidence"), list)
        or not isinstance(preflight.get("explanation"), str)
        or not isinstance(preflight.get("policy_version"), str)
        or not isinstance(preflight.get("investigation_id"), str)
        or preflight.get("metadata_classification") != "untrusted_registry_metadata"
    ):
        raise ApiError("DepShield returned an invalid preflight decision")

    _output(
        {
            "decision": preflight["decision"],
            "policy_version": preflight["policy_version"],
            "package": candidate.name,
            "version": candidate.version,
            "registry": metadata.get("registry"),
            "published_at": metadata.get("published_at"),
            "deprecated": metadata.get("deprecated"),
            "repository": metadata.get("repository"),
            "provenance_url": metadata.get("provenance_url"),
            "integrity": metadata.get("integrity"),
            "lifecycle_scripts": metadata.get("lifecycle_scripts"),
            "metadata_classification": preflight["metadata_classification"],
            "evidence": preflight["evidence"],
            "explanation": preflight["explanation"],
            "investigation_id": preflight["investigation_id"],
        },
        json_output,
    )
    if preflight["decision"] == "block":
        print("Installation blocked by DepShield policy.", file=sys.stderr)
        return 1
    if not _confirm_install(manager, candidate):
        return 4

    if manager == "npm":
        result = _run_npm_install(root, candidate)
        if result.returncode:
            raise RuntimeError(f"npm install failed with exit code {result.returncode}")
        manager, lockfile = detect_npm(root)
        inventory = read_npm_inventory(lockfile)
        verified = _verify_candidate(
            root, lockfile, candidate, str(metadata.get("integrity") or "")
        )
        failure_detail = (
            "npm install completed but the manifest, installed path, lockfile version, or integrity "
            "did not match the preflight candidate"
        )
    else:
        add_result = _run_uv_add(root, candidate)
        if add_result.returncode:
            raise RuntimeError(f"uv add failed with exit code {add_result.returncode}")
        sync_result = _run_uv_sync(root)
        if sync_result.returncode:
            raise RuntimeError(
                "uv updated project metadata, but dependency synchronization failed; "
                "inspect the project before retrying"
            )
        manager, lockfile = detect_uv(root)
        inventory = read_uv_inventory(lockfile)
        verified = _verify_uv_candidate(
            root, lockfile, candidate, str(metadata.get("integrity") or "")
        )
        failure_detail = (
            "uv completed but the project declaration, lockfile version, artifact hash, or "
            "installed version did not match the preflight candidate"
        )
    if not verified:
        raise RuntimeError(f"{failure_detail}; inventory was not synchronized")
    with _authorized_client(config) as client:
        sync_result = _sync_inventory(client, config.project_id, manager, inventory)
    _output(
        {
            "status": "installed_and_synchronized",
            "package": candidate.name,
            "version": candidate.version,
            "changed_count": sync_result["changed_count"],
            "removed_count": sync_result["removed_count"],
        },
        json_output,
    )
    return 0


def _run_npm_install(
    root: Path,
    candidate: PackageCandidate,
) -> subprocess.CompletedProcess[bytes]:
    executable = shutil.which("npm")
    if executable is None:
        raise RuntimeError("npm was not found; no installation was attempted")
    args = [
        executable,
        "install",
        "--ignore-scripts",
        "--save-exact",
        "--global=false",
        f"{candidate.name}@{candidate.version}",
    ]
    try:
        return subprocess.run(
            args,
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=600,
            check=False,
            shell=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("npm install timed out; inspect the project before retrying") from exc


def _run_uv_add(
    root: Path,
    candidate: PackageCandidate,
) -> subprocess.CompletedProcess[bytes]:
    executable = shutil.which("uv")
    if executable is None:
        raise RuntimeError("uv was not found; no installation was attempted")
    return _run_package_manager(
        [executable, "add", "--no-sync", f"{candidate.name}=={candidate.version}"],
        root,
        "uv add",
    )


def _run_uv_sync(root: Path) -> subprocess.CompletedProcess[bytes]:
    executable = shutil.which("uv")
    if executable is None:
        raise RuntimeError("uv was not found; no installation was attempted")
    return _run_package_manager([executable, "sync"], root, "uv sync")


def _run_package_manager(
    args: list[str],
    root: Path,
    operation: str,
) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            args,
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=600,
            check=False,
            shell=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{operation} timed out; inspect the project before retrying") from exc


def _verify_candidate(
    root: Path,
    lockfile: Path,
    candidate: PackageCandidate,
    expected_integrity: str,
) -> bool:
    manifest = _read_package_json(root)
    declared = False
    for section_name in (
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    ):
        section = manifest.get(section_name)
        if isinstance(section, dict) and section.get(candidate.name) == candidate.version:
            declared = True
            break
    if not declared or not (root / "node_modules" / Path(*candidate.name.split("/"))).exists():
        return False
    try:
        lock_data = json.loads(lockfile.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    direct_path = "node_modules/" + candidate.name
    packages = lock_data.get("packages")
    if isinstance(packages, dict):
        entry = packages.get(direct_path)
        return (
            isinstance(entry, dict)
            and entry.get("version") == candidate.version
            and entry.get("integrity") == expected_integrity
        )
    dependencies = lock_data.get("dependencies")
    if isinstance(dependencies, dict):
        entry = dependencies.get(candidate.name)
        return (
            isinstance(entry, dict)
            and entry.get("version") == candidate.version
            and entry.get("integrity") == expected_integrity
        )
    return False


def _verify_uv_candidate(
    root: Path,
    lockfile: Path,
    candidate: PackageCandidate,
    expected_integrity: str,
) -> bool:
    if not verify_locked_candidate(root, lockfile, candidate, expected_integrity):
        return False
    executable = shutil.which("uv")
    if executable is None:
        raise RuntimeError("uv was not found during post-install verification")
    try:
        result = subprocess.run(
            [
                executable,
                "run",
                "--locked",
                "--no-sync",
                "python",
                "-c",
                "import importlib.metadata, sys; print(importlib.metadata.version(sys.argv[1]))",
                candidate.name,
            ],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=60,
            check=False,
            shell=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Python package verification timed out") from exc
    return result.returncode == 0 and result.stdout.decode("utf-8", errors="replace").strip() == candidate.version


def _confirm_install(manager: str, candidate: PackageCandidate) -> bool:
    operation = "npm install with scripts disabled" if manager == "npm" else "uv add and uv sync"
    package_spec = (
        f"{candidate.name}@{candidate.version}"
        if manager == "npm"
        else f"{candidate.name}=={candidate.version}"
    )
    answer = input(f"Run {operation} for {package_spec}? [y/N] ").strip().lower()
    return answer in {"y", "yes"}


def _explain(config: ProjectConfig, finding_or_package: str, json_output: bool) -> int:
    with _authorized_client(config) as client:
        try:
            uuid.UUID(finding_or_package)
        except ValueError:
            history = client.get(
                f"/api/v1/agent/projects/{config.project_id}/investigations"
            )
            if not isinstance(history, list):
                raise ApiError("DepShield returned an invalid investigation history")
            matching = [
                item
                for item in history
                if isinstance(item, dict) and item.get("package_name") == finding_or_package
            ]
            if not matching:
                raise ValueError(f"No saved investigation found for {finding_or_package}")
            if not isinstance(matching[0].get("id"), str):
                raise ApiError("DepShield returned an invalid investigation record")
            finding_or_package = matching[0]["id"]
        result = client.get(f"/api/v1/agent/investigations/{finding_or_package}")
    _output(result, json_output)
    return 0


def _report(config: ProjectConfig, json_output: bool) -> int:
    with _authorized_client(config) as client:
        scans = client.get(f"/api/v1/projects/{config.project_id}/scans")
        if not isinstance(scans, list):
            raise ApiError("DepShield returned an invalid scan history")
        if not scans:
            raise ValueError("No saved scan report exists for this project")
        if not isinstance(scans[0], dict) or not isinstance(scans[0].get("id"), str):
            raise ApiError("DepShield returned an invalid scan record")
        report = client.get(f"/api/v1/scans/{scans[0]['id']}")
    _output(report, json_output)
    return 0


class _ClientContext:
    def __init__(self, client: ApiClient) -> None:
        self.client = client

    def __enter__(self) -> ApiClient:
        return self.client

    def __exit__(self, *_: object) -> None:
        self.client.close()


def _authorized_client(config: ProjectConfig) -> _ClientContext:
    token = get_token(config.api_url)
    if not token:
        raise RuntimeError("Not signed in; run `depshield login`")
    return _ClientContext(ApiClient(config.api_url, token))


def _load_project_config(start: Path) -> tuple[Path, ProjectConfig]:
    found = find_config(start.resolve())
    if found is None:
        raise ValueError("No .depshield/config.json found; run `depshield init` first")
    root, config_path = found
    config = load_config(config_path)
    _validate_api_url(config.api_url)
    if config.manager not in {"npm", "uv"}:
        raise ValueError(f"Unsupported package manager in DepShield config: {config.manager}")
    try:
        uuid.UUID(config.project_id)
        uuid.UUID(config.organization_id)
    except ValueError as exc:
        raise ValueError("Project configuration contains an invalid registration ID") from exc
    return root, config


def _detect_project(root: Path) -> tuple[str, Path]:
    npm_project = (root / "package.json").is_file()
    python_project = (root / "pyproject.toml").is_file() or (root / "uv.lock").is_file()
    if npm_project and python_project:
        raise ValueError("Mixed npm/Python projects are not supported by a single DepShield config")
    if npm_project:
        return detect_npm(root)
    if python_project:
        return detect_uv(root)
    raise ValueError("No supported npm package.json or Python uv project was found")


def _read_inventory(manager: str, lockfile: Path) -> list[PackageCandidate]:
    if manager == "npm":
        return read_npm_inventory(lockfile)
    if manager == "uv":
        return read_uv_inventory(lockfile)
    raise ValueError(f"Unsupported package manager: {manager}")


def _ensure_project_manager(manager: str, config: ProjectConfig) -> None:
    if manager != config.manager:
        raise ValueError(
            "The package manager changed since `depshield init`; reinitialize the project"
        )


def _read_package_json(root: Path) -> dict[str, Any]:
    path = root / "package.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read package.json: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("package.json must contain a JSON object")
    return payload


def _read_python_project(root: Path) -> dict[str, Any]:
    path = root / "pyproject.toml"
    try:
        payload = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ValueError(f"Could not read Python project metadata: {exc}") from exc
    project = payload.get("project")
    return project if isinstance(project, dict) else {}


def _file_snapshot(paths: list[Path]) -> tuple[tuple[str, int, int] | None, ...]:
    snapshot = []
    for path in paths:
        try:
            stat = path.stat()
            snapshot.append((str(path), stat.st_mtime_ns, stat.st_size))
        except FileNotFoundError:
            snapshot.append(None)
    return tuple(snapshot)


def _watched_files(root: Path) -> list[Path]:
    return [
        root / name
        for name in (
            "package.json",
            "package-lock.json",
            "npm-shrinkwrap.json",
            "pnpm-lock.yaml",
            "yarn.lock",
            "pyproject.toml",
            "uv.lock",
            "Pipfile.lock",
            "poetry.lock",
            "requirements.txt",
        )
    ]


def _read_choice(maximum: int) -> int:
    while True:
        try:
            choice = int(input("Selection: ").strip())
        except ValueError:
            choice = 0
        if 1 <= choice <= maximum:
            return choice
        print(f"Enter a number from 1 to {maximum}.")


def _validate_api_url(api_url: str) -> None:
    parsed = urlsplit(api_url)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise ValueError("DepShield API URL must use HTTP or HTTPS and include a host")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("DepShield API URL must not include credentials, query, or fragment")
    if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise ValueError("Non-local DepShield API URLs must use HTTPS")


def _output(value: Any, json_output: bool) -> None:
    if json_output:
        print(json.dumps(value, indent=2, ensure_ascii=True))
    elif isinstance(value, dict):
        for key, item in value.items():
            print(f"{_terminal_text(key.replace('_', ' ').title())}: {_terminal_text(str(item))}")
    else:
        print(_terminal_text(str(value)))


def _error(message: str, json_output: bool) -> None:
    if json_output:
        print(json.dumps({"error": message, "status": "failed"}), file=sys.stderr)
    else:
        print(f"DepShield: {_terminal_text(message)}", file=sys.stderr)


def _terminal_text(value: str) -> str:
    return "".join(
        character
        for character in value
        if not (
            ord(character) < 32 and character not in "\t\n"
            or 0x7F <= ord(character) <= 0x9F
            or 0x202A <= ord(character) <= 0x202E
            or 0x2066 <= ord(character) <= 0x2069
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
