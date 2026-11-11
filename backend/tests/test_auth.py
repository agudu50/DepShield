import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import AuthenticatedUser, get_current_user
from app.config import Settings


class NeonJwtVerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(
            neon_auth_base_url="https://auth.example.test/neondb/auth",
            _env_file=None,
        )
        self.private_key = Ed25519PrivateKey.generate()
        self.public_key = self.private_key.public_key()
        self.jwks_client = SimpleNamespace(
            get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=self.public_key)
        )

    def token(
        self,
        *,
        issuer: str = "https://auth.example.test",
        audience: str = "https://auth.example.test",
        expires_at: datetime | None = None,
        signing_key: Ed25519PrivateKey | None = None,
    ) -> str:
        now = datetime.now(timezone.utc)
        return jwt.encode(
            {
                "sub": "neon-user-1",
                "email": "user@example.test",
                "iss": issuer,
                "aud": audience,
                "iat": now,
                "exp": expires_at or now + timedelta(minutes=5),
            },
            signing_key or self.private_key,
            algorithm="EdDSA",
            headers={"kid": "test-key"},
        )

    def credentials(self, token: str) -> HTTPAuthorizationCredentials:
        return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    def test_valid_token_returns_subject_from_verified_claims(self) -> None:
        with patch("app.auth._get_jwks_client", return_value=self.jwks_client):
            user = get_current_user(self.credentials(self.token()), self.settings)

        self.assertEqual(user, AuthenticatedUser(id="neon-user-1", email="user@example.test"))

    def test_wrong_issuer_is_rejected(self) -> None:
        with (
            patch("app.auth._get_jwks_client", return_value=self.jwks_client),
            self.assertRaises(HTTPException) as raised,
        ):
            get_current_user(
                self.credentials(self.token(issuer="https://attacker.example.test")),
                self.settings,
            )

        self.assertEqual(raised.exception.status_code, 401)

    def test_wrong_audience_is_rejected(self) -> None:
        with (
            patch("app.auth._get_jwks_client", return_value=self.jwks_client),
            self.assertRaises(HTTPException) as raised,
        ):
            get_current_user(
                self.credentials(self.token(audience="https://other.example.test")),
                self.settings,
            )

        self.assertEqual(raised.exception.status_code, 401)

    def test_expired_token_is_rejected(self) -> None:
        with (
            patch("app.auth._get_jwks_client", return_value=self.jwks_client),
            self.assertRaises(HTTPException) as raised,
        ):
            get_current_user(
                self.credentials(self.token(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))),
                self.settings,
            )

        self.assertEqual(raised.exception.status_code, 401)

    def test_token_with_untrusted_signature_is_rejected(self) -> None:
        with (
            patch("app.auth._get_jwks_client", return_value=self.jwks_client),
            self.assertRaises(HTTPException) as raised,
        ):
            get_current_user(
                self.credentials(
                    self.token(signing_key=Ed25519PrivateKey.generate())
                ),
                self.settings,
            )

        self.assertEqual(raised.exception.status_code, 401)

    def test_missing_bearer_token_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            get_current_user(None, self.settings)

        self.assertEqual(raised.exception.status_code, 401)

    def test_missing_auth_configuration_is_reported_as_unavailable(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            get_current_user(
                self.credentials(self.token()),
                Settings(_env_file=None),
            )

        self.assertEqual(raised.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
