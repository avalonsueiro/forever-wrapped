"""Shared helper: join the per-song tags (step 3) back onto every play (step 1)."""
import json
import pandas as pd
from . import config


def song_moods(t: dict) -> dict:
    """A song's moods as {mood: 1 or 0}: its one mood, or two (music and lyrics) when they clash.
    Older tags scored every mood 0-10; those count as just their highest-scored mood."""
    picked = [t.get("music_mood"), t.get("lyrics_mood")]
    if not picked[0] and t.get("moods"):
        scores = t["moods"]
        picked = [max(config.MOODS, key=lambda m: scores.get(m) or 0)]
    picked = {m for m in picked if m in config.MOODS}
    return {m: (1 if m in picked else 0) for m in config.MOODS} if picked else {m: None for m in config.MOODS}


def load_tags() -> pd.DataFrame:
    rows = []
    if config.TAGS_CACHE.exists():
        for line in config.TAGS_CACHE.read_text(encoding="utf-8").splitlines():
            if line.strip():
                t = json.loads(line)
                flat = {"track_uri": t["track_uri"], "themes": t.get("themes", []),
                        "valence": t.get("valence"), "intensity": t.get("intensity"),
                        "language": t.get("language"), "basis": t.get("basis")}
                for m, v in song_moods(t).items():
                    flat[f"mood_{m}"] = v
                rows.append(flat)
    cols = ["track_uri", "themes", "valence", "intensity", "language", "basis"] + [f"mood_{m}" for m in config.MOODS]
    tags = pd.DataFrame(rows, columns=cols)
    if tags.empty:
        # No tags yet: everything still builds; mood and theme slides hide themselves.
        print("  note: no tags yet (step 3), so mood and theme slides will be skipped")
    return tags.drop_duplicates("track_uri", keep="last")


def apply_mood_overrides(df: pd.DataFrame) -> None:
    """Your own corrections in mood_overrides.csv (columns: track, artist, mood). The named mood
    becomes the song's only mood. Matches every version of
    the song by name, and leaves the tags Claude wrote (data/cache/tags.jsonl) untouched."""
    path = config.HOME / "mood_overrides.csv"
    if not path.exists():
        return
    for o in pd.read_csv(path).itertuples():
        mood = str(o.mood).strip().lower()
        if mood not in config.MOODS:
            print(f"  note: mood_overrides.csv: '{o.mood}' isn't one of {', '.join(config.MOODS)}")
            continue
        rows = (df["track"].str.lower() == str(o.track).lower()) & (df["artist"].str.lower() == str(o.artist).lower())
        if not rows.any():
            print(f"  note: mood_overrides.csv: no plays of '{o.track}' by {o.artist}")
            continue
        for m in config.MOODS:
            df.loc[rows, f"mood_{m}"] = 1 if m == mood else 0
        df.loc[rows, "tagged"] = True


def load_plays_with_tags() -> pd.DataFrame:
    plays = pd.read_pickle(config.PLAYS_FILE)
    tags = load_tags()
    df = plays.merge(tags, on="track_uri", how="left")
    df["tagged"] = df["valence"].notna()
    for c in ["valence", "intensity"] + [f"mood_{m}" for m in config.MOODS]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    apply_mood_overrides(df)
    # Each song's mood "share": 1.0 for its one mood, or 0.5 each when music and lyrics differ,
    # so every song contributes a total of 1.0. Multiplying by minutes later gives "mood-minutes".
    mood_cols = [f"mood_{m}" for m in config.MOODS]
    totals = df[mood_cols].sum(axis=1).astype(float).replace(0, float("nan"))
    for m in config.MOODS:
        df[f"share_{m}"] = (df[f"mood_{m}"].astype(float) / totals).fillna(0)
    df["themes"] = df["themes"].apply(lambda x: x if isinstance(x, list) else [])
    return df


def mood_minutes(df: pd.DataFrame, by) -> pd.DataFrame:
    """Minutes spent in each mood, grouped by `by`. Returns one column per mood."""
    w = pd.DataFrame({m: df[f"share_{m}"] * df["minutes"] for m in config.MOODS})
    key = df[by] if isinstance(by, str) else by
    return w.groupby(key).sum()


def theme_minutes(df: pd.DataFrame, by) -> pd.DataFrame:
    """Minutes per theme. A song with 3 themes splits its minutes three ways."""
    ex = df[["minutes", "themes"]].copy()
    ex["key"] = df[by] if isinstance(by, str) else list(zip(*[df[b] for b in by]))
    ex = ex[ex["themes"].map(len) > 0]
    ex["minutes"] = ex["minutes"] / ex["themes"].map(len)
    ex = ex.explode("themes")
    return ex.pivot_table(index="key", columns="themes", values="minutes", aggfunc="sum", fill_value=0)
