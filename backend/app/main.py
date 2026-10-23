"""FaceSys Enterprise — FastAPI application entry point."""
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.core.config import settings
from app.core.database import close_db
from app.core.security import SecurityHeaders
from app.integrations.hikvision.poller import registry

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("facesys")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("FaceSys Enterprise starting (env=%s)", settings.ENVIRONMENT)
    # Start device pollers (they no-op when the DB has no devices)
    try:
        await registry.start_all()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Device pollers not started: %s", exc)
    yield
    logger.info("FaceSys Enterprise shutting down")
    await registry.stop_all()
    await close_db()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Klinika uchun HR va Face ID davomat tizimi. "
        "Barcha ko'rsatkichlar real bazadan hisoblanadi."
    ),
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url="/api/redoc" if settings.DEBUG else None,
    openapi_url="/api/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
    allow_methods=settings.CORS_ALLOW_METHODS,
    allow_headers=settings.CORS_ALLOW_HEADERS,
)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    for header, value in SecurityHeaders.get_headers().items():
        response.headers.setdefault(header, value)
    response.headers["X-Response-Time-Ms"] = f"{(time.perf_counter() - start) * 1000:.1f}"
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = []
    for e in exc.errors():
        loc = ".".join(str(x) for x in e.get("loc", []) if x != "body")
        errors.append(f"{loc}: {e.get('msg')}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Ma'lumotlar validatsiyadan o'tmadi", "errors": errors},
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Server xatosi. Administratorga murojaat qiling."},
    )


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.APP_VERSION}


app.include_router(api_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        # Exactly one worker: the device poller starts in the app lifespan.
        # Running multiple workers would start duplicate pollers.
        workers=1,
    )