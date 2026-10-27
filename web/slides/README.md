# Pages of Forever, Wrapped

Each page of the story is one file here: `NN-name.js` (play order = NN) plus `NN-name.css`.
`era-page.js` is the full-screen page that opens when you click an era on page 13.
The title page (index.html `#intro`) and the shell (`../app.js`) are not page files.

## The house style (match the title page)
- **Background:** Spotify black `#121212` with faint grain, on every page. Already done in index.html; don't add backgrounds.
- **Type:** Figtree (`var(--display)`), **lowercase everywhere** (CSS already forces it), heavy 800-900 weight for headlines, tight letter spacing. Very little text: one idea per page, like Spotify Wrapped.
- **Color:** white text. One saturated **accent** per page: `THEMES[theme][2]`, also available as CSS `var(--ac)`. Accents: lemon `#ffe500`, sunset `#ff2d87`, cobalt `#4f6bff`, flame `#ff2e2e`, lime `#c8ff00`, violet `#9d6bff`. Mood colors are in `MC`. No gradients, no pastels.
- **Records:** black vinyl records with spinning photo labels and a bright LED underglow, sliding out one from behind another in one smooth motion. They move across the screen in **lines, waves, zigzags, diagonals, stairs, S-curves, rows cut in half by a screen edge**, at whatever size suits the page (big and few, or small and many).
  **No rings, circles or arcs of records**: the ring belongs to the title page only (the end screen may use one).
- **Buttons:** outlined white pills (2px white border, white text, fill white on hover).
- **Charts:** drawn with d3 in the page's `after()`. On black: white for structure (opacity .15-.3), the accent for what matters, mood colors where moods are shown. SVG text is already white Figtree.

## What build() returns
```js
defineSlide("my-page", () => ({
  theme: "lime",                       // picks the accent (THEMES in ../core.js)
  html: `<div class="inner">...</div>`,// the page; classes: kick (small line above), huge, big, mid, sub, rank, row, grow, chart, tag, card
                                       // rise / d1..d5 = fade-up entrance with delays
  after() { /* d3 charts etc., runs after the html is on the page */ },
  trail: SHAPES.wave({ y: 0.9, r: 0.06 }),   // the records behind this page (../shapes.js), or your own (W, H) => [{ r, points }]
  glow: ["#c8ff00", "#1f3cff"],        // optional: LED colors (default: the six Wrapped colors)
  trailOptions: { totalSeconds: 2.4 }, // optional: anything RecordRing accepts (../recordRing.js), e.g. timing
}));
```
Return `null` to skip the page (e.g. when there's no data). `yr()` is the year picked in the top-right picker (null = all time); pages must work for "all time" and for each year.

## Shapes (../shapes.js)
Positions are screen fractions (x 0 = left, 1 = right; y 0 = top, 1 = bottom; outside 0..1 = off screen); `r` = record radius as a fraction of the screen's short side.
`SHAPES.line`, `edge` (row cut in half by an edge), `wave`, `vwave` (vertical wave), `zigzag`, `scurve`, `stairs`, `one` (single record), `combine(...)` (several at once). Write your own `(W, H) => [{ r, points: [[x, y], ...] }]` if none fits; space records about `2 * r * 0.82` apart along the path so they overlap like the title ring.

## Layout rules
- Records **frame** the content: they must not cover headlines, numbers, lists or charts. Keep them along edges, corners and empty areas. The top ~70px holds the progress bars and year picker.
- The shape should **mean something** for the page when possible (falling, climbing, repeating, splitting...).
- Must look good at **1512x860** (MacBook in Chrome), **1920x1080** and **390x844** (phone). Shapes are given in screen fractions, so they scale; check the phone, where the screen is tall and narrow.
- Content taller than the window is shrunk automatically (`fitToScreen` in app.js), but design so it doesn't need to be.

## Checking your page
```
tools/shoot.sh <page number> <output folder>      # e.g. tools/shoot.sh 7 /tmp/shots/07
tools/shoot.sh era3 <output folder>               # the era page, era 3
tools/shoot.sh 7 <output folder> year=2024        # with a year picked
```
Writes three PNGs (the three sizes above) with every animation at its final frame. Look at them, fix, repeat.
In a normal browser: `web/index.html?slide=7` opens page 7 directly (title page skipped).

## Rules for agents
- Edit **only your own page's `.js` and `.css`**. Everything shared (`index.html`, `core.js`, `app.js`, `shapes.js`, `recordRing.js`) is read-only: if you need a change there, describe it in your report instead.
- Prefix every CSS rule with something unique to your page so it can't leak into other pages.
- Keep the data logic (what the page measures and says) unless it's broken; this is a visual redesign.
- Comments: short, plain language, matching the existing code. Never use em dashes.
