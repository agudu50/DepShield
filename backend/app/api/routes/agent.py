import json
import logging
import re
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from app.agents.bifrost import BifrostClient, BifrostError, ModelNotAllowedError, resolve_model


def make_bifrost_client(settings: "Settings", model: str | None = None) -> BifrostClient:
    return BifrostClient(
        base_url=settings.bifrost_base_url,
        model=resolve_model(settings, model),
        virtual_key=settings.bifrost_virtual_key.get_secret_value(),
        fallback_models=list(settings.bifrost_fallback_models),
    )
from app.agents.investigation import InvestigationError, SecurityInvestigator
from app.api.dependencies import get_authenticated_db_session, require_project_membership
from app.auth import AuthenticatedUser, get_current_user
from app.config import Settings, get_settings
from app.domain.scanning.service import (
    AdvisoryServiceError,
    ManifestError,
    lookup_advisories,
    parse_manifest,
)
from app.models import AgentInvestigation, InvestigationEvent, Membership, Project

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/agent", tags=["agent"])

_PACKAGE_NAME = re.compile(r"^@?[A-Za-z0-9._/-]{1,214}$")
_NPM_PACKAGE_NAME = re.compile(r"^(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+$")
_EXACT_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.!+_-]{0,99}$")


class InvestigationRequest(BaseModel):
    project_id: UUID
    ecosystem: Literal["npm", "python"]
    package_name: str = Field(min_length=1, max_length=214)
    version: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=1, max_length=1000)
    model: str | None = Field(default=None, max_length=120)

    @field_validator("package_name")
    @classmethod
    def package_name_is_supported(cls, value: str) -> str:
        value = value.strip()
        if not _PACKAGE_NAME.fullmatch(value) or ".." in value or "//" in value:
            raise ValueError("Package name contains unsupported characters")
        return value

    @field_validator("version")
    @classmethod
    def version_is_exact(cls, value: str) -> str:
        value = value.strip()
        if not _EXACT_VERSION.fullmatch(value) or any(character in value for character in "<>=^*"):
            raise ValueError("An exact package version is required")
        return value

    @field_validator("question")
    @classmethod
    def question_is_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Question must not be blank")
        return value


class RegistryMetadata(BaseModel):
    registry: str | None = Field(default=None, max_length=500)
    published_at: str | None = Field(default=None, max_length=100)
    deprecated: str | None = Field(default=None, max_length=1000)
    repository: str | None = Field(default=None, max_length=1000)
    provenance_url: str | None = Field(default=None, max_length=1000)
    integrity: str | None = Field(default=None, max_length=500)
    lifecycle_scripts: list[str] = Field(default_factory=list, max_length=20)
    yanked: bool = False

    @field_validator("lifecycle_scripts")
    @classmethod
    def lifecycle_script_names_are_bounded(cls, value: list[str]) -> list[str]:
        if any(len(script) > 128 for script in value):
            raise ValueError("Lifecycle script names must be at most 128 characters")
        return value


class PreflightRequest(BaseModel):
    project_id: UUID
    ecosystem: Literal["npm", "python"]
    package_name: str = Field(min_length=1, max_length=214)
    version: str = Field(min_length=1, max_length=100)
    metadata: RegistryMetadata = Field(default_factory=RegistryMetadata)


class EvidenceResponse(BaseModel):
    source: Literal["OSV.dev"]
    id: str
    aliases: list[str]
    summary: str


class PreflightResponse(BaseModel):
    investigation_id: UUID
    decision: Literal["allow", "warn", "block"]
    policy_version: str
    package_name: str
    version: str
    metadata: RegistryMetadata
    metadata_classification: Literal["untrusted_registry_metadata"]
    evidence: list[EvidenceResponse]
    explanation: str
    explanation_status: Literal["not_needed", "available", "unavailable"]
    caveat: str


class InvestigationEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    payload: dict[str, object]
    created_at: datetime


class InvestigationResponse(BaseModel):
    id: UUID
    status: Literal["evidence_reviewed", "no_advisory_returned"]
    ecosystem: str
    package_name: str
    version: str
    answer: str
    evidence: list[EvidenceResponse]
    model: str | None
    gateway_response_id: str | None
    usage: dict[str, int]
    created_at: datetime
    completed_at: datetime
    durable_history: bool = True


class InvestigationSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    ecosystem: str
    package_name: str
    version: str
    status: str
    created_at: datetime
    completed_at: datetime | None


class InvestigationDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    organization_id: UUID
    actor_user_id: str
    ecosystem: str
    package_name: str
    version: str
    question: str
    status: str
    answer: str | None
    evidence: list[EvidenceResponse]
    model: str | None
    gateway_response_id: str | None
    usage: dict[str, int]
    error_code: str | None
    created_at: datetime
    completed_at: datetime | None
    events: list[InvestigationEventResponse]


def _append_event(
    session: Session,
    investigation: AgentInvestigation,
    actor_user_id: str | None,
    event_type: str,
    payload: dict[str, object] | None = None,
) -> None:
    session.add(
        InvestigationEvent(
            investigation_id=investigation.id,
            actor_user_id=actor_user_id,
            event_type=event_type,
            payload=payload or {},
        )
    )


def _commit_or_report_storage_error(session: Session, action: str) -> None:
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Could not persist %s", action)
        raise HTTPException(status_code=503, detail="Investigation history could not be saved") from exc


@router.post("/investigations", response_model=InvestigationResponse, status_code=201)
async def investigate_dependency(
    request: InvestigationRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
    settings: Settings = Depends(get_settings),
) -> InvestigationResponse:
    project, _ = require_project_membership(session, user.id, request.project_id)

    try:
        if request.ecosystem == "npm":
            if not _NPM_PACKAGE_NAME.fullmatch(request.package_name):
                raise HTTPException(status_code=422, detail="Invalid npm package name")
            manifest = json.dumps({"dependencies": {request.package_name: request.version}})
        else:
            manifest = f"{request.package_name}=={request.version}"
        dependencies = parse_manifest(manifest, request.ecosystem)
    except ManifestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if len(dependencies) != 1 or not dependencies[0].exact_version:
        raise HTTPException(status_code=422, detail="An exact package version is required")

    investigation = AgentInvestigation(
        organization_id=project.organization_id,
        project_id=project.id,
        actor_user_id=user.id,
        ecosystem=request.ecosystem,
        package_name=request.package_name,
        version=request.version,
        question=request.question,
        status="running",
    )
    session.add(investigation)
    session.flush()
    _append_event(session, investigation, user.id, "authorization.allowed", {"project_id": project.id})
    _append_event(session, investigation, user.id, "investigation.started")
    _commit_or_report_storage_error(session, "investigation start")

    try:
        bifrost_client = make_bifrost_client(settings, request.model)
    except ModelNotAllowedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    investigator = SecurityInvestigator(bifrost_client)
    try:
        result = await investigator.investigate(dependencies[0], request.question)
    except InvestigationError as exc:
        investigation.status = "failed"
        investigation.error_code = "upstream_failure"
        investigation.completed_at = datetime.now(timezone.utc)
        _append_event(
            session,
            investigation,
            None,
            "investigation.failed",
            {"code": investigation.error_code},
        )
        _commit_or_report_storage_error(session, "investigation failure")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected investigation failure for %s", investigation.id)
        investigation.status = "failed"
        investigation.error_code = "internal_failure"
        investigation.completed_at = datetime.now(timezone.utc)
        _append_event(
            session,
            investigation,
            None,
            "investigation.failed",
            {"code": investigation.error_code},
        )
        _commit_or_report_storage_error(session, "investigation failure")
        raise HTTPException(status_code=502, detail="The investigation could not be completed") from exc

    completed_at = datetime.now(timezone.utc)
    investigation.status = "completed"
    investigation.answer = result.answer
    investigation.evidence = result.evidence
    investigation.model = result.model
    investigation.gateway_response_id = result.gateway_response_id
    investigation.usage = result.usage
    investigation.completed_at = completed_at
    _append_event(
        session,
        investigation,
        None,
        "advisory.evidence_reviewed" if result.evidence else "advisory.no_match",
        {
            "source": "OSV.dev",
            "advisory_ids": [item["id"] for item in result.evidence],
        },
    )
    if result.model is not None:
        _append_event(
            session,
            investigation,
            None,
            "bifrost.explanation_received",
            {
                "model": result.model,
                "gateway_response_id": result.gateway_response_id,
                "usage": result.usage,
            },
        )
    _append_event(
        session,
        investigation,
        None,
        "investigation.completed",
        {"status": result.status},
    )
    _commit_or_report_storage_error(session, "investigation result")

    return InvestigationResponse(
        id=investigation.id,
        status=result.status,
        ecosystem=request.ecosystem,
        package_name=request.package_name,
        version=request.version,
        answer=result.answer,
        evidence=result.evidence,
        model=result.model,
        gateway_response_id=result.gateway_response_id,
        usage=result.usage,
        created_at=investigation.created_at,
        completed_at=completed_at,
    )


@router.post("/preflight", response_model=PreflightResponse, status_code=201)
async def preflight_dependency(
    request: PreflightRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
    settings: Settings = Depends(get_settings),
) -> PreflightResponse:
    project, _ = require_project_membership(session, user.id, request.project_id)
    try:
        if request.ecosystem == "npm":
            manifest = json.dumps({"dependencies": {request.package_name: request.version}})
        else:
            manifest = f"{request.package_name}=={request.version}"
        dependencies = parse_manifest(manifest, request.ecosystem)
    except ManifestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if len(dependencies) != 1 or not dependencies[0].exact_version:
        raise HTTPException(status_code=422, detail="An exact package version is required")

    investigation = AgentInvestigation(
        organization_id=project.organization_id,
        project_id=project.id,
        actor_user_id=user.id,
        ecosystem=request.ecosystem,
        package_name=request.package_name,
        version=request.version,
        question="Apply the project's pre-install security policy to this exact package version.",
        status="running",
    )
    session.add(investigation)
    session.flush()
    _append_event(session, investigation, user.id, "preflight.started")
    metadata = request.metadata.model_dump(exclude_none=True)
    if metadata:
        _append_event(session, investigation, user.id, "registry.metadata_received", metadata)
    _commit_or_report_storage_error(session, "preflight start")

    try:
        advisories = await lookup_advisories(dependencies)
    except AdvisoryServiceError as exc:
        investigation.status = "failed"
        investigation.error_code = "advisory_source_unavailable"
        investigation.completed_at = datetime.now(timezone.utc)
        _append_event(
            session,
            investigation,
            None,
            "preflight.failed",
            {"code": investigation.error_code},
        )
        _commit_or_report_storage_error(session, "preflight failure")
        raise HTTPException(status_code=502, detail="Required advisory check is unavailable") from exc

    evidence = [
        {
            "source": "OSV.dev",
            "id": advisory.id,
            "aliases": advisory.aliases[:10],
            "summary": advisory.summary[:1000],
        }
        for advisory in advisories[0][:20]
    ]
    decision: Literal["allow", "warn", "block"]
    explanation_status: Literal["not_needed", "available", "unavailable"] = "not_needed"
    explanation = (
        "OSV.dev returned no matching advisory for this exact version. "
        "This is not a guarantee that the package is safe."
    )
    model = None
    response_id = None
    usage: dict[str, int] = {}
    if evidence:
        decision = "block"
        try:
            reply = await make_bifrost_client(settings).explain_finding(
                "Summarize only the verified advisory evidence and do not infer package safety.",
                evidence,
            )
        except BifrostError:
            explanation_status = "unavailable"
            explanation = "Verified advisory evidence matched; AI explanation is unavailable."
            investigation.error_code = "ai_explanation_unavailable"
        else:
            explanation_status = "available"
            explanation = reply.answer
            model = reply.model
            response_id = reply.response_id
            usage = reply.usage
    elif (
        metadata.get("deprecated")
        or metadata.get("lifecycle_scripts")
        or metadata.get("provenance_url")
        or metadata.get("yanked")
    ):
        decision = "warn"
        explanation = (
            "No matching OSV advisory was returned, but registry metadata contains signals "
            "that should be reviewed. Provenance signals are not independently verified here."
            " Metadata is untrusted and is not proof of malicious behavior."
        )
    else:
        decision = "allow"

    completed_at = datetime.now(timezone.utc)
    investigation.status = "completed"
    investigation.answer = explanation
    investigation.evidence = evidence
    investigation.model = model
    investigation.gateway_response_id = response_id
    investigation.usage = usage
    investigation.completed_at = completed_at
    _append_event(
        session,
        investigation,
        None,
        "preflight.decision",
        {
            "decision": decision,
            "policy_version": "default-v1",
            "advisory_ids": [item["id"] for item in evidence],
        },
    )
    if explanation_status == "unavailable":
        _append_event(
            session,
            investigation,
            None,
            "bifrost.explanation_unavailable",
            {"code": investigation.error_code},
        )
    elif model is not None:
        _append_event(
            session,
            investigation,
            None,
            "bifrost.explanation_received",
            {"model": model, "gateway_response_id": response_id, "usage": usage},
        )
    _commit_or_report_storage_error(session, "preflight result")

    return PreflightResponse(
        investigation_id=investigation.id,
        decision=decision,
        policy_version="default-v1",
        package_name=request.package_name,
        version=request.version,
        metadata=request.metadata,
        metadata_classification="untrusted_registry_metadata",
        evidence=[EvidenceResponse(**item) for item in evidence],
        explanation=explanation,
        explanation_status=explanation_status,
        caveat="A clean advisory lookup does not prove a package is safe.",
    )


@router.get(
    "/projects/{project_id}/investigations",
    response_model=list[InvestigationSummaryResponse],
)
def list_project_investigations(
    project_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> list[InvestigationSummaryResponse]:
    project, _ = require_project_membership(session, user.id, project_id)
    rows = session.scalars(
        select(AgentInvestigation)
        .where(AgentInvestigation.project_id == project.id)
        .order_by(AgentInvestigation.created_at.desc(), AgentInvestigation.id)
        .limit(limit)
    ).all()
    return [InvestigationSummaryResponse.model_validate(row) for row in rows]


@router.get("/investigations/{investigation_id}", response_model=InvestigationDetailResponse)
def get_investigation(
    investigation_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> InvestigationDetailResponse:
    investigation = session.scalar(
        select(AgentInvestigation)
        .join(Project, Project.id == AgentInvestigation.project_id)
        .join(Membership, Membership.organization_id == Project.organization_id)
        .where(
            AgentInvestigation.id == str(investigation_id),
            Membership.user_id == user.id,
        )
        .options(selectinload(AgentInvestigation.events))
    )
    if investigation is None:
        raise HTTPException(status_code=404, detail="Investigation not found")
    return InvestigationDetailResponse.model_validate(investigation)
