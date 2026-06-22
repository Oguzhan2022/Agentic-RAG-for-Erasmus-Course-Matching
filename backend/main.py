from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from backend.logging_utils import setup_logging

setup_logging()

from backend.routers import universities, courses, ingestion, matching, auth, workflow, student, coordinator, ects_scraper, university_info, grading_schemes, transcripts, senate_decisions, transfer_documents
from authorization.router import router as auth_admin_router

app = FastAPI(
    title="Erasmus Course Matching System",
    description="API for managing university courses, parsing PDFs, and course matching",
    version="1.0.0",
)

# CORS — allow dev servers + production frontend URL from env
_frontend_url = os.getenv("FRONTEND_URL", "")
_allowed_origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
]
if _frontend_url:
    _allowed_origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Register routers
app.include_router(universities.router)
app.include_router(courses.router)
app.include_router(ingestion.router)
app.include_router(matching.router)
app.include_router(auth.router)
app.include_router(auth_admin_router)
app.include_router(workflow.router)
app.include_router(student.router)
app.include_router(coordinator.router)
app.include_router(ects_scraper.router)
app.include_router(university_info.router)
app.include_router(grading_schemes.router)
app.include_router(transcripts.router)
app.include_router(senate_decisions.router)
app.include_router(transfer_documents.router)

# Serve uploaded PDFs as static files
uploads_dir = os.path.join(os.getcwd(), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "erasmus-match-api"}




from fastapi.responses import FileResponse

# Serve frontend only in production (Render sets this env var)
# Locally, Vite dev server handles the frontend
if os.getenv("RENDER"):
    _frontend_dist = os.path.join(os.getcwd(), "frontend", "dist")
    if os.path.exists(_frontend_dist):
        # Serve assets (js, css, images) directly
        app.mount("/assets", StaticFiles(directory=os.path.join(_frontend_dist, "assets")), name="assets")

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            # 1. If requesting a real file in dist (e.g. favicon.ico), serve it
            file_path = os.path.join(_frontend_dist, full_path)
            if os.path.isfile(file_path):
                return FileResponse(file_path)
            
            # 2. Otherwise, always return index.html to let React Router handle the path
            return FileResponse(os.path.join(_frontend_dist, "index.html"))
