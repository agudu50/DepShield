import hashlib
import json
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_db_session, require_project_membership
from app.auth import AuthenticatedUser, get_current_user
from app.models import Project, ProjectInventory, ProjectScan
from app.domain.scanning.service import (
    AdvisoryServiceError,
    DependencyRecord,
    MAX_DEPENDENCIES,
    ManifestError,
    VulnerabilityRecord,
    lookup_advisories,
    parse_manifest,
)

router = APIRouter(tags=["scans"])


class ScanRequest(BaseModel):
    project_name: str = Field(min_length=1, max_length=100)
    ecosystem: Literal["npm", "python"]
    manifest_type: Literal["manifest", "lockfile"] = "manifest"
    manifest: str

    @field_validator("project_name")
    @classmethod
    def project_name_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Project name must not be blank")
        return value.strip()


class VulnerabilityResponse(BaseModel):
    id: str
    aliases: list[str]
    summary: str


class DependencyResponse(BaseModel):
    name: str
    version: str
    ecosystem: str
    status: Literal["checked", "version_range"]
    vulnerabilities: list[VulnerabilityResponse]


class ScanResponse(BaseModel):
    project_name: str
    ecosystem: str
    manifest_type: Literal["manifest", "lockfile"]
    dependency_count: int
    checked_count: int
    unpinned_count: int
    vulnerability_count: int
    dependencies: list[DependencyResponse]


class SavedScanRequest(BaseModel):
    ecosystem: Literal["npm", "python"]
    manifest_type: Literal["manifest", "lockfile"] = "manifest"
    manifest: str


class ScanHistorySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    ecosystem: str
    created_at: datetime
    dependency_count: int
    checked_count: int
    unpinned_count: int
    vulnerability_count: int


class SavedScanResponse(ScanResponse):
    id: UUID
    project_id: UUID
    actor_user_id: str
    created_at: datetime


class InventoryPackage(BaseModel):
    name: str = Field(min_length=1, max_length=214)
    version: str = Field(min_length=1, max_length=100)


class InventorySyncRequest(BaseModel):
    manager: Literal["npm", "uv"]
    packages: list[InventoryPackage] = Field(max_length=MAX_DEPENDENCIES)


class InventorySyncResponse(BaseModel):
    revision: int
    dependency_count: int
    changed_count: int
    removed_count: int
    scan: ScanResponse | None


class ProjectInventoryResponse(BaseModel):
    project_id: UUID
    manager: str
    revision: int
    updated_at: datetime
    packages: list[InventoryPackage]


@router.post("/api/scans", response_model=ScanResponse, include_in_schema=False)
@router.post("/api/v1/scans", response_model=ScanResponse)
async def scan_manifest(request: ScanRequest) -> ScanResponse:
    return await _scan(
        request.project_name,
        request.ecosystem,
        request.manifest_type,
        request.manifest,
    )


@router.post(
    "/api/v1/projects/{project_id}/scans",
    response_model=SavedScanResponse,
    status_code=201,
)
async def scan_project_manifest(
    project_id: UUID,
    request: SavedScanRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> SavedScanResponse:
    project, _ = require_project_membership(session, user.id, project_id)
    result = await _scan(
        project.name,
        request.ecosystem,
        request.manifest_type,
        request.manifest,
    )
    record = ProjectScan(
        organization_id=project.organization_id,
        project_id=project.id,
        actor_user_id=user.id,
        ecosystem=request.ecosystem,
        result=result.model_dump(mode="json"),
    )
    session.add(record)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=503, detail="Scan history could not be saved") from exc
    return SavedScanResponse(
        id=record.id,
        project_id=project.id,
        actor_user_id=user.id,
        created_at=record.created_at,
        **result.model_dump(),
    )


@router.put(
    "/api/v1/projects/{project_id}/inventory",
    response_model=InventorySyncResponse,
)
async def sync_project_inventory(
    project_id: UUID,
    request: InventorySyncRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> InventorySyncResponse:
    project, _ = require_project_membership(session, user.id, project_id)
    session.scalar(
        select(Project)
        .where(Project.id == project.id)
        .with_for_update()
    )
    current_packages = sorted(
        {(item.name, item.version) for item in request.packages},
        key=lambda item: (item[0].lower(), item[1]),
    )
    if len(current_packages) != len(request.packages):
        raise HTTPException(status_code=422, detail="Inventory contains duplicate packages")

    encoded_inventory = json.dumps(
        [{"name": name, "version": version} for name, version in current_packages],
        separators=(",", ":"),
        ensure_ascii=True,
    )
    inventory_digest = hashlib.sha256(encoded_inventory.encode("utf-8")).hexdigest()

    try:
        inventory = session.scalar(
            select(ProjectInventory)
            .where(ProjectInventory.project_id == project.id)
            .with_for_update()
        )
        previous_packages = (
            {(item["name"], item["version"]) for item in inventory.packages}
            if inventory is not None
            else set()
        )
        current_set = set(current_packages)
        changed_packages = current_set - previous_packages
        removed_count = len(previous_packages - current_set)
        manager_changed = inventory is not None and inventory.manager != request.manager
        if manager_changed:
            changed_packages = current_set
        should_assess = inventory is None or bool(changed_packages) or manager_changed

        if (
            inventory is not None
            and not changed_packages
            and not removed_count
            and not manager_changed
            and inventory.digest == inventory_digest
        ):
            return InventorySyncResponse(
                revision=inventory.revision,
                dependency_count=len(current_packages),
                changed_count=0,
                removed_count=0,
                scan=None,
            )

        result = None
        if should_assess:
            ecosystem: Literal["npm", "python"] = (
                "npm" if request.manager == "npm" else "python"
            )
            if ecosystem == "npm":
                lock_packages = {}
                for index, (name, version) in enumerate(
                    sorted(changed_packages, key=lambda item: (item[0].lower(), item[1]))
                ):
                    package_path = f"node_modules/.depshield/{index}/node_modules/{name}"
                    lock_packages[package_path] = {"version": version}
                manifest = json.dumps({"lockfileVersion": 3, "packages": lock_packages})
                manifest_type: Literal["manifest", "lockfile"] = "lockfile"
            else:
                manifest = "\n".join(
                    f"{name}=={version}"
                    for name, version in sorted(changed_packages, key=lambda item: (item[0].lower(), item[1]))
                )
                manifest_type = "manifest"
            result = await _scan(project.name, ecosystem, manifest_type, manifest)
            session.add(
                ProjectScan(
                    organization_id=project.organization_id,
                    project_id=project.id,
                    actor_user_id=user.id,
                    ecosystem=ecosystem,
                    result=result.model_dump(mode="json"),
                )
            )

        if inventory is None:
            inventory = ProjectInventory(
                project_id=project.id,
                organization_id=project.organization_id,
                manager=request.manager,
                revision=1,
                digest=inventory_digest,
                packages=[{"name": name, "version": version} for name, version in current_packages],
            )
            session.add(inventory)
        else:
            inventory.manager = request.manager
            inventory.revision += 1
            inventory.digest = inventory_digest
            inventory.packages = [
                {"name": name, "version": version} for name, version in current_packages
            ]

        session.commit()
    except (ManifestError, SQLAlchemyError) as exc:
        session.rollback()
        if isinstance(exc, ManifestError):
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        raise HTTPException(status_code=503, detail="Project inventory could not be synchronized") from exc

    return InventorySyncResponse(
        revision=inventory.revision,
        dependency_count=len(current_packages),
        changed_count=len(changed_packages),
        removed_count=removed_count,
        scan=result,
    )


@router.get(
    "/api/v1/projects/{project_id}/inventory",
    response_model=ProjectInventoryResponse | None,
)
def get_project_inventory(
    project_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> ProjectInventoryResponse | None:
    project, _ = require_project_membership(session, user.id, project_id)
    inventory = session.get(ProjectInventory, project.id)
    if inventory is None:
        return None
    return ProjectInventoryResponse(
        project_id=inventory.project_id,
        manager=inventory.manager,
        revision=inventory.revision,
        updated_at=inventory.updated_at,
        packages=[InventoryPackage(**item) for item in inventory.packages],
    )


@router.get(
    "/api/v1/projects/{project_id}/scans",
    response_model=list[ScanHistorySummary],
)
def list_project_scans(
    project_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> list[ScanHistorySummary]:
    project, _ = require_project_membership(session, user.id, project_id)
    records = session.scalars(
        select(ProjectScan)
        .where(ProjectScan.project_id == project.id)
        .order_by(ProjectScan.created_at.desc(), ProjectScan.id)
        .limit(limit)
    ).all()
    return [
        ScanHistorySummary(
            id=record.id,
            project_id=record.project_id,
            ecosystem=record.ecosystem,
            created_at=record.created_at,
            dependency_count=int(record.result["dependency_count"]),
            checked_count=int(record.result["checked_count"]),
            unpinned_count=int(record.result["unpinned_count"]),
            vulnerability_count=int(record.result["vulnerability_count"]),
        )
        for record in records
    ]


@router.get("/api/v1/scans/{scan_id}", response_model=SavedScanResponse)
def get_project_scan(
    scan_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> SavedScanResponse:
    record = session.scalar(select(ProjectScan).where(ProjectScan.id == str(scan_id)))
    if record is None:
        raise HTTPException(status_code=404, detail="Scan not found")
    require_project_membership(session, user.id, record.project_id)
    return SavedScanResponse(
        id=record.id,
        project_id=record.project_id,
        actor_user_id=record.actor_user_id,
        created_at=record.created_at,
        **record.result,
    )


async def _scan(
    project_name: str,
    ecosystem: Literal["npm", "python"],
    manifest_type: Literal["manifest", "lockfile"],
    manifest: str,
) -> ScanResponse:
    try:
        dependencies = parse_manifest(manifest, ecosystem, manifest_type)
    except ManifestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        advisories = await lookup_advisories(dependencies)
    except AdvisoryServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    response_dependencies = [
        _dependency_response(dependency, vulnerabilities)
        for dependency, vulnerabilities in zip(dependencies, advisories, strict=True)
    ]
    checked_count = sum(dependency.exact_version for dependency in dependencies)
    vulnerability_count = sum(len(vulnerabilities) for vulnerabilities in advisories)

    return ScanResponse(
        project_name=project_name,
        ecosystem=ecosystem,
        manifest_type=manifest_type,
        dependency_count=len(dependencies),
        checked_count=checked_count,
        unpinned_count=len(dependencies) - checked_count,
        vulnerability_count=vulnerability_count,
        dependencies=response_dependencies,
    )


def _dependency_response(
    dependency: DependencyRecord,
    vulnerabilities: list[VulnerabilityRecord],
) -> DependencyResponse:
    return DependencyResponse(
        name=dependency.name,
        version=dependency.version,
        ecosystem=dependency.ecosystem,
        status="checked" if dependency.exact_version else "version_range",
        vulnerabilities=[
            VulnerabilityResponse(
                id=vulnerability.id,
                aliases=vulnerability.aliases,
                summary=vulnerability.summary,
            )
            for vulnerability in vulnerabilities
        ],
    )
