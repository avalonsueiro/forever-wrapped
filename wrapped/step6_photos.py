"""
STEP 6 (Mac only): pick photos for every era from your Photos library, and work out where you were.

Run with:   python run.py photos            pick by the rules below
            python run.py photos --ai       let Claude look at the best candidates and choose
Then:       python run.py build             to put them on the era pages

Nothing leaves your computer unless you add --ai (then small thumbnails of candidate photos are sent
to Claude to choose from).

HOW PHOTOS ARE FOUND: osxphotos (https://github.com/RhetTbull/osxphotos) reads the Photos app's
library directly. For each era we take every photo taken between its start and end date, skipping
screenshots, screen recordings, hidden photos, videos and extra shots from bursts.

HOW THEY'RE PICKED (PHOTOS_PER_ERA per era, default 6):
  * each photo gets a score: Apple's own "best photo" score, +2 if it's a favorite, +1 if it has
    people in it, +0.5 for selfies
  * the era is split into equal time slices and the best photo of each slice is taken, so the picks
    spread across the whole era instead of all coming from one weekend
  * photos taken within 3 minutes of one already picked are skipped (no near-duplicates)
  * with --ai, the top candidates go to Claude with the era's name and drivers, and it picks the set
    that best captures the era
Photos you've already put in an era's folder count toward the total and are never removed.

WHERE YOU WERE (the GPS part): every photo with a location has Apple's own place name attached
(computed by Photos on your Mac). For each era we count how many DIFFERENT DAYS you took photos in
each city (days, not photos, so one big night out doesn't outweigh weeks at home):
  * the city with the most days is suggested as where you lived; it fills `lived_in` in
    era_notes.csv only if you haven't written something there yourself
  * all cities go in the `photos_say_you_were_in` column, e.g. "Austin (19 days), Lisbon (3 days)"
  * if an era has fewer than 5 days of located photos, the 4 weeks before and after are included
"""
import csv
import json
import shutil
import subprocess
import tempfile
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from . import config

# Older copies of config.py don't have these two settings yet; fall back to the defaults.
if not hasattr(config, "PHOTOS_DIR"):
    config.PHOTOS_DIR = config.WEB_DIR / "photos"
if not hasattr(config, "ERA_NOTES"):
    config.ERA_NOTES = config.ROOT / "era_notes.csv"

PHOTOS_PER_ERA = 6
NEAR_DUPLICATE_MINUTES = 3
AI_CANDIDATES = 16
IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


# ------------------------------------------------------------------ reading the library
def open_library():
    try:
        import osxphotos
    except ImportError:
        raise SystemExit("osxphotos isn't installed. Run:  pip install osxphotos")
    print("  opening your Photos library (the first time can take a minute)...")
    try:
        return osxphotos.PhotosDB()
    except Exception as e:
        raise SystemExit(f"Couldn't open the Photos library ({e}).\n"
                         "Give Terminal access: System Settings > Privacy & Security > Full Disk Access >"
                         " turn on Terminal, then quit and reopen Terminal and try again.")


def usable(p) -> bool:
    """Real photos only: no videos, screenshots, screen recordings, hidden or trashed items, and
    only the chosen frame of a burst."""
    if getattr(p, "ismovie", False) or getattr(p, "hidden", False) or getattr(p, "intrash", False):
        return False
    if getattr(p, "screenshot", False) or getattr(p, "screen_recording", False):
        return False
    if getattr(p, "burst", False) and not getattr(p, "burst_key", True):
        return False
    if getattr(p, "syndicated", False) and not getattr(p, "saved_to_library", False):
        return False                               # "Shared with You" from Messages that you never saved
    return p.date is not None


def photo_score(p) -> float:
    s = 0.0
    sc = getattr(p, "score", None)
    if sc is not None and getattr(sc, "overall", None) is not None:
        s += float(sc.overall)                     # Apple's aesthetic score, roughly -1 to 1
    if getattr(p, "favorite", False):
        s += 2
    if getattr(p, "persons", None):
        s += 1
    if getattr(p, "selfie", False):
        s += 0.5
    return s


def city_of(p):
    """Apple's reverse-geocoded place for a photo: (city, country) or None."""
    place = getattr(p, "place", None)
    if not place:
        return None
    city = None
    addr = getattr(place, "address", None)
    if addr is not None:
        city = getattr(addr, "city", None)
    names = getattr(place, "names", None)
    if not city and names is not None:
        for field in ("city", "sub_locality", "area_of_interest", "additional_city_info", "state_province"):
            vals = getattr(names, field, None)
            if vals:
                city = vals[0]
                break
    country = getattr(addr, "country", None) if addr is not None else None
    if not city:
        city = getattr(place, "name", None)
        if city:
            city = city.split(",")[0].strip()
    return (city, country) if city else None


# ------------------------------------------------------------------ choosing
def pick(candidates, start: date, end: date, n: int):
    """Best photo per time slice, then fill with the best of the rest; no near-duplicates."""
    if not candidates:
        return []
    span = max(1, (end - start).days + 1)
    slices = [[] for _ in range(n)]
    for p in candidates:
        k = min(n - 1, (p.date.date() - start).days * n // span)
        slices[k].append(p)
    chosen = []

    def far_enough(p):
        return all(abs((p.date - c.date).total_seconds()) > NEAR_DUPLICATE_MINUTES * 60 for c in chosen)

    for sl in slices:
        for p in sorted(sl, key=photo_score, reverse=True):
            if far_enough(p):
                chosen.append(p)
                break
    for p in sorted(candidates, key=photo_score, reverse=True):
        if len(chosen) >= n:
            break
        if p not in chosen and far_enough(p):
            chosen.append(p)
    return sorted(chosen[:n], key=lambda p: p.date)


def where_you_were(photos_by_day: dict, start: date, end: date):
    """Count distinct days per city inside the era (widened by 4 weeks if there's too little)."""
    def count(a, b):
        days = Counter()
        for d, cities in photos_by_day.items():
            if a <= d <= b:
                for c in cities:
                    days[c] += 1
        return days
    days = count(start, end)
    if sum(days.values()) < 5:
        days = count(start - timedelta(weeks=4), end + timedelta(weeks=4))
    return days.most_common()


def ai_pick(client, era, candidates, n):
    """Send small thumbnails of the top candidates to Claude and let it choose n of them."""
    import base64
    tmp = Path(tempfile.mkdtemp())
    content, kept = [], []
    for i, p in enumerate(candidates):
        src = source_file(p) or download(p, tmp, f"full_{i}.jpg")
        if not src:
            continue
        thumb = tmp / f"{i}.jpg"
        r = subprocess.run(["sips", "-s", "format", "jpeg", "-Z", "512", str(src), "--out", str(thumb)], capture_output=True)
        if r.returncode or not thumb.exists():
            continue
        content += [{"type": "text", "text": f"Photo {len(kept)} ({p.date:%b %d, %Y})"},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                 "data": base64.b64encode(thumb.read_bytes()).decode()}}]
        kept.append(p)
    shutil.rmtree(tmp, ignore_errors=True)
    if len(kept) <= n:
        return kept
    tool = {"name": "choose_photos", "description": "Record the chosen photo numbers.",
            "input_schema": {"type": "object", "properties": {"photos": {"type": "array", "items": {"type": "integer"}}},
                             "required": ["photos"]}}
    prompt = (f"These photos are from one period of someone's life, an 'era' of their music listening called "
              f"\"{era.get('name', '')}\" ({era['start']} to {era['end']}), defined by: {'; '.join(era.get('drivers', []))}. "
              f"Choose the {n} photos that together best capture what this time looked like: varied moments, "
              f"people and places, good-looking shots, no near-duplicates, nothing that looks like a document or "
              f"receipt. Call choose_photos with their numbers.")
    params = dict(model=config.TAG_MODEL, max_tokens=300, tools=[tool], tool_choice={"type": "tool", "name": "choose_photos"},
                  messages=[{"role": "user", "content": content + [{"type": "text", "text": prompt}]}])
    try:
        msg = client.messages.create(**params)
    except Exception as e:
        if "tool_choice" not in str(e):
            raise
        params["tool_choice"] = {"type": "auto"}
        msg = client.messages.create(**params)
    for b in msg.content:
        if b.type == "tool_use":
            idx = [i for i in b.input.get("photos", []) if 0 <= i < len(kept)]
            if idx:
                return [kept[i] for i in dict.fromkeys(idx)][:n]
    return kept[:n]


# ------------------------------------------------------------------ exporting
def source_file(p):
    """The full-size file for a photo if it's on this Mac: edited version, then original.
    With "Optimize Mac Storage" most photos are only in iCloud, so this is often None."""
    for attr in ("path_edited", "path"):
        v = getattr(p, attr, None)
        if v and Path(v).exists():
            return Path(v)
    return None


def check_photokit():
    """iCloud-only photos are downloaded through Apple's PhotoKit, which needs the Photos permission
    for your terminal app. Fail early with instructions instead of failing on every photo."""
    from osxphotos.photokit import PhotoLibrary
    try:
        PhotoLibrary()
    except Exception:
        raise SystemExit("Your terminal isn't allowed to use Photos, so photos stored in iCloud can't be "
                         "downloaded.\nTurn it on: System Settings > Privacy & Security > Photos > your terminal "
                         "app (Full Access), then quit and reopen the terminal and try again.")


def download(p, folder: Path, name: str):
    """Download a photo from iCloud as a JPEG named `name` in `folder` (via PhotoKit, no Photos
    window). Returns the file's path, or None if it couldn't be downloaded."""
    from osxphotos.photoexporter import PhotoExporter, ExportOptions
    try:
        res = PhotoExporter(p).export(str(folder), name, options=ExportOptions(
            convert_to_jpeg=True, use_photokit=True, download_missing=True, edited=bool(p.hasadjustments)))
    except Exception:
        return None
    if not res.exported:
        return None
    got = Path(res.exported[0])
    want = folder / name
    if got != want:                             # osxphotos may write .jpeg; keep our .jpg name
        got.rename(want)
    return want


def export(p, folder: Path):
    out = folder / f"{p.date:%Y-%m-%d_%H%M}_{p.uuid[:8]}.jpg"
    if out.exists():
        return True
    src = source_file(p)
    if src is None:                              # only in iCloud: download it
        return download(p, folder, out.name) is not None
    if src.suffix.lower() in {".jpg", ".jpeg"}:
        shutil.copy2(src, out)
    else:                                          # HEIC, PNG, etc. -> JPEG with the Mac's built-in sips
        r = subprocess.run(["sips", "-s", "format", "jpeg", str(src), "--out", str(out)], capture_output=True)
        if r.returncode or not out.exists():
            return False
    return True


# ------------------------------------------------------------------ notes file
def update_notes(places: dict):
    """Write the GPS findings into era_notes.csv without overwriting anything you typed."""
    from .step5_build import NOTE_COLUMNS
    rows = []
    if config.ERA_NOTES.exists():
        with open(config.ERA_NOTES, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
    known = {r["photo_folder"] for r in rows}
    for folder, info in places.items():
        if folder not in known:
            rows.append({"photo_folder": folder, "era_name": info["name"], "start": info["start"], "end": info["end"]})
    for r in rows:
        info = places.get(r["photo_folder"])
        if not info:
            continue
        r["photos_say_you_were_in"] = info["summary"]
        if not (r.get("lived_in") or "").strip() and info["home"]:
            r["lived_in"] = info["home"]
    with open(config.ERA_NOTES, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=NOTE_COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


# ------------------------------------------------------------------ main
def run(use_ai: bool = False):
    if not config.ERAS_CACHE.exists():
        raise SystemExit("No eras yet. Run `python run.py eras` first.")
    eras = json.loads(config.ERAS_CACHE.read_text())["eras"]
    db = open_library()
    check_photokit()
    photos = [p for p in db.photos(images=True, movies=False) if usable(p)]
    print(f"  {len(photos):,} photos in your library")

    # where each photo-day was, for the GPS part. Apple's place name when Photos has worked it out;
    # otherwise look the GPS coordinates up in an offline city list (reverse_geocoder, nothing sent).
    by_day = {}
    no_name = []
    for p in photos:
        c = city_of(p)
        if c:
            by_day.setdefault(p.date.date(), set()).add(c[0])
        elif p.location and p.location[0] is not None:
            no_name.append(p)
    if no_name:
        try:
            import reverse_geocoder
        except ImportError:
            reverse_geocoder = None
            print("  (pip install reverse_geocoder to place the photos Photos hasn't named yet)")
        if reverse_geocoder:
            # gives the nearest town or neighborhood, e.g. "Hyde Park" (Chicago), "Alfama" (Lisbon)
            found = reverse_geocoder.search([p.location for p in no_name], mode=1, verbose=False)
            for p, f in zip(no_name, found):
                by_day.setdefault(p.date.date(), set()).add(f["name"])
    print(f"  {len(by_day):,} days with located photos")

    client = None
    if use_ai:
        import anthropic
        if not config.ANTHROPIC_API_KEY:
            raise SystemExit("ANTHROPIC_API_KEY is not set (needed for --ai).")
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    config.PHOTOS_DIR.mkdir(exist_ok=True)
    # Every photo ever exported is logged in photos/picked.txt ("<era folder> <uuid8>" per line).
    # One that's logged but no longer in its folder is one you deleted: it's never picked again,
    # for any era.
    log_file = config.PHOTOS_DIR / "picked.txt"
    logged = [ln.split() for ln in log_file.read_text().splitlines() if ln.strip()] if log_file.exists() else []
    rejected = {u for f, u in logged
                if not any(x.stem.endswith("_" + u) for x in (config.PHOTOS_DIR / f).glob("*"))}
    if rejected:
        print(f"  {len(rejected)} photo{'s' if len(rejected) != 1 else ''} you deleted will not be picked again")
    new_log = []
    places = {}
    for e in eras:
        start, end = date.fromisoformat(e["start"]), date.fromisoformat(e["end"])
        folder_name = f"{e['start']}_to_{e['end']}"
        folder = config.PHOTOS_DIR / folder_name
        folder.mkdir(exist_ok=True)
        files = [f for f in folder.iterdir() if f.suffix.lower() in IMAGE_TYPES]
        have = len(files)
        need = max(0, PHOTOS_PER_ERA - have)
        in_folder = {f.stem.split("_")[-1] for f in files}    # our exports end in _<uuid8>
        cands = [p for p in photos if start <= p.date.date() <= end
                 and p.uuid[:8] not in in_folder and p.uuid[:8] not in rejected]

        picked = []
        if need and cands:
            if client:
                top = sorted(cands, key=photo_score, reverse=True)[:AI_CANDIDATES * 2]
                top = pick(top, start, end, AI_CANDIDATES)          # spread out before Claude sees them
                picked = ai_pick(client, e, top, need)
            else:
                picked = pick(cands, start, end, need)
        done = [p for p in picked if export(p, folder)]
        exported = len(done)
        new_log += [f"{folder_name} {p.uuid[:8]}" for p in done]

        counts = where_you_were(by_day, start, end)
        home = counts[0][0] if counts else ""
        summary = ", ".join(f"{c} ({n} day{'s' if n != 1 else ''})" for c, n in counts[:5])
        places[folder_name] = {"name": e.get("name", ""), "start": e["start"], "end": e["end"],
                               "home": home, "summary": summary}
        print(f"  {e['start']} to {e['end']}  {e.get('name', '')[:28]:<28} "
              f"{len(cands):>4} photos taken, +{exported} exported ({have + exported} in folder)  "
              f"{('· ' + summary) if summary else '· no located photos'}")

    if new_log:
        with open(log_file, "a") as f:
            f.write("\n".join(new_log) + "\n")
    update_notes(places)
    print(f"  saved places to {config.ERA_NOTES.name} (your own lived_in entries were kept). "
          f"If you edit it, run `python run.py build` again.")
