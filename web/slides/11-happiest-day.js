/* Page 11: your happiest day.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("happiest-day", () => {
  const mood = "happy";
  if (!TAGGED || !D.extremes) return null;
  const E = D.extremes, d = yr() ? E.by_year[yr()][mood] : E.overall[mood];
  const tracks = yr() ? [] : E.overall[mood].tracks.slice(0, 2);

  // split "Jan 13, 2026" so the year can sit on its own line in the accent
  const full = date(d.date), cut = full.lastIndexOf(", ");
  const day = full.slice(0, cut + 1), year = full.slice(cut + 2);

  // records: a smiley drawn with small records (outline, two eyes, a big smile), right of the
  // text (under it on a phone); the happy twin of page 10's sad face
  const smiley = (W, H) => {
    const phone = W < 700, u = shapeUnit(W, H);
    const r = (phone ? 0.02 : 0.017) * u, step = 2 * r * 0.88;
    const F = phone ? Math.min(0.36 * W, 0.17 * H) : Math.min(0.3 * H, 0.17 * W);
    const cx = phone ? W / 2 : 0.76 * W, cy = phone ? H - F - 0.06 * H : 0.54 * H;
    const arc = (x, y, R, a0, a1) => shapeSpaced(t => {          // degrees, 0 = right, 90 = down
      const a = (a0 + (a1 - a0) * t) * Math.PI / 180; return [x + R * Math.cos(a), y + R * Math.sin(a)]; }, step);
    const ex = 0.36 * F, ey = cy - 0.22 * F;
    return [
      { r, points: arc(cx, cy, F, -90, 270) },                     // the face, starting at the top
      { r: 1.7 * r, points: [[cx - ex, ey]] },                     // eyes: one bigger record each
      { r: 1.7 * r, points: [[cx + ex, ey]] },
      { r, points: arc(cx, cy + 0.02 * F, 0.55 * F, 25, 155) },    // the smile (the bottom of a circle)
    ];
  };

  return { theme: "lemon",
    html: `<div class="inner hd11">
      <p class="kick rise">Your happiest day, ${when()}</p>
      <h1 class="hd11-date rise d1"><span>${day}</span><span class="hd11-year">${year}</span></h1>
      ${tracks.length ? `<div class="hd11-repeat rise d2">
        <p class="hd11-label">On repeat</p>
        <ol>${tracks.map(t => `<li>${t.cover ? `<img class="tr-cover" src="${encodeURI(t.cover.src)}" alt="" style="--glow:${t.cover.glow}">` : ""}<span class="hd11-t">${esc(clean(t.track))}</span><span class="hd11-a">by ${esc(t.artist)}</span></li>`).join("")}</ol>
      </div>` : ""}
    </div>`,
    trail: smiley,
    trailOptions: { still: true },             // the face is just there, no records sliding in
    glow: ["#ffe500", "#ff8a00", "#ff2d87", "#ffe500"],
  };
});
