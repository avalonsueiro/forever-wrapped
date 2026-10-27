"""
STEP 5: Crunch every number the app needs and write it to web/data.js.

INPUT : plays + tags + eras
OUTPUT: web/data.js  ->  `window.WRAPPED = {...}`  (open web/index.html to see it)

Each function below builds the data for one screen. They are independent, so if you want to change
how a chart works, find its function here and edit just that part. All time values are local time.
"""
import json
import numpy as np
import pandas as pd
from . import config

# Older copies of config.py don't have these two settings yet; fall back to the defaults.
if not hasattr(config, "PHOTOS_DIR"):
    config.PHOTOS_DIR = config.WEB_DIR / "photos"
if not hasattr(config, "ERA_NOTES"):
    config.ERA_NOTES = config.ROOT / "era_notes.csv"
from .common import load_plays_with_tags, mood_minutes, theme_minutes

MOODS = config.MOODS


def r(x, n=1):
    return round(float(x), n)


def top_mood(row) -> str:
    return max(MOODS, key=lambda m: row.get(m, 0))


def mood_mix(df) -> dict:
    mm = mood_minutes(df, lambda _: 0).sum()
    total = mm.sum() or 1
    return {m: r(mm[m] / total, 3) for m in MOODS}


def top_list(df, keys, n=10):
    g = df.groupby(keys).agg(minutes=("minutes", "sum"), plays=("minutes", "size"))
    g = g.sort_values("minutes", ascending=False).head(n).reset_index()
    return [{**{k: row[k] for k in ([keys] if isinstance(keys, str) else keys)},
             "minutes": r(row["minutes"]), "plays": int(row["plays"])} for _, row in g.iterrows()]


# ---------------------------------------------------------------- 1, 2: intro + years
def overview(df, eras):
    return {
        "total_minutes": r(df["minutes"].sum(), 0), "total_plays": len(df),
        "songs": df["track_uri"].nunique(), "artists": df["artist"].nunique(),
        "first": str(df["local_time"].min().date()), "last": str(df["local_time"].max().date()),
        "years": sorted(int(y) for y in df["year"].unique()),
        # years with enough listening to get their own button in the year picker
        "picker_years": sorted(int(y) for y, m in df.groupby("year")["minutes"].sum().items()
                               if m >= config.MIN_YEAR_MINUTES),
        "tagged_share": r(df.loc[df["tagged"], "minutes"].sum() / df["minutes"].sum(), 3),
        "lyrics_share": r(df.loc[df["basis"] == "lyrics", "minutes"].sum() / df["minutes"].sum(), 3),
    }


def year_cards(df, eras):
    titles = eras.get("year_titles", {})
    out = []
    for y, sub in df.groupby("year"):
        mix = mood_mix(sub[sub["tagged"]])
        out.append({
            "year": int(y), "title": titles.get(str(y), str(y)),
            "minutes": r(sub["minutes"].sum(), 0), "plays": len(sub),
            "top_artist": sub.groupby("artist")["minutes"].sum().idxmax(),
            "top_song": "{} by {}".format(*sub.groupby(["track", "artist"])["minutes"].sum().idxmax()),
            "dominant_mood": top_mood(mix), "mood_mix": mix,
            "new_artists": len(set(sub["artist"]) - set(df.loc[df["year"] < y, "artist"])),
        })
    return out


# ---------------------------------------------------------------- 3: when you listen
def when_you_listen(df):
    heat = df.pivot_table(index="weekday", columns="hour", values="minutes", aggfunc="sum",
                          fill_value=0).reindex(index=range(7), columns=range(24), fill_value=0)
    radial = {int(y): [r(v) for v in sub.groupby("hour")["minutes"].sum().reindex(range(24), fill_value=0)]
              for y, sub in df.groupby("year")}
    daily = df.groupby("date")["minutes"].sum()
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    span_days = (df["local_time"].max() - df["local_time"].min()).days + 1
    return {
        "heatmap": [[r(v) for v in row] for row in heat.values],
        "radial_by_year": radial,
        "monthly": {m: r(v) for m, v in df.groupby("month")["minutes"].sum().items()},
        "peaks": {
            "busiest_hour": int(df.groupby("hour")["minutes"].sum().idxmax()),
            "busiest_weekday": days[int(df.groupby("weekday")["minutes"].sum().idxmax())],
            "busiest_day": str(daily.idxmax()), "busiest_day_minutes": r(daily.max(), 0),
            "avg_minutes_per_day": r(df["minutes"].sum() / span_days, 0),
        },
    }


# ---------------------------------------------------------------- 4: calendar, sessions, streaks
def calendar(df):
    daily = df.groupby("date")["minutes"].sum()
    # Sessions: plays separated by less than SESSION_GAP_MIN minutes belong together.
    t = df["local_time"]
    start_of_play = t - pd.to_timedelta(df["ms_played"], unit="ms")
    gap = (start_of_play - t.shift()).dt.total_seconds() / 60
    sid = (gap.isna() | (gap > config.SESSION_GAP_MIN)).cumsum()
    s = df.assign(sid=sid, start=start_of_play).groupby("sid").agg(
        start=("start", "min"), end=("local_time", "max"), minutes=("minutes", "sum"),
        plays=("minutes", "size"), top_artist=("artist", lambda a: a.value_counts().index[0]))
    s = s.sort_values("minutes", ascending=False).head(10)
    sessions = [{"start": str(x.start)[:16], "end": str(x.end)[:16], "minutes": r(x.minutes, 0),
                 "plays": int(x.plays), "top_artist": x.top_artist} for x in s.itertuples()]
    # Streak: longest run of consecutive days with any listening.
    d = pd.Series(sorted(pd.to_datetime(daily.index)))
    run_id = (d.diff().dt.days != 1).cumsum()
    runs = d.groupby(run_id).agg(["min", "max", "size"]).sort_values("size", ascending=False)
    best = runs.iloc[0]
    return {"daily": {str(k): r(v) for k, v in daily.items()}, "top_sessions": sessions,
            "longest_streak": {"start": str(best["min"].date()), "end": str(best["max"].date()),
                               "days": int(best["size"])},
            "days_listened": int(len(daily))}


# ---------------------------------------------------------------- 5: seasons wheel
def seasons(df):
    tagged = df[df["tagged"]]

    def wheel(sub):
        mm = mood_minutes(sub, "week_of_year").reindex(range(1, 53), fill_value=0)
        # circular smoothing: wrap the year around so late Dec blends into early Jan
        padded = pd.concat([mm.iloc[-2:], mm, mm.iloc[:2]])
        smooth = padded.rolling(5, center=True).mean().iloc[2:-2]
        share = smooth.div(smooth.sum(axis=1).replace(0, 1), axis=0)
        return {m: [r(v, 3) for v in share[m]] for m in MOODS}

    order = {"winter": [12, 1, 2], "spring": [3, 4, 5], "summer": [6, 7, 8], "fall": [9, 10, 11]}
    month_num = tagged["local_time"].dt.month

    def profiles_for(plays, min_minutes=0):
        out = {}
        for season, months in order.items():
            sub = plays[plays["season"] == season]
            if sub.empty or sub["minutes"].sum() < min_minutes:   # too little to say what a season sounded like
                continue
            out[season] = profile(sub, months)
        return out

    def profile(sub, months):
        early = sub[month_num.loc[sub.index] == months[0]]
        late = sub[month_num.loc[sub.index] == months[-1]]
        tm = theme_minutes(sub.assign(_k=0), "_k").sum().sort_values(ascending=False)
        return {
            "minutes": r(sub["minutes"].sum(), 0), "mood_mix": mood_mix(sub),
            "top_themes": tm.index[:3].tolist(),
            "top_artists": sub.groupby("artist")["minutes"].sum().nlargest(3).index.tolist(),
            "starts": top_mood(mood_mix(early)) if len(early) else None,
            "ends": top_mood(mood_mix(late)) if len(late) else None,
        }

    # a year's seasons are that calendar year's plays (its winter is January, February and December)
    return {"wheel_all": wheel(tagged),
            "wheel_by_year": {int(y): wheel(sub) for y, sub in tagged.groupby("year")},
            "profiles": profiles_for(tagged),
            "profiles_by_year": {int(y): profiles_for(sub, 60) for y, sub in tagged.groupby("year")}}


# ---------------------------------------------------------------- 6: mood by time of day
def mood_by_hour(df):
    tagged = df[df["tagged"]]

    def shares(sub):
        mm = mood_minutes(sub, "hour").reindex(range(24), fill_value=0)
        sh = mm.div(mm.sum(axis=1).replace(0, 1), axis=0)
        return {m: [r(v, 3) for v in sh[m]] for m in MOODS}

    tm = theme_minutes(tagged, "hour").reindex(range(24), fill_value=0)
    return {"all": shares(tagged), "weekday": shares(tagged[tagged["weekday"] < 5]),
            "weekend": shares(tagged[tagged["weekday"] >= 5]),
            "top_theme_by_hour": [tm.loc[h].idxmax() if tm.loc[h].sum() else None for h in range(24)],
            "minutes_by_hour": [r(v) for v in tagged.groupby("hour")["minutes"].sum().reindex(range(24), fill_value=0)]}


# ---------------------------------------------------------------- 7: mood extremes
def extremes(df):
    tagged = df[df["tagged"]]
    if tagged.empty:
        return None
    daily_min = tagged.groupby("date")["minutes"].sum()
    eligible = daily_min[daily_min >= config.MIN_DAY_MINUTES].index
    sub = tagged[tagged["date"].isin(eligible)]
    # day score for a mood = the share of that day's minutes spent in it (0 to 1)
    w = pd.DataFrame({m: sub[f"share_{m}"] * sub["minutes"] for m in MOODS})
    score = w.groupby(sub["date"]).sum().div(daily_min.loc[eligible], axis=0)

    def day_card(date, mood):
        d = sub[sub["date"] == date]
        return {"date": str(date), "score": r(score.loc[date, mood]), "minutes": r(daily_min[date], 0),
                "tracks": top_list(d, ["track", "artist"], 8)}

    out = {"overall": {m: day_card(score[m].idxmax(), m) for m in MOODS}, "by_year": {}}
    years = pd.Series(pd.to_datetime(score.index).year, index=score.index)
    for y in sorted(years.unique()):
        s = score[years == y]
        out["by_year"][int(y)] = {m: {"date": str(s[m].idxmax()), "score": r(s[m].max())} for m in MOODS}
    # most volatile day: biggest spread of valence across the day's songs (minutes-weighted std)
    def wstd(g):
        v, wt = g["valence"], g["minutes"]
        mu = (v * wt).sum() / wt.sum()
        return np.sqrt(((v - mu) ** 2 * wt).sum() / wt.sum())
    vol = sub.groupby("date")[["valence", "minutes"]].apply(wstd)
    vd = vol.idxmax()
    out["volatile"] = {"date": str(vd), "spread": r(vol.max(), 2), "minutes": r(daily_min[vd], 0),
                       "tracks": top_list(sub[sub["date"] == vd], ["track", "artist"], 8)}
    out["min_minutes"] = config.MIN_DAY_MINUTES
    return out


# ---------------------------------------------------------------- 8: theme timeline
def theme_timeline(df):
    tm = theme_minutes(df[df["tagged"]], "month").sort_index()
    top = tm.sum().nlargest(10).index
    tm["other"] = tm.drop(columns=top).sum(axis=1)
    tm = tm[list(top) + ["other"]]
    # example songs per theme: your most-played songs about it, each song's minutes split across
    # its themes (like the chart), so songs that are mostly about the theme come first
    songs = df[df["tagged"] & (df["themes"].map(len) > 0)].groupby(["track", "artist"]).agg(
        minutes=("minutes", "sum"), themes=("themes", "first")).reset_index()
    songs["share"] = songs["minutes"] / songs["themes"].map(len)
    examples = {}
    for t in top:
        hit = songs[songs["themes"].map(lambda ts: t in ts)].nlargest(8, "share")
        examples[t] = [{"track": x.track, "artist": x.artist, "minutes": r(x.minutes)} for x in hit.itertuples()]
    return {"months": tm.index.tolist(), "themes": list(tm.columns),
            "series": {t: [r(v) for v in tm[t]] for t in tm.columns}, "examples": examples}


# ---------------------------------------------------------------- 10: top artists / songs + bump chart
def tops(df):
    out = {"all": {"artists": top_list(df, "artist"), "songs": top_list(df, ["track", "artist"])}}
    for y, sub in df.groupby("year"):
        out[int(y)] = {"artists": top_list(sub, "artist"), "songs": top_list(sub, ["track", "artist"])}
    top_artists = df.groupby("artist")["minutes"].sum().nlargest(8).index
    monthly = df.pivot_table(index="month", columns="artist", values="minutes", aggfunc="sum", fill_value=0)
    ranks = monthly.rank(axis=1, ascending=False, method="first")
    bump = {a: [int(v) if v <= 15 and monthly.loc[m, a] > 0 else None
                for m, v in ranks[a].items()] for a in top_artists}
    out["bump"] = {"months": monthly.index.tolist(), "ranks": bump}
    from .artist_images import add_images      # Spotify profile pictures for the top artists
    add_images(df, out)
    return out


# ---------------------------------------------------------------- 11, 12: skips + fallen favorites
def skips(df):
    g = df.groupby(["track", "artist"]).agg(plays=("skipped", "size"), skips=("skipped", "sum"))
    g["rate"] = g["skips"] / g["plays"]
    g = g.reset_index()
    rows = lambda x: [{"track": a.track, "artist": a.artist, "plays": int(a.plays), "skips": int(a.skips),
                       "rate": r(a.rate, 3)} for a in x.itertuples()]
    enough = g[g["plays"] >= config.MIN_PLAYS_SKIP_RATE]
    love_hate = enough[(enough["rate"] >= 0.35) & (enough["plays"] >= enough["plays"].quantile(0.9))]
    sk = df[df["skipped"]]
    return {
        "most_skipped": rows(g.nlargest(10, "skips")),
        "highest_rate": rows(enough.nlargest(10, "rate")),
        "love_hate": rows(love_hate.sort_values("plays", ascending=False).head(10)),
        "avg_seconds_before_skip": r(sk["ms_played"].median() / 1000, 0) if len(sk) else None,
        "skip_rate_overall": r(df["skipped"].mean(), 3),
        "skip_rate_by_year": {int(y): r(s["skipped"].mean(), 3) for y, s in df.groupby("year")},
        # each year's most skipped song (skips within that year only)
        "most_skipped_by_year": {int(y): rows(s.groupby(["track", "artist"]).agg(plays=("skipped", "size"), skips=("skipped", "sum"))
                                               .assign(rate=lambda x: x["skips"] / x["plays"]).reset_index().nlargest(1, "skips"))[0]
                                 for y, s in df.groupby("year") if s["skipped"].any()},
    }


def fallen_favorites(df):
    out = []
    for (track, artist), sub in df.groupby(["track", "artist"]):
        if len(sub) < config.MIN_PLAYS_FALLEN:
            continue
        n = len(sub)
        k = max(5, int(n * 0.3))
        early, late = sub["skipped"].iloc[:k].mean(), sub["skipped"].iloc[-k:].mean()
        if early > 0.3 or late - early < 0.3:   # must start loved and end skipped
            continue
        roll = sub["skipped"].rolling(5, min_periods=5).mean()
        crossed = roll[roll >= 0.5]
        burn = crossed.index[0] if len(crossed) else None
        # last time it played all the way through
        full = sub[sub["reason_end"] == "trackdone"]
        idx = np.linspace(0, n - 1, min(n, 30)).astype(int)
        out.append({
            "track": track, "artist": artist, "plays": n, "early_rate": r(early, 2), "late_rate": r(late, 2),
            "jump": r(late - early, 2), "first_play": str(sub["date"].iloc[0]),
            "burnout_date": str(sub.loc[burn, "date"]) if burn is not None else None,
            "burnout_days": int((sub.loc[burn, "local_time"] - sub["local_time"].iloc[0]).days) if burn is not None else None,
            "last_full_play": str(full["date"].iloc[-1]) if len(full) else None,
            "curve": [r(v, 2) for v in roll.bfill().iloc[idx]],
        })
    return sorted(out, key=lambda x: (-x["jump"], -x["plays"]))[:10]


# ---------------------------------------------------------------- 13: year vs year
def jsd(p, q):
    """Jensen-Shannon distance between two distributions: 0 = identical, 1 = nothing in common."""
    p, q = np.asarray(p, float), np.asarray(q, float)
    p, q = p / (p.sum() or 1), q / (q.sum() or 1)
    m = (p + q) / 2
    kl = lambda a, b: np.sum(np.where(a > 0, a * np.log2(np.where(a > 0, a, 1) / np.where(b > 0, b, 1)), 0))
    return float(np.sqrt(max(0.0, (kl(p, m) + kl(q, m)) / 2)))


def year_vs_year(df):
    per_year = df.groupby("year")["minutes"].sum()
    years = sorted(int(y) for y, m in per_year.items() if m >= config.MIN_YEAR_MINUTES)
    df = df[df["year"].isin(years)]
    tagged = df[df["tagged"]]
    artists = df.pivot_table(index="year", columns="artist", values="minutes", aggfunc="sum", fill_value=0)
    moods = mood_minutes(tagged, "year").reindex(years, fill_value=0)
    themes = theme_minutes(tagged, "year").reindex(years, fill_value=0)

    def dist(a, b):
        parts = {"artists": jsd(artists.loc[a], artists.loc[b]),
                 "moods": jsd(moods.loc[a], moods.loc[b]), "themes": jsd(themes.loc[a], themes.loc[b])}
        parts["overall"] = float(np.mean(list(parts.values())))
        return {k: r(v, 3) for k, v in parts.items()}

    matrix = [[dist(a, b)["overall"] for b in years] for a in years]
    pairs = [(a, b, dist(a, b)) for i, a in enumerate(years) for b in years[i + 1:]]

    def drivers(a, b):
        delta = (artists.loc[b] / artists.loc[b].sum()) - (artists.loc[a] / artists.loc[a].sum())
        md = (moods.loc[b] / (moods.loc[b].sum() or 1)) - (moods.loc[a] / (moods.loc[a].sum() or 1))
        return {"artists_up": delta.nlargest(4).index.tolist(),
                "artists_down": delta.nsmallest(4).index.tolist(),
                "moods_up": [m for m in md.nlargest(2).index if md[m] > 0],
                "moods_down": [m for m in md.nsmallest(2).index if md[m] < 0]}

    consecutive = [{"from": a, "to": b, **dist(a, b), "drivers": drivers(a, b)}
                   for a, b in zip(years, years[1:])]
    carry = {}
    for a, b in zip(years, years[1:]):
        seen = set(df.loc[df["year"] <= a, "artist"])
        sub = df[df["year"] == b]
        carry[b] = r(sub.loc[sub["artist"].isin(seen), "minutes"].sum() / sub["minutes"].sum(), 3)
    out = {"years": years, "matrix": matrix, "consecutive": consecutive, "carryover": carry}
    if pairs:
        far = max(pairs, key=lambda p: p[2]["overall"])
        near = min(pairs, key=lambda p: p[2]["overall"])
        out["most_different"] = {"a": far[0], "b": far[1], **far[2], "drivers": drivers(far[0], far[1])}
        out["most_similar"] = {"a": near[0], "b": near[1], **near[2]}
        out["biggest_shift"] = max(consecutive, key=lambda c: c["overall"])
    return out


# ---------------------------------------------------------------- 14: where you listened
def locations(df):
    tagged = df[df["tagged"]]
    home = df.groupby("country")["minutes"].sum().idxmax()
    countries = []
    for c, sub in df.groupby("country"):
        name, lat, lon = config.COUNTRY_INFO.get(c, (c, None, None))
        tsub = tagged[tagged["country"] == c]
        countries.append({
            "code": c, "name": name, "lat": lat, "lon": lon, "minutes": r(sub["minutes"].sum(), 0),
            "plays": len(sub), "days": int(sub["date"].nunique()),
            "first": str(sub["date"].min()), "last": str(sub["date"].max()),
            "top_artist": sub.groupby("artist")["minutes"].sum().idxmax(),
            "top_song": "{} by {}".format(*sub.groupby(["track", "artist"])["minutes"].sum().idxmax()),
            "dominant_mood": top_mood(mood_mix(tsub)) if len(tsub) else None,
            "by_year": {int(y): r(v, 0) for y, v in sub.groupby("year")["minutes"].sum().items()},
        })
    cities = []
    if df["city"].notna().any():
        for (city, c), sub in df[df["city"].notna()].groupby(["city", "country"]):
            cities.append({"city": city, "country": c, "lat": r(sub["lat"].median(), 3),
                           "lon": r(sub["lon"].median(), 3), "minutes": r(sub["minutes"].sum(), 0),
                           "days": int(sub["date"].nunique()),
                           "top_artist": sub.groupby("artist")["minutes"].sum().idxmax(),
                           "by_year": {int(y): r(v, 0) for y, v in sub.groupby("year")["minutes"].sum().items()}})
        cities = sorted(cities, key=lambda x: -x["minutes"])[:60]
    # Trips: runs of consecutive listening days spent in a non-home country.
    day_country = df.groupby("date")["country"].agg(lambda s: s.value_counts().index[0])
    trips, cur = [], None
    for d, c in day_country.items():
        if c != home and cur and cur["code"] == c and (pd.Timestamp(d) - pd.Timestamp(cur["end"])).days <= 3:
            cur["end"] = str(d)
        elif c != home:
            if cur:
                trips.append(cur)
            cur = {"code": c, "name": config.COUNTRY_INFO.get(c, (c,))[0], "start": str(d), "end": str(d)}
        elif cur:
            trips.append(cur)
            cur = None
    if cur:
        trips.append(cur)
    for t in trips:
        sub = df[(df["country"] == t["code"]) & (df["date"].astype(str) >= t["start"]) & (df["date"].astype(str) <= t["end"])]
        t["days"] = (pd.Timestamp(t["end"]) - pd.Timestamp(t["start"])).days + 1
        t["minutes"] = r(sub["minutes"].sum(), 0)
        t["top_song"] = "{} by {}".format(*sub.groupby(["track", "artist"])["minutes"].sum().idxmax())
    return {"home": home, "countries": sorted(countries, key=lambda x: -x["minutes"]),
            "cities": cities, "trips": trips[-40:]}


# ---------------------------------------------------------------- eras: notes, photos, places
PHOTO_TYPES = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
NOTE_COLUMNS = ["photo_folder", "era_name", "start", "end", "lived_in", "caption", "photos_say_you_were_in",
                "spotify_says_you_were_in"]


def convert_heic(folder):
    """iPhone photos are often .HEIC, which browsers can't show. On a Mac, convert them to JPEG
    with the built-in `sips` tool (the originals are left alone)."""
    import shutil, subprocess
    if not shutil.which("sips"):
        return
    for f in folder.iterdir():
        if f.suffix.lower() == ".heic" and not f.with_suffix(".jpg").exists():
            subprocess.run(["sips", "-s", "format", "jpeg", str(f), "--out", str(f.with_suffix(".jpg"))],
                           capture_output=True)


def make_thumbs(folder, name):
    """Small copies (600px) of an era's photos in web/photos-thumbs/<same folder>/, same file names.
    The era page and the record labels load these; the originals are 2-9MB phone shots."""
    import shutil, subprocess
    if not shutil.which("sips"):
        return
    out = config.WEB_DIR / "photos-thumbs" / name
    out.mkdir(parents=True, exist_ok=True)
    for f in folder.iterdir():
        if f.suffix.lower() in PHOTO_TYPES and not (out / f.name).exists():
            subprocess.run(["sips", "-Z", "600", str(f), "--out", str(out / f.name)], capture_output=True)


def era_extras(df, eras):
    """Adds to every era: its photo folder and photos, where you lived (from era_notes.csv), and the
    countries Spotify saw you in. Creates the folders and the notes file the first time, and adds
    rows for new eras later without touching what you've already written."""
    import csv
    notes = {}
    if config.ERA_NOTES.exists():
        with open(config.ERA_NOTES, newline="", encoding="utf-8") as f:
            notes = {r["photo_folder"]: r for r in csv.DictReader(f)}
    config.PHOTOS_DIR.mkdir(exist_ok=True)
    rows = []
    for e in eras:
        folder = f"{e['start']}_to_{e['end']}"
        d = config.PHOTOS_DIR / folder
        d.mkdir(exist_ok=True)
        convert_heic(d)
        make_thumbs(d, folder)
        e["photo_folder"] = folder
        e["photos"] = sorted(f"photos/{folder}/{p.name}" for p in d.iterdir() if p.suffix.lower() in PHOTO_TYPES)
        sub = df[(df["date"].astype(str) >= e["start"]) & (df["date"].astype(str) <= e["end"])]
        cc = sub.groupby("country")["minutes"].sum().sort_values(ascending=False)
        e["countries"] = [config.COUNTRY_INFO.get(c, (c,))[0] for c in cc.index[:3]]
        note = notes.get(folder, {})
        e["lived_in"] = (note.get("lived_in") or "").strip()
        e["caption"] = (note.get("caption") or "").strip()
        e["places"] = (note.get("photos_say_you_were_in") or "").strip()
        rows.append({"photo_folder": folder, "era_name": e.get("name", ""), "start": e["start"], "end": e["end"],
                     "lived_in": e["lived_in"], "caption": e["caption"],
                     "photos_say_you_were_in": note.get("photos_say_you_were_in", ""),
                     "spotify_says_you_were_in": ", ".join(e["countries"])})
    # keep notes for eras that no longer exist (in case you change settings back), after the current ones
    rows += [r for k, r in notes.items() if k not in {x["photo_folder"] for x in rows}]
    with open(config.ERA_NOTES, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=NOTE_COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    with_photos = sum(1 for e in eras if e["photos"])
    print(f"  eras: {len(eras)} ({with_photos} with photos). Dates and photo folders:")
    for e in eras:
        print(f"    {e['start']} to {e['end']}  {e.get('name', ''):<30} web/photos/{e['photo_folder']}/  "
              f"({len(e['photos'])} photos)")
    print(f"  add where you lived in {config.ERA_NOTES.name}, drop pictures in the folders, rerun build")
    return eras


def with_covers(df, songs):
    """Adds "cover" ({src, glow}) to each song dict (track + artist)."""
    from .album_covers import song_cover
    for x in songs:
        x["cover"] = song_cover(df, x["track"], x["artist"])
    return songs


def run():
    df = load_plays_with_tags()
    eras = json.loads(config.ERAS_CACHE.read_text()) if config.ERAS_CACHE.exists() else {}
    if not eras:
        print("  note: no eras yet (run step 4); era screens will be empty")
    builders = {
        "overview": lambda: overview(df, eras), "years": lambda: year_cards(df, eras),
        "listening": lambda: when_you_listen(df), "calendar": lambda: calendar(df),
        "seasons": lambda: seasons(df), "mood_by_hour": lambda: mood_by_hour(df),
        "extremes": lambda: (lambda x: ([with_covers(df, x["overall"][m]["tracks"][:2]) for m in ("sad", "happy") if x.get("overall", {}).get(m)], x)[1])(extremes(df)), "theme_timeline": lambda: theme_timeline(df),
        "eras": lambda: __import__("wrapped.album_covers", fromlist=["x"]).era_covers(df, era_extras(df, eras.get("eras", []))), "tops": lambda: (lambda t: ([with_covers(df, v["songs"][:1]) for v in t.values() if isinstance(v, dict) and "songs" in v], t)[1])(tops(df)), "skips": lambda: (lambda k: {**k, "most_skipped": with_covers(df, k["most_skipped"][:3]) + k["most_skipped"][3:],
                                       "most_skipped_by_year": {y: with_covers(df, [v])[0] for y, v in k["most_skipped_by_year"].items()}})(skips(df)),
        "fallen": lambda: with_covers(df, fallen_favorites(df)[:3]), "yvy": lambda: year_vs_year(df),
        "locations": lambda: locations(df),
        "year_albums": lambda: __import__("wrapped.album_covers", fromlist=["x"]).year_albums(df),
        "covers": lambda: __import__("wrapped.album_covers", fromlist=["x"]).album_covers(df),   # record labels
        "identity": lambda: {"title": eras.get("identity_title", ""), "summary": eras.get("identity_summary", "")},
    }
    data = {"moods": MOODS, "mood_colors": config.MOOD_COLORS}
    for name, build in builders.items():
        try:
            data[name] = build()
        except Exception as e:                      # one broken screen shouldn't kill the rest
            print(f"  warning: '{name}' failed ({type(e).__name__}: {e})")
            data[name] = None
    config.DATA_JS.write_text("window.WRAPPED = " + json.dumps(data, default=str) + ";\n", encoding="utf-8")
    print(f"  wrote {config.DATA_JS} ({config.DATA_JS.stat().st_size / 1024:.0f} KB). Open web/index.html")
