/* Page 15: the song you skipped most.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("most-skipped", () => {
    // the picked year's most skipped song (all time: the most skipped overall)
    const s = yr() ? (D.skips.most_skipped_by_year || {})[yr()] : D.skips.most_skipped[0];
    if (!s) return null;

    // one pip per play, lit in the accent when it was skipped (capped so a huge count still fits)
    const n = Math.min(s.plays, 120), lit = Math.round(n * Math.min(1, s.skips / Math.max(1, s.plays)));
    const pips = Array.from({ length: n }, (_, i) => `<i class="${i < lit ? "ms15-on" : ""}"></i>`).join("");

    // records: a zigzag that keeps breaking. each leg is its own run of records and the corners are
    // missing, like a song cut off before it got anywhere. desktop: it climbs the empty right side.
    // phone: it runs along the bottom.
    const broken = (W, H) => {
      const phone = W / H < 0.8;
      const corners = phone
        ? [[-0.12, 0.95], [0.30, 0.76], [0.70, 0.95], [1.12, 0.76]]
        : [[0.78, 1.16], [0.95, 0.74], [0.78, 0.42], [0.95, 0.06]];
      const r = phone ? 0.055 : 0.048, cut = 0.2;      // cut = how much of each leg's ends is skipped
      return corners.slice(1).flatMap((to, i) => {
        const from = corners[i], at = t => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
        return SHAPES.line({ from: at(i === 0 ? 0 : cut), to: at(1 - cut), r })(W, H);
      });
    };

    return {
      theme: "sunset",
      html: `<div class="inner ms15">
        <p class="kick rise">The song you skipped most, ${when()}</p>
        <h1 class="big ms15-title rise d1" style="${fit(clean(s.track))}">${esc(clean(s.track))}</h1>
        <p class="mid ms15-count rise d3"><span class="ms15-num" data-count="${s.skips}">${fmt(s.skips)}</span> skips</p>
        <div class="ms15-pips rise d4" aria-hidden="true">${pips}</div>
        <p class="sub ms15-sub rise d5">By ${esc(s.artist)}. You still played it ${fmt(s.plays)} times.</p>
      </div>
      ${s.cover ? `<figure class="song-cover rise d2" style="--glow:${s.cover.glow}"><img src="${encodeURI(s.cover.src)}" alt=""></figure>` : ""}`,      // the song's album cover instead of records
    };
  });
