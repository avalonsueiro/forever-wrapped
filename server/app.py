"""
The upload server: lets someone else make their own Forever, Wrapped from their Spotify export,
their photos and their own Anthropic API key.

    source .venv/bin/activate
    python server/app.py            then open http://127.0.0.1:8800

It only listens on this Mac (127.0.0.1) for now. Each upload gets a random id and its own folder in
server/jobs/<id>/; the build runs as a separate process (server/run_job.py) that sees only that folder
and that person's key. The key is passed straight to that process and never saved. Everything in a
job folder is deleted after KEEP_DAYS.
"""
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
JOBS = HERE / "jobs"
JOBS.mkdir(exist_ok=True)
KEEP_DAYS = 7
MAX_RUNNING = 2                          # builds at the same time; the rest wait their turn
MAX_SPOTIFY_MB, MAX_PHOTOS_MB, MAX_PHOTOS = 300, 1500, 400
ID = re.compile(r"^[A-Za-z0-9_-]{20,40}$")
TEST_KEY = "sk-ant-test-0000000000000000000000"           # with WRAPPED_TEST=1 set, builds with fake tags

app = FastAPI(docs_url=None, redoc_url=None)
slots = threading.Semaphore(MAX_RUNNING)


def job_dir(job_id: str) -> Path:
    if not ID.match(job_id) or not (JOBS / job_id).is_dir():
        raise HTTPException(404, "not found")
    return JOBS / job_id


async def save(upload: UploadFile, dest: Path, budget: list) -> None:
    """Write one uploaded file, counting its size against budget[0] (bytes left)."""
    name = Path(upload.filename or "file").name                 # never trust the folder part of a name
    with open(dest / name, "wb") as f:
        while chunk := await upload.read(1 << 20):
            budget[0] -= len(chunk)
            if budget[0] < 0:
                raise HTTPException(413, "upload too large")
            f.write(chunk)


def run(home: Path, key: str) -> None:
    """Wait for a free slot, then build in a separate process that gets only this person's key."""
    with slots:
        env = {k: v for k, v in os.environ.items() if not k.startswith("ANTHROPIC")}   # never the owner's key
        env.update(WRAPPED_HOME=str(home), ANTHROPIC_API_KEY=key)
        if os.environ.get("WRAPPED_TEST") and key == TEST_KEY:
            env["WRAPPED_MOCK"] = "1"                        # local testing only: fake tags, no API calls
        with open(home / "log.txt", "w") as log:
            subprocess.run([sys.executable, str(HERE / "run_job.py")], env=env, stdout=log, stderr=subprocess.STDOUT)


@app.post("/api/jobs")
async def create(api_key: str = Form(...), spotify: list[UploadFile] = File(...), photos: list[UploadFile] = File(default=[])):
    key = api_key.strip()
    if not re.match(r"^sk-ant-[A-Za-z0-9_-]{20,}$", key):
        raise HTTPException(400, "That doesn't look like an Anthropic API key (it starts with sk-ant-).")
    if len(photos) > MAX_PHOTOS:
        raise HTTPException(400, f"Up to {MAX_PHOTOS} photos, please.")
    job_id = secrets.token_urlsafe(18)
    home = JOBS / job_id
    try:
        (home / "uploads" / "spotify").mkdir(parents=True)
        (home / "uploads" / "photos").mkdir(parents=True)
        budget = [MAX_SPOTIFY_MB << 20]
        for f in spotify:
            await save(f, home / "uploads" / "spotify", budget)
        budget = [MAX_PHOTOS_MB << 20]
        for f in photos:
            await save(f, home / "uploads" / "photos", budget)
    except Exception:
        shutil.rmtree(home, ignore_errors=True)
        raise
    (home / "status.json").write_text(json.dumps({"state": "waiting", "step": None, "message": "", "updated": time.time()}))
    threading.Thread(target=run, args=(home, key), daemon=True).start()
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    return JSONResponse(json.loads((job_dir(job_id) / "status.json").read_text()))


@app.get("/api/jobs/{job_id}/download")
def download(job_id: str):
    web = job_dir(job_id) / "web"
    if not (web / "data.js").exists():
        raise HTTPException(404, "not ready")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in web.rglob("*"):
            if p.is_file():
                z.write(p, Path("forever-wrapped") / p.relative_to(web))
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": 'attachment; filename="forever-wrapped.zip"'})


@app.get("/sites/{job_id}/{path:path}")
def site(job_id: str, path: str):
    web = (job_dir(job_id) / "web").resolve()
    f = (web / (path or "index.html")).resolve()
    if web not in f.parents or not f.is_file():                # nothing outside their own site
        raise HTTPException(404, "not found")
    return FileResponse(f)


@app.get("/jobs/{job_id}")
def job_page(job_id: str):
    job_dir(job_id)
    return FileResponse(HERE / "static" / "upload.html")


@app.get("/assets/{path:path}")
def assets(path: str):
    base = (PROJECT / "web" / "vendor").resolve()
    f = (base / path).resolve()
    if base not in f.parents or not f.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(f)


@app.get("/", response_class=HTMLResponse)
def home():
    return FileResponse(HERE / "static" / "upload.html")


def cleanup():
    """Every hour, delete job folders older than KEEP_DAYS."""
    while True:
        cutoff = time.time() - KEEP_DAYS * 86400
        for d in JOBS.iterdir():
            if d.is_dir() and d.stat().st_mtime < cutoff:
                shutil.rmtree(d, ignore_errors=True)
        time.sleep(3600)


if __name__ == "__main__":
    import uvicorn
    threading.Thread(target=cleanup, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8800)
