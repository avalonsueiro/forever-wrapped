/* Page 02: total minutes listened.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */

// Rows of small records piled up from the bottom edge, so many they run off the screen.
// The lowest row is cut in half by the edge; each row above is shifted half a record, like bricks.
// Phones get an extra row since the screen is tall and the text sits near the top.
function minutesPile(W, H) {
  const phone = W < 700;
  const R = phone ? 24 : Math.max(18, 0.036 * Math.min(H, W * 1.2));
  const step = 2 * R * 0.82, gapY = R * 1.6;
  const rows = Math.max(2, Math.round((phone ? 0.3 : 0.17) * H / gapY));   // fill the bottom of the screen
  const out = [];
  for (let i = 0; i < rows; i++) {
    const y = H - i * gapY;                            // row 0 sits on the edge, cut in half
    const shift = i % 2 ? step / 2 : 0;
    const pts = [];
    for (let x = -R + shift; x < W + R; x += step) pts.push([x, y]);
    if (i % 2) pts.reverse();                          // odd rows run right to left, so the pile zigzags up
    out.push({ r: R, points: pts });
  }
  return out;
}

defineSlide("minutes", () => {
    const m = yr() ? yearRow().minutes : D.overview.total_minutes;
    return { theme: "sunset", html: `<div class="inner mn-wrap">
      <p class="kick rise">You listened for</p>
      <h1 class="huge rise d1 mn-num" data-count="${m}">${fmt(m)}</h1>
      <p class="mid rise d2 mn-unit">minutes${yr() ? ` in ${yr()}` : ""}</p>
      <p class="sub rise d3 mn-days">That's <b>${fmt(m / 1440)}</b> full days of music.</p></div>`,
      trail: minutesPile,
      glow: ["#ff2d87", "#ffe500", "#ff2d87", "#9d4dff"],
      trailOptions: { totalSeconds: 2.6 } };
  });
