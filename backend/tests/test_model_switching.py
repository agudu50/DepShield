from __future__ import annotations

import asyncio
import json
import unittest
from types import SimpleNamespace

import httpx
from pydantic import SecretStr

from app.agents.bifrost import (
    BifrostClient,
    ModelNotAllowedError,
    cost_tier,
    make_bifrost_client,
    resolve_model,
)


def _settings(**overrides):
    base = dict(
        bifrost_base_url="http://bifrost.test/openai",
        bifrost_model="openai/gpt-4o-mini",
        bifrost_models=["openai/gpt-4o-mini", "anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5"],
        bifrost_fallback_models=[],
        bifrost_virtual_key=SecretStr(""),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _capture(model: str, fallbacks: list[str] | None = None, content="ok"):
    captured: dict = {}

    def respond(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.read()))
        return httpx.Response(
            200,
            json={"id": "r1", "model": model, "choices": [{"message": {"content": content}}], "usage": {"total_tokens": 9}},
        )

    client = BifrostClient(
        base_url="http://bifrost.test/openai",
        model=model,
        transport=httpx.MockTransport(respond),
        fallback_models=fallbacks,
    )
    return client, captured


class ModelSwitchingTests(unittest.TestCase):
    def test_openai_model_keeps_low_temperature(self) -> None:
        client, sent = _capture("openai/gpt-4o-mini")
        asyncio.run(client.explain_finding("q", [{"id": "GHSA-x"}]))
        self.assertEqual(sent["model"], "openai/gpt-4o-mini")
        self.assertEqual(sent["temperature"], 0.1)
        self.assertEqual(sent["max_tokens"], 500)

    def test_anthropic_model_omits_temperature_and_leaves_thinking_headroom(self) -> None:
        client, sent = _capture("anthropic/claude-sonnet-5-5")
        asyncio.run(client.explain_finding("q", [{"id": "GHSA-x"}]))
        self.assertEqual(sent["model"], "anthropic/claude-sonnet-5-5")
        self.assertNotIn("temperature", sent)
        self.assertGreaterEqual(sent["max_tokens"], 1024)

    def test_fallback_chain_is_sent_to_gateway_without_primary(self) -> None:
        client, sent = _capture("anthropic/claude-haiku-5-5", ["anthropic/claude-haiku-5-5", "openai/gpt-4o-mini"])
        asyncio.run(client.ping())
        self.assertEqual(sent["fallbacks"], ["openai/gpt-4o-mini"])

    def test_content_part_arrays_are_flattened(self) -> None:
        client, _ = _capture("anthropic/claude-haiku-5-5", content=[{"type": "text", "text": "pong"}])
        self.assertEqual(asyncio.run(client.ping()).answer, "pong")

    def test_resolve_model_defaults_and_enforces_allowlist(self) -> None:
        settings = _settings()
        self.assertEqual(resolve_model(settings, None), "openai/gpt-4o-mini")
        self.assertEqual(resolve_model(settings, "anthropic/claude-sonnet-5-5"), "anthropic/claude-sonnet-5-5")
        with self.assertRaises(ModelNotAllowedError):
            resolve_model(settings, "anthropic/some-unlisted-model")

    def test_cost_tiers_label_free_options(self) -> None:
        self.assertEqual(cost_tier("ollama/llama3.2"), "local")
        self.assertEqual(cost_tier("openrouter/meta-llama/llama-3.3-70b-instruct:free"), "free")
        self.assertEqual(cost_tier("groq/llama-3.1-8b-instant"), "free_tier")
        self.assertEqual(cost_tier("gemini/gemini-2.5-flash"), "free_tier")
        self.assertEqual(cost_tier("anthropic/claude-haiku-5-5"), "paid")

    def test_factory_uses_selected_model(self) -> None:
        self.assertEqual(make_bifrost_client(_settings(), "anthropic/claude-haiku-5-5").model, "anthropic/claude-haiku-5-5")


if __name__ == "__main__":
    unittest.main()
