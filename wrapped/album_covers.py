"""
Album covers for the record labels (used by the build step).

Takes your top albums by minutes listened and, for each, its most played track. Spotify's public
embed info for that track (oEmbed, no account or key needed) includes the album cover. Covers are
saved in web/covers/ and remembered in data/cache/album_covers.json, so each album is fetched once
and the site works offline afterwards. Only track IDs go to Spotify.
"""
import json
import re
import requests
from . import config

CACHE = config.CACHE_DIR / "album_covers.json"
OUT_DIR = config.WEB_DIR / "covers"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"}
TOP_ALBUMS = 80          # more than any one page has records, so labels never repeat on a page

# The site's neon colors, with the hue (0-360) each one stands for. Every record's glow is one of these.
NEONS = [("#ff2e2e", 0), ("#ff8a00", 32), ("#ffe500", 54), ("#c8ff00", 75),
         ("#00d1ff", 192), ("#4f6bff", 230), ("#9d4dff", 270), ("#ff2d87", 335)]


def neon_for(path):
    """The neon that goes best with a cover: its most vivid color, matched to the nearest neon.
    Grey or black-and-white covers get violet if they're dark and cyan if they're light."""
    import colorsys
    from PIL import Image
    img = Image.open(path).convert("RGB").resize((64, 64))
    votes = {c: 0.0 for c, _ in NEONS}
    vivid = light = 0.0
    for r, g, b in img.getdata():
        h, sat, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        light += v
        if sat < 0.35 or v < 0.3:                  # greys, blacks and washed-out bits don't count
            continue
        w = sat * v                                # brighter and more saturated = louder
        hue = h * 360
        best = min(NEONS, key=lambda n: min(abs(hue - n[1]), 360 - abs(hue - n[1])))
        votes[best[0]] += w
        vivid += w
    if vivid < 64 * 64 * 0.04:                     # hardly any color at all
        return "#00d1ff" if light / (64 * 64) > 0.55 else "#9d4dff"
    return max(votes, key=votes.get)


_missed = []
def _miss(key, err):
    """Say which covers couldn't be found, but only the first few (offline, every one would fail)."""
    _missed.append(key)
    if len(_missed) <= 3:
        print(f"  note: no cover for {key} ({type(err).__name__})")
    elif len(_missed) in (4, 50, 500):
        print(f"  note: {len(_missed)} covers missing so far (offline? songs without a Spotify page?)")


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "album"


def _fetch(key, track_uri):
    info = requests.get("https://open.spotify.com/oembed",
                        params={"url": f"https://open.spotify.com/track/{track_uri.split(':')[-1]}"},
                        headers=UA, timeout=15).json()
    url = info.get("thumbnail_url")
    if not url:
        return None
    img = requests.get(url, headers=UA, timeout=15)
    if img.status_code != 200 or not img.content:
        return None
    OUT_DIR.mkdir(exist_ok=True)
    path = OUT_DIR / f"{_slug(key)}.jpg"
    path.write_bytes(img.content)
    return f"covers/{path.name}"


def era_covers(df, eras, per_era=12):
    """Adds "covers" to every era: its most played albums during the era, most first, as
    [{"src", "glow"}]. Uses the same cover cache as album_covers, so most are already saved."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    df = df[df["album"].notna() & (df["album"] != "")]
    new = 0
    for e in eras:
        sub = df[(df["date"].astype(str) >= e["start"]) & (df["date"].astype(str) <= e["end"])]
        out = []
        for album, artist in sub.groupby(["album", "artist"])["minutes"].sum().nlargest(per_era).index:
            key = f"{album} - {artist}"
            if key not in cache or (cache[key] and not (config.WEB_DIR / cache[key]).exists()):
                uri = sub[(sub["album"] == album) & (sub["artist"] == artist)].groupby("track_uri")["minutes"].sum().idxmax()
                try:
                    cache[key] = _fetch(key, uri)
                    new += 1
                except Exception as ex:
                    _miss(key, ex)
                    continue
            if cache.get(key):
                out.append({"src": cache[key], "glow": neon_for(config.WEB_DIR / cache[key]), "album": album, "artist": artist})
        e["covers"] = out
    if new:
        CACHE.write_text(json.dumps(cache, indent=1, ensure_ascii=False))
        print(f"  era album covers: fetched {new} more")
    return eras


def song_cover(df, track, artist):
    """{"src", "glow"} for one song's album cover (for the most skipped and fallen favorite pages)."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    sub = df[(df["track"] == track) & (df["artist"] == artist)]
    if sub.empty:
        return None
    album = sub["album"].mode().iat[0] if sub["album"].notna().any() else track
    key = f"{album} - {artist}"
    if key not in cache or (cache[key] and not (config.WEB_DIR / cache[key]).exists()):
        try:
            cache[key] = _fetch(key, sub["track_uri"].mode().iat[0])
            CACHE.write_text(json.dumps(cache, indent=1, ensure_ascii=False))
        except Exception as e:
            _miss(key, e)
            return None
    return {"src": cache[key], "glow": neon_for(config.WEB_DIR / cache[key])} if cache.get(key) else None


def year_albums(df):
    """{year: {"src", "glow", "album", "artist"}}: each year's most played album, for the end card."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    df = df[df["album"].notna() & (df["album"] != "")]
    out, new = {}, 0
    for y, sub in df.groupby("year"):
        album, artist = sub.groupby(["album", "artist"])["minutes"].sum().idxmax()
        key = f"{album} - {artist}"
        if key not in cache or (cache[key] and not (config.WEB_DIR / cache[key]).exists()):
            uri = sub[(sub["album"] == album) & (sub["artist"] == artist)].groupby("track_uri")["minutes"].sum().idxmax()
            try:
                cache[key] = _fetch(key, uri); new += 1
            except Exception as e:
                _miss(key, e); continue
        if cache.get(key):
            out[int(y)] = {"src": cache[key], "glow": neon_for(config.WEB_DIR / cache[key]), "album": album, "artist": artist}
    if new:
        CACHE.write_text(json.dumps(cache, indent=1, ensure_ascii=False))
    return out


def album_covers(df):
    """Your top albums' covers, most listened first: [{"src": web path, "glow": neon color}, ...]."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    df = df[df["album"].notna() & (df["album"] != "")]
    ranked = df.groupby(["album", "artist"])["minutes"].sum().nlargest(TOP_ALBUMS).index
    out, new = [], 0
    for album, artist in ranked:
        key = f"{album} - {artist}"
        if key not in cache or (cache[key] and not (config.WEB_DIR / cache[key]).exists()):
            uri = df[(df["album"] == album) & (df["artist"] == artist)].groupby("track_uri")["minutes"].sum().idxmax()
            try:
                cache[key] = _fetch(key, uri)
                new += 1
            except Exception as e:                 # offline etc.: try again next build
                _miss(key, e)
                continue
        if cache.get(key) and cache[key] not in [c["src"] for c in out]:
            out.append({"src": cache[key], "glow": neon_for(config.WEB_DIR / cache[key]), "album": album, "artist": artist})
    if new:
        CACHE.write_text(json.dumps(cache, indent=1, ensure_ascii=False))
        print(f"  album covers: fetched {new}, {len(out)} in use")
    return out
