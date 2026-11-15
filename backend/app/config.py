from functools import lru_cache
import json
from pathlib import Path
from typing import Any

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "DepShield AI"
    app_version: str = "0.1.0"
    environment: str = "development"
    database_url: SecretStr = SecretStr("")
    database_url_unpooled: SecretStr = SecretStr("")
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if not v or v == "*":
                return ["*"]
            if v.startswith("[") and v.endswith("]"):
                try:
                    parsed = json.loads(v)
                    if isinstance(parsed, list):
                        return [str(x).strip() for x in parsed if str(x).strip()]
                except Exception:
                    pass
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        if isinstance(v, (list, tuple, set)):
            return [str(x).strip() for x in v if str(x).strip()]
        return ["*"]
    bifrost_base_url: str = "http://localhost:8080/openai"
    # Default model plus the allowlist users may switch between. Bifrost routes on the
    # "provider/model" prefix, so any provider configured in the gateway works here.
    bifrost_model: str = "openai/gpt-4o-mini"
    bifrost_models: list[str] = [
        "openai/gpt-4o-mini",
        "openai/gpt-4o",
        "anthropic/claude-haiku-5-5",
        "anthropic/claude-sonnet-5-5",
        "anthropic/claude-opus-5-5",
        # Free: free-tier API keys (rate limited) or fully local.
        "groq/llama-3.3-70b-versatile",
        "groq/llama-3.1-8b-instant",
        "gemini/gemini-2.5-flash",
        "openrouter/meta-llama/llama-3.3-70b-instruct:free",
        "ollama/llama3.2",
    ]
    # Optional Bifrost-side failover chain, tried in order if the chosen model errors.
    bifrost_fallback_models: list[str] = []
    bifrost_virtual_key: SecretStr = SecretStr("")
    neon_auth_base_url: str = ""
    neon_auth_jwks_url: str = ""

    class Config:
        env_file = Path(__file__).resolve().parents[2] / ".env"
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
