from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import quote

import httpx

from app.agents.bifrost import BifrostClient, BifrostError
from app.domain.scanning.service import (
    AdvisoryServiceError,
    DependencyRecord,
    ManifestError,
    VulnerabilityRecord,
    lookup_advisories,
    parse_manifest,
)

GITHUB_API_BASE = "https://api.github.com"
MAX_MANIFEST_BYTES = 1_000_000

_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_SAFE_REF = re.compile(r"^[A-Za-z0-9_./-]{1,100}$")
_SAFE_PATH = re.compile(r"^[A-Za-z0-9_./-]{1,250}$")

MANIFEST_DEFINITIONS: dict[str, tuple[Literal["npm", "python"], Literal["manifest", "lockfile"]]] = {
    "package.json": ("npm", "manifest"),
    "package-lock.json": ("npm", "lockfile"),
    "npm-shrinkwrap.json": ("npm", "lockfile"),
    "requirements.txt": ("python", "manifest"),
    "pyproject.toml": ("python", "manifest"),
    "uv.lock": ("python", "lockfile"),
    "poetry.lock": ("python", "lockfile"),
    "Pipfile.lock": ("python", "lockfile"),
}


class GitHubError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class GitHubUserProfile:
    login: str
    name: str | None
    avatar_url: str
    html_url: str
    public_repos: int
    total_private_repos: int | None = None


@dataclass(frozen=True)
class GitHubRepository:
    id: int
    name: str
    full_name: str
    private: bool
    html_url: str
    description: str | None
    default_branch: str
    language: str | None
    stargazers_count: int
    updated_at: str


@dataclass(frozen=True)
class GitHubManifestFile:
    name: str
    path: str
    ecosystem: Literal["npm", "python"]
    manifest_type: Literal["manifest", "lockfile"]
    size: int


@dataclass(frozen=True)
class GitHubVulnerabilityItem:
    id: str
    aliases: list[str]
    summary: str


@dataclass(frozen=True)
class GitHubScannedDependency:
    name: str
    version: str
    ecosystem: str
    status: Literal["checked", "version_range"]
    vulnerabilities: list[GitHubVulnerabilityItem]


@dataclass(frozen=True)
class GitHubAnalysisReport:
    repository: str
    branch: str
    manifest_path: str
    ecosystem: str
    manifest_type: str
    dependency_count: int
    checked_count: int
    unpinned_count: int
    vulnerability_count: int
    risk_level: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "CLEAN"]
    dependencies: list[GitHubScannedDependency]
    agent_summary: str
    recommendations: list[str]


class GitHubService:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    def _headers(self, token: str, accept: str = "application/vnd.github.v3+json") -> dict[str, str]:
        clean_token = token.strip()
        if not clean_token:
            raise GitHubError("GitHub access token is required", 401)
        return {
            "Authorization": f"Bearer {clean_token}",
            "Accept": accept,
            "User-Agent": "DepShield-AI/0.1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _validate_owner_repo(self, owner: str, repo: str) -> None:
        if not _SAFE_IDENTIFIER.match(owner) or not _SAFE_IDENTIFIER.match(repo):
            raise GitHubError("Invalid owner or repository name", 400)

    def _validate_path(self, path: str) -> None:
        clean = path.strip().lstrip("/")
        if not clean or ".." in clean or not _SAFE_PATH.match(clean):
            raise GitHubError("Invalid manifest path", 400)

    async def get_user_profile(self, token: str) -> GitHubUserProfile:
        headers = self._headers(token)
        try:
            async with httpx.AsyncClient(timeout=10.0, transport=self._transport) as client:
                res = await client.get(f"{GITHUB_API_BASE}/user", headers=headers)
                if res.status_code == 401:
                    raise GitHubError("Invalid or expired GitHub token", 401)
                if res.status_code != 200:
                    raise GitHubError(f"GitHub API error: {res.text}", res.status_code)
                data = res.json()
                return GitHubUserProfile(
                    login=data["login"],
                    name=data.get("name"),
                    avatar_url=data.get("avatar_url", ""),
                    html_url=data.get("html_url", ""),
                    public_repos=data.get("public_repos", 0),
                    total_private_repos=data.get("total_private_repos"),
                )
        except httpx.HTTPError as exc:
            raise GitHubError(f"Failed to communicate with GitHub: {exc}", 502) from exc

    async def list_repositories(self, token: str, page: int = 1, per_page: int = 50) -> list[GitHubRepository]:
        headers = self._headers(token)
        params = {
            "sort": "updated",
            "direction": "desc",
            "per_page": min(max(per_page, 1), 100),
            "page": max(page, 1),
            "affiliation": "owner,collaborator,organization_member",
        }
        try:
            async with httpx.AsyncClient(timeout=15.0, transport=self._transport) as client:
                res = await client.get(f"{GITHUB_API_BASE}/user/repos", headers=headers, params=params)
                if res.status_code == 401:
                    raise GitHubError("Invalid or expired GitHub token", 401)
                if res.status_code != 200:
                    raise GitHubError(f"GitHub API error: {res.text}", res.status_code)
                items = res.json()
                if not isinstance(items, list):
                    return []
                results: list[GitHubRepository] = []
                for item in items:
                    results.append(
                        GitHubRepository(
                            id=item["id"],
                            name=item["name"],
                            full_name=item["full_name"],
                            private=item.get("private", False),
                            html_url=item["html_url"],
                            description=item.get("description"),
                            default_branch=item.get("default_branch", "main"),
                            language=item.get("language"),
                            stargazers_count=item.get("stargazers_count", 0),
                            updated_at=item.get("updated_at", ""),
                        )
                    )
                return results
        except httpx.HTTPError as exc:
            raise GitHubError(f"Failed to list repositories: {exc}", 502) from exc

    async def detect_manifests(
        self,
        token: str,
        owner: str,
        repo: str,
        ref: str | None = None,
    ) -> list[GitHubManifestFile]:
        self._validate_owner_repo(owner, repo)
        headers = self._headers(token)
        params: dict[str, Any] = {}
        if ref:
            if not _SAFE_REF.match(ref):
                raise GitHubError("Invalid ref parameter", 400)
            params["ref"] = ref

        dirs_to_check = ["", "backend", "frontend", "server", "client", "src"]
        found: list[GitHubManifestFile] = []
        seen_paths: set[str] = set()

        async with httpx.AsyncClient(timeout=15.0, transport=self._transport) as client:
            for d in dirs_to_check:
                url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{quote(d)}" if d else f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents"
                try:
                    res = await client.get(url, headers=headers, params=params)
                    if res.status_code == 404:
                        continue
                    if res.status_code == 401:
                        raise GitHubError("Invalid or expired GitHub token", 401)
                    if res.status_code != 200:
                        continue
                    data = res.json()
                    if isinstance(data, list):
                        for file_info in data:
                            filename = file_info.get("name")
                            filepath = file_info.get("path")
                            if filename in MANIFEST_DEFINITIONS and filepath not in seen_paths:
                                seen_paths.add(filepath)
                                eco, mtype = MANIFEST_DEFINITIONS[filename]
                                found.append(
                                    GitHubManifestFile(
                                        name=filename,
                                        path=filepath,
                                        ecosystem=eco,
                                        manifest_type=mtype,
                                        size=file_info.get("size", 0),
                                    )
                                )
                except httpx.HTTPError:
                    continue

        return found

    async def fetch_manifest_content(
        self,
        token: str,
        owner: str,
        repo: str,
        path: str,
        ref: str | None = None,
    ) -> str:
        self._validate_owner_repo(owner, repo)
        self._validate_path(path)
        headers = self._headers(token, accept="application/vnd.github.v3.raw")
        params: dict[str, Any] = {}
        if ref:
            if not _SAFE_REF.match(ref):
                raise GitHubError("Invalid ref parameter", 400)
            params["ref"] = ref

        try:
            async with httpx.AsyncClient(timeout=15.0, transport=self._transport) as client:
                res = await client.get(
                    f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{quote(path.lstrip('/'))}",
                    headers=headers,
                    params=params,
                )
                if res.status_code == 404:
                    raise GitHubError(f"Manifest '{path}' not found in repository", 404)
                if res.status_code == 401:
                    raise GitHubError("Invalid or expired GitHub token", 401)
                if res.status_code != 200:
                    raise GitHubError(f"Failed to fetch manifest content: {res.text}", res.status_code)
                content = res.text
                if len(content.encode("utf-8")) > MAX_MANIFEST_BYTES:
                    raise GitHubError("Manifest file exceeds maximum allowed size of 1 MB", 400)
                return content
        except httpx.HTTPError as exc:
            raise GitHubError(f"Network error fetching manifest from GitHub: {exc}", 502) from exc

    async def analyze_repository_manifest(
        self,
        token: str,
        owner: str,
        repo: str,
        manifest_path: str,
        ref: str | None = None,
        question: str | None = None,
        bifrost: BifrostClient | None = None,
    ) -> GitHubAnalysisReport:
        content = await self.fetch_manifest_content(token, owner, repo, manifest_path, ref)
        filename = manifest_path.strip().split("/")[-1]
        if filename not in MANIFEST_DEFINITIONS:
            # Fallback deduction
            if filename.endswith(".json"):
                eco, mtype = "npm", "manifest"
            elif filename.endswith(".txt") or filename.endswith(".toml"):
                eco, mtype = "python", "manifest"
            else:
                raise GitHubError(f"Unsupported manifest file: {filename}", 400)
        else:
            eco, mtype = MANIFEST_DEFINITIONS[filename]

        try:
            records = parse_manifest(content, ecosystem=eco, manifest_type=mtype)
        except ManifestError as exc:
            raise GitHubError(f"Failed to parse manifest: {exc}", 400) from exc

        try:
            advisories_per_dep = await lookup_advisories(records)
        except AdvisoryServiceError as exc:
            raise GitHubError(f"OSV advisory lookup failed: {exc}", 502) from exc

        scanned_deps: list[GitHubScannedDependency] = []
        total_vulns = 0
        exact_checked = 0
        unpinned = 0
        all_evidence: list[dict[str, Any]] = []

        for dep, adv_list in zip(records, advisories_per_dep):
            if dep.exact_version:
                exact_checked += 1
            else:
                unpinned += 1

            vuln_items = [
                GitHubVulnerabilityItem(
                    id=adv.id,
                    aliases=adv.aliases,
                    summary=adv.summary,
                )
                for adv in adv_list
            ]
            total_vulns += len(vuln_items)
            for adv in adv_list:
                all_evidence.append({
                    "source": "OSV.dev",
                    "package": dep.name,
                    "version": dep.version,
                    "id": adv.id,
                    "aliases": adv.aliases,
                    "summary": adv.summary,
                })

            scanned_deps.append(
                GitHubScannedDependency(
                    name=dep.name,
                    version=dep.version,
                    ecosystem=eco,
                    status="checked" if dep.exact_version else "version_range",
                    vulnerabilities=vuln_items,
                )
            )

        # Determine risk level
        if total_vulns >= 3:
            risk_level: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "CLEAN"] = "CRITICAL"
        elif total_vulns > 0:
            risk_level = "HIGH"
        elif unpinned > 0:
            risk_level = "MEDIUM"
        else:
            risk_level = "CLEAN"

        # Generate Agent Summary and actionable Recommendations
        recommendations: list[str] = []
        for dep in scanned_deps:
            if dep.vulnerabilities:
                vuln_ids = ", ".join(v.id for v in dep.vulnerabilities[:3])
                recommendations.append(
                    f"Upgrade package '{dep.name}' (current: {dep.version}) to address advisory {vuln_ids}."
                )
        if unpinned > 0:
            recommendations.append(
                f"Pin {unpinned} dependency version ranges to exact versions or generate a lockfile to prevent upstream supply-chain drift."
            )
        if not recommendations:
            recommendations.append("All checked pinned dependencies are currently clear of known OSV advisories.")

        agent_summary = ""
        if total_vulns > 0:
            # Try AI Agent investigation via Bifrost if provided
            if bifrost:
                agent_prompt = question or (
                    f"Analyze the {total_vulns} verified vulnerability advisories detected in repository "
                    f"'{owner}/{repo}' ({manifest_path}). Provide an executive risk analysis, "
                    f"root cause summary, and prioritized remediation actions."
                )
                try:
                    bifrost_res = await bifrost.explain_finding(agent_prompt, all_evidence[:20])
                    agent_summary = bifrost_res.answer
                except BifrostError:
                    agent_summary = (
                        f"DepShield Security Agent verified {total_vulns} active advisories across "
                        f"{len(scanned_deps)} dependencies in '{owner}/{repo}'. "
                        "Immediate remediation is recommended for the flagged packages."
                    )
            else:
                agent_summary = (
                    f"DepShield Security Agent verified {total_vulns} active advisories across "
                    f"{len(scanned_deps)} dependencies in '{owner}/{repo}'. "
                    "Review the affected packages and follow the recommended upgrade paths."
                )
        else:
            agent_summary = (
                f"DepShield Security Agent analyzed {len(scanned_deps)} dependencies in '{owner}/{repo}' "
                f"({manifest_path}). No known active OSV advisories matched the verified versions. "
                + (f"Note: {unpinned} unpinned range(s) could not be deterministically evaluated." if unpinned else "All dependencies are pinned and verified.")
            )

        return GitHubAnalysisReport(
            repository=f"{owner}/{repo}",
            branch=ref or "default",
            manifest_path=manifest_path,
            ecosystem=eco,
            manifest_type=mtype,
            dependency_count=len(scanned_deps),
            checked_count=exact_checked,
            unpinned_count=unpinned,
            vulnerability_count=total_vulns,
            risk_level=risk_level,
            dependencies=scanned_deps,
            agent_summary=agent_summary,
            recommendations=recommendations,
        )

