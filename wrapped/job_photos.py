"""
Photos from a folder (`python run.py photos --folder PATH`): the same idea as step 6 (photos per era,
and where you were), but from photo files instead of the Mac Photos app, so it works on any computer.

Each photo's date and GPS come from the information stored inside the file (EXIF). Photos without a
date are skipped. Up to 6 per era are picked, spread evenly across the era, saved as JPEGs (iPhone
.HEIC photos are converted) into web/photos/<era folder>/, then the build step lays them out.
"""
import json
from datetime import datetime, date
from pathlib import Path
from . import config
from .step6_photos import where_you_were, update_notes, PHOTOS_PER_ERA

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}


def _open(path):
    from PIL import Image
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    return Image.open(path)


def _gps(exif):
    """(lat, lon) from EXIF GPS info, or None."""
    try:
        g = exif.get_ifd(0x8825)
        if not g or 2 not in g or 4 not in g:
            return None
        deg = lambda v: float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
        lat, lon = deg(g[2]), deg(g[4])
        if g.get(1) == "S": lat = -lat
        if g.get(3) == "W": lon = -lon
        return (lat, lon) if (lat or lon) else None
    except Exception:
        return None


def read_photo(path: Path):
    """{"path", "taken" (datetime), "gps"} or None if it has no date."""
    try:
        img = _open(path)
        exif = img.getexif()
        raw = exif.get_ifd(0x8769).get(36867) or exif.get(306)          # DateTimeOriginal, else DateTime
        taken = datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S") if raw else None
    except Exception:
        return None
    return {"path": path, "taken": taken, "gps": _gps(exif)} if taken else None


def run(photo_dir: Path):
    eras = json.loads(config.ERAS_CACHE.read_text())["eras"] if config.ERAS_CACHE.exists() else []
    files = [p for p in Path(photo_dir).rglob("*") if p.suffix.lower() in IMAGE_EXTS]
    photos = [r for r in map(read_photo, files) if r]
    print(f"  {len(files)} photos found, {len(photos)} with a date")

    by_day = {}                                     # where each photo-day was, from GPS
    located = [p for p in photos if p["gps"]]
    if located:
        import reverse_geocoder
        for p, f in zip(located, reverse_geocoder.search([p["gps"] for p in located], mode=1, verbose=False)):
            by_day.setdefault(p["taken"].date(), set()).add(f["name"])

    config.PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    places = {}
    used = []          # every photo placed so far: eras can overlap, and only one photo per day overall
    near = lambda p, others: any(p["taken"].date() == o["taken"].date() for o in others)
    for e in eras:
        start, end = date.fromisoformat(e["start"]), date.fromisoformat(e["end"])
        folder_name = f"{e['start']}_to_{e['end']}"
        folder = config.PHOTOS_DIR / folder_name
        folder.mkdir(exist_ok=True)
        inside = sorted((p for p in photos if start <= p["taken"].date() <= end), key=lambda p: p["taken"])
        # spread the picks evenly across the era: for each evenly spaced moment, the closest photo
        # from a day that hasn't been used yet (in this era or another)
        n, picks = min(PHOTOS_PER_ERA, len(inside)), []
        for i in range(n):
            target = inside[round(i * (len(inside) - 1) / max(1, n - 1))]["taken"]
            ok = [p for p in inside if not near(p, picks + used)]
            if not ok:
                break
            picks.append(min(ok, key=lambda p: abs(p["taken"] - target)))
        used += picks
        for src in picks:
            out = folder / f"{src['taken']:%Y-%m-%d_%H%M%S}.jpg"
            try:
                from PIL import ImageOps
                img = ImageOps.exif_transpose(_open(src["path"])).convert("RGB")   # turn it the way the phone held it
                img.thumbnail((1600, 1600))
                img.save(out, "JPEG", quality=85)
            except Exception as ex:
                print(f"  could not use {src['path'].name} ({type(ex).__name__})")
        counts = where_you_were(by_day, start, end)
        places[folder_name] = {"name": e.get("name", ""), "start": e["start"], "end": e["end"],
                               "home": counts[0][0] if counts else "",
                               "summary": ", ".join(f"{c} ({k} day{'s' if k != 1 else ''})" for c, k in counts[:5])}
    if eras:
        update_notes(places)
    print(f"  photos placed in {sum(1 for _ in config.PHOTOS_DIR.rglob('*.jpg'))} spots across {len(eras)} eras")
