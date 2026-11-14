"""Live end-to-end check that Bifrost returns real model output, not mock data.

Unlike the unit tests (which use httpx.MockTransport), this script talks to the
REAL OSV.dev API and the REAL Bifrost gateway configured in .env.

Run from backend/ with the gateway running:
    .venv\\Scripts\\python.exe -m tests.live_bifrost_check
    .venv\\Scripts\\python.exe -m tests.live_bifrost_check --model anthropic/claude-sonnet-5-5

Exit code 0 = every check passed, 1 = at least one failed, 2 = gateway unreachable.
"""
from __future__ import annotations

import asyncio
import re
import sys
import time

from app.agents.bifrost import BifrostClient, BifrostError
from app.config import get_settings
from app.domain.scanning.service import DependencyRecord, lookup_advisories

settings = get_settings()

# Two packages pinned to versions with well-known, distinct OSV advisories.
TARGETS = [
    DependencyRecord("lodash", "4.17.15", "npm", True),
    DependencyRecord("minimist", "1.2.5", "npm", True),
]
ADVISORY_ID = re.compile(r"\b(?:GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|CVE-\d{4}-\d{4,})\b", re.I)

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    results.append((ok, label))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}")


async def main() -> int:
    model = settings.bifrost_model
    if "--model" in sys.argv:
        model = sys.argv[sys.argv.index("--model") + 1]
    print(f"Gateway : {settings.bifrost_base_url}")
    print(f"Model   : {model}\n")
    client = BifrostClient(
        base_url=settings.bifrost_base_url,
        model=model,
        virtual_key=settings.bifrost_virtual_key.get_secret_value(),
    )

    print("1) Gateway ping")
    try:
        started = time.perf_counter()
        pong = await client.ping()
        latency = (time.perf_counter() - started) * 1000
    except BifrostError as exc:
        print(f"  [FAIL] Gateway unreachable: {exc} ({exc.__cause__!r})")
        print("\nStart Bifrost first, e.g.:  npx -y @maximhq/bifrost   (UI at http://localhost:8080)")
        return 2
    print(f"  reply={pong.answer!r} id={pong.response_id} model={pong.model} {latency:.0f}ms")
    check(bool(pong.response_id), "Gateway returned a response id")
    check(pong.usage.get("total_tokens", 0) > 0, "Gateway reported non-zero token usage")
    check("pong" in pong.answer.lower(), "Model followed a trivial instruction")

    print("\n2) Real OSV evidence -> Bifrost explanation")
    advisories = await lookup_advisories(TARGETS)
    answers: list[str] = []
    ids_seen: set[str] = set()
    for dep, advs in zip(TARGETS, advisories):
        evidence = [
            {"source": "OSV.dev", "id": a.id, "aliases": a.aliases[:10], "summary": a.summary[:1000]}
            for a in advs[:20]
        ]
        allowed = {e["id"].upper() for e in evidence} | {x.upper() for e in evidence for x in e["aliases"]}
        print(f"\n  {dep.name}@{dep.version}: {len(evidence)} OSV advisories {sorted(e['id'] for e in evidence)[:5]}")
        check(len(evidence) > 0, f"OSV returned advisories for {dep.name}@{dep.version}")
        if not evidence:
            continue

        reply = await client.explain_finding(
            f"Explain the risk of {dep.name}@{dep.version} and the fix.", evidence
        )
        print(f"  model={reply.model} id={reply.response_id} usage={reply.usage}")
        print("  answer: " + reply.answer[:400].replace("\n", " ") + ("..." if len(reply.answer) > 400 else ""))

        cited = {m.upper() for m in ADVISORY_ID.findall(reply.answer)}
        check(bool(reply.response_id) and reply.response_id not in ids_seen, "Unique gateway response id")
        ids_seen.add(reply.response_id or "")
        check(reply.usage.get("prompt_tokens", 0) > 50, "Prompt tokens reflect the evidence payload")
        check(dep.name.lower() in reply.answer.lower(), f"Answer is about {dep.name}")
        check(bool(cited & allowed), "Answer cites at least one supplied advisory id")
        invented = cited - allowed
        check(not invented, f"No advisory ids outside the evidence {sorted(invented) if invented else ''}".rstrip())
        answers.append(reply.answer)

    if len(answers) == 2:
        check(answers[0] != answers[1], "Different evidence produced different answers (not canned)")

    failed = [label for ok, label in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
