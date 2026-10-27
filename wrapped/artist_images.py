"""
Artist photos for the top artists, straight from Spotify (used by the build step).

Your export has track IDs but no artist IDs or pictures, so for each artist we take their most
played track, open its public Spotify page to find the artist's ID, then ask Spotify's public
embed info (oEmbed, no account or key needed) for the artist's profile picture, at 640px.

Photos are saved in web/artists/ and remembered in data/cache/artist_images.json, so each artist is
fetched once; after that the site works offline. Only artist names and track IDs go to Spotify.
If you're offline or Spotify changes its pages, artists just go without a photo.
"""
import json
import re
import requests
from . import config

CACHE = config.CACHE_DIR / "artist_images.json"
OUT_DIR = config.WEB_DIR / "artists"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"}


def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "artist"


def _fetch(artist, track_uri):
    """Download one artist's picture; returns the web path or None."""
    track_id = track_uri.split(":")[-1]
    page = requests.get(f"https://open.spotify.com/track/{track_id}", headers=UA, timeout=15).text
    m = re.search(r"/artist/([A-Za-z0-9]{22})", page)
    if not m:
        return None
    info = requests.get("https://open.spotify.com/oembed",
                        params={"url": f"https://open.spotify.com/artist/{m.group(1)}"}, headers=UA, timeout=15).json()
    url = info.get("thumbnail_url")
    if not url:
        return None
    url = url.replace("ab67616100005174", "ab6761610000e5eb")   # the 320px picture -> the 640px one
    img = requests.get(url, headers=UA, timeout=15)
    if img.status_code != 200 or not img.content:
        return None
    OUT_DIR.mkdir(exist_ok=True)
    path = OUT_DIR / f"{_slug(artist)}.jpg"
    path.write_bytes(img.content)
    return f"artists/{path.name}"


def add_images(df, tops, per_list=5):
    """Adds "image" (a web path) to the first `per_list` artists of every list in `tops`."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    wanted = {a["artist"] for key, t in tops.items() if isinstance(t, dict) and "artists" in t
              for a in t["artists"][:per_list]}
    new = 0
    for artist in sorted(wanted):
        if artist in cache and (cache[artist] is None or (config.WEB_DIR / cache[artist]).exists()):
            continue
        plays = df[df["artist"] == artist]
        if plays.empty:
            continue
        uri = plays.groupby("track_uri")["minutes"].sum().idxmax()
        try:
            cache[artist] = _fetch(artist, uri)
            new += 1
        except Exception as e:                     # offline etc.: try again next build
            print(f"  note: no photo for {artist} ({type(e).__name__})")
    if new:
        CACHE.write_text(json.dumps(cache, indent=1, ensure_ascii=False))
        print(f"  artist photos: fetched {new}, {sum(1 for v in cache.values() if v)} saved in web/artists/")
    for t in tops.values():
        if isinstance(t, dict) and "artists" in t:
            for a in t["artists"]:
                if cache.get(a["artist"]):
                    a["image"] = cache[a["artist"]]
    return tops
