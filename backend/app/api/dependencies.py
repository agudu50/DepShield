from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import AuthenticatedUser, get_current_user
from app.database import get_db_session, set_rls_context, set_rls_organization
from app.models import Membership, Project


def get_authenticated_db_session(
    user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_db_session),
) -> Session:
    set_rls_context(session, user.id, user.email)
    return session


def require_project_membership(
    session: Session,
    user_id: str,
    project_id: UUID | str,
) -> tuple[Project, Membership]:
    result = session.execute(
        select(Project, Membership)
        .join(Membership, Membership.organization_id == Project.organization_id)
        .where(
            Project.id == str(project_id),
            Membership.user_id == user_id,
        )
    ).first()
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    set_rls_organization(session, result[0].organization_id, result[1].role)
    return result


def require_organization_membership(
    session: Session,
    user_id: str,
    organization_id: UUID | str,
) -> Membership:
    membership = session.get(Membership, (str(organization_id), user_id))
    if membership is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    set_rls_organization(session, str(organization_id), membership.role)
    return membership
