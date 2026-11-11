import unittest

from app.auth import get_current_user
from app.main import app
from tests.api_support import DatabaseBackedApiTestCase


class OrganizationEndpointTests(DatabaseBackedApiTestCase):
    def test_create_organization_assigns_owner_membership(self) -> None:
        response = self.client.post(
            "/api/v1/organizations",
            json={"name": "  Security Team  "},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "Security Team")
        self.assertEqual(response.json()["role"], "owner")
        listed = self.client.get("/api/v1/organizations")
        self.assertEqual([item["id"] for item in listed.json()], [response.json()["id"]])

    def test_project_creation_is_scoped_to_organization_membership(self) -> None:
        organization_response = self.client.post(
            "/api/v1/organizations",
            json={"name": "Security Team"},
        )
        organization_id = organization_response.json()["id"]

        created = self.client.post(
            f"/api/v1/organizations/{organization_id}/projects",
            json={"name": "api"},
        )

        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["organization_id"], organization_id)
        listed = self.client.get(
            f"/api/v1/organizations/{organization_id}/projects",
        )
        self.assertEqual([project["id"] for project in listed.json()], [created.json()["id"]])

    def test_non_member_cannot_list_or_create_projects(self) -> None:
        organization_id, _, _ = self.create_project()
        self.set_user("unrelated-user")

        listed = self.client.get(
            f"/api/v1/organizations/{organization_id}/projects",
        )
        created = self.client.post(
            f"/api/v1/organizations/{organization_id}/projects",
            json={"name": "private"},
        )

        self.assertEqual(listed.status_code, 404)
        self.assertEqual(created.status_code, 404)
        self.assertEqual(self.client.get("/api/v1/organizations").json(), [])

    def test_members_cannot_create_projects(self) -> None:
        organization_id, _, _ = self.create_project(
            user_id="test-user",
            role="member",
        )

        response = self.client.post(
            f"/api/v1/organizations/{organization_id}/projects",
            json={"name": "forbidden"},
        )

        self.assertEqual(response.status_code, 403)

    def test_organization_route_requires_authentication(self) -> None:
        app.dependency_overrides.pop(get_current_user)

        response = self.client.get("/api/v1/organizations")

        self.assertEqual(response.status_code, 401)

    def test_duplicate_project_name_in_one_organization_returns_conflict(self) -> None:
        organization_id, _, _ = self.create_project()

        response = self.client.post(
            f"/api/v1/organizations/{organization_id}/projects",
            json={"name": "demo"},
        )

        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
