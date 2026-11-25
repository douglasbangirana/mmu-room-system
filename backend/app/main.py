import asyncio
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config
from .jobs import scheduler
from .schema_upgrade import ensure_schema
from .version import VERSION
from .routers import auth, me, people, reports, rooms, terminal, terminals_admin, timetable
from .util import ApiResponse, now_local


@asynccontextmanager
async def lifespan(_app):
    await asyncio.to_thread(ensure_schema)
    task = asyncio.create_task(scheduler())
    yield
    task.cancel()


app = FastAPI(title="MMU Room Verification API", version=VERSION, lifespan=lifespan, default_response_class=ApiResponse)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/api/health")
def health():
    return {"ok": True, "time": now_local()}


# Terminal routes (device-key auth) and dashboard routes (JWT) share the /api prefix.
for r in (terminal.router, auth.router, me.router, rooms.router, terminals_admin.router, timetable.router, people.cards, people.users,
          reports.logs, reports.settings):
    app.include_router(r)


# The dashboard and firmware read {"error": "..."}, so every failure uses that shape.
@app.exception_handler(StarletteHTTPException)
async def http_error(_req, exc):
    return ApiResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_req, exc):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    return ApiResponse({"error": f"Invalid request{': ' + where if where else ''}"}, status_code=400)


@app.exception_handler(Exception)
async def server_error(_req, exc):
    print("[error]", repr(exc))
    return ApiResponse({"error": "Server error"}, status_code=500)


# After `npm run build` in ../dashboard, this server also serves the website on the same port.
_DIST = Path(__file__).resolve().parent.parent.parent / "dashboard" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="dashboard")
