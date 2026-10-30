/* Page 08: your saddest day. Page 09 (your happiest day) is the same page with a smile, built by
   moodDaySlide below, so the two always match.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */

// One page for a mood's most extreme day: the date (year on its own line in the accent), the songs
// on repeat that day, and a face drawn with small records, right of the text (under it on a phone).
// Only the wording, colors and the mouth change between the sad and happy versions.
const MOOD_DAY = {
  sad:   { word: "saddest",  theme: "cobalt", glow: ["#2f6bff", "#00d1ff", "#4f6bff", "#7f8cff"],
           mouth: F => [0.62 * F, 0.42 * F, 215, 325] },     // a frown: the top of a small circle below the eyes
  happy: { word: "happiest", theme: "lemon",  glow: ["#ffe500", "#ff8a00", "#ff2d87", "#ffe500"],
           mouth: F => [0.02 * F, 0.55 * F, 25, 155] },      // a smile: the bottom of a circle
};

function moodDaySlide(mood) {
  const M = MOOD_DAY[mood];
  if (!TAGGED || !D.extremes) return null;
  const E = D.extremes, d = yr() ? (E.by_year[yr()] || {})[mood] : E.overall[mood];
  if (!d) return null;
  const tracks = (d.tracks || []).slice(0, 2);

  // split "Jan 13, 2026" so the year can sit on its own line in the accent
  const full = date(d.date), cut = full.lastIndexOf(", ");
  const day = full.slice(0, cut + 1), year = full.slice(cut + 2);

  const face = (W, H) => {
    const phone = W < 700, u = shapeUnit(W, H);
    const r = (phone ? 0.02 : 0.017) * u, step = 2 * r * 0.88;
    const F = phone ? Math.min(0.36 * W, 0.17 * H) : Math.min(0.3 * H, 0.17 * W);
    const cx = phone ? W / 2 : 0.76 * W, cy = phone ? H - F - 0.06 * H : 0.54 * H;
    const arc = (x, y, R, a0, a1) => shapeSpaced(t => {          // degrees, 0 = right, 90 = down
      const a = (a0 + (a1 - a0) * t) * Math.PI / 180; return [x + R * Math.cos(a), y + R * Math.sin(a)]; }, step);
    const ex = 0.36 * F, ey = cy - 0.22 * F, [dy, R, a0, a1] = M.mouth(F);
    return [
      { r, points: arc(cx, cy, F, -90, 270) },                     // the face, starting at the top
      { r: 1.7 * r, points: [[cx - ex, ey]] },                     // eyes: one bigger record each
      { r: 1.7 * r, points: [[cx + ex, ey]] },
      { r, points: arc(cx, cy + dy, R, a0, a1) },                  // the mouth
    ];
  };

  return { theme: M.theme,
    html: `<div class="inner md">
      <p class="kick rise">Your ${M.word} day, ${when()}</p>
      <h1 class="md-date rise d1"><span>${day}</span><span class="md-year">${year}</span></h1>
      ${tracks.length ? `<div class="md-repeat rise d2">
        <p class="md-label">On repeat</p>
        <ol>${tracks.map(t => `<li>${t.cover ? `<img class="tr-cover" src="${encodeURI(t.cover.src)}" alt="" style="--glow:${t.cover.glow}">` : ""}<span class="md-t">${esc(clean(t.track))}</span><span class="md-a">by ${esc(t.artist)}</span></li>`).join("")}</ol>
      </div>` : ""}
    </div>`,
    trail: face,
    trailOptions: { still: true },             // the face is just there, no records sliding in
    glow: M.glow,
  };
}

defineSlide("saddest-day", () => moodDaySlide("sad"));
