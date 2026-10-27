# Forever, Wrapped

A desktop "Spotify Wrapped" for your entire listening history, styled as a vinyl record.
Python crunches your Spotify export (plus lyrics and Claude's tags) into one data file; a
static web page plays it back as a Wrapped-style story of about 19 slides.

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

1. Request **Extended streaming history** at https://www.spotify.com/account/privacy/ (takes days to weeks).
2. Clear the practice data: `rm -rf data/raw/* data/cache/* data/out/*`
3. Unzip the export and put every `Streaming_History_Audio_*.json` file in `data/raw/`.
4. Run the steps one at a time so you can look at each output:

```bash
python run.py load                       # ~seconds
python run.py lyrics --limit 50          # try your top 50 first, then run without --limit
python run.py tag --mode live --limit 50 # check data/cache/tags.jsonl looks right
python run.py tag --mode batch           # the rest at ~half price; safe to Ctrl+C and rerun
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
| `web/app.js` | each slide is one function in `SLIDES`; colors are in `THEMES` |

See `HOW_IT_WORKS.md` for a walkthrough of the whole pipeline.

## Letting other people make their own (the upload server)

```
source .venv/bin/activate
python server/app.py          # then open http://127.0.0.1:8800
```

Someone drops in their Spotify export zip, optional photos, and their own Anthropic API key, and gets
their own Forever, Wrapped at a private link (plus a zip download). Their top 500 songs are tagged
from title and artist (no lyrics, about 10 minutes and $1 to $3 on their key). Each person's build runs
as its own process in `server/jobs/<id>/`; their key is only given to that process and never saved,
their uploaded files are removed once the build is done, and everything is deleted after 7 days.
It only listens on this Mac for now.

Testing without a key: `WRAPPED_TEST=1 python server/app.py`, then use the key
`sk-ant-test-0000000000000000000000` (fake moods and era names, no API calls).
