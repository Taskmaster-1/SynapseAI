from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.v1.router import v1_router
from app.core.config import settings
from app.core.exceptions import AppException
from app.db.supabase import get_supabase_client
from app.services.cache.redis_client import close_redis, get_redis
from app.services.scheduler.setup import start_scheduler, stop_scheduler
from app.middleware.logging import LoggingMiddleware
from app.middleware.rate_limit import limiter
from app.utils.logger import logger, setup_logging
from app.core.composio_patch import apply_patch

apply_patch()

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger.info("Starting up", env=settings.ENV, version=settings.APP_VERSION)

    # Warm up Supabase connection
    await get_supabase_client()
    logger.info("Supabase connected")

    # Warm up Redis (optional — graceful if not configured)
    redis = await get_redis()
    if redis:
        logger.info("Redis connected")
    else:
        logger.info("Redis not configured — token denylist disabled")

    # Start background job scheduler
    await start_scheduler()

    yield

    await stop_scheduler()
    await close_redis()
    logger.info("Shutting down")


# ── App Factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        openapi_url="/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # ── Rate limiter ──────────────────────────────────────────────────────
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    # ── CORS ──────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Request logging ───────────────────────────────────────────────────
    app.add_middleware(LoggingMiddleware)

    # ── Exception handlers ────────────────────────────────────────────────
    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "status_code": exc.status_code},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception", exc_info=exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error"},
        )

    # ── Routes ────────────────────────────────────────────────────────────
    app.include_router(v1_router)

    @app.get("/health", tags=["Health"], include_in_schema=False)
    async def health():
        return {"status": "ok", "version": settings.APP_VERSION, "env": settings.ENV}

    return app


app = create_app()
