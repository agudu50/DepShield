from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from depshield_cli.api import ApiClient, ApiError
from depshield_cli.auth import get_token, store_token, delete_token

GITHUB_API_BASE = "https://api.github.com"
GITHUB_KEYRING_SERVICE = "depshield-github"
GITHUB_KEYRING_USERNAME = "github-pat"

_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")


@dataclass(frozen=True)
class GitHubUser:
    login: str
    name: str | None
    avatar_url: str
    html_url: str
    public_repos: int
    total_private_repos: int | None = None


@dataclass(frozen=True)
class GitHubRepo:
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
class GitHubManifest:
    name: str
    path: str
    ecosystem: str
    manifest_type: str
    size: int


class GitHubCliClient:
    """Client for GitHub API operations with credential storage support."""

    def __init__(self, token: str | None = None, transport: httpx.BaseTransport | None = None) -> None:
        self.token = token or self.get_stored_token()
        self._transport = transport

    @classmethod
    def get_stored_token(cls) -> str | None:
        env_token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if env_token:
            return env_token.strip()

        try:
            return get_token(GITHUB_KEYRING_SERVICE, GITHUB_KEYRING_USERNAME)
        except Exception:
            return None

    @classmethod
    def store_token(cls, token: str) -> None:
        clean = token.strip()
        if not clean:
            raise ValueError("GitHub token cannot be empty")
        store_token(GITHUB_KEYRING_SERVICE, GITHUB_KEYRING_USERNAME, clean)

    @classmethod
    def delete_stored_token(cls) -> None:
        try:
            delete_token(GITHUB_KEYRING_SERVICE, GITHUB_KEYRING_USERNAME)
        except Exception:
            pass

    def _headers(self) -> dict[str, str]:
        if not self.token:
            raise ValueError(
                "GitHub token is required. Run 'depshield github login' or set GITHUB_TOKEN."
            )
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "DepShield-CLI/0.1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def get_user(self) -> GitHubUser:
        with httpx.Client(timeout=10.0, transport=self._transport) as client:
            res = client.get(f"{GITHUB_API_BASE}/user", headers=self._headers())
            if res.status_code == 401:
                raise ValueError("GitHub token is invalid or expired.")
            if res.status_code != 200:
                raise RuntimeError(f"GitHub API error: {res.text}")
            data = res.json()
            return GitHubUser(
                login=data["login"],
                name=data.get("name"),
                avatar_url=data.get("avatar_url", ""),
                html_url=data.get("html_url", ""),
                public_repos=data.get("public_repos", 0),
                total_private_repos=data.get("total_private_repos"),
            )

    def list_repositories(self, page: int = 1, per_page: int = 30) -> list[GitHubRepo]:
        with httpx.Client(timeout=15.0, transport=self._transport) as client:
            params = {
                "sort": "updated",
                "direction": "desc",
                "page": max(page, 1),
                "per_page": min(max(per_page, 1), 100),
                "affiliation": "owner,collaborator,organization_member",
            }
            res = client.get(f"{GITHUB_API_BASE}/user/repos", headers=self._headers(), params=params)
            if res.status_code == 401:
                raise ValueError("GitHub token is invalid or expired.")
            if res.status_code != 200:
                raise RuntimeError(f"GitHub API error: {res.text}")
            data = res.json()
            if not isinstance(data, list):
                return []
            return [
                GitHubRepo(
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
                for item in data
            ]

    def detect_manifests(self, owner: str, repo: str, ref: str | None = None) -> list[GitHubManifest]:
        known = {
            "package.json": ("npm", "manifest"),
            "package-lock.json": ("npm", "lockfile"),
            "npm-shrinkwrap.json": ("npm", "lockfile"),
            "requirements.txt": ("python", "manifest"),
            "pyproject.toml": ("python", "manifest"),
            "uv.lock": ("python", "lockfile"),
            "poetry.lock": ("python", "lockfile"),
            "Pipfile.lock": ("python", "lockfile"),
        }
        dirs = ["", "backend", "frontend", "server", "client"]
        found: list[GitHubManifest] = []
        seen: set[str] = set()

        with httpx.Client(timeout=15.0, transport=self._transport) as client:
            params = {"ref": ref} if ref else {}
            for d in dirs:
                url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{quote(d)}" if d else f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents"
                res = client.get(url, headers=self._headers(), params=params)
                if res.status_code != 200:
                    continue
                items = res.json()
                if isinstance(items, list):
                    for item in items:
                        name = item.get("name")
                        path = item.get("path")
                        if name in known and path not in seen:
                            seen.add(path)
                            eco, mtype = known[name]
                            found.append(
                                GitHubManifest(
                                    name=name,
                                    path=path,
                                    ecosystem=eco,
                                    manifest_type=mtype,
                                    size=item.get("size", 0),
                                )
                            )
        return found

