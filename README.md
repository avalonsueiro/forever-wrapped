# Forever, Wrapped

A Spotify Wrapped for your entire listening history, not just one year, styled as a stack of vinyl
records. Python turns your Spotify export into one data file, with Claude tagging every song's mood
and themes, and a web page plays it back as a story of 19 pages. You can view all time or any single
year, and each era of your listening gets its own page with your photos from that time.

Everything runs on your own computer. Your listening history never leaves it, apart from song titles
sent to Claude for tagging and to LRCLIB for lyrics.

## What you need

- **Your Spotify history.** Request **Extended streaming history** at
  https://www.spotify.com/account/privacy/. Spotify emails it in a few days, sometimes up to 30.
  (The regular "Account data" export only covers one year and won't work.)
- **Python 3.10 or newer.** Check with `python3 --version`.
- **An Anthropic API key**, from https://console.anthropic.com (Settings > API Keys), with a few
  dollars of credit. Tagging costs about $1 per 750 songs in batch mode; most histories have 3,000 to
  10,000 songs, so expect $4 to $14. The tag step prints its estimate and asks before spending anything.

## Setup (once)

```bash
cd spotify-vinyl
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                 # then open .env and paste your Anthropic API key
```

Get an API key at https://console.anthropic.com (Settings > API Keys). The key lives only in
`.env`, which `.gitignore` keeps out of git. Never paste it into code.

## Practice run (no Spotify data, no API key, about 1 minute)

```bash
python run.py sample                 # fake 6 years of listening into data/raw/
python run.py all --mode mock        # every step, with fake lyrics and fake tags
open web/index.html                  # Windows: start web\index.html
```

Then practice the real API on a small slice of the fake data:

```bash
rm data/cache/tags.jsonl
python run.py tag --mode live --limit 20     # Claude tags 20 songs (they're fake, so it judges by title)
```

## Real run

1. Unzip the export Spotify emailed you.
2. Clear the practice data: `rm -rf data/raw/* data/cache/* data/out/*`
3. Put every `Streaming_History_Audio_*.json` file from it in `data/raw/`.
4. Run the steps one at a time so you can look at each output:

```bash
python run.py load                       # ~seconds
python run.py lyrics --limit 50          # try your top 50 first, then run without --limit
python run.py tag --mode live --limit 50 # check data/cache/tags.jsonl looks right
python run.py tag --mode batch           # the rest at half price; safe to Ctrl+C and rerun
python run.py eras
python run.py build
open web/index.html
```

Every step caches its results in `data/cache/`, so rerunning only does the missing work.

**Optional: cities on the map.** Download "IP to City Lite" (MMDB format) from
https://db-ip.com/db/download/ip-to-city-lite, unzip it, drop the `.mmdb` file in `data/raw/`,
and rerun `load` and `build`. The lookup happens on your computer; no IPs are sent anywhere.

## Things you can tune

| Where | What |
|---|---|
| `wrapped/config.py` `MOODS`, `THEMES` | the tag vocabulary Claude chooses from |
| `wrapped/config.py` `COUNTRY_TZ` | time zone per country for places you've lived |
| `wrapped/config.py` thresholds | skip definition, session gap, min minutes for mood extremes, era similarity |
| `.env` `TAG_MODEL`, `WRITER_MODEL` | which Claude models do the tagging and the naming |
| `web/slides/` | one file per page; `web/slides/README.md` explains how a page is put together |

See `HOW_IT_WORKS.md` for a walkthrough of the whole pipeline.

## Photos on the era pages (optional)

On a Mac, the photos step reads your Photos library directly (it asks for permission the first time):

```bash
python run.py photos
```

On any computer, point it at a folder of photos instead. It reads the date and location saved inside
each photo, so phone photos work best. iPhone `.HEIC` files are fine.

```bash
python run.py photos --folder ~/Pictures/export
```

Either way it picks up to 6 photos per era, works out where you were from their locations, and
rebuilds the site. You can also drop pictures straight into the era folders in `web/photos/` and run
`python run.py build`.

## Fixing a song's mood

If Claude got a song wrong, copy `mood_overrides.example.csv` to `mood_overrides.csv`, add a line
like `Song Title,Artist,sad`, and run `python run.py build`.

## Privacy

`.gitignore` keeps your history, caches, photos, album covers, `.env` and `era_notes.csv` out of git,
so forking and pushing this repo won't publish your listening. The finished site (`web/` after a
build) does contain it, so think before putting that folder online.
