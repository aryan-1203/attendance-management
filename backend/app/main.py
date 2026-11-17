import logging
from contextlib import asynccontextmanager

from decimal import Decimal

from fastapi import FastAPI
from fastapi.encoders import ENCODERS_BY_TYPE
from fastapi.middleware.cors import CORSMiddleware

from app.api import attendance, auth, calendar, employees, imports, leave, reports, system
from app.core.config import settings
from app.core.errors import register_error_handlers
from app.schemas.common import ErrorOut, fmt_decimal

# endpoints that return plain dicts go through jsonable_encoder: keep Decimals as 2dp strings, never floats
ENCODERS_BY_TYPE[Decimal] = fmt_decimal

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    from app.services import scheduler
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(
    title="ProsParity API",
    version="1.0.0",
    description="Attendance, leave & pay-days management. All day counts are decimal strings. Salary amounts are out of scope (handled by Accounts).",
    lifespan=lifespan,
    responses={400: {"model": ErrorOut}, 401: {"model": ErrorOut}, 403: {"model": ErrorOut},
               404: {"model": ErrorOut}, 409: {"model": ErrorOut}, 422: {"model": ErrorOut}, 423: {"model": ErrorOut}},
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list,
                   allow_origin_regex=settings.cors_origin_regex or None, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])
register_error_handlers(app)

API = "/api"
for r in (auth.router, auth.users, employees.router, employees.meta, calendar.holidays, calendar.cycles,
          attendance.router, leave.router, leave.reg, imports.router, reports.router, reports.dashboard,
          system.notifications, system.audit, system.settings_router):
    app.include_router(r, prefix=API)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok", "app": settings.app_name}
