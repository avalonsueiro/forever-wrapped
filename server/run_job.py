"""
Builds one person's Forever, Wrapped site. The upload server starts this as its own process with:
    WRAPPED_HOME=<their job folder>      everything is read from and written to there
    ANTHROPIC_API_KEY=<their own key>    only in this process's environment; never written anywhere
Progress goes to <job folder>/status.json so the server can show it.

Their folder:
    uploads/spotify/   the Spotify export they uploaded (a .zip or the .json files)
    uploads/photos/    their photos
    data/, web/        made here
"""
import json
import os
import shutil
import sys
import time
import traceback
import zipfile
from pathlib import Path

HOME = Path(os.environ["WRAPPED_HOME"])
PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))
TOP_SONGS = 500        # songs tagged with moods and themes (their key), most played first
STEPS = ["unpacking your spotify export", "reading your listening history", "tagging your top songs with moods",
         "finding your eras", "building your pages", "placing your photos", "finishing"]


def status(step=None, state="running", message=""):
    s = {"state": state, "step": step, "steps": STEPS, "message": message, "updated": time.time()}
    (HOME / "status.json").write_text(json.dumps(s))


def unpack():
    """Spotify's export into data/raw: only the Streaming_History_Audio_*.json files, from a zip or as-is."""
    raw = HOME / "data" / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    found = 0
    for f in (HOME / "uploads" / "spotify").iterdir():
        if f.suffix.lower() == ".zip":
            with zipfile.ZipFile(f) as z:
                for name in z.namelist():
                    base = Path(name).name                    # file name only: nothing can land outside raw/
                    if base.startswith("Streaming_History_Audio_") and base.endswith(".json"):
                        (raw / base).write_bytes(z.read(name)); found += 1
        elif f.name.startswith("Streaming_History_Audio_") and f.suffix == ".json":
            shutil.copy(f, raw / f.name); found += 1
    if not found:
        raise SystemExit("No Streaming_History_Audio_*.json files found. Upload the zip Spotify emailed you "
                         "(Extended streaming history), or the Streaming_History_Audio files inside it.")
    print(f"  {found} history files")


def copy_site():
    """The site itself (pages, scripts, fonts), without this project's own data or photos."""
    web = HOME / "web"
    web.mkdir(parents=True, exist_ok=True)
    src = PROJECT / "web"
    for name in ["index.html", "app.js", "core.js", "shapes.js", "recordRing.js"]:
        shutil.copy(src / name, web / name)
    for d in ["slides", "vendor"]:
        shutil.copytree(src / d, web / d, dirs_exist_ok=True)


def main():
    try:
        status(STEPS[0]); unpack(); copy_site()
        from wrapped import step1_load, step3_tag, step4_eras, step5_build, job_photos
        status(STEPS[1]); step1_load.run()
        mode = "mock" if os.environ.get("WRAPPED_MOCK") else "live"  # mock: fake tags, for testing without a key
        status(STEPS[2]); step3_tag.run(mode, TOP_SONGS)              # no lyrics: tagged from title and artist
        status(STEPS[3]); step4_eras.run(mode)
        status(STEPS[4]); step5_build.run()
        status(STEPS[5]); job_photos.run(HOME / "uploads" / "photos")
        status(STEPS[6]); step5_build.run()                          # again, with the photos in place
        shutil.rmtree(HOME / "uploads", ignore_errors=True)          # originals aren't needed any more
        status(state="done")
    except SystemExit as e:
        status(state="failed", message=str(e))
    except Exception as e:
        traceback.print_exc()
        msg = str(e)
        if "authentication" in msg.lower() or "api key" in msg.lower() or "401" in msg:
            msg = "Your Anthropic API key didn't work. Check it and try again."
        status(state="failed", message=msg[:300])


if __name__ == "__main__":
    main()
