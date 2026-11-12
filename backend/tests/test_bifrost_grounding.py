from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.agents.bifrost import BifrostClient, BifrostError
from app.agents.investigation import InvestigationError, SecurityInvestigator
from app.domain.scanning.service import DependencyRecord, VulnerabilityRecord


class BifrostGroundingVerification(unittest.TestCase):
    def test_prompt_enforces_strict_grounding_and_anti_hallucination(self) -> None:
        """Verify that the Bifrost system prompt locks the model strictly to OSV evidence."""
        captured = {}

        def mock_bifrost_api(request: httpx.Request) -> httpx.Response:
            captured["payload"] = json.loads(request.read().decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "id": "bifrost-123",
                    "model": "gpt-4o-mini",
                    "choices": [
                        {
                            "message": {
                                "content": "Advisory GHSA-test confirms a denial-of-service vulnerability."
                            }
                        }
                    ],
                    "usage": {"total_tokens": 42},
                },
            )

        client = BifrostClient(
            base_url="http://localhost:3000/v1",
            model="gpt-4o-mini",
            transport=httpx.MockTransport(mock_bifrost_api),
        )

        real_evidence = [
            {
                "source": "OSV.dev",
                "id": "GHSA-test-456",
                "package": "body-parser",
                "version": "1.20.8",
                "summary": "Denial of Service in body-parser via excessive chunking",
            }
        ]

        reply = asyncio.run(
            client.explain_finding(
                "Evaluate reachability for body-parser",
                real_evidence,
            )
        )

        # 1. Verify system prompt explicitly prohibits hallucinations
        system_prompt = captured["payload"]["messages"][0]["content"]
        self.assertIn("Explain only the supplied verified OSV evidence", system_prompt)
        self.assertIn("Do not invent CVEs", system_prompt)
        self.assertIn("reference advisory IDs for factual claims", system_prompt)

        # 2. Verify temperature is set low (0.1) for deterministic output
        self.assertEqual(captured["payload"]["temperature"], 0.1)

        # 3. Verify user prompt contains only the verified OSV evidence
        user_content = json.loads(captured["payload"]["messages"][1]["content"])
        self.assertEqual(user_content["verified_osv_evidence"][0]["id"], "GHSA-test-456")

        # 4. Verify reply content
        self.assertIn("GHSA-test", reply.answer)
        self.assertEqual(reply.model, "gpt-4o-mini")

    def test_clean_packages_never_invoke_ai_gateway(self) -> None:
        """When OSV finds 0 advisories, Bifrost must NEVER be called to prevent false positives."""
        bifrost = AsyncMock()
        investigator = SecurityInvestigator(bifrost)
        clean_dep = DependencyRecord("safe-package", "2.0.0", "npm", True)

        async def mock_lookup(deps):
            return [[]]

        with patch("app.agents.investigation.lookup_advisories", side_effect=mock_lookup):
            result = asyncio.run(investigator.investigate(clean_dep, "Is this safe?"))

        # Bifrost must NOT be awaited when there are no verified advisories
        bifrost.explain_finding.assert_not_awaited()
        self.assertEqual(result.status, "no_advisory_returned")
        self.assertEqual(result.evidence, [])
        self.assertIsNone(result.model)

    def test_gateway_errors_fail_closed_without_fabricating_claims(self) -> None:
        """If Bifrost gateway fails, the system must fail-closed rather than fabricating fixes."""
        bifrost = AsyncMock()
        bifrost.explain_finding.side_effect = BifrostError("Gateway timeout")
        investigator = SecurityInvestigator(bifrost)
        vulnerable_dep = DependencyRecord("vuln-lib", "1.0.0", "npm", True)

        async def mock_lookup(deps):
            return [
                [
                    VulnerabilityRecord(
                        id="GHSA-real",
                        aliases=["CVE-2024-0001"],
                        summary="Real CVE from OSV.dev",
                    )
                ]
            ]

        with patch("app.agents.investigation.lookup_advisories", side_effect=mock_lookup):
            with self.assertRaises(InvestigationError):
                asyncio.run(investigator.investigate(vulnerable_dep, "Analyze vulnerability"))


if __name__ == "__main__":
    unittest.main()
