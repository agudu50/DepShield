from __future__ import annotations

import uuid

from app.api.routes import metrics as metrics_routes
from app.site_metrics import SiteVisit, _invalidate_summary, increment_counters
from tests.api_support import DatabaseBackedApiTestCase


def vid() -> str:
    return str(uuid.uuid4())


class SiteMetricsTests(DatabaseBackedApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        metrics_routes._last_seen.clear()
        _invalidate_summary()

    def summary(self) -> dict:
        _invalidate_summary()
        res = self.client.get("/api/v1/metrics/summary")
        self.assertEqual(res.status_code, 200)
        return res.json()

    def test_counts_views_unique_visitors_and_presence(self) -> None:
        a, b = vid(), vid()
        self.assertEqual(self.client.post("/api/v1/metrics/visit", json={"visitor_id": a}).status_code, 204)
        self.assertEqual(self.client.post("/api/v1/metrics/visit", json={"visitor_id": b}).status_code, 204)
        data = self.summary()
        self.assertTrue(data["available"])
        self.assertEqual(data["page_views"], 2)
        self.assertEqual(data["unique_visitors"], 2)
        self.assertEqual(data["visitors_today"], 2)
        self.assertEqual(data["here_now"], 2)

    def test_heartbeat_keeps_presence_without_adding_a_view(self) -> None:
        a = vid()
        self.client.post("/api/v1/metrics/visit", json={"visitor_id": a})
        self.client.post("/api/v1/metrics/visit", json={"visitor_id": a, "heartbeat": True})
        self.assertEqual(self.summary()["page_views"], 1)

    def test_rapid_repeat_views_are_throttled(self) -> None:
        a = vid()
        for _ in range(5):
            self.client.post("/api/v1/metrics/visit", json={"visitor_id": a})
        self.assertEqual(self.summary()["page_views"], 1)

    def test_rejects_non_uuid_ids(self) -> None:
        for bad in ("not-a-uuid", "x" * 36, "00000000-0000-1000-8000-000000000000"):
            res = self.client.post("/api/v1/metrics/visit", json={"visitor_id": bad})
            self.assertEqual(res.status_code, 422, bad)

    def test_only_a_random_id_and_timestamps_are_stored(self) -> None:
        self.client.post("/api/v1/metrics/visit", json={"visitor_id": vid()}, headers={"User-Agent": "secret-agent"})
        with self.session_factory() as s:
            row = s.query(SiteVisit).one()
            stored = {c.name for c in SiteVisit.__table__.columns}
        self.assertEqual(stored, {"day", "visitor_id", "views", "first_seen", "last_seen"})
        self.assertNotIn("secret-agent", str(vars(row)))

    def test_audit_counters_accumulate(self) -> None:
        with self.session_factory() as s:
            increment_counters(s, {"manifests_audited": 1, "packages_checked": 271, "advisories_found": 10})
            increment_counters(s, {"manifests_audited": 1, "packages_checked": 12, "advisories_found": 34, "bogus": 99})
        data = self.summary()
        self.assertEqual((data["manifests_audited"], data["packages_checked"], data["advisories_found"]), (2, 283, 44))
        self.assertNotIn("bogus", data)
