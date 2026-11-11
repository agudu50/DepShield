from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlsplit

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient, PyJWKClientConnectionError

from app.config import Settings, get_settings

_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str | None


def _auth_configuration(settings: Settings) -> tuple[str, str]:
    base_url = settings.neon_auth_base_url.strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=503, detail="Neon Auth is not configured")

    parsed_base = urlsplit(base_url)
    if (
        parsed_base.scheme not in {"https", "http"}
        or not parsed_base.netloc
        or parsed_base.username is not None
        or parsed_base.password is not None
        or parsed_base.query
        or parsed_base.fragment
        or (
            parsed_base.scheme != "https"
            and parsed_base.hostname not in {"localhost", "127.0.0.1", "::1"}
        )
    ):
        raise HTTPException(status_code=503, detail="Neon Auth URL is invalid")

    origin = f"{parsed_base.scheme}://{parsed_base.netloc}"
    jwks_url = settings.neon_auth_jwks_url.strip()
    if not jwks_url:
        jwks_url = f"{base_url}/.well-known/jwks.json"

    parsed_jwks = urlsplit(jwks_url)
    if (
        parsed_jwks.scheme != parsed_base.scheme
        or parsed_jwks.netloc != parsed_base.netloc
        or not parsed_jwks.path
        or parsed_jwks.query
        or parsed_jwks.fragment
    ):
        raise HTTPException(status_code=503, detail="Neon Auth JWKS URL is invalid")

    return origin, jwks_url


@lru_cache(maxsize=4)
def _get_jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url, cache_keys=True, timeout=5)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Bearer authentication is required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    issuer, jwks_url = _auth_configuration(settings)
    try:
        signing_key = _get_jwks_client(jwks_url).get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["EdDSA"],
            issuer=issuer,
            audience=issuer,
            options={"require": ["exp", "iss", "aud", "sub"]},
            leeway=30,
        )
    except PyJWKClientConnectionError as exc:
        raise HTTPException(status_code=503, detail="Neon Auth keys are temporarily unavailable") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=401,
            detail="Bearer token is invalid or expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    subject = claims.get("sub")
    email = claims.get("email")
    if not isinstance(subject, str) or not subject.strip():
        raise HTTPException(status_code=401, detail="Bearer token has no valid subject")

    return AuthenticatedUser(
        id=subject,
        email=email if isinstance(email, str) else None,
    )
