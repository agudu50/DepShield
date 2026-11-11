from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote

import httpx

from depshield_cli.adapters.common import PackageCandidate
from depshield_cli.adapters.uv import normalize_name, parse_spec

PYPI_JSON_URL = "https://pypi.org/pypi"
MAX_RESPONSE_BYTES = 8_000_000
_SHA256 = re.compile(r"^[a-fA-F0-9]{64}$")


def resolve_candidate(
    root: Path,
    spec: str,
    requested_version: str | None = None,
) -> tuple[PackageCandidate, dict[str, object]]:
    del root
    package_name, version = parse_spec(spec, requested_version)
    url = f"{PYPI_JSON_URL}/{quote(package_name, safe='')}"
    if version is not None:
        url += f"/{quote(version, safe='')}"

    try:
        with httpx.Client(timeout=15.0, follow_redirects=False) as client:
            with client.stream("GET", url, headers={"Accept": "application/json"}) as response:
                if response.status_code == 404:
                    raise ValueError(f"Package {package_name} was not found on PyPI")
                response.raise_for_status()
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_RESPONSE_BYTES:
                    raise ValueError("PyPI metadata exceeds the 8 MB size limit")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise ValueError("PyPI metadata exceeds the 8 MB size limit")
    except httpx.HTTPError as exc:
        raise ValueError("PyPI metadata could not be verified; package was not installed") from exc

    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("PyPI returned invalid package metadata") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("info"), dict):
        raise ValueError("PyPI returned an unsupported package metadata document")

    info = payload["info"]
    resolved_name = info.get("name")
    resolved_version = info.get("version")
    if (
        not isinstance(resolved_name, str)
        or normalize_name(resolved_name) != package_name
        or not isinstance(resolved_version, str)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.!+_-]{0,99}", resolved_version)
        or (version is not None and resolved_version != version)
    ):
        raise ValueError("PyPI did not confirm the requested package and exact version")

    urls = payload.get("urls")
    if not isinstance(urls, list) or not urls:
        raise ValueError("PyPI did not provide release artifacts for this version")

    artifacts = [
        item
        for item in urls
        if isinstance(item, dict)
        and isinstance(item.get("digests"), dict)
        and isinstance(item["digests"].get("sha256"), str)
        and _SHA256.fullmatch(item["digests"]["sha256"])
    ]
    if not artifacts:
        raise ValueError("PyPI release artifacts have no verifiable SHA-256 digest")
    artifacts.sort(key=lambda item: item.get("packagetype") != "sdist")

    published_times = [
        item["upload_time_iso_8601"]
        for item in artifacts
        if isinstance(item.get("upload_time_iso_8601"), str)
    ]
    project_urls = info.get("project_urls")
    repository = None
    if isinstance(project_urls, dict):
        for key, value in project_urls.items():
            if isinstance(key, str) and any(
                marker in key.lower() for marker in ("source", "repository", "homepage")
            ):
                repository = _bounded_string(value)
                if repository:
                    break

    yanked = all(item.get("yanked") is True for item in artifacts)
    metadata: dict[str, object] = {
        "registry": "https://pypi.org/",
        "published_at": _bounded_string(min(published_times), 100) if published_times else None,
        "repository": repository,
        "integrity": f"sha256:{artifacts[0]['digests']['sha256']}",
        "yanked": yanked,
    }
    return PackageCandidate(package_name, resolved_version), metadata


def _bounded_string(value: object, limit: int = 1000) -> str | None:
    if not isinstance(value, str):
        return None
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
