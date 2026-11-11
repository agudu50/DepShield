from __future__ import annotations

import json
import re
import tomllib
from dataclasses import dataclass
from typing import Any, Literal

import httpx

MAX_MANIFEST_BYTES = 1_000_000
MAX_DEPENDENCIES = 1_000
OSV_QUERY_BATCH_SIZE = 100
OSV_QUERY_URL = "https://api.osv.dev/v1/querybatch"

_EXACT_NPM_VERSION = re.compile(
    r"^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
_REQUIREMENT = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?\s*(.*)$")
_EXACT_PYTHON_VERSION = re.compile(r"^(?:===|==)\s*([A-Za-z0-9][A-Za-z0-9.!+_-]*)$")
_NPM_PACKAGE_NAME = re.compile(r"^(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+$")


class ManifestError(ValueError):
    pass


class AdvisoryServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class DependencyRecord:
    name: str
    version: str
    ecosystem: str
    exact_version: bool


@dataclass(frozen=True)
class VulnerabilityRecord:
    id: str
    aliases: list[str]
    summary: str


def parse_manifest(
    manifest: str,
    ecosystem: str,
    manifest_type: Literal["manifest", "lockfile"] = "manifest",
) -> list[DependencyRecord]:
    if len(manifest.encode("utf-8")) > MAX_MANIFEST_BYTES:
        raise ManifestError("Manifest exceeds the 1 MB size limit")

    if manifest_type not in {"manifest", "lockfile"}:
        raise ManifestError(f"Unsupported manifest type: {manifest_type}")

    if ecosystem == "npm" and manifest_type == "manifest":
        dependencies = _parse_npm_manifest(manifest)
    elif ecosystem == "npm":
        dependencies = _parse_npm_lock(manifest)
    elif ecosystem == "python" and manifest_type == "manifest":
        dependencies = _parse_python_requirements(manifest)
    elif ecosystem == "python":
        dependencies = _parse_python_lock(manifest)
    else:
        raise ManifestError(f"Unsupported ecosystem: {ecosystem}")

    if len(dependencies) > MAX_DEPENDENCIES:
        raise ManifestError(f"Manifest exceeds the {MAX_DEPENDENCIES} dependency limit")
    return dependencies


def _exact_dependency(
    name: str,
    version: str,
    ecosystem: Literal["npm", "python"],
) -> DependencyRecord:
    if ecosystem == "npm":
        if not _NPM_PACKAGE_NAME.fullmatch(name):
            raise ManifestError(f"Unsupported npm package name in lockfile: {name}")
        exact_version = bool(_EXACT_NPM_VERSION.fullmatch(version))
    else:
        exact_version = True
    return DependencyRecord(name, version, ecosystem, exact_version)


def _parse_npm_lock(manifest: str) -> list[DependencyRecord]:
    try:
        content = json.loads(manifest)
    except json.JSONDecodeError as exc:
        raise ManifestError("package-lock.json must contain valid JSON") from exc
    if not isinstance(content, dict):
        raise ManifestError("package-lock.json must contain a JSON object")

    packages = content.get("packages")
    if packages is not None:
        if not isinstance(packages, dict):
            raise ManifestError("package-lock.json packages must be a JSON object")
        dependencies = []
        for path, details in packages.items():
            if not isinstance(path, str) or not path:
                continue
            name = _npm_name_from_lock_path(path)
            if name is None:
                continue
            if not isinstance(details, dict):
                raise ManifestError(f"Invalid lockfile entry for {name}")
            version = details.get("version")
            if isinstance(version, str):
                dependencies.append(_exact_dependency(name, version, "npm"))
        return sorted(set(dependencies), key=lambda item: (item.name, item.version))

    root = content.get("dependencies")
    if not isinstance(root, dict):
        raise ManifestError("package-lock.json must include a dependencies or packages object")
    dependencies: list[DependencyRecord] = []
    pending = [root]
    while pending:
        current = pending.pop()
        for name, details in current.items():
            if not isinstance(name, str) or not isinstance(details, dict):
                raise ManifestError("Invalid nested dependency in package-lock.json")
            version = details.get("version")
            if isinstance(version, str):
                dependencies.append(_exact_dependency(name, version, "npm"))
            nested = details.get("dependencies", {})
            if not isinstance(nested, dict):
                raise ManifestError(f"Invalid nested dependencies for {name}")
            pending.append(nested)
            if len(dependencies) + sum(len(group) for group in pending) > MAX_DEPENDENCIES:
                raise ManifestError(f"Manifest exceeds the {MAX_DEPENDENCIES} dependency limit")
    return sorted(set(dependencies), key=lambda item: (item.name, item.version))


def _npm_name_from_lock_path(path: str) -> str | None:
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


def _parse_python_lock(manifest: str) -> list[DependencyRecord]:
    try:
        content = json.loads(manifest)
    except json.JSONDecodeError:
        try:
            content = tomllib.loads(manifest)
        except tomllib.TOMLDecodeError as exc:
            raise ManifestError("Python lockfile must be valid Poetry/uv TOML or Pipfile.lock JSON") from exc

    if isinstance(content, dict) and isinstance(content.get("default"), dict):
        package_entries = list(content["default"].items())
        develop = content.get("develop", {})
        if isinstance(develop, dict):
            package_entries.extend(develop.items())
        dependencies = []
        for name, details in package_entries:
            version = details.get("version") if isinstance(details, dict) else None
            if isinstance(name, str) and isinstance(version, str):
                matched = _EXACT_PYTHON_VERSION.fullmatch(version)
                dependencies.append(
                    _exact_dependency(name, matched.group(1) if matched else version, "python")
                )
        return sorted(set(dependencies), key=lambda item: (item.name.lower(), item.version))

    packages = content.get("package", []) if isinstance(content, dict) else None
    if not isinstance(packages, list):
        raise ManifestError("Python lockfile must include a package list or Pipfile.lock default object")
    dependencies = []
    for package in packages:
        if not isinstance(package, dict):
            raise ManifestError("Invalid package entry in Python lockfile")
        source = package.get("source")
        if isinstance(source, dict) and any(
            key in source for key in ("editable", "directory", "virtual")
        ):
            continue
        name, version = package.get("name"), package.get("version")
        if not isinstance(name, str) or not isinstance(version, str):
            raise ManifestError("Each Python lockfile package must include name and version")
        dependencies.append(_exact_dependency(name, version, "python"))
    return sorted(set(dependencies), key=lambda item: (item.name.lower(), item.version))


def _parse_npm_manifest(manifest: str) -> list[DependencyRecord]:
    try:
        content = json.loads(manifest)
    except json.JSONDecodeError as exc:
        raise ManifestError("package.json must contain valid JSON") from exc

    if not isinstance(content, dict):
        raise ManifestError("package.json must contain a JSON object")

    merged: dict[str, str] = {}
    for section in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
        entries = content.get(section, {})
        if not isinstance(entries, dict):
            raise ManifestError(f"{section} must be a JSON object")
        for name, version in entries.items():
            if not isinstance(name, str) or not name.strip() or not isinstance(version, str):
                raise ManifestError(f"Entries in {section} must have package names and version strings")
            merged[name] = version.strip()

    return [
        DependencyRecord(
            name=name,
            version=version,
            ecosystem="npm",
            exact_version=bool(_EXACT_NPM_VERSION.fullmatch(version)),
        )
        for name, version in sorted(merged.items())
    ]


def _parse_python_requirements(manifest: str) -> list[DependencyRecord]:
    dependencies: list[DependencyRecord] = []
    for line_number, raw_line in enumerate(manifest.splitlines(), start=1):
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue

        match = _REQUIREMENT.fullmatch(line)
        if match is None:
            raise ManifestError(f"Unsupported requirement syntax on line {line_number}")

        name, specifier = match.groups()
        specifier = specifier.strip()
        exact_match = _EXACT_PYTHON_VERSION.fullmatch(specifier)
        version = exact_match.group(1) if exact_match else (specifier or "unspecified")
        dependencies.append(
            DependencyRecord(
                name=name,
                version=version,
                ecosystem="python",
                exact_version=bool(exact_match),
            )
        )

    return dependencies


async def lookup_advisories(
    dependencies: list[DependencyRecord],
) -> list[list[VulnerabilityRecord]]:
    results: list[list[VulnerabilityRecord]] = [[] for _ in dependencies]
    checkable_indices = [
        index for index, dependency in enumerate(dependencies) if dependency.exact_version
    ]
    if not checkable_indices:
        return results

    queries = [
        {
            "package": {
                "name": dependencies[index].name,
                "ecosystem": "PyPI" if dependencies[index].ecosystem == "python" else "npm",
            },
            "version": dependencies[index].version.lstrip("v"),
        }
        for index in checkable_indices
    ]

    async with httpx.AsyncClient(timeout=10.0) as client:
        for batch_start in range(0, len(queries), OSV_QUERY_BATCH_SIZE):
            batch = queries[batch_start : batch_start + OSV_QUERY_BATCH_SIZE]
            try:
                response = await client.post(OSV_QUERY_URL, json={"queries": batch})
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise AdvisoryServiceError("OSV advisory lookup failed") from exc

            try:
                payload: Any = response.json()
            except json.JSONDecodeError as exc:
                raise AdvisoryServiceError("OSV returned invalid JSON") from exc
            batch_results = payload.get("results") if isinstance(payload, dict) else None
            if not isinstance(batch_results, list) or len(batch_results) != len(batch):
                raise AdvisoryServiceError("OSV returned an invalid batch response")

            for offset, result in enumerate(batch_results):
                if not isinstance(result, dict):
                    raise AdvisoryServiceError("OSV returned an invalid advisory result")
                vulnerabilities = result.get("vulns", [])
                if not isinstance(vulnerabilities, list):
                    raise AdvisoryServiceError("OSV returned an invalid vulnerability list")
                dependency_index = checkable_indices[batch_start + offset]
                if any(
                    not isinstance(vulnerability, dict)
                    or not isinstance(vulnerability.get("aliases", []), list)
                    or (
                        vulnerability.get("withdrawn") is not None
                        and not isinstance(vulnerability.get("withdrawn"), str)
                    )
                    for vulnerability in vulnerabilities
                ):
                    raise AdvisoryServiceError("OSV returned an invalid vulnerability record")
                results[dependency_index] = [
                    VulnerabilityRecord(
                        id=str(vulnerability.get("id", "Unknown advisory")),
                        aliases=[
                            str(alias)
                            for alias in vulnerability.get("aliases", [])
                            if isinstance(alias, str)
                        ],
                        summary=str(
                            vulnerability.get("summary")
                            or "OSV advisory matched; check the advisory ID for details."
                        ),
                    )
                    for vulnerability in vulnerabilities
                    if isinstance(vulnerability, dict)
                    and vulnerability.get("withdrawn") is None
                ]

    return results
