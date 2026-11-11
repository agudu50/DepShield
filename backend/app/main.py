import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.members import router as members_router
from app.api.routes.organizations import router as organizations_router
from app.api.routes.health import router as health_router
from app.api.routes.agent import router as agent_router
from app.api.routes.scans import router as scans_router
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


async def _maintenance_loop() -> None:
    while True:
        try:
            from app.maintenance import run_maintenance

            await asyncio.to_thread(run_maintenance)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Scheduled data-retention and stale-run maintenance failed")
        await asyncio.sleep(60 * 60)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = None
    if (
        settings.database_url.get_secret_value()
        or settings.database_url_unpooled.get_secret_value()
    ):
        task = asyncio.create_task(_maintenance_loop())
    yield
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health_router)
app.include_router(scans_router)
app.include_router(organizations_router)
app.include_router(members_router)
app.include_router(agent_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "DepShield AI API is running"}
