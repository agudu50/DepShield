from functools import lru_cache
import logging
from typing import Generator

from fastapi import Depends, HTTPException
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def _apply_transaction_context(session: Session, connection: Connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    connection.execute(
        text(
            "SELECT "
            "set_config('app.user_id', :user_id, true), "
            "set_config('app.user_email', :user_email, true), "
            "set_config('app.organization_id', :organization_id, true), "
            "set_config('app.organization_role', :organization_role, true), "
            "set_config('app.invitation_id', :invitation_id, true), "
            "set_config('app.maintenance', :maintenance, true)"
        ),
        {
            "user_id": session.info.get("rls_user_id", ""),
            "user_email": session.info.get("rls_user_email", ""),
            "organization_id": session.info.get("rls_organization_id", ""),
            "organization_role": session.info.get("rls_organization_role", ""),
            "invitation_id": session.info.get("rls_invitation_id", ""),
            "maintenance": "true" if session.info.get("rls_maintenance") else "false",
        },
    )


@event.listens_for(Session, "after_begin")
def _restore_transaction_context(
    session: Session,
    transaction,
    connection: Connection,
) -> None:
    _apply_transaction_context(session, connection)


def set_rls_context(
    session: Session,
    user_id: str,
    user_email: str | None = None,
    invitation_id: str | None = None,
) -> None:
    session.info["rls_user_id"] = user_id
    session.info["rls_user_email"] = (user_email or "").strip().lower()
    session.info["rls_organization_id"] = ""
    session.info["rls_organization_role"] = ""
    session.info["rls_invitation_id"] = invitation_id or ""
    _apply_transaction_context(session, session.connection())


def set_rls_organization(
    session: Session,
    organization_id: str | None,
    role: str | None = None,
) -> None:
    session.info["rls_organization_id"] = organization_id or ""
    session.info["rls_organization_role"] = role or ""
    if session.in_transaction():
        _apply_transaction_context(session, session.connection())


def set_rls_invitation(session: Session, invitation_id: str | None) -> None:
    session.info["rls_invitation_id"] = invitation_id or ""
    if session.in_transaction():
        _apply_transaction_context(session, session.connection())


def set_rls_maintenance(session: Session) -> None:
    session.info["rls_maintenance"] = True
    if session.in_transaction():
        _apply_transaction_context(session, session.connection())


def _sqlalchemy_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


@lru_cache(maxsize=4)
def get_engine(database_url: str) -> Engine:
    normalized_url = _sqlalchemy_url(database_url)
    connect_args = {"check_same_thread": False} if normalized_url.startswith("sqlite:") else {}
    return create_engine(
        normalized_url,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


@lru_cache(maxsize=4)
def _get_session_factory(database_url: str) -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(database_url), expire_on_commit=False)


def get_db_session(
    settings: Settings = Depends(get_settings),
) -> Generator[Session, None, None]:
    database_url = settings.database_url.get_secret_value()
    if not database_url:
        raise HTTPException(
            status_code=503,
            detail="Database access is not configured",
        )

    session = _get_session_factory(database_url)()
    try:
        session.connection()
    except SQLAlchemyError as exc:
        session.close()
        logger.exception("Could not connect to the configured database")
        raise HTTPException(status_code=503, detail="Database access is temporarily unavailable") from exc

    try:
        yield session
    finally:
        session.close()
