"""
STEP 3b (optional): Research songs that have no lyrics, then tag them.

Run with:  python run.py tag --research-missing

WHICH SONGS: the ones LRCLIB marked "missing" (no lyrics found) or "instrumental".
WHAT'S DIFFERENT from step 3:
  * Claude also gets Anthropic's web search tool (runs on Anthropic's servers, no extra setup).
  * It may search up to RESEARCH_MAX_SEARCHES times per song for what the song is about and how it
    sounds: song-meaning pages, reviews, interviews. It is told not to quote lyrics.
  * Then it calls the same tag_song tool as step 3, so the tags have the exact same shape.
  * Tags are saved with basis="research". If the song already had a title-only ("metadata") tag,
    the new one replaces it (the tag loader keeps the last line written for each song).

COST: web search is billed per search ($10 per 1,000 at the time of writing) on top of tokens, and
search results add input tokens. Expect roughly 1-2 cents per song.

How the request loop works:
  1. Send the song with both tools available and tool_choice "auto" (forcing tag_song would stop
     Claude from searching first).
  2. Searches run server-side inside that same request. If the response comes back with
     stop_reason "pause_turn" (a long search turn), send it back unchanged to let it continue.
  3. Pull the tag_song call out of the final response. If Claude stopped without calling it,
     send one follow-up that forces tag_song.
"""
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd
from . import config
from .step2_lyrics import load_cache
from .step3_tag import SYSTEM_PROMPT, TAG_TOOL, parse_message

RESEARCH_MAX_SEARCHES = 2
RESEARCH_WORKERS = 4

RESEARCH_NOTE = """
No lyrics are available for this song. Before tagging, use web_search (at most two searches) to learn
what the song is about and how it sounds: song-meaning pages, reviews, interviews, or descriptions of
the track. Do not quote or reproduce any lyrics in your searches or your answer. If the track is
instrumental, judge its mood from descriptions of the music itself. Then call tag_song once."""


def research_one(client, row, status: str) -> tuple[dict, int]:
    kind = "an instrumental track" if status == "instrumental" else "a song whose lyrics weren't found"
    messages = [{"role": "user", "content": f"Title: {row.track}\nArtist: {row.artist}\n"
                                            f"Album: {row.album}\n\nThis is {kind}."}]
    params = {
        "model": config.RESEARCH_MODEL,
        "max_tokens": 1500,
        "system": SYSTEM_PROMPT + "\n" + RESEARCH_NOTE,
        "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": RESEARCH_MAX_SEARCHES},
                  TAG_TOOL],
        "tool_choice": {"type": "auto"},
    }
    searches = 0
    for _ in range(4):                         # a few rounds at most: search turns, then the tag call
        msg = client.messages.create(messages=messages, **params)
        stu = getattr(msg.usage, "server_tool_use", None)
        searches += getattr(stu, "web_search_requests", 0) or 0
        if any(b.type == "tool_use" and b.name == "tag_song" for b in msg.content):
            return parse_message(msg, row.track_uri, "research"), searches
        messages.append({"role": "assistant", "content": msg.content})
        if msg.stop_reason == "pause_turn":
            continue                           # let the paused search turn carry on
        # Claude finished without tagging: ask once more, this time requiring the tag tool.
        messages.append({"role": "user", "content": "Now record the tags with tag_song."})
        params["tool_choice"] = {"type": "tool", "name": "tag_song"}
    raise RuntimeError("no tag_song call after research")


def run(limit: int | None = None):
    import anthropic
    if not config.ANTHROPIC_API_KEY:
        raise SystemExit("ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example).")
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    tracks = pd.read_csv(config.TRACKS_FILE)
    lyrics = load_cache(config.LYRICS_CACHE)
    tags = load_cache(config.TAGS_CACHE)
    # songs whose lyrics lookup failed, that don't already have a research tag
    todo = tracks[tracks["track_uri"].map(lambda u: lyrics.get(u, {}).get("status") in ("missing", "instrumental")
                                          and tags.get(u, {}).get("basis") != "research")]
    if limit:
        todo = todo.head(limit)
    print(f"  {len(todo):,} songs without lyrics to research "
          f"(model {config.RESEARCH_MODEL}, up to {RESEARCH_MAX_SEARCHES} searches each)")
    if todo.empty:
        return

    ok = fail = total_searches = 0
    with open(config.TAGS_CACHE, "a", encoding="utf-8") as out, \
            ThreadPoolExecutor(max_workers=RESEARCH_WORKERS) as pool:
        futures = {pool.submit(research_one, client, r, lyrics[r.track_uri]["status"]): r for r in todo.itertuples()}
        for fut in as_completed(futures):
            row = futures[fut]
            try:
                rec, n = fut.result()
                out.write(json.dumps(rec) + "\n")
                out.flush()
                ok += 1
                total_searches += n
            except Exception as e:
                fail += 1
                print(f"  failed '{row.track}': {e}")
            if (ok + fail) % 10 == 0:
                print(f"  {ok + fail:,}/{len(todo):,} researched, {total_searches} searches so far")
    print(f"  done: {ok:,} tagged from research, {fail} failed, {total_searches} web searches "
          f"(about ${total_searches * 0.01:.2f} in search fees plus tokens). Rerun to retry failures.")
