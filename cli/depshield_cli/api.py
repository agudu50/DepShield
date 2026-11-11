from __future__ import annotations

from typing import Any

import httpx


class ApiError(RuntimeError):
    pass


class ApiClient:
    def __init__(self, base_url: str, token: str, timeout: float = 20.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
        )

    def close(self) -> None:
        self._client.close()

    def get(self, path: str) -> Any:
        return self._request("GET", path)

    def post(self, path: str, payload: dict[str, Any]) -> Any:
        return self._request("POST", path, json=payload)

    def put(self, path: str, payload: dict[str, Any]) -> Any:
        return self._request("PUT", path, json=payload)

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._client.request(
                method,
                f"{self._base_url}{path}",
                **kwargs,
            )
        except httpx.TimeoutException as exc:
            raise ApiError("DepShield API request timed out; the required check did not complete") from exc
        except httpx.RequestError as exc:
            raise ApiError("DepShield API is unavailable; the required check did not complete") from exc

        try:
            payload = response.json() if response.content else None
        except ValueError:
            payload = None
        if not response.is_success:
            detail = payload.get("detail") if isinstance(payload, dict) else None
            if response.status_code == 401:
                raise ApiError("DepShield login expired or was rejected; run `depshield login` again")
            raise ApiError(
                str(detail or f"DepShield API returned HTTP {response.status_code}")
            )
        return payload
