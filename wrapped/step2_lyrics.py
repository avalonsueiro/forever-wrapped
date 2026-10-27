"""
STEP 2: Fetch lyrics for every unique song from LRCLIB (free, no API key).

INPUT : data/out/tracks.csv
OUTPUT: data/cache/lyrics.jsonl   one JSON line per song:
        {"track_uri": ..., "status": "found" | "instrumental" | "missing", "lyrics": "..."}

How matching works:
  1. Try /api/get with the exact title, artist, album and duration. This is the precise lookup.
  2. If that misses, try /api/search and pick the candidate whose artist matches and whose
     duration is closest to ours (so live versions and covers don't win by accident).

The cache makes this resumable: if it stops halfway, run it again and it skips songs it already has.
LRCLIB asks for sequential requests with a short pause, so this runs one song at a time.
Run this on your own computer (this step's website is not reachable from every network).
"""
import json
import time
import requests
import pandas as pd
from . import config


def load_cache(path) -> dict:
    if not path.exists():
        return {}
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            out[row["track_uri"]] = row
    return out


def _norm(s: str) -> str:
    return "".join(ch for ch in str(s).lower() if ch.isalnum())


def lookup(session: requests.Session, track: str, artist: str, album: str, duration) -> dict:
    # 1) exact lookup
    params = {"track_name": track, "artist_name": artist}
    if isinstance(album, str):
        params["album_name"] = album
    if pd.notna(duration):
        params["duration"] = int(round(duration))
    r = session.get(f"{config.LRCLIB_URL}/get", params=params, timeout=20)
    if r.status_code == 200:
        return r.json()

    # 2) fuzzy search, ranked by artist match + duration closeness
    time.sleep(config.LRCLIB_PAUSE_SEC)
    r = session.get(f"{config.LRCLIB_URL}/search",
                    params={"track_name": track, "artist_name": artist}, timeout=20)
    if r.status_code != 200 or not r.json():
        return {}

    def score(c):
        s = 0
        if _norm(c.get("artistName", "")) == _norm(artist):
            s += 10
        if _norm(c.get("trackName", "")) == _norm(track):
            s += 5
        if pd.notna(duration) and c.get("duration"):
            s -= abs(c["duration"] - duration) / 5        # lose a point per 5s of difference
        if c.get("plainLyrics"):
            s += 2
        return s

    return max(r.json(), key=score)


def run(limit: int | None = None, mode: str = "live"):
    tracks = pd.read_csv(config.TRACKS_FILE)
    if limit:
        tracks = tracks.head(limit)               # most-listened songs first
    cache = load_cache(config.LYRICS_CACHE)
    todo = tracks[~tracks["track_uri"].isin(cache)]
    print(f"  {len(cache):,} songs already cached, {len(todo):,} to fetch")

    if mode == "mock":   # practice data: fake songs have no real lyrics, so pretend we found some
        with open(config.LYRICS_CACHE, "a", encoding="utf-8") as f:
            for row in todo.itertuples():
                f.write(json.dumps({"track_uri": row.track_uri, "status": "found",
                                    "lyrics": "(sample lyrics)"}) + "\n")
        print(f"  wrote {len(todo):,} mock lyric entries")
        return

    session = requests.Session()
    session.headers["User-Agent"] = config.LRCLIB_USER_AGENT
    counts = {"found": 0, "instrumental": 0, "missing": 0}

    with open(config.LYRICS_CACHE, "a", encoding="utf-8") as f:
        for i, row in enumerate(todo.itertuples(), 1):
            try:
                hit = lookup(session, row.track, row.artist, row.album, row.duration_sec)
            except requests.RequestException as e:
                print(f"  network error on '{row.track}': {e}. Stopping; rerun to resume.")
                break
            if hit.get("instrumental"):
                status, lyrics = "instrumental", ""
            elif hit.get("plainLyrics"):
                status, lyrics = "found", hit["plainLyrics"]
            else:
                status, lyrics = "missing", ""
            counts[status] += 1
            f.write(json.dumps({"track_uri": row.track_uri, "status": status, "lyrics": lyrics}) + "\n")
            f.flush()
            if i % 50 == 0:
                print(f"  {i:,}/{len(todo):,}  {counts}")
            time.sleep(config.LRCLIB_PAUSE_SEC)

    print(f"  done: {counts}")
