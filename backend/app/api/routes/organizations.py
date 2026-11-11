from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import AuthenticatedUser, get_current_user
from app.api.dependencies import (
    get_authenticated_db_session,
    require_organization_membership,
)
from app.models import Membership, Organization, Project

router = APIRouter(prefix="/api/v1", tags=["organizations"])


class OrganizationCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Organization name must not be blank")
        return value


class OrganizationResponse(BaseModel):
    id: UUID
    name: str
    role: str


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Project name must not be blank")
        return value


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    name: str


@router.get("/organizations", response_model=list[OrganizationResponse])
def list_organizations(
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> list[OrganizationResponse]:
    rows = session.execute(
        select(Organization, Membership.role)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.created_at, Organization.id)
    ).all()
    return [
        OrganizationResponse(id=organization.id, name=organization.name, role=role)
        for organization, role in rows
    ]


@router.post("/organizations", response_model=OrganizationResponse, status_code=201)
def create_organization(
    request: OrganizationCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> OrganizationResponse:
    organization = Organization(name=request.name, created_by_user_id=user.id)
    session.add(organization)
    session.flush()
    session.add(
        Membership(
            organization_id=organization.id,
            user_id=user.id,
            role="owner",
        )
    )
    session.commit()
    return OrganizationResponse(id=organization.id, name=organization.name, role="owner")


@router.get(
    "/organizations/{organization_id}/projects",
    response_model=list[ProjectResponse],
)
def list_projects(
    organization_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> list[ProjectResponse]:
    require_organization_membership(session, user.id, organization_id)

    projects = session.scalars(
        select(Project)
        .where(Project.organization_id == str(organization_id))
        .order_by(Project.created_at, Project.id)
    ).all()
    return [ProjectResponse.model_validate(project) for project in projects]


@router.post(
    "/organizations/{organization_id}/projects",
    response_model=ProjectResponse,
    status_code=201,
)
def create_project(
    organization_id: UUID,
    request: ProjectCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> ProjectResponse:
    membership = require_organization_membership(session, user.id, organization_id)
    if membership.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Organization admin access is required")

    project = Project(organization_id=str(organization_id), name=request.name)
    session.add(project)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="A project with this name already exists in the organization",
        ) from exc

    return ProjectResponse.model_validate(project)
