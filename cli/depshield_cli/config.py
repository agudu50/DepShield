from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

CONFIG_DIRECTORY = ".depshield"
CONFIG_FILE = "config.json"


@dataclass(frozen=True)
class ProjectConfig:
    project_id: str
    organization_id: str
    project_name: str
    manager: str
    api_url: str
    schema_version: int = 1


def find_config(start: Path) -> tuple[Path, Path] | None:
    for candidate in (start, *start.parents):
        config_path = candidate / CONFIG_DIRECTORY / CONFIG_FILE
        if config_path.is_file():
            return candidate, config_path
    return None


def load_config(path: Path) -> ProjectConfig:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read DepShield configuration at {path}: {exc}") from exc
    try:
        config = ProjectConfig(**payload)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid DepShield configuration at {path}") from exc
    if config.schema_version != 1:
        raise ValueError(f"Unsupported DepShield config schema: {config.schema_version}")
    return config


def save_config(root: Path, config: ProjectConfig) -> Path:
    config_directory = root / CONFIG_DIRECTORY
    config_directory.mkdir(parents=True, exist_ok=True)
    config_path = config_directory / CONFIG_FILE
    temporary_path = config_path.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps(
            {
                "schema_version": config.schema_version,
                "project_id": config.project_id,
                "organization_id": config.organization_id,
                "project_name": config.project_name,
                "manager": config.manager,
                "api_url": config.api_url,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    os.replace(temporary_path, config_path)
    return config_path
