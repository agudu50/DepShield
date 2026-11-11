import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.domain.github.service import (
    GitHubError,
    GitHubManifestFile,
    GitHubRepository,
    GitHubService,
    GitHubUserProfile,
)
from app.domain.scanning.service import DependencyRecord, VulnerabilityRecord
from app.main import app
from tests.api_support import DatabaseBackedApiTestCase


class GitHubServiceTests(unittest.TestCase):
    def test_get_user_profile_success(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers.get("Authorization"), "Bearer test-gh-token")
            return httpx.Response(
                200,
                json={
                    "login": "octocat",
                    "name": "The Octocat",
                    "avatar_url": "https://avatars.githubusercontent.com/u/583231",
                    "html_url": "https://github.com/octocat",
                    "public_repos": 8,
                    "total_private_repos": 2,
                },
            )

        service = GitHubService(transport=httpx.MockTransport(handler))
        profile = asyncio.run(service.get_user_profile("test-gh-token"))
        self.assertEqual(profile.login, "octocat")
        self.assertEqual(profile.name, "The Octocat")
        self.assertEqual(profile.public_repos, 8)

    def test_list_repositories(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 12345,
                        "name": "super-project",
                        "full_name": "octocat/super-project",
                        "private": False,
                        "html_url": "https://github.com/octocat/super-project",
                        "description": "Awesome repo",
                        "default_branch": "main",
                        "language": "TypeScript",
                        "stargazers_count": 42,
                        "updated_at": "2026-11-10T00:00:00Z",
                    }
                ],
            )

        service = GitHubService(transport=httpx.MockTransport(handler))
        repos = asyncio.run(service.list_repositories("test-gh-token"))
        self.assertEqual(len(repos), 1)
        self.assertEqual(repos[0].name, "super-project")
        self.assertEqual(repos[0].stargazers_count, 42)

    def test_detect_manifests(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if "contents" in str(request.url):
                return httpx.Response(
                    200,
                    json=[
                        {"name": "package.json", "path": "package.json", "size": 350},
                        {"name": "package-lock.json", "path": "package-lock.json", "size": 12000},
                        {"name": "README.md", "path": "README.md", "size": 500},
                    ],
                )
            return httpx.Response(404)

        service = GitHubService(transport=httpx.MockTransport(handler))
        manifests = asyncio.run(service.detect_manifests("test-gh-token", "octocat", "super-project"))
        manifest_names = [m.name for m in manifests]
        self.assertIn("package.json", manifest_names)
        self.assertIn("package-lock.json", manifest_names)

    @patch("app.domain.github.service.lookup_advisories", new_callable=AsyncMock)
    def test_analyze_repository_manifest(self, mock_lookup: AsyncMock) -> None:
        mock_lookup.return_value = [
            [VulnerabilityRecord(id="GHSA-test-vuln", aliases=["CVE-2026-1111"], summary="Critical prototype pollution")]
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                text=json.dumps({"dependencies": {"lodash": "4.17.15"}}),
            )

        service = GitHubService(transport=httpx.MockTransport(handler))
        report = asyncio.run(
            service.analyze_repository_manifest(
                token="test-gh-token",
                owner="octocat",
                repo="super-project",
                manifest_path="package.json",
            )
        )
        self.assertEqual(report.repository, "octocat/super-project")
        self.assertEqual(report.dependency_count, 1)
        self.assertEqual(report.vulnerability_count, 1)
        self.assertEqual(report.risk_level, "HIGH")
        self.assertIn("GHSA-test-vuln", report.recommendations[0])


class GitHubApiRouteTests(DatabaseBackedApiTestCase):
    def test_routes_require_github_token_header(self) -> None:
        res = self.client.get("/api/v1/github/user")
        self.assertEqual(res.status_code, 422)

    def test_get_user_route(self) -> None:
        mock_user = GitHubUserProfile(
            login="octocat",
            name="The Octocat",
            avatar_url="https://avatars.githubusercontent.com/u/583231",
            html_url="https://github.com/octocat",
            public_repos=12,
            total_private_repos=4,
        )
        with patch.object(GitHubService, "get_user_profile", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_user
            res = self.client.get("/api/v1/github/user", headers={"X-GitHub-Token": "test-token"})
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["login"], "octocat")
            self.assertEqual(data["public_repos"], 12)


if __name__ == "__main__":
    unittest.main()
