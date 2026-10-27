"""
STEP 3: Have Claude read each song's lyrics and tag it.

INPUT : data/out/tracks.csv + data/cache/lyrics.jsonl
OUTPUT: data/cache/tags.jsonl   one JSON line per song, e.g.
        {"track_uri": "...", "music_mood": "hyped", "lyrics_mood": "sad", "themes": ["heartbreak", "longing"],
         "valence": 3, "intensity": 6, "language": "en", "basis": "lyrics"}

The tag design:
  * ONE mood per song (music_mood), for how the song feels as a whole, sound and words together
  * a second one (lyrics_mood) only when the words feel clearly different from the music, like a
    bouncy pop song about a breakup. Otherwise it's null. No scores.
  * themes are PICKED from a fixed list (1-4 per song) -> cheap even with a long list

How we force clean JSON: we give Claude a single "tool" whose input schema IS our tag format and
require it to call that tool. The tool's input is then guaranteed to match the schema.

Three modes:
  live  : sends songs in parallel threads and saves results as they arrive (fast feedback)
  batch : submits everything to the Message Batches API (about half price, finishes within 24h,
          usually much sooner). Safe to Ctrl+C while waiting; rerun to pick up the same batch.
  mock  : no API calls. Fake but consistent tags, for practicing the pipeline without a key.

Songs with no lyrics (instrumental or not found) are tagged from title + artist only and marked
basis="metadata" so you can filter them out later if you want lyric-only results.
"""
import json
import time
import hashlib
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd
from . import config
from .step2_lyrics import load_cache

SYSTEM_PROMPT = f"""You tag songs for a personal music-listening analysis.
You will get a song's title, artist, and usually its lyrics.

Give the song ONE mood: how it feels to listen to, taking the music (tempo, melody, energy,
production, as you know the song or the artist's sound) and the lyrics together.
Only if the lyrics feel clearly different from the music (an upbeat, danceable track about
heartbreak; a gentle ballad about rage) also give lyrics_mood: the mood of the words alone. In that
case music_mood is the mood of the sound. Mild differences don't count: leave lyrics_mood null.
Instrumentals never get a lyrics_mood. If no lyrics are provided, judge from the title and artist.
Pick 1 to 4 themes, most central first, only from the allowed list.
valence: 1 = very negative/sad, 10 = very positive/happy. intensity: 1 = soft/still, 10 = explosive.
language: ISO 639-1 code of the lyrics (use "none" for instrumentals).
Never quote the lyrics back. Call the tag_song tool exactly once.

Allowed moods, and what each one means here:
- happy: joyful, cheerful, sunny, feel-good. Can be gentle or bouncy. Most upbeat, cheerful pop goes here.
- hyped: HIGH ENERGY, the adrenaline kind: loud, fast or hard-hitting, made to party, dance hard,
  work out or psych yourself up. Having a beat or a catchy chorus is not enough. A mid-tempo or
  slow song with a groove is not hyped (sexy R&B is romantic, cheerful pop is happy).
- romantic: love, desire, crushes, intimacy, devotion, including slow or sensual songs.
- sad: grief, heartbreak, hurt, crying-in-your-room songs.
- lonely: isolation, missing someone, feeling unseen or left behind.
- nostalgic: looking back at the past, home, childhood, growing up, memories.
- calm: peaceful, soft, still, relaxing, background music.
- anxious: restless, tense, overthinking, uneasy, spiraling.
- angry: rage, spite, defiance, bitterness, getting even.
- hopeful: looking forward, healing, resilience, things getting better.
Ask what the song mainly makes you feel, not just how fast it is.
Allowed themes: {", ".join(config.THEMES)}"""

TAG_TOOL = {
    "name": "tag_song",
    "description": "Record the tags for one song.",
    "strict": True,                    # the moods must come from the list (it once answered "melancholic")
    "input_schema": {
        "type": "object",
        "properties": {
            "music_mood": {"type": "string", "enum": config.MOODS},
            "lyrics_mood": {"anyOf": [{"type": "string", "enum": config.MOODS}, {"type": "null"}],
                            "description": "Only when the lyrics feel clearly different from the music; otherwise null."},
            "themes": {"type": "array", "items": {"type": "string", "enum": config.THEMES},
                       "description": "1 to 4 themes, most central first"},
            "valence": {"type": "integer", "description": "1 to 10"},       # strict mode can't check ranges,
            "intensity": {"type": "integer", "description": "1 to 10"},     # so parse_message clamps them
            "language": {"type": "string"},
        },
        "required": ["music_mood", "lyrics_mood", "themes", "valence", "intensity", "language"],
        "additionalProperties": False,
    },
}


def build_request(row, lyric_row) -> dict:
    """The Messages API parameters for one song."""
    lyrics = (lyric_row or {}).get("lyrics", "")
    if lyrics:
        body = f"Title: {row.track}\nArtist: {row.artist}\n\nLyrics:\n{lyrics[:config.MAX_LYRIC_CHARS]}"
    else:
        status = (lyric_row or {}).get("status", "missing")
        note = "This track is instrumental." if status == "instrumental" else "Lyrics unavailable."
        body = f"Title: {row.track}\nArtist: {row.artist}\n\n{note}"
    return {
        "model": config.TAG_MODEL,
        "max_tokens": 400,
        # cache_control marks the long, identical system prompt for prompt caching,
        # so repeated calls reuse it instead of paying for it every time.
        "system": [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        "tools": [TAG_TOOL],
        "tool_choice": {"type": "tool", "name": "tag_song"},   # forces structured output
        "messages": [{"role": "user", "content": body}],
    }


def parse_message(msg, track_uri: str, basis: str) -> dict:
    for block in msg.content:
        if block.type == "tool_use":
            out = dict(block.input)
            out["themes"] = [t for t in out.get("themes", []) if t in config.THEMES][:4]
            for k in ("valence", "intensity"):
                out[k] = max(1, min(10, int(out.get(k) or 5)))
            if out.get("music_mood") not in config.MOODS:
                raise ValueError(f"mood not in the list: {out.get('music_mood')}")
            if out.get("lyrics_mood") not in config.MOODS or out["lyrics_mood"] == out["music_mood"]:
                out["lyrics_mood"] = None                        # same as the music (or unknown): just one mood
            return {"track_uri": track_uri, "basis": basis, **out}
    raise ValueError("no tool_use block in response")


def mock_tags(row, basis: str, truth: dict) -> dict:
    """Deterministic fake tags. If sample data is in use, follow its hidden 'true' mood so the
    charts show real-looking patterns; otherwise derive pseudo-random tags from the song name."""
    rng = random.Random(hashlib.md5(row.track_uri.encode()).hexdigest())
    main = truth.get(row.track_uri, {}).get("mood") or rng.choice(config.MOODS)
    second = rng.choice([m for m in config.MOODS if m != main]) if rng.random() < 0.15 else None
    pos = {"happy": 8, "hyped": 8, "hopeful": 7, "romantic": 7, "calm": 6, "nostalgic": 5,
           "anxious": 3, "lonely": 3, "angry": 3, "sad": 2}
    themes = truth.get(row.track_uri, {}).get("themes") or rng.sample(config.THEMES, 2)
    return {"track_uri": row.track_uri, "basis": basis, "music_mood": main, "lyrics_mood": second, "themes": themes,
            "valence": max(1, min(10, pos[main] + rng.randint(-1, 1))),
            "intensity": rng.randint(2, 9), "language": "en"}


# Rough cost per song on Haiku 4.5 ($1 / $5 per million input / output tokens): the prompt plus up to
# MAX_LYRIC_CHARS of lyrics is about 1,950 tokens in, the answer about 120 out. Batch is half price.
COST_PER_SONG = {"lyrics": 0.0026, "metadata": 0.0015}


def confirm_cost(todo_with_lyrics: int, todo_without: int, mode: str, assume_yes: bool) -> None:
    """Print what tagging will roughly cost and ask before spending anything."""
    cost = todo_with_lyrics * COST_PER_SONG["lyrics"] + todo_without * COST_PER_SONG["metadata"]
    if mode == "batch":
        cost /= 2
    note = "" if config.TAG_MODEL.startswith("claude-haiku-4-5") else f" (priced as Haiku 4.5; you set {config.TAG_MODEL})"
    print(f"  this will cost about ${cost:,.2f} on your Anthropic account{note}")
    if assume_yes or cost < 0.50:
        return
    import sys
    if not sys.stdin.isatty():
        raise SystemExit("  stopping: add --yes to run without being asked")
    try:
        answer = input("  go ahead? [y/N] ")
    except (EOFError, KeyboardInterrupt):
        answer = ""
    if answer.strip().lower() not in ("y", "yes"):
        raise SystemExit("  stopped, nothing was spent")


def run(mode: str = "live", limit: int | None = None, redo: list[str] | None = None, assume_yes: bool = False):
    """redo: moods to tag again, e.g. ["hyped"] after tightening what hyped means. Songs currently
    tagged with one of them are sent again (web-researched songs are left alone)."""
    tracks = pd.read_csv(config.TRACKS_FILE)
    if limit:
        tracks = tracks.head(limit)
    lyrics = load_cache(config.LYRICS_CACHE)
    done = load_cache(config.TAGS_CACHE)
    again = {u for u, t in done.items() if redo and t.get("music_mood") in redo and t.get("basis") != "research"}
    todo = tracks[~tracks["track_uri"].isin(done) | tracks["track_uri"].isin(again)]
    if again:
        print(f"  tagging {len(again):,} {'/'.join(redo)} songs again")
    with_lyrics = sum(1 for u in todo["track_uri"] if lyrics.get(u, {}).get("lyrics"))
    print(f"  {len(done):,} already tagged, {len(todo):,} to tag ({with_lyrics:,} with lyrics)")
    if todo.empty:
        return

    def basis_for(uri):
        return "lyrics" if lyrics.get(uri, {}).get("lyrics") else "metadata"

    out = open(config.TAGS_CACHE, "a", encoding="utf-8")
    write = lambda rec: (out.write(json.dumps(rec) + "\n"), out.flush())

    if mode == "mock":
        truth_file = config.RAW_DIR / "_sample_truth.json"
        truth = json.loads(truth_file.read_text()) if truth_file.exists() else {}
        for row in todo.itertuples():
            write(mock_tags(row, basis_for(row.track_uri), truth))
        print(f"  wrote {len(todo):,} mock tags")
        return

    import anthropic
    if not config.ANTHROPIC_API_KEY:
        raise SystemExit("ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) or use --mode mock.")
    confirm_cost(with_lyrics, len(todo) - with_lyrics, mode, assume_yes)
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    if mode == "live":
        def tag_one(row):
            req = build_request(row, lyrics.get(row.track_uri))
            msg = client.messages.create(**req)   # the SDK retries rate limits automatically
            return parse_message(msg, row.track_uri, basis_for(row.track_uri)), msg.usage

        ok = fail = in_tok = out_tok = 0
        with ThreadPoolExecutor(max_workers=config.TAG_CONCURRENCY) as pool:
            futures = {pool.submit(tag_one, r): r for r in todo.itertuples()}
            for fut in as_completed(futures):
                try:
                    rec, usage = fut.result()
                    write(rec)
                    ok += 1
                    in_tok += usage.input_tokens
                    out_tok += usage.output_tokens
                except Exception as e:
                    fail += 1
                    print(f"  failed '{futures[fut].track}': {e}")
                if (ok + fail) % 25 == 0:
                    print(f"  {ok + fail:,}/{len(todo):,} tagged ({fail} failed)")
        print(f"  done: {ok:,} tagged, {fail} failed. Tokens used: {in_tok:,} in / {out_tok:,} out "
              f"(not counting cached prompt reads). Rerun to retry failures.")
        return

    # ---- batch mode ----
    state_file = config.CACHE_DIR / "batch_state.json"
    if state_file.exists():
        state = json.loads(state_file.read_text())
        print(f"  resuming batch {state['batch_id']}")
    else:
        id_map, requests = {}, []
        for i, row in enumerate(todo.itertuples()):
            cid = f"s{i}"                                    # custom_id must be short and simple
            id_map[cid] = row.track_uri
            requests.append({"custom_id": cid, "params": build_request(row, lyrics.get(row.track_uri))})
        batch = client.messages.batches.create(requests=requests)
        state = {"batch_id": batch.id, "id_map": id_map}
        state_file.write_text(json.dumps(state))
        print(f"  submitted batch {batch.id} with {len(requests):,} songs")

    while True:
        b = client.messages.batches.retrieve(state["batch_id"])
        c = b.request_counts
        print(f"  status={b.processing_status}  processing={c.processing} succeeded={c.succeeded} "
              f"errored={c.errored}")
        if b.processing_status == "ended":
            break
        time.sleep(60)

    ok = 0
    for entry in client.messages.batches.results(state["batch_id"]):
        uri = state["id_map"][entry.custom_id]
        if entry.result.type == "succeeded":
            try:
                write(parse_message(entry.result.message, uri, basis_for(uri)))
                ok += 1
            except ValueError:
                pass
    state_file.unlink()
    print(f"  saved {ok:,} tags. Rerun (live or batch) to retry any that failed.")
