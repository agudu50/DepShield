import hashlib
import unittest

from app.models import Membership, OrganizationInvitation
from tests.api_support import DatabaseBackedApiTestCase


class OrganizationMemberTests(DatabaseBackedApiTestCase):
    def test_owner_can_invite_matching_email_and_invitation_token_is_not_stored(self) -> None:
        organization_id, _, _ = self.create_project()

        created = self.client.post(
            f"/api/v1/organizations/{organization_id}/invitations",
            json={"email": "new-member@example.test", "role": "member"},
        )

        self.assertEqual(created.status_code, 201)
        token = created.json()["token"]
        invitation_id = created.json()["invitation"]["id"]
        with self.session_factory() as session:
            invitation = session.get(OrganizationInvitation, invitation_id)
            self.assertIsNotNone(invitation)
            self.assertEqual(invitation.token_digest, hashlib.sha256(token.encode()).hexdigest())
            self.assertNotEqual(invitation.token_digest, token)

        self.set_user("new-user")
        self.assertEqual(
            self.client.post("/api/v1/invitations/accept", json={"token": token}).status_code,
            404,
        )

        self.set_user("invited-user", "new-member@example.test")
        accepted = self.client.post("/api/v1/invitations/accept", json={"token": token})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["organization_id"], organization_id)
        self.assertEqual(accepted.json()["role"], "member")
        self.assertEqual(self.client.get("/api/v1/organizations").json()[0]["id"], organization_id)

    def test_only_admins_can_create_invitations_and_manage_roles(self) -> None:
        organization_id, _, _ = self.create_project()
        with self.session_factory() as session:
            session.add(
                Membership(
                    organization_id=organization_id,
                    user_id="member-user",
                    role="member",
                )
            )
            session.commit()

        self.set_user("member-user")
        denied_invite = self.client.post(
            f"/api/v1/organizations/{organization_id}/invitations",
            json={"email": "new-member@example.test"},
        )
        denied_update = self.client.patch(
            f"/api/v1/organizations/{organization_id}/members/member-user",
            json={"role": "admin"},
        )
        self.assertEqual(denied_invite.status_code, 403)
        self.assertEqual(denied_update.status_code, 403)

    def test_last_owner_cannot_be_removed_or_demoted(self) -> None:
        organization_id, _, _ = self.create_project()

        removed = self.client.delete(
            f"/api/v1/organizations/{organization_id}/members/test-user"
        )
        demoted = self.client.patch(
            f"/api/v1/organizations/{organization_id}/members/test-user",
            json={"role": "admin"},
        )

        self.assertEqual(removed.status_code, 409)
        self.assertEqual(demoted.status_code, 409)

    def test_invitation_can_be_revoked_before_acceptance(self) -> None:
        organization_id, _, _ = self.create_project()
        created = self.client.post(
            f"/api/v1/organizations/{organization_id}/invitations",
            json={"email": "new-member@example.test"},
        )

        revoked = self.client.delete(
            f"/api/v1/organizations/{organization_id}/invitations/{created.json()['invitation']['id']}"
        )
        self.assertEqual(revoked.status_code, 204)

        self.set_user("invited-user", "new-member@example.test")
        accepted = self.client.post(
            "/api/v1/invitations/accept",
            json={"token": created.json()["token"]},
        )
        self.assertEqual(accepted.status_code, 404)


if __name__ == "__main__":
    unittest.main()
