from __future__ import annotations

import re
import tomllib
from pathlib import Path

from depshield_cli.adapters.common import PackageCandidate

MAX_LOCKFILE_BYTES = 50_000_000
_PACKAGE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,213}$")
_EXACT_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.!+_-]{0,99}$")


def detect(root: Path) -> tuple[str, Path]:
    project_file = root / "pyproject.toml"
    lockfile = root / "uv.lock"
    if not project_file.is_file() or not lockfile.is_file():
        raise ValueError("Python uv projects require both pyproject.toml and uv.lock")

    competing_files = (
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "Pipfile.lock",
        "poetry.lock",
        "requirements.txt",
    )
    if any((root / name).is_file() for name in competing_files):
        raise ValueError("A competing package manager or lockfile was found; DepShield will not guess")

    try:
        project = tomllib.loads(project_file.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ValueError(f"Could not read Python project metadata: {exc}") from exc
    if not isinstance(project, dict):
        raise ValueError("pyproject.toml must contain a TOML table")
    return "uv", lockfile


def read_inventory(lockfile: Path) -> list[PackageCandidate]:
    try:
        if lockfile.stat().st_size > MAX_LOCKFILE_BYTES:
            raise ValueError("uv.lock exceeds the 50 MB limit")
        content = tomllib.loads(lockfile.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ValueError(f"Could not parse uv.lock: {exc}") from exc

    packages = content.get("package", [])
    if not isinstance(packages, list):
        raise ValueError("uv.lock must contain a package list")

    inventory: set[tuple[str, str]] = set()
    for package in packages:
        if not isinstance(package, dict):
            raise ValueError("uv.lock contains a malformed package entry")
        source = package.get("source")
        if isinstance(source, dict) and any(
            key in source for key in ("editable", "directory", "virtual")
        ):
            continue
        name, version = package.get("name"), package.get("version")
        if (
            not isinstance(name, str)
            or not _PACKAGE_NAME.fullmatch(name)
            or not isinstance(version, str)
            or not _EXACT_VERSION.fullmatch(version)
        ):
            raise ValueError("uv.lock contains an unsupported package name or version")
        inventory.add((normalize_name(name), version))
        if len(inventory) > 1_000:
            raise ValueError("uv.lock exceeds the 1000 dependency limit")
    return [PackageCandidate(name, version) for name, version in sorted(inventory)]


def parse_spec(spec: str, requested_version: str | None = None) -> tuple[str, str | None]:
    package_name, separator, inline_version = spec.partition("==")
    if separator and "==" in inline_version:
        raise ValueError("Provide one exact package version")
    if not separator:
        package_name, inline_version = spec, ""
    if requested_version and inline_version and requested_version != inline_version:
        raise ValueError("Provide the package version either inline or with --version, not both")
    version = requested_version or (inline_version if separator else None)
    if not _PACKAGE_NAME.fullmatch(package_name):
        raise ValueError("Use a Python package name with an optional exact ==version")
    if version is not None and not _EXACT_VERSION.fullmatch(version):
        raise ValueError("Python preflight requires an exact PEP 440 version")
    return normalize_name(package_name), version


def normalize_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def verify_locked_candidate(
    root: Path,
    lockfile: Path,
    candidate: PackageCandidate,
    expected_integrity: str,
) -> bool:
    try:
        project = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
        lock_data = tomllib.loads(lockfile.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return False

    project_metadata = project.get("project")
    dependencies = project_metadata.get("dependencies") if isinstance(project_metadata, dict) else None
    declared = False
    if isinstance(dependencies, list):
        for requirement in dependencies:
            if not isinstance(requirement, str):
                continue
            match = re.match(
                r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*([^;\s]+)",
                requirement,
            )
            if (
                match
                and normalize_name(match.group(1)) == candidate.name
                and match.group(2) == candidate.version
            ):
                declared = True
                break

    packages = lock_data.get("package")
    if not declared or not isinstance(packages, list):
        return False
    for package in packages:
        if (
            not isinstance(package, dict)
            or normalize_name(str(package.get("name", ""))) != candidate.name
            or package.get("version") != candidate.version
        ):
            continue
        hashes: set[str] = set()
        sdist = package.get("sdist")
        if isinstance(sdist, dict) and isinstance(sdist.get("hash"), str):
            hashes.add(sdist["hash"])
        wheels = package.get("wheels")
        if isinstance(wheels, list):
            hashes.update(
                wheel["hash"]
                for wheel in wheels
                if isinstance(wheel, dict) and isinstance(wheel.get("hash"), str)
            )
        return expected_integrity in hashes
    return False
