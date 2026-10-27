"""
STEP 1: Load your Spotify Extended Streaming History into one clean table.

INPUT : data/raw/Streaming_History_Audio_*.json  (from Spotify's "Extended streaming history" export)
OUTPUT: data/out/plays.pkl   one row per play (a "play" = one time a song started)
        data/out/tracks.csv  one row per unique song (this is what we fetch lyrics for and tag)

What each raw record looks like (only the fields we use):
    {
      "ts": "2023-02-14T03:12:44Z",          # when the play ENDED, in UTC
      "ms_played": 183000,                    # how long you actually listened
      "conn_country": "US",                   # country you streamed from
      "master_metadata_track_name": "...",
      "master_metadata_album_artist_name": "...",
      "spotify_track_uri": "spotify:track:abc",
      "reason_end": "trackdone" | "fwdbtn" | ...,   # fwdbtn = you hit "next"
      "skipped": true | false | null,         # often null in older years
      "shuffle": true | false
    }
"""
import json
import pandas as pd
from . import config


def read_raw_files() -> pd.DataFrame:
    files = sorted(config.RAW_DIR.glob("*.json"))
    # Video history files have no songs in them, so they're skipped.
    files = [f for f in files if "Video" not in f.name and not f.name.startswith("_")]
    if not files:
        raise SystemExit(f"No JSON files found in {config.RAW_DIR}. Put your Spotify export there "
                         "or run `python run.py sample` to generate practice data.")
    records = []
    for f in files:
        records.extend(json.loads(f.read_text(encoding="utf-8")))
    print(f"  read {len(records):,} records from {len(files)} file(s)")
    return pd.DataFrame(records)


def to_local_time(df: pd.DataFrame) -> pd.Series:
    """Spotify timestamps are UTC. Convert each play to the local time where it happened,
    using conn_country to pick the time zone (so 2 AM in Paris counts as 2 AM)."""
    utc = pd.to_datetime(df["ts"], utc=True)
    tz_for_row = df["conn_country"].map(config.COUNTRY_TZ).fillna(config.HOME_TZ)
    local = pd.Series(index=df.index, dtype="object")
    # Convert one time zone group at a time (much faster than row by row).
    for tz, idx in tz_for_row.groupby(tz_for_row).groups.items():
        local.loc[idx] = utc.loc[idx].dt.tz_convert(tz).dt.tz_localize(None)
    return pd.to_datetime(local)


def add_cities(df: pd.DataFrame, ips) -> None:
    """Optional city-level location. If you've downloaded DB-IP's free "IP to City Lite" database
    (an .mmdb file) into data/raw/, each play's IP address is looked up OFFLINE in that file to get an
    approximate city + coordinates. Without the file, the map uses countries only.
    IP-based location is approximate (often the nearest big city or your ISP's hub)."""
    df["city"], df["lat"], df["lon"] = None, None, None
    dbs = sorted(config.RAW_DIR.glob("*.mmdb"))
    if ips is None or not dbs:
        print("  location: country-level (add a DB-IP City Lite .mmdb to data/raw/ for cities)")
        return
    import maxminddb
    reader = maxminddb.open_database(str(dbs[-1]))
    lookup = {}
    for ip in ips.dropna().unique():          # each unique IP is looked up once
        try:
            rec = reader.get(ip) or {}
        except ValueError:
            continue
        loc = rec.get("location", {})
        name = (rec.get("city", {}).get("names", {}) or {}).get("en")
        if name and "latitude" in loc:
            lookup[ip] = (name, loc["latitude"], loc["longitude"])
    hits = ips.map(lookup)
    df["city"] = hits.map(lambda h: h[0] if isinstance(h, tuple) else None)
    df["lat"] = hits.map(lambda h: h[1] if isinstance(h, tuple) else None)
    df["lon"] = hits.map(lambda h: h[2] if isinstance(h, tuple) else None)
    print(f"  location: city-level for {df['city'].notna().mean():.0%} of plays")


def run():
    raw = read_raw_files()

    # Keep music only: podcasts and audiobooks have no track URI.
    raw = raw[raw["spotify_track_uri"].notna() & raw["master_metadata_track_name"].notna()].copy()

    df = pd.DataFrame({
        "track_uri": raw["spotify_track_uri"],
        "track": raw["master_metadata_track_name"],
        "artist": raw["master_metadata_album_artist_name"],
        "album": raw.get("master_metadata_album_album_name"),
        "ms_played": raw["ms_played"].astype(int),
        "country": raw["conn_country"].fillna("US"),
        "reason_end": raw.get("reason_end"),
        "skipped_flag": raw.get("skipped"),
        "shuffle": raw.get("shuffle"),
    })
    df["local_time"] = to_local_time(raw)
    ip_col = "ip_addr" if "ip_addr" in raw else ("ip_addr_decrypted" if "ip_addr_decrypted" in raw else None)
    add_cities(df, raw[ip_col] if ip_col else None)

    # A play counts as a skip if Spotify flagged it, you pressed next, or it lasted under 30 seconds.
    df["skipped"] = (
        (df["skipped_flag"] == True)
        | (df["reason_end"] == "fwdbtn")
        | (df["ms_played"] < config.SKIP_MS)
    )
    df["minutes"] = df["ms_played"] / 60_000

    # Handy calendar columns used by almost every chart.
    t = df["local_time"]
    df["date"] = t.dt.date
    df["year"] = t.dt.year
    df["month"] = t.dt.to_period("M").astype(str)       # "2023-02"
    df["hour"] = t.dt.hour
    df["weekday"] = t.dt.dayofweek                       # 0 = Monday
    df["week_of_year"] = t.dt.isocalendar().week.clip(upper=52).astype(int)
    df["season"] = t.dt.month.map({12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring",
                                   5: "spring", 6: "summer", 7: "summer", 8: "summer",
                                   9: "fall", 10: "fall", 11: "fall"})
    df = df.sort_values("local_time").reset_index(drop=True)
    df.to_pickle(config.PLAYS_FILE)

    # Unique songs. The longest completed play is our best guess at the song's length,
    # which helps LRCLIB match the right version of a song.
    done = df[df["reason_end"] == "trackdone"]
    tracks = (df.groupby("track_uri")
                .agg(track=("track", "first"), artist=("artist", "first"), album=("album", "first"),
                     plays=("track", "size"), minutes=("minutes", "sum"))
                .reset_index())
    tracks["duration_sec"] = tracks["track_uri"].map(done.groupby("track_uri")["ms_played"].max() / 1000)
    tracks = tracks.sort_values("minutes", ascending=False)
    tracks.to_csv(config.TRACKS_FILE, index=False)

    print(f"  {len(df):,} plays, {len(tracks):,} unique songs, "
          f"{df['local_time'].min():%b %Y} to {df['local_time'].max():%b %Y}")
