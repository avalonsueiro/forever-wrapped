/* Page 10: your saddest day.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("saddest-day", () => {
  const mood = "sad", k = 0;
    if (!TAGGED || !D.extremes) return null;
    const E = D.extremes, d = yr() ? (E.by_year[yr()] || {})[mood] : E.overall[mood];
    if (!d) return null;
    const tracks = (d.tracks || []).slice(0, 2);

    // split "Oct 22, 2024" so the year can sit on its own line in the accent
    const full = date(d.date), cut = full.lastIndexOf(", ");
    const day = full.slice(0, cut), year = full.slice(cut + 2);

    // records: a sad face drawn with small records (outline, two eyes and a frown),
    // in the empty space right of the text (under it on a phone). Each part forms at the same time.
    const face = (W, H) => {
      const phone = W < 700, u = shapeUnit(W, H);
      const r = (phone ? 0.02 : 0.017) * u, step = 2 * r * 0.88;
      const F = phone ? Math.min(0.36 * W, 0.17 * H) : Math.min(0.3 * H, 0.17 * W);
      const cx = phone ? W / 2 : 0.76 * W, cy = phone ? H - F - 0.06 * H : 0.54 * H;
      const arc = (x, y, R, a0, a1) => shapeSpaced(t => {           // angles in degrees, 0 = right, 90 = down
        const a = (a0 + (a1 - a0) * t) * Math.PI / 180; return [x + R * Math.cos(a), y + R * Math.sin(a)]; }, step);
      const dot = (x, y, R) => arc(x, y, R, -90, 270);
      const ex = 0.36 * F, ey = cy - 0.22 * F;
      return [
        { r, points: arc(cx, cy, F, -90, 270) },                      // the face, starting at the top
        { r: 1.7 * r, points: [[cx - ex, ey]] },                     // eyes: one bigger record each
        { r: 1.7 * r, points: [[cx + ex, ey]] },
        { r, points: arc(cx, cy + 0.62 * F, 0.42 * F, 215, 325) },    // the frown (the top of a small circle)
      ];
    };

    return { theme: "cobalt", html: `<div class="inner sd10">
      <p class="kick rise">Your ${mood === "sad" ? "saddest" : "happiest"} day, ${when()}</p>
      <h1 class="sd10-date rise d1"><span>${esc(day)},</span> <span class="sd10-year">${esc(year)}</span></h1>
      ${tracks.length ? `<div class="sd10-repeat rise d2">
        <p class="sd10-label">On repeat</p>
        <ol class="sd10-list">${tracks.map(t => `<li>${t.cover ? `<img class="tr-cover" src="${encodeURI(t.cover.src)}" alt="" style="--glow:${t.cover.glow}">` : ""}<b>${esc(clean(t.track))}</b><span>by ${esc(t.artist)}</span></li>`).join("")}</ol>
      </div>` : ""}</div>`,
      trail: face,
      trailOptions: { still: true },             // the face is just there, no records sliding in
      glow: ["#2f6bff", "#00d1ff", "#4f6bff", "#7f8cff"],
    };
});
