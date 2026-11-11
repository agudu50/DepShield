from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.agents.bifrost import BifrostClient, BifrostError
from app.domain.scanning.service import (
    AdvisoryServiceError,
    DependencyRecord,
    lookup_advisories,
)


class InvestigationError(RuntimeError):
    pass


@dataclass(frozen=True)
class InvestigationResult:
    status: str
    answer: str
    evidence: list[dict[str, Any]]
    model: str | None
    gateway_response_id: str | None
    usage: dict[str, int]


class SecurityInvestigator:
    def __init__(self, bifrost: BifrostClient) -> None:
        self._bifrost = bifrost

    async def investigate(
        self,
        dependency: DependencyRecord,
        question: str,
    ) -> InvestigationResult:
        try:
            advisories = await lookup_advisories([dependency])
        except AdvisoryServiceError as exc:
            raise InvestigationError("Authoritative advisory lookup failed") from exc

        evidence = [
            {
                "source": "OSV.dev",
                "id": advisory.id,
                "aliases": advisory.aliases,
                "summary": advisory.summary,
            }
            for advisory in advisories[0][:20]
        ]
        evidence = [
            {
                **advisory,
                "aliases": advisory["aliases"][:10],
                "summary": advisory["summary"][:1000],
            }
            for advisory in evidence
        ]
        if not evidence:
            return InvestigationResult(
                status="no_advisory_returned",
                answer=(
                    "OSV.dev returned no matching advisory for this exact package version. "
                    "This does not prove the package is safe, and no AI assessment was generated."
                ),
                evidence=[],
                model=None,
                gateway_response_id=None,
                usage={},
            )

        try:
            reply = await self._bifrost.explain_finding(question, evidence)
        except BifrostError as exc:
            raise InvestigationError("AI explanation service is unavailable") from exc

        return InvestigationResult(
            status="evidence_reviewed",
            answer=reply.answer,
            evidence=evidence,
            model=reply.model,
            gateway_response_id=reply.response_id,
            usage=reply.usage,
        )
