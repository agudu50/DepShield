from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx

from depshield_cli.adapters.npm import PackageCandidate, parse_spec

MAX_REGISTRY_RESPONSE_BYTES = 8_000_000
DEFAULT_REGISTRY = "https://registry.npmjs.org/"
_LIFECYCLE_SCRIPTS = {"preinstall", "install", "postinstall", "prepare"}


def registry_for(root: Path, package_name: str) -> str:
    config_values: dict[str, str] = {}
    for path in (Path.home() / ".npmrc", root / ".npmrc"):
        config_values.update(_read_npmrc(path))

    scope = package_name.split("/", 1)[0] if package_name.startswith("@") else ""
    registry = (
        os.environ.get("NPM_CONFIG_REGISTRY")
        or (config_values.get(f"{scope}:registry") if scope else None)
        or config_values.get("registry")
        or DEFAULT_REGISTRY
    )
    return _validate_registry(registry)


def resolve_candidate(
    root: Path,
    spec: str,
    requested_version: str | None = None,
) -> tuple[PackageCandidate, dict[str, object]]:
    package_name, version = parse_spec(spec, requested_version)
    registry = registry_for(root, package_name)
    metadata_url = registry.rstrip("/") + "/" + quote(package_name, safe="")
    try:
        with httpx.Client(timeout=15.0, follow_redirects=False) as client:
            with client.stream(
                "GET",
                metadata_url,
                headers={"Accept": "application/vnd.npm.install-v1+json"},
            ) as response:
                if response.status_code == 404:
                    raise ValueError(f"Package {package_name} was not found in registry {registry}")
                response.raise_for_status()
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_REGISTRY_RESPONSE_BYTES:
                    raise ValueError("npm registry metadata exceeds the 8 MB size limit")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_REGISTRY_RESPONSE_BYTES:
                        raise ValueError("npm registry metadata exceeds the 8 MB size limit")
    except httpx.HTTPError as exc:
        raise ValueError(
            "npm registry metadata could not be verified; package was not installed"
        ) from exc

    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("npm registry returned invalid package metadata") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("versions"), dict):
        raise ValueError("npm registry returned an unsupported package metadata document")
    tags = payload.get("dist-tags")
    if not isinstance(tags, dict):
        tags = {}
    resolved_version = version or tags.get("latest")
    if not isinstance(resolved_version, str):
        raise ValueError("npm registry did not provide an exact latest version")
    version_metadata = payload["versions"].get(resolved_version)
    if not isinstance(version_metadata, dict) or version_metadata.get("name") != package_name:
        raise ValueError("npm registry did not confirm the requested package and exact version")
    if version_metadata.get("version") != resolved_version:
        raise ValueError("npm registry returned inconsistent version metadata")

    dist = version_metadata.get("dist")
    dist = dist if isinstance(dist, dict) else {}
    integrity = _bounded_string(dist.get("integrity"), 500)
    if not integrity or not integrity.startswith(("sha512-", "sha384-", "sha256-")):
        raise ValueError(
            "npm registry did not provide a supported integrity digest; package was not installed"
        )
    attestations = dist.get("attestations")
    attestations = attestations if isinstance(attestations, dict) else {}
    time_values = payload.get("time")
    time_values = time_values if isinstance(time_values, dict) else {}
    repository = version_metadata.get("repository")
    if isinstance(repository, dict):
        repository = repository.get("url")
    scripts = version_metadata.get("scripts")
    metadata: dict[str, object] = {
        "registry": registry,
        "published_at": _bounded_string(time_values.get(resolved_version)),
        "deprecated": _bounded_string(version_metadata.get("deprecated")),
        "repository": _bounded_string(repository),
        "provenance_url": _bounded_string(attestations.get("url")),
        "integrity": integrity,
        "lifecycle_scripts": (
            sorted(script for script in scripts if script in _LIFECYCLE_SCRIPTS)
            if isinstance(scripts, dict)
            and all(isinstance(script, str) for script in scripts)
            else []
        ),
    }
    return PackageCandidate(package_name, resolved_version), metadata


def _read_npmrc(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return {}
    except OSError as exc:
        raise ValueError(f"Could not read npm configuration {path}: {exc}") from exc
    values: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", ";")) or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip().lower()
        value = value.strip()
        if key == "registry" or (key.startswith("@") and key.endswith(":registry")):
            if "${" in value or "$(" in value:
                raise ValueError(f"Variable interpolation is not supported in {path}")
            values[key] = value
    return values


def _validate_registry(value: str) -> str:
    parsed = urlsplit(value)
    local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    if (
        (parsed.scheme != "https" and not local_http)
        or not parsed.netloc
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise ValueError("npm registry must be an HTTPS URL (HTTP is allowed only for localhost)")
    return value.rstrip("/") + "/"


def _bounded_string(value: object, limit: int = 1000) -> str | None:
    if isinstance(value, str):
        return "".join(
            character
            for character in value[:limit]
            if not (
                ord(character) < 32
                or 0x7F <= ord(character) <= 0x9F
                or 0x202A <= ord(character) <= 0x202E
                or 0x2066 <= ord(character) <= 0x2069
            )
        )
    return None
