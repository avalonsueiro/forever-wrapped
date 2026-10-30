"""
STEP 4: Find your "eras" and have Claude name them.

INPUT : plays + tags
OUTPUT: data/cache/eras.json  (eras with names, a title per year, and the closing summary)

An era is a stretch where you listened to something far more than you usually do: a song, an artist,
a kind of song (theme) or a mood. It lasts exactly as long as that listening stayed out of the
ordinary. There is no length limit: a song obsession is usually a few weeks, an artist or a sad-songs
phase can run for months. Eras can overlap, and ordinary stretches belong to no era.
No AI is involved in finding them:

  1. Everything is counted per week, smoothed over 3 weeks so one big day doesn't make a spike.
  2. Your "usual" for each song, artist, theme and mood is its MEDIAN weekly share of your listening,
     so a long obsession doesn't raise its own baseline.
  3. A burst STARTS when it jumps well above usual:
       * song:   at least 5% of your listening and 3x its usual share
       * artist: at least 12% of your listening and 1.8x its usual share
       * theme:  6+ points above its usual share and 1.35x it    (e.g. far more heartbreak songs)
       * mood:   5+ points above its usual share and 1.25x it
     and it KEEPS GOING for as long as it stays at least halfway to that level. Dips of up to 2 weeks
     (a trip, a busy stretch) don't end it. So the era ends when the listening actually fades.
  4. Strength = how far above usual it ran, added up over its weeks. Bursts stronger than
     ERA_SPIKE_QUANTILE of all bursts start an era.
  5. Related bursts become one era: a song and its artist, or any two bursts that started and ended
     at about the same time (they share 50%+ of their combined weeks). A song spike that sits inside
     a longer, unrelated era (say a pop song during a months-long folk phase) stays its own era.
  6. Listening amount: each era's minutes per week vs the 26 weeks before it. Surges rank higher.
  7. The strongest MAX_ERAS are kept, in date order.

Then ONE call to Claude receives each era's drivers and stats (no lyrics) and returns a short name +
tagline for each era, a title for each year, and an overall "listening identity".
"""
import json
import numpy as np
import pandas as pd
from . import config
from .common import load_plays_with_tags, mood_minutes, theme_minutes

SMOOTH_WEEKS = 3
ACTIVE_WEEK_MINUTES = 60      # weeks with less listening than this can't start a burst
MIN_BURST_WEEKS = 2
MAX_DIP_WEEKS = 2             # a burst survives a dip this long
STAY_FRACTION = 0.5           # a burst continues while at least this far from usual to its start level
MIN_SEED_STRENGTH = 0.5       # extra share x weeks needed to start an era (0.5 = +25 points for 2 weeks)
SAME_TIME = 0.5               # bursts sharing this much of their combined weeks belong together
MAX_ERAS = 30
KINDS = {   # where a burst starts, per kind of signal (see the docstring)
    "song":   dict(min_share=0.05, min_ratio=3.0, min_excess=0.0, weight=1.0),
    "artist": dict(min_share=0.12, min_ratio=1.8, min_excess=0.0, weight=1.0),
    "theme":  dict(min_share=0.0, min_ratio=1.35, min_excess=0.06, weight=0.8),
    "mood":   dict(min_share=0.0, min_ratio=1.25, min_excess=0.05, weight=0.8),
}


def weekly_tables(df):
    """Minutes per week for every song, artist, mood and theme (smoothed), plus totals."""
    df = df.assign(week=df["local_time"].dt.to_period("W-SUN").dt.start_time)
    weeks = pd.date_range(df["week"].min(), df["week"].max(), freq="7D")
    smooth = lambda t: t.reindex(weeks, fill_value=0).rolling(SMOOTH_WEEKS, center=True, min_periods=1).mean()
    piv = lambda col: smooth(df.pivot_table(index="week", columns=col, values="minutes", aggfunc="sum", fill_value=0))
    tables = {"song": piv("track_uri"), "artist": piv("artist")}
    total = smooth(df.groupby("week")["minutes"].sum())
    tagged = df[df["tagged"]]
    tagged_total = smooth(tagged.groupby("week")["minutes"].sum()) if len(tagged) else total * 0
    if len(tagged):
        tables["mood"] = smooth(pd.DataFrame({m: (tagged[f"share_{m}"] * tagged["minutes"]).groupby(tagged["week"]).sum()
                                              for m in config.MOODS}))
        th = theme_minutes(tagged, "week")
        if len(th.columns):
            tables["theme"] = smooth(th)
    return df, weeks, tables, total, tagged_total


def hysteresis_runs(start_ok, stay_ok):
    """Runs that begin where start_ok is true and continue while stay_ok is true, allowing dips of
    up to MAX_DIP_WEEKS. Returns (first, last) week indexes, trimmed to weeks that were stay_ok."""
    out, i, n = [], 0, len(start_ok)
    while i < n:
        if not start_ok[i]:
            i += 1
            continue
        a = i
        while a > 0 and stay_ok[a - 1]:          # it was already building up before it crossed the line
            a -= 1
        z, dip, j = i, 0, i + 1
        while j < n:
            if stay_ok[j]:
                z, dip = j, 0
            else:
                dip += 1
                if dip > MAX_DIP_WEEKS:
                    break
            j += 1
        if z - a + 1 >= MIN_BURST_WEEKS:
            out.append((a, z))
        i = z + 1
    return out


def find_bursts(tables, total, tagged_total):
    bursts = []
    for kind, table in tables.items():
        rule = KINDS[kind]
        denom = tagged_total if kind in ("mood", "theme") else total
        active = (denom >= ACTIVE_WEEK_MINUTES).values
        if not active.any():
            continue
        share = table.div(denom.replace(0, np.nan), axis=0).fillna(0)
        usual = share[active].median()
        start = np.maximum(np.maximum(rule["min_share"], usual * rule["min_ratio"]), usual + rule["min_excess"])
        stay = usual + STAY_FRACTION * (start - usual)
        start_ok = share.ge(start, axis=1) & active[:, None]
        stay_ok = share.ge(stay, axis=1)
        for key in start_ok.columns[start_ok.any().values]:
            col, u = share[key].values, usual[key]
            for a, z in hysteresis_runs(start_ok[key].values, stay_ok[key].values):
                extra = np.clip(col[a:z + 1] - u, 0, None)
                bursts.append({"kind": kind, "key": key, "a": a, "z": z,
                               "extra_minutes": float((extra * denom.values[a:z + 1]).sum()),
                               "score": float(extra.sum()) * rule["weight"], "peak": float(col[a:z + 1].max()),
                               "lift": float(col[a:z + 1].mean() / u) if u > 0 else 99.0})
    return bursts


def overlap(a1, z1, a2, z2):
    return max(0, min(z1, z2) - max(a1, a2) + 1)


def same_time(b, e):
    """Share of the combined weeks that both cover (1 = identical span)."""
    inter = overlap(b["a"], b["z"], e["a"], e["z"])
    union = max(b["z"], e["z"]) - min(b["a"], e["a"]) + 1
    return inter / union


def related(b, e, song_artist):
    """A song and its own artist belong together if they overlap at all in time."""
    if not overlap(b["a"], b["z"], e["a"], e["z"]):
        return False
    for m in e["members"]:
        pair = {(b["kind"], b["key"]), (m["kind"], m["key"])}
        kinds = {k for k, _ in pair}
        if kinds == {"song", "artist"}:
            song = next(k for kk, k in pair if kk == "song")
            artist = next(k for kk, k in pair if kk == "artist")
            if song_artist.get(song) == artist:
                return True
    return False


def find_eras(df):
    df, weeks, tables, total, tagged_total = weekly_tables(df)
    song_artist = df.drop_duplicates("track_uri").set_index("track_uri")["artist"].to_dict()
    bursts = sorted(find_bursts(tables, total, tagged_total), key=lambda b: -b["score"])
    if not bursts:
        return df, weeks, []
    seed_cut = max(np.quantile([b["score"] for b in bursts], getattr(config, "ERA_SPIKE_QUANTILE", 0.6)), MIN_SEED_STRENGTH)
    eras = []
    for b in bursts:                                   # strongest first, so seeds define the eras
        home = max(eras, key=lambda e: same_time(b, e), default=None)
        joins = home and (same_time(b, home) >= SAME_TIME or related(b, home, song_artist))
        if not joins:
            home = next((e for e in eras if related(b, e, song_artist)), None)
            joins = home is not None
        if joins:
            home["members"].append(b)                  # the era keeps its seed's dates
        elif b["score"] >= seed_cut:
            eras.append({"a": b["a"], "z": b["z"], "members": [b]})

    # listening amount: compare each era with the 26 weeks before it
    tv = total.values
    for e in eras:
        during = tv[e["a"]:e["z"] + 1].mean()
        before = tv[max(0, e["a"] - 26):e["a"]]
        before = before[before >= ACTIVE_WEEK_MINUTES]
        ref = np.median(before) if len(before) else np.median(tv[tv >= ACTIVE_WEEK_MINUTES])
        e["activity_lift"] = float(during / ref) if ref else 1.0
        e["score"] = sum(m["score"] for m in e["members"]) * (1 + 0.25 * min(max(e["activity_lift"] - 1, 0), 2))
    eras = sorted(eras, key=lambda e: -e["score"])[:MAX_ERAS]
    return df, weeks, sorted(eras, key=lambda e: e["a"])


def driver_text(b, names):
    """What set an era off, in plain words (shown on the era page)."""
    if b["kind"] == "song":
        return f"{names.loc[b['key'], 'track']} on repeat"
    if b["kind"] == "artist":
        return f"lots of {b['key']}"
    if b["kind"] == "theme":
        return f"songs about {b['key']}"
    return f"more {b['key']} songs than usual"


def lift_text(lift):
    """How much more or less you listened than usual, e.g. 0.4 -> 'less than half as much as usual'."""
    if lift >= 2.4:
        return f"you listened {lift:.1f} times as much as usual"
    if lift >= 1.8:
        return "you listened about twice as much as usual"
    if lift >= 1.5:
        return "you listened half again as much as usual"
    if lift < 0.45:
        return "you listened less than half as much as usual"
    return "you listened about half as much as usual"


def describe(sub):
    moods = mood_minutes(sub, lambda _: 0).sum().sort_values(ascending=False) if len(sub) else pd.Series(dtype=float)
    themes = theme_minutes(sub.assign(_k=0), "_k").sum().sort_values(ascending=False) if sub["tagged"].any() else pd.Series(dtype=float)
    val = sub.loc[sub["valence"].notna()]
    return {
        "minutes": round(sub["minutes"].sum()),
        "top_moods": list(moods.index[:3]) if moods.sum() else [],
        "top_themes": list(themes.index[:3]),
        "top_artists": sub.groupby("artist")["minutes"].sum().nlargest(5).index.tolist(),
        "top_songs": [f"{t} by {a}" for (t, a) in sub.groupby(["track", "artist"])["minutes"].sum().nlargest(5).index],
        "avg_valence": round(float((val["valence"] * val["minutes"]).sum() / max(val["minutes"].sum(), 1)), 2) if len(val) else None,
    }


def build_eras(df):
    df, weeks, found = find_eras(df)
    names = df.drop_duplicates("track_uri").set_index("track_uri")[["track", "artist"]]
    out = []
    for e in found:
        start, end = weeks[e["a"]], weeks[e["z"]] + pd.Timedelta(days=6)
        sub = df[(df["local_time"] >= start) & (df["local_time"] < end + pd.Timedelta(days=1))]
        members = sorted(e["members"], key=lambda b: -b["score"])
        drivers, seen = [], set()
        for b in members:
            t = driver_text(b, names)
            if t not in seen:
                seen.add(t); drivers.append(t)
        lift = e["activity_lift"]
        if lift >= 1.5 or lift <= 0.6:
            drivers.append(lift_text(lift))
        out.append({"start": str(start.date()), "end": str(end.date()), "weeks": int(e["z"] - e["a"] + 1),
                    "trigger": drivers[0], "drivers": drivers[:4], "activity_lift": round(lift, 2),
                    "strength": round(e["score"]), **describe(sub)})
    return df, out


NAMING_TOOL = {
    "name": "name_eras",
    "description": "Return names for each era, a title per year, and an overall summary.",
    "input_schema": {
        "type": "object",
        "properties": {
            "eras": {"type": "array", "items": {"type": "object", "properties": {
                "index": {"type": "integer"},
                "name": {"type": "string", "description": "2-4 words: a real song title, artist or genre from the era plus one plain word, e.g. 'Sports Car Summer'"},
                "tagline": {"type": "string", "description": "one plain sentence, under 14 words"}},
                "required": ["index", "name", "tagline"]}},
            "years": {"type": "array", "items": {"type": "object", "properties": {
                "year": {"type": "integer"}, "title": {"type": "string", "description": "2-5 words"}},
                "required": ["year", "title"]}},
            "identity_title": {"type": "string", "description": "2-5 words"},
            "identity_summary": {"type": "string", "description": "1-2 short sentences, second person"},
        },
        "required": ["eras", "years", "identity_title", "identity_summary"],
    },
}


def ask_for_names(client, anthropic, brief) -> dict:
    """One Claude call that returns the era names. We first try to *force* the name_eras tool.
    Some models don't allow forcing a tool (the API answers 400: 'tool_choice ... not supported'),
    so in that case we let the model choose ("auto") and tell it to use the tool, asking once more
    if it replies with plain text instead."""
    params = dict(
        model=config.WRITER_MODEL, max_tokens=4000,
        system=("You name chapters of one person's music-listening history. Each era is a short spike "
                "where their listening departed from normal; its 'drivers' say what spiked (a song on "
                "repeat, an artist, a theme or mood, listening amount). Eras can overlap and are not "
                "continuous, so name each one on its own, and do not invent facts about the person's life. "
                "Every era name follows one format: something the person would recognize at a glance "
                "from that era (a song title, an artist's name or a kind of music, written the way it "
                "appears in the data, not a fragment of it) plus one plain word for how it felt or "
                "when it was. Examples of the format: 'Stick Season Marathon', 'Sports Car Summer', "
                "'Original Cast Fever', 'Too Sweet Summer', 'Dive Into Olivia'. 2 to 4 words. No band "
                "trivia, no inside jokes, no puns on lyrics, no words that only make sense if you "
                "know the album. Vary the plain word across eras so they don't all end in a season. "
                "Write taglines, titles and the summary the way a friend would text "
                "them: plain everyday words, short, specific (a song, an artist, a month). Never "
                "list three things; name one or two. No flowery verbs (powered, fueled, anchored, "
                "swallowed, soaked, carried) and no stacked adjectives. No em dashes. "
                "Call the name_eras tool once."),
        tools=[NAMING_TOOL], tool_choice={"type": "tool", "name": "name_eras"},
    )
    messages = [{"role": "user", "content": json.dumps(brief, default=str)}]
    try:
        msg = client.messages.create(messages=messages, **params)
    except anthropic.BadRequestError as e:
        if "tool_choice" not in str(e):
            raise
        params["tool_choice"] = {"type": "auto"}
        msg = client.messages.create(messages=messages, **params)
    for _ in range(2):
        for b in msg.content:
            if b.type == "tool_use" and b.name == "name_eras":
                return b.input
        messages += [{"role": "assistant", "content": msg.content},
                     {"role": "user", "content": "Please record the names with the name_eras tool."}]
        msg = client.messages.create(messages=messages, **params)
    raise SystemExit("Claude didn't return era names. Try again, or set WRITER_MODEL in .env to another model.")


def mock_names(eras, years):
    return {
        "eras": [{"index": i, "name": f"Era {i + 1}", "tagline": "; ".join(e["drivers"])}
                 for i, e in enumerate(eras)],
        "years": [{"year": y, "title": f"Side {chr(65 + i)}"} for i, y in enumerate(years)],
        "identity_title": "The Whole Record",
        "identity_summary": "Mock summary. Run step 4 without --mode mock to have Claude write this.",
    }


def run(mode: str = "live", names_only: bool = False):
    df = load_plays_with_tags()
    if names_only and config.ERAS_CACHE.exists():
        # keep the eras you already have (photo folders and era_notes.csv are tied to their dates)
        # and only ask for new names
        eras = json.loads(config.ERAS_CACHE.read_text())["eras"]
    else:
        df, eras = build_eras(df)
    years = sorted(int(y) for y in df["year"].unique())
    tagged_note = "" if df["tagged"].any() else " (no tags yet, so themes and moods weren't used)"
    print(f"  found {len(eras)} eras across {len(years)} years{tagged_note}")

    if mode == "mock":
        names = mock_names(eras, years)
    else:
        import anthropic
        if not config.ANTHROPIC_API_KEY:
            raise SystemExit("ANTHROPIC_API_KEY is not set. Add it to .env or use --mode mock.")
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        per_year = {y: describe(df[df["year"] == y]) for y in years}
        # (old names are left out so they don't steer the new ones)
        brief = {"eras": [{"index": i, **{k: v for k, v in e.items() if k not in ("name", "tagline")}}
                          for i, e in enumerate(eras)], "years": per_year}
        names = ask_for_names(client, anthropic, brief)

    by_index = {e["index"]: e for e in names["eras"]}
    for i, e in enumerate(eras):
        e["name"] = by_index.get(i, {}).get("name", f"Era {i + 1}")
        e["tagline"] = by_index.get(i, {}).get("tagline", "")
    result = {"eras": eras,
              "year_titles": {str(y["year"]): y["title"] for y in names["years"]},
              "identity_title": names["identity_title"],
              "identity_summary": names["identity_summary"]}
    config.ERAS_CACHE.write_text(json.dumps(result, indent=2, default=str))
    for e in eras:
        print(f"  {e['start']} to {e['end']} ({e['weeks']} wk): {e['name']}  [{'; '.join(e['drivers'])}]")
