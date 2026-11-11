from __future__ import annotations

import logging
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.agents.bifrost import BifrostClient
from app.config import get_settings
from app.domain.github.service import (
    GitHubError,
    GitHubManifestFile,
    GitHubRepository,
    GitHubService,
    GitHubUserProfile,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/github", tags=["github"])
settings = get_settings()


class AnalyzeRepoRequest(BaseModel):
    manifest_path: str = Field(min_length=1, max_length=250)
    ref: str | None = Field(default=None, max_length=100)
    question: str | None = Field(default=None, max_length=1000)
    project_id: UUID | None = None


def _get_github_service() -> GitHubService:
    return GitHubService()


def _get_bifrost_client() -> BifrostClient | None:
    if settings.bifrost_base_url:
        return BifrostClient(
            base_url=settings.bifrost_base_url,
            model=settings.bifrost_model,
            virtual_key=settings.bifrost_virtual_key.get_secret_value(),
        )
    return None


@router.get("/user", response_model=GitHubUserProfile)
async def get_github_user(
    x_github_token: str = Header(..., alias="X-GitHub-Token", description="GitHub Personal Access Token"),
) -> GitHubUserProfile:
    service = _get_github_service()
    try:
        return await service.get_user_profile(x_github_token)
    except GitHubError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/repos", response_model=list[GitHubRepository])
async def list_github_repositories(
    page: int = Query(default=1, ge=1, le=100),
    per_page: int = Query(default=50, ge=1, le=100),
    x_github_token: str = Header(..., alias="X-GitHub-Token", description="GitHub Personal Access Token"),
) -> list[GitHubRepository]:
    service = _get_github_service()
    try:
        return await service.list_repositories(x_github_token, page=page, per_page=per_page)
    except GitHubError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/repos/{owner}/{repo}/manifests", response_model=list[GitHubManifestFile])
async def detect_repository_manifests(
    owner: str,
    repo: str,
    ref: str | None = Query(default=None),
    x_github_token: str = Header(..., alias="X-GitHub-Token", description="GitHub Personal Access Token"),
) -> list[GitHubManifestFile]:
    service = _get_github_service()
    try:
        return await service.detect_manifests(x_github_token, owner=owner, repo=repo, ref=ref)
    except GitHubError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/repos/{owner}/{repo}/analyze")
async def analyze_repository(
    owner: str,
    repo: str,
    request: AnalyzeRepoRequest,
    x_github_token: str = Header(..., alias="X-GitHub-Token", description="GitHub Personal Access Token"),
) -> dict[str, Any]:
    service = _get_github_service()
    bifrost = _get_bifrost_client()
    try:
        report = await service.analyze_repository_manifest(
            token=x_github_token,
            owner=owner,
            repo=repo,
            manifest_path=request.manifest_path,
            ref=request.ref,
            question=request.question,
            bifrost=bifrost,
        )
        return {
            "repository": report.repository,
            "branch": report.branch,
            "manifest_path": report.manifest_path,
            "ecosystem": report.ecosystem,
            "manifest_type": report.manifest_type,
            "dependency_count": report.dependency_count,
            "checked_count": report.checked_count,
            "unpinned_count": report.unpinned_count,
            "vulnerability_count": report.vulnerability_count,
            "risk_level": report.risk_level,
            "agent_summary": report.agent_summary,
            "recommendations": report.recommendations,
            "dependencies": [
                {
                    "name": d.name,
                    "version": d.version,
                    "ecosystem": d.ecosystem,
                    "status": d.status,
                    "vulnerabilities": [
                        {"id": v.id, "aliases": v.aliases, "summary": v.summary}
                        for v in d.vulnerabilities
                    ],
                }
                for d in report.dependencies
            ],
        }
    except GitHubError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

