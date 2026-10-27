"""
STEP 0 (practice only): Generate fake Spotify history in the exact Extended Streaming History format.

OUTPUT: data/raw/Streaming_History_Audio_SAMPLE.json  + data/raw/_sample_truth.json
The fake listener has deliberate patterns so every screen has something to show:
  sadder winters, sunnier summers, lonelier late nights, artists rising and fading by year,
  a few songs that get played to death and then skipped, and trips abroad.
Delete both files (and data/cache, data/out) before running on your real export.
"""
import json
import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from . import config

WORDS_A = ["Velvet", "Paper", "Neon", "Silver", "Hollow", "Golden", "Static", "Paper", "Lunar", "Wild",
           "Glass", "Saint", "Echo", "Coastal", "Midnight", "Copper", "Honey", "Ivory", "Northern", "Low"]
WORDS_B = ["Harbor", "Lanes", "Season", "Arcade", "Radio", "Kids", "Garden", "Hotel", "Avenue", "Fever",
           "Ghosts", "Tide", "Parade", "Machines", "Weather", "Hearts", "Motel", "Atlas", "Club", "Tapes"]
SONG_WORDS = ["Rain", "Summer", "Fire", "Gone", "Home", "Stay", "Dancing", "Letters", "Polaroid", "Drive",
              "Sunday", "Heavy", "Gold", "Glow", "Ocean", "Weekend", "Ghost", "Satellite", "Sugar", "Faded",
              "Runaway", "Window", "Cherry", "Static", "Blue", "Lights", "Thunder", "Still", "Rewind", "Bloom"]
MOOD_THEMES = {
    "happy": ["love", "friendship", "dance"], "sad": ["heartbreak", "loss", "longing"],
    "angry": ["rebellion", "independence", "politics"], "nostalgic": ["nostalgia", "growing up", "home"],
    "romantic": ["love", "longing", "sex"], "hyped": ["partying", "ambition", "money"],
    "calm": ["nature", "escapism", "travel"], "anxious": ["self-doubt", "mental health", "city life"],
    "lonely": ["longing", "city life", "self-doubt"], "hopeful": ["freedom", "self-love", "ambition"],
}
SEASON_BIAS = {  # month -> moods that get boosted
    12: ["sad", "nostalgic", "lonely"], 1: ["sad", "lonely", "calm"], 2: ["sad", "romantic"],
    3: ["hopeful", "calm"], 4: ["hopeful", "happy"], 5: ["happy", "romantic"],
    6: ["happy", "hyped"], 7: ["hyped", "happy"], 8: ["happy", "nostalgic"],
    9: ["nostalgic", "calm"], 10: ["nostalgic", "anxious"], 11: ["sad", "anxious", "nostalgic"],
}
TRIPS = [("FR", "2021-07-02", 12), ("ES", "2022-03-10", 9), ("MX", "2022-12-20", 10),
         ("GB", "2023-08-05", 7), ("JP", "2024-04-01", 14), ("PT", "2025-06-15", 8), ("ES", "2026-01-03", 6)]


def run(start_year=2020, seed=7):
    rng = random.Random(seed)
    tz = ZoneInfo("America/New_York")
    end = datetime(2026, 10, 15)

    artists = []
    for i in range(45):
        name = f"{rng.choice(WORDS_A)} {rng.choice(WORDS_B)}"
        peak = rng.uniform(start_year - 0.5, 2026.8)               # year this artist is most played
        moods = rng.sample(list(MOOD_THEMES), 2)
        artists.append({"name": name, "peak": peak, "width": rng.uniform(0.6, 2.2), "moods": moods})

    songs, truth = [], {}
    for a in artists:
        for j in range(rng.randint(5, 12)):
            uri = "spotify:track:" + "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(22))
            title = " ".join(rng.sample(SONG_WORDS, rng.choice([1, 2])))
            mood = rng.choice(a["moods"] + [rng.choice(list(MOOD_THEMES))])
            songs.append({"uri": uri, "title": title, "artist": a, "mood": mood,
                          "length": rng.randint(150, 260) * 1000, "album": f"{title} (Deluxe)"})
            truth[uri] = {"mood": mood, "themes": rng.sample(MOOD_THEMES[mood], 2)}
    # a few "fallen favorites": played heavily at first, then skipped
    fallen = {s["uri"]: datetime(rng.randint(start_year, 2025), rng.randint(1, 12), 1)
              for s in rng.sample(songs, 6)}

    trips = [(c, datetime.fromisoformat(d), n) for c, d, n in TRIPS]
    records = []
    day = datetime(start_year, 1, 1)
    while day < end:
        yr = day.year + day.timetuple().tm_yday / 366
        country = next((c for c, d0, n in trips if d0 <= day < d0 + timedelta(days=n)), "US")
        n_plays = max(0, int(rng.gauss(28 if day.weekday() >= 5 else 22, 12)))
        if rng.random() < 0.06:
            n_plays = 0                                               # quiet days
        if rng.random() < 0.02:
            n_plays *= 4                                              # binge days
        weights = [max(0.02, 2.7 ** (-((yr - a["peak"]) / a["width"]) ** 2)) for a in artists]
        hours = sorted(rng.choices(range(24), weights=[1, 1, 1, .5, .2, .2, .5, 2, 3, 3, 3, 3, 4, 4,
                                                        3, 3, 3, 4, 4, 5, 5, 5, 4, 2], k=n_plays))
        for h in hours:
            # time-of-day and season nudge which mood gets picked
            boost = list(SEASON_BIAS[day.month])
            if h >= 23 or h <= 3:
                boost += ["lonely", "sad", "calm"]
            elif 6 <= h <= 9:
                boost += ["hopeful", "calm"]
            elif 17 <= h <= 21:
                boost += ["hyped", "happy"]
            # pick an artist, favoring ones who have songs in the boosted moods
            w2 = [wt * (3 if any(m in boost for m in a["moods"]) else 1) for wt, a in zip(weights, artists)]
            artist = rng.choices(artists, weights=w2)[0]
            pool = [s for s in songs if s["artist"] is artist]
            pref = [s for s in pool if s["mood"] in boost]
            song = rng.choice(pref if pref and rng.random() < 0.85 else pool)
            for uri, start in fallen.items():                         # obsession phase
                if start <= day < start + timedelta(days=200) and rng.random() < 0.05:
                    song = next(s for s in songs if s["uri"] == uri)
            # skip behaviour
            skip_p = 0.18
            if song["uri"] in fallen:
                age = (day - fallen[song["uri"]]).days
                skip_p = 0.03 if age < 80 else (0.85 if age > 120 else 0.4)
            skipped = rng.random() < skip_p
            ms = rng.randint(3000, 40000) if skipped else song["length"]
            local = datetime(day.year, day.month, day.day, h, rng.randint(0, 59), rng.randint(0, 59), tzinfo=tz)
            ts = local.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")
            records.append({
                "ts": ts, "platform": "ios", "ms_played": ms, "conn_country": country, "ip_addr": None,
                "master_metadata_track_name": song["title"],
                "master_metadata_album_artist_name": song["artist"]["name"],
                "master_metadata_album_album_name": song["album"], "spotify_track_uri": song["uri"],
                "episode_name": None, "episode_show_name": None, "spotify_episode_uri": None,
                "reason_start": "clickrow" if rng.random() < 0.3 else "trackdone",
                "reason_end": "fwdbtn" if skipped else "trackdone",
                "shuffle": rng.random() < 0.5, "skipped": skipped if day.year >= 2022 else None,
                "offline": False, "offline_timestamp": None, "incognito_mode": False,
            })
        day += timedelta(days=1)

    records.sort(key=lambda x: x["ts"])
    (config.RAW_DIR / "Streaming_History_Audio_SAMPLE.json").write_text(json.dumps(records))
    (config.RAW_DIR / "_sample_truth.json").write_text(json.dumps(truth))
    print(f"  wrote {len(records):,} fake plays of {len(songs)} songs by {len(artists)} artists")
