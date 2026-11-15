from __future__ import annotations

import asyncio
import unittest

import httpx

from app.agents.bifrost_providers import clear_cache, gateway_root, provider_availability


def gateway(routes: dict[str, httpx.Response]):
    def respond(request: httpx.Request) -> httpx.Response:
        return routes.get(request.url.path, httpx.Response(404, json={"error": "provider not found"}))
    return httpx.MockTransport(respond)


class ProviderAvailabilityTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_cache()

    def test_gateway_root_strips_integration_prefix(self) -> None:
        self.assertEqual(gateway_root("http://localhost:8080/openai"), "http://localhost:8080")
        self.assertEqual(gateway_root("https://gw.example.com/v1"), "https://gw.example.com")

    def test_only_openai_configured(self) -> None:
        transport = gateway({"/api/providers/openai": httpx.Response(200, json={"name": "openai", "keys": [{"id": "k1"}]})})
        status, by = asyncio.run(
            provider_availability("http://gw/openai", ["openai", "anthropic", "groq"], transport=transport)
        )
        self.assertEqual(status, "checked")
        self.assertEqual(by, {"anthropic": False, "groq": False, "openai": True})

    def test_provider_without_keys_is_not_available_unless_keyless(self) -> None:
        transport = gateway({
            "/api/providers/anthropic": httpx.Response(200, json={"name": "anthropic", "keys": []}),
            "/api/providers/ollama": httpx.Response(200, json={"name": "ollama", "keys": []}),
        })
        _, by = asyncio.run(provider_availability("http://gw/openai", ["anthropic", "ollama"], transport=transport))
        self.assertEqual(by, {"anthropic": False, "ollama": True})

    def test_unreachable_gateway_is_unknown_not_unavailable(self) -> None:
        def down(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)
        status, by = asyncio.run(
            provider_availability("http://gw/openai", ["openai", "groq"], transport=httpx.MockTransport(down))
        )
        self.assertEqual(status, "unreachable")
        self.assertEqual(by, {"groq": None, "openai": None})

    def test_auth_protected_management_api_is_unknown(self) -> None:
        def locked(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"error": "unauthorized"})
        status, by = asyncio.run(
            provider_availability("http://gw/openai", ["openai"], transport=httpx.MockTransport(locked))
        )
        self.assertEqual(status, "partial")
        self.assertEqual(by, {"openai": None})


if __name__ == "__main__":
    unittest.main()
