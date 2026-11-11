from __future__ import annotations

import json
import re
from pathlib import Path

from depshield_cli.adapters.common import PackageCandidate

MAX_LOCKFILE_BYTES = 50_000_000
_PACKAGE_NAME = re.compile(r"^(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+$")
_SPEC_VERSION = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")


def detect(root: Path) -> tuple[str, Path]:
    if not (root / "package.json").is_file():
        raise ValueError(f"No package.json found in {root}")
    try:
        manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read package.json: {exc}") from exc
    package_manager = manifest.get("packageManager") if isinstance(manifest, dict) else None
    if isinstance(package_manager, str) and not package_manager.startswith("npm@"):
        raise ValueError(f"Project declares unsupported package manager {package_manager}")
    npm_lock = next(
        (
            path
            for path in (root / "npm-shrinkwrap.json", root / "package-lock.json")
            if path.is_file()
        ),
        None,
    )
    other_locks = [
        root / name
        for name in ("pnpm-lock.yaml", "yarn.lock")
        if (root / name).is_file()
    ]
    if len(other_locks) or (npm_lock is not None and other_locks):
        raise ValueError(
            "A non-npm or conflicting lockfile was found; npm adapter will not guess the package manager"
        )
    if npm_lock is None:
        raise ValueError(
            "npm is detected from package.json, but a package-lock.json or npm-shrinkwrap.json "
            "is required for a complete inventory"
        )
    return "npm", npm_lock


def read_inventory(lockfile: Path) -> list[PackageCandidate]:
    try:
        size = lockfile.stat().st_size
        if size > MAX_LOCKFILE_BYTES:
            raise ValueError("npm lockfile exceeds the 50 MB limit")
        content = json.loads(lockfile.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not parse npm lockfile {lockfile}: {exc}") from exc
    if not isinstance(content, dict):
        raise ValueError("npm lockfile must contain a JSON object")

    packages = content.get("packages")
    if packages is not None:
        if not isinstance(packages, dict):
            raise ValueError("npm lockfile packages field must be an object")
        inventory: set[tuple[str, str]] = set()
        for path, details in packages.items():
            if not isinstance(path, str):
                continue
            name = _name_from_lock_path(path)
            if not name:
                continue
            if not isinstance(details, dict):
                raise ValueError(f"npm lockfile entry for {name} is malformed")
            version = details.get("version", "unspecified")
            if isinstance(version, str) and version:
                if len(version) > 100:
                    raise ValueError(f"npm lockfile contains an oversized version for {name}")
                if any(ord(character) < 32 or ord(character) == 127 for character in version):
                    raise ValueError(f"npm lockfile contains invalid control characters for {name}")
                inventory.add((name, version))
            else:
                raise ValueError(f"npm lockfile has no usable version for {name}")
        return _packages_from_set(inventory)

    dependencies = content.get("dependencies")
    if not isinstance(dependencies, dict):
        raise ValueError("npm lockfile has no supported packages or dependencies section")
    inventory = set()
    pending = [dependencies]
    while pending:
        current = pending.pop()
        for name, details in current.items():
            if not isinstance(name, str):
                raise ValueError("npm lockfile dependency name is malformed")
            if not isinstance(details, dict):
                raise ValueError(f"npm lockfile entry for {name} is malformed")
            version = details.get("version", "unspecified")
            if isinstance(version, str) and version:
                if len(version) > 100:
                    raise ValueError(f"npm lockfile contains an oversized version for {name}")
                if any(ord(character) < 32 or ord(character) == 127 for character in version):
                    raise ValueError(f"npm lockfile contains invalid control characters for {name}")
                inventory.add((name, version))
            else:
                raise ValueError(f"npm lockfile has no usable version for {name}")
            nested = details.get("dependencies")
            if isinstance(nested, dict):
                pending.append(nested)
            if len(inventory) > 1_000:
                raise ValueError("npm lockfile exceeds the 1000 dependency limit")
    return _packages_from_set(inventory)


def parse_spec(spec: str, version: str | None = None) -> tuple[str, str | None]:
    separator = spec.rfind("@")
    spec_version = None
    if separator > 0 and "/" not in spec[separator + 1 :]:
        package_name, spec_version = spec[:separator], spec[separator + 1 :]
    else:
        package_name = spec
    if version and spec_version and version != spec_version:
        raise ValueError("Provide the package version either inline or with --version, not both")
    version = version or spec_version
    if not _PACKAGE_NAME.fullmatch(package_name) or ".." in package_name:
        raise ValueError("Only ordinary npm package names are supported (no URLs, aliases, or local paths)")
    if version is not None and not _SPEC_VERSION.fullmatch(version):
        raise ValueError("Preflight requires an exact semantic version such as 1.2.3")
    return package_name, version


def _name_from_lock_path(path: str) -> str | None:
    parts = path.split("/")
    candidates: list[str] = []
    index = 0
    while index < len(parts):
        if parts[index] != "node_modules" or index + 1 >= len(parts):
            index += 1
            continue
        if parts[index + 1].startswith("@"):
            if index + 2 < len(parts):
                candidates.append(f"{parts[index + 1]}/{parts[index + 2]}")
                index += 3
                continue
            return None
        candidates.append(parts[index + 1])
        index += 2
    return candidates[-1] if candidates else None


def _packages_from_set(packages: set[tuple[str, str]]) -> list[PackageCandidate]:
    invalid = [name for name, _ in packages if not _PACKAGE_NAME.fullmatch(name)]
    if invalid:
        raise ValueError(f"npm lockfile contains an unsupported package name: {invalid[0]}")
    if len(packages) > 1_000:
        raise ValueError("npm lockfile exceeds the 1000 dependency limit")
    return [
        PackageCandidate(name, version)
        for name, version in sorted(packages, key=lambda item: (item[0].lower(), item[1]))
    ]
