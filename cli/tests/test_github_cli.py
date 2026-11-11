from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

import httpx

from depshield_cli.github import (
    GitHubCliClient,
    GitHubManifest,
    GitHubRepo,
    GitHubUser,
)
from depshield_cli.main import build_parser, main


class GitHubCliTests(unittest.TestCase):
    def test_parser_registers_github_subcommands(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["github", "status"])
        self.assertEqual(args.command, "github")
        self.assertEqual(args.github_command, "status")

        args = parser.parse_args(["github", "repos", "--page", "2", "--per-page", "15"])
        self.assertEqual(args.github_command, "repos")
        self.assertEqual(args.page, 2)
        self.assertEqual(args.per_page, 15)

        args = parser.parse_args(["github", "analyze", "octocat/hello-world", "--manifest", "package.json"])
        self.assertEqual(args.github_command, "analyze")
        self.assertEqual(args.repo, "octocat/hello-world")
        self.assertEqual(args.manifest, "package.json")

    def test_github_client_get_user(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers.get("Authorization"), "Bearer test-pat")
            return httpx.Response(
                200,
                json={
                    "login": "octocat",
                    "name": "The Octocat",
                    "avatar_url": "https://avatars.githubusercontent.com/u/583231",
                    "html_url": "https://github.com/octocat",
                    "public_repos": 10,
                },
            )

        client = GitHubCliClient(token="test-pat", transport=httpx.MockTransport(handler))
        user = client.get_user()
        self.assertEqual(user.login, "octocat")
        self.assertEqual(user.public_repos, 10)

    def test_github_client_list_repositories(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 999,
                        "name": "cool-repo",
                        "full_name": "octocat/cool-repo",
                        "private": False,
                        "html_url": "https://github.com/octocat/cool-repo",
                        "description": "Very cool",
                        "default_branch": "main",
                        "language": "Python",
                        "stargazers_count": 88,
                        "updated_at": "2026-11-10T12:00:00Z",
                    }
                ],
            )

        client = GitHubCliClient(token="test-pat", transport=httpx.MockTransport(handler))
        repos = client.list_repositories()
        self.assertEqual(len(repos), 1)
        self.assertEqual(repos[0].name, "cool-repo")
        self.assertEqual(repos[0].stargazers_count, 88)

    def test_github_client_detect_manifests(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if "contents" in str(request.url):
                return httpx.Response(
                    200,
                    json=[
                        {"name": "package.json", "path": "package.json", "size": 350},
                        {"name": "requirements.txt", "path": "requirements.txt", "size": 150},
                    ],
                )
            return httpx.Response(404)

        client = GitHubCliClient(token="test-pat", transport=httpx.MockTransport(handler))
        manifests = client.detect_manifests("octocat", "cool-repo")
        self.assertEqual(len(manifests), 2)
        names = [m.name for m in manifests]
        self.assertIn("package.json", names)
        self.assertIn("requirements.txt", names)

    @patch.object(GitHubCliClient, "get_stored_token", return_value="test-pat")
    @patch.object(GitHubCliClient, "get_user")
    def test_github_status_command(self, mock_user: MagicMock, _mock_token: MagicMock) -> None:
        mock_user.return_value = GitHubUser(
            login="octocat",
            name="The Octocat",
            avatar_url="https://avatar",
            html_url="https://github.com/octocat",
            public_repos=5,
        )
        exit_code = main(["github", "status", "--json"])
        self.assertEqual(exit_code, 0)

