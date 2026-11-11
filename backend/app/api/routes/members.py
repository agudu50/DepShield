import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.dependencies import (
    get_authenticated_db_session,
    require_organization_membership,
)
from app.auth import AuthenticatedUser, get_current_user
from app.database import set_rls_invitation, set_rls_organization
from app.models import Membership, OrganizationInvitation

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["organization members"])

_INVITATION_TTL = timedelta(days=7)
_EMAIL_ADDRESS = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(?:\.[^@\s.]+)+$")


class MemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    organization_id: UUID
    role: str
    created_at: datetime


class InvitationSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: str
    inviter_user_id: str
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None


class InvitationCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: Literal["admin", "member"] = "member"

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _EMAIL_ADDRESS.fullmatch(normalized):
            raise ValueError("A valid email address is required")
        return normalized


class InvitationCreatedResponse(BaseModel):
    invitation: InvitationSummaryResponse
    token: str


class InvitationAcceptRequest(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class MemberRoleRequest(BaseModel):
    role: Literal["owner", "admin", "member"]


def _require_admin(
    session: Session,
    user_id: str,
    organization_id: UUID,
) -> Membership:
    membership = require_organization_membership(session, user_id, organization_id)
    if membership.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Organization admin access is required")
    return membership


def _commit_or_report_storage_error(session: Session, action: str) -> None:
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        logger.exception("Could not persist %s", action)
        raise HTTPException(status_code=503, detail="Organization data could not be saved") from exc


@router.get(
    "/organizations/{organization_id}/members",
    response_model=list[MemberResponse],
)
def list_members(
    organization_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> list[MemberResponse]:
    require_organization_membership(session, user.id, organization_id)
    rows = session.scalars(
        select(Membership)
        .where(Membership.organization_id == str(organization_id))
        .order_by(Membership.created_at, Membership.user_id)
    ).all()
    return [MemberResponse.model_validate(row) for row in rows]


@router.patch(
    "/organizations/{organization_id}/members/{member_user_id}",
    response_model=MemberResponse,
)
def update_member_role(
    organization_id: UUID,
    member_user_id: str,
    request: MemberRoleRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> MemberResponse:
    requester = _require_admin(session, user.id, organization_id)
    member = session.get(Membership, (str(organization_id), member_user_id))
    if member is None:
        raise HTTPException(status_code=404, detail="Organization member not found")
    if member.role == "owner" and requester.role != "owner":
        raise HTTPException(status_code=403, detail="Only an owner can change another owner's role")
    if request.role == "owner" and requester.role != "owner":
        raise HTTPException(status_code=403, detail="Only an owner can grant owner access")
    if member.role == "owner" and request.role != "owner":
        owner_count = session.scalar(
            select(func.count())
            .select_from(Membership)
            .where(
                Membership.organization_id == str(organization_id),
                Membership.role == "owner",
            )
        )
        if owner_count == 1:
            raise HTTPException(status_code=409, detail="An organization must keep at least one owner")

    member.role = request.role
    _commit_or_report_storage_error(session, "member role")
    return MemberResponse.model_validate(member)


@router.delete(
    "/organizations/{organization_id}/members/{member_user_id}",
    status_code=204,
)
def remove_member(
    organization_id: UUID,
    member_user_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> Response:
    requester = _require_admin(session, user.id, organization_id)
    member = session.get(Membership, (str(organization_id), member_user_id))
    if member is None:
        raise HTTPException(status_code=404, detail="Organization member not found")
    if member.role == "owner" and requester.role != "owner":
        raise HTTPException(status_code=403, detail="Only an owner can remove another owner")
    if member.role == "owner":
        owner_count = session.scalar(
            select(func.count())
            .select_from(Membership)
            .where(
                Membership.organization_id == str(organization_id),
                Membership.role == "owner",
            )
        )
        if owner_count == 1:
            raise HTTPException(status_code=409, detail="Transfer ownership before removing the last owner")

    session.delete(member)
    _commit_or_report_storage_error(session, "organization member")
    return Response(status_code=204)


@router.get(
    "/organizations/{organization_id}/invitations",
    response_model=list[InvitationSummaryResponse],
)
def list_invitations(
    organization_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> list[InvitationSummaryResponse]:
    require_organization_membership(session, user.id, organization_id)
    rows = session.scalars(
        select(OrganizationInvitation)
        .where(
            OrganizationInvitation.organization_id == str(organization_id),
            OrganizationInvitation.accepted_at.is_(None),
            OrganizationInvitation.revoked_at.is_(None),
            OrganizationInvitation.expires_at > datetime.now(timezone.utc),
        )
        .order_by(OrganizationInvitation.created_at.desc())
    ).all()
    return [InvitationSummaryResponse.model_validate(row) for row in rows]


@router.post(
    "/organizations/{organization_id}/invitations",
    response_model=InvitationCreatedResponse,
    status_code=201,
)
def create_invitation(
    organization_id: UUID,
    request: InvitationCreateRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> InvitationCreatedResponse:
    _require_admin(session, user.id, organization_id)
    email = str(request.email).strip().lower()
    existing = session.scalar(
        select(OrganizationInvitation.id).where(
            OrganizationInvitation.organization_id == str(organization_id),
            func.lower(OrganizationInvitation.email) == email,
            OrganizationInvitation.accepted_at.is_(None),
            OrganizationInvitation.revoked_at.is_(None),
            OrganizationInvitation.expires_at > datetime.now(timezone.utc),
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="An active invitation already exists for this email")

    token = secrets.token_urlsafe(32)
    invitation = OrganizationInvitation(
        organization_id=str(organization_id),
        email=email,
        role=request.role,
        token_digest=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        inviter_user_id=user.id,
        expires_at=datetime.now(timezone.utc) + _INVITATION_TTL,
    )
    session.add(invitation)
    _commit_or_report_storage_error(session, "organization invitation")
    return InvitationCreatedResponse(
        invitation=InvitationSummaryResponse.model_validate(invitation),
        token=token,
    )


@router.delete(
    "/organizations/{organization_id}/invitations/{invitation_id}",
    status_code=204,
)
def revoke_invitation(
    organization_id: UUID,
    invitation_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> Response:
    _require_admin(session, user.id, organization_id)
    invitation = session.scalar(
        select(OrganizationInvitation).where(
            OrganizationInvitation.id == str(invitation_id),
            OrganizationInvitation.organization_id == str(organization_id),
            OrganizationInvitation.accepted_at.is_(None),
            OrganizationInvitation.revoked_at.is_(None),
        )
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    invitation.revoked_at = datetime.now(timezone.utc)
    _commit_or_report_storage_error(session, "invitation revocation")
    return Response(status_code=204)


@router.post("/invitations/accept", response_model=MemberResponse)
def accept_invitation(
    request: InvitationAcceptRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_authenticated_db_session),
) -> MemberResponse:
    if not user.email:
        raise HTTPException(status_code=403, detail="An account email is required to accept invitations")

    token_digest = hashlib.sha256(request.token.encode("utf-8")).hexdigest()
    invitation = session.scalar(
        select(OrganizationInvitation).where(
            func.lower(OrganizationInvitation.email) == user.email.strip().lower(),
            OrganizationInvitation.token_digest == token_digest,
            OrganizationInvitation.accepted_at.is_(None),
            OrganizationInvitation.revoked_at.is_(None),
            OrganizationInvitation.expires_at > datetime.now(timezone.utc),
        )
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="A valid invitation for this account was not found")

    set_rls_organization(session, invitation.organization_id)
    set_rls_invitation(session, invitation.id)
    if session.get(Membership, (invitation.organization_id, user.id)) is not None:
        raise HTTPException(status_code=409, detail="This account is already an organization member")
    membership = Membership(
        organization_id=invitation.organization_id,
        user_id=user.id,
        role=invitation.role,
    )
    session.add(membership)
    session.flush()
    invitation.accepted_at = datetime.now(timezone.utc)
    _commit_or_report_storage_error(session, "invitation acceptance")
    return MemberResponse.model_validate(membership)
