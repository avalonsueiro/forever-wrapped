# How Forever, Wrapped works

The project is a straight line of five steps. Each step reads the previous step's output from disk
and writes its own, so you can run, inspect and rerun any step on its own.

```
Spotify JSON ──► 1 load ──► plays.pkl + tracks.csv
                               │
                               ├─► 2 lyrics (LRCLIB) ──► lyrics.jsonl
                               │                              │
                               └──────────► 3 tag (Claude) ◄──┘ ──► tags.jsonl
                                                   │
                         4 eras (math, then Claude names them) ──► eras.json
                                                   │
                         5 build (all the chart math) ──► web/data.js
                                                   │
                         web/index.html + app.js draw the screens
```

## File map

```
run.py                     the command line: `python run.py <step>`
wrapped/config.py          every setting, path, threshold and the tag vocabulary
wrapped/step0_sample.py    fake data for practice
wrapped/step1_load.py      Spotify JSON -> clean table of plays
wrapped/step2_lyrics.py    lyrics from LRCLIB
wrapped/step3_tag.py       Claude tags each song
wrapped/common.py          joins tags onto plays; "mood minutes" and "theme minutes" helpers
wrapped/step4_eras.py      finds eras, Claude names them
wrapped/step5_build.py     one function per screen -> web/data.js
web/index.html             page shell and styles
web/app.js                 the slides, one function each (D3 for charts)
web/vendor/                D3, topojson and a world map, bundled so it works offline
data/raw/                  your Spotify files go here
data/cache/                lyrics, tags, eras (expensive to recreate, so kept)
data/out/                  plays.pkl, tracks.csv (cheap to recreate)
```

## Step 1: load (`step1_load.py`)

Spotify gives one JSON record per play. This step keeps songs (drops podcasts), and adds:

- **Local time.** Timestamps arrive in UTC. Each play is converted using the time zone of the
  country you streamed from (`conn_country`), so a 2 AM play in Madrid counts as 2 AM.
- **Skip flag.** `skipped == true`, or `reason_end == "fwdbtn"` (you pressed next), or under 30 seconds.
  Three signals because the `skipped` field is empty in older years.
- **Calendar columns**: date, year, month, hour, weekday, week of year, season.
- **Song length estimate**: the longest play that ended with `trackdone`. LRCLIB uses it to pick
  the right version of a song.

It also writes `tracks.csv`, one row per unique song, sorted by minutes. Steps 2 and 3 work on this
list, so a song you played 400 times is fetched and tagged once.

## Step 2: lyrics (`step2_lyrics.py`)

For each song it asks LRCLIB for an exact match (title, artist, album, duration), and if that fails,
searches and scores the candidates (artist match +10, title match +5, minus a point per 5 seconds of
length difference). Results are appended to `lyrics.jsonl` one line at a time, which is what makes it
resumable. It pauses between requests because LRCLIB asks clients to.

## Step 3: tagging (`step3_tag.py`)

This is the part that uses Claude. For each song it sends one request:

- **system prompt**: the rules and the allowed moods and themes. It's identical for every song, so it is
  marked for **prompt caching** and you mostly pay for it once.
- **user message**: title, artist, lyrics (cut at 3,500 characters).
- **a tool called `tag_song`** whose input schema *is* the tag format, plus `tool_choice` forcing Claude
  to call it. That's how the answer always comes back as valid JSON with the right fields.

Tag design: **one mood per song** (`music_mood`), for how the song feels as a whole, music and lyrics
together. Only when the lyrics feel clearly different from the music (an upbeat track about a
breakup) does it get a second, `lyrics_mood`; otherwise that's null. No scores. Plus 1-4 themes
**picked** from a list of 27. Claude can't hear the audio, so the music side comes from what it knows
about the song and the artist's sound. Older tags that scored all 10 moods count as their top mood.

Modes: `live` runs 8 requests at a time and saves as it goes; `batch` submits everything to the
Message Batches API (about half price, results within 24 hours); `mock` invents tags without the API.

## Step 3b: research songs without lyrics (`step3b_research.py`, optional)

`python run.py tag --research-missing` takes only the songs LRCLIB couldn't find lyrics for (or marked
instrumental), gives Claude the web search tool plus the same `tag_song` tool, and lets it look up what
the song is about (up to 2 searches) before tagging. Those tags are saved as `basis: "research"` and
replace any earlier title-only guess. Costs about 1-2 cents per song because searches are billed.

## How tags become charts (`common.py`)

Every play inherits its song's tags. Each song counts as 1.0 of its mood, or 0.5 of each when its
music and lyrics differ. Multiply by
minutes played and you get **mood-minutes**, which can be summed by any grouping: by week for the
seasons wheel, by hour for mood-by-hour, by year for year-vs-year. Themes work the same way: a song
with three themes splits its minutes three ways.

## Step 4: eras (`step4_eras.py`)

An era is a stretch where you listened to a song, artist, theme or mood far more than you usually do,
and it lasts exactly as long as that stayed out of the ordinary. No length limit: song obsessions tend
to be a few weeks, an artist or a sad-songs phase can run for months. Eras can overlap; ordinary
stretches belong to no era. No AI in the detection:
1. Count everything per week (smoothed over 3 weeks). "Usual" = each thing's median weekly share.
2. A burst starts when something jumps well above usual (song: 5%+ of listening and 3x usual; artist:
   12%+ and 1.8x; theme: +6 points; mood: +5 points) and continues while it stays at least halfway
   to that level, surviving dips of up to 2 weeks. So it ends when the listening actually fades.
3. Strength = how far above usual, summed over its weeks. Bursts stronger than 60% of all bursts
   (`ERA_SPIKE_QUANTILE`) start an era.
4. Related bursts form one era: a song with its artist, or bursts that started and ended at about the
   same time. An unrelated song spike inside a long artist phase stays its own era.
5. Listening amount: each era vs the 26 weeks before it; surges rank higher. Top 30 kept.

Then one request to Claude names each era from its drivers and stats (no lyrics), titles each
year, and writes the closing "listening identity".

## Era photos and places

`build` creates `web/photos/<start>_to_<end>/` for every era and an `era_notes.csv` in the project
folder with each era's dates, a `lived_in` and `caption` column for you to fill, and the countries
Spotify saw you in. Drop pictures into the folders (iPhone .HEIC files are converted to JPEG
automatically on a Mac), fill in the CSV, and run `build` again. Your notes are kept between runs.
Folder names come from the era dates, so if you change era settings and the dates move, move the
photos to the new folders.

## Step 5: build (`step5_build.py`)

One function per screen. The less obvious ones:

- **Sessions**: plays less than 15 minutes apart are one session.
- **Mood extremes**: each day's score for a mood is the minutes-weighted average of its songs' scores.
  Days under 30 minutes are skipped so one song can't win. The volatile day has the largest spread in valence.
- **Seasons wheel**: mood-minutes per week of the year, smoothed over 5 weeks (wrapping December into
  January), as shares.
- **Fallen favorites**: songs with 20+ plays whose skip rate in their first 30% of plays was 30% or
  less and rose by 30 points or more by their last 30%. Burnout is when the rolling skip rate over 5
  plays first hit 50%.
- **Year vs. year**: Jensen-Shannon distance (0 = identical mix, 1 = no overlap) between two years'
  artist mixes, mood mixes and theme mixes, averaged. Carryover is the share of a year's minutes
  going to artists you'd heard in earlier years.
- **Trips**: runs of days where most plays came from a country other than your home country (the
  one with the most minutes), allowing gaps of up to 3 days.

Everything is written to `web/data.js` as `window.WRAPPED = {...}`. Using a `.js` file instead of
`.json` means the page works by double-clicking it, with no local server.

## The web app (`web/app.js`)

It follows the Wrapped story format: one idea per slide, full-bleed flat color, oversized type,
at most one simple visual, a row of progress bars along the top. `SLIDES` is an ordered list of
functions; each returns `{ theme, html, after }`:
- `theme` picks a color pair from `THEMES` (background, text, accent).
- `html` is the slide's text. Headlines are worked out from the data, e.g. "Winters go sad" comes from
  `standout()`, which finds the mood most over-represented in a season compared with your overall mix.
- `after` draws the chart with D3 once the html is on the page.
A slide can return `null` to skip itself (for example when there are no fallen favorites yet).
`state.year` holds the year chosen in the top-right pills; most slides switch to that year.
The font (Archivo) and libraries are bundled in `web/vendor/`, so the page works offline.

## Cost and time (rough, for ~3,000 unique songs)

| Step | Time | Cost |
|---|---|---|
| load | seconds | free |
| lyrics | ~30-60 min (one request at a time) | free |
| tag, live | ~10-20 min | a few dollars on a small model |
| tag, batch | under an hour usually, max 24h | about half of live |
| eras + build | under a minute | cents |
