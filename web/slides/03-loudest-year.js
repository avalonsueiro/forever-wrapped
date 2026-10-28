/* Page 03: your loudest year (bar chart of minutes per year).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
// Is the current year (the last year in your export) on track to beat your loudest year? Compare
// both years at the same date: if this year has more hours by, say, Oct 15 than the loudest year
// had by Oct 15, it's on track (that handles seasons, since both years are measured the same way).
// Says nothing when it's behind, too early in the year (under 60 days), or the export is stale.
function lyPace(top) {
  const daily = D.calendar.daily, last = Object.keys(daily).sort().at(-1);
  if (!last) return "";
  const cy = +last.slice(0, 4), md = last.slice(5);
  const lastDay = new Date(last + "T12:00:00");
  const dayOfYear = (lastDay - new Date(cy, 0, 1)) / 864e5 + 1;
  if ((Date.now() - lastDay) / 864e5 > 60 || dayOfYear < 60 || md === "12-31") return "";
  if (top.year === cy) return `<p class="ly-pace rise d2">and <b>${cy}</b> isn't over yet</p>`;
  const upTo = y => Object.entries(daily).reduce((a, [k, v]) => (k.startsWith(y + "-") && k.slice(5) <= md ? a + v : a), 0);
  return upTo(cy) > upTo(top.year) ? `<p class="ly-pace rise d2"><b>${cy}</b> is on track to beat it</p>` : "";
}

// With a year picked: that year's months instead of your years, so the page names the loudest month.
const LY_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const LY_MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

defineSlide("loudest-year", () => {
  const y = yr();
  const ys = y
    ? LY_MONTHS.map((m, i) => ({ year: m, i, minutes: d3.sum(Object.entries(D.calendar.daily),
        ([d, v]) => (d.startsWith(`${y}-${String(i + 1).padStart(2, "0")}`) ? v : 0)) }))
    : D.years;
  const top = ys.reduce((a, b) => b.minutes > a.minutes ? b : a);
  if (!top.minutes) return null;
  const max = Math.max(1, top.minutes);
  // the bars are plain html so the labels keep a readable size on a phone
  const cols = ys.map((d, i) => `<div class="ly-col${d.year === top.year ? " ly-top" : ""}${!y && d.year === yr() && d.year !== top.year ? " ly-picked" : ""}${d.minutes ? "" : " ly-zero"}">
      <div class="ly-track"><span class="ly-v">${fmt(d.minutes / 60)}h</span>
        <i class="ly-bar" style="--p:${(d.minutes / max).toFixed(4)};--k:${i}"></i></div>
      <span class="ly-y">${d.year}</span></div>`).join("");
  return {
    theme: "cobalt",
    html: `<div class="inner ly-wrap">
      <div class="ly-head"><p class="kick rise">${y ? `Your loudest month of ${y}` : "Your loudest year"}</p>
        <h1 class="huge rise d1${y ? " ly-month" : ""}">${y ? LY_MONTH_NAMES[top.i] : top.year}</h1>
        <p class="ly-hours rise d2"><b>${fmt(top.minutes / 60)}</b> hours of music</p>
        ${y ? "" : lyPace(top)}</div>
      <div class="ly-bars rise d3${y ? " ly-12" : ""}" id="yearbars" style="--n:${ys.length}">${cols}</div></div>`,
    // stairs climbing up toward the loudest year, in the empty space beside the headline (or below the chart on a phone)
    trail: (W, H) => {
      if (W < 700) return SHAPES.stairs({ from: [-0.06, 0.985], to: [1.08, 0.79], steps: 3, r: 0.075 })(W, H);
      // start just right of the big year so no record touches it (same sizes as the css)
      const fs = Math.min(0.15 * W, 0.27 * H, 260), left = (W - Math.min(1100, W - 56)) / 2;
      // (a month name is wider than a year, so use where the headline really ends when it's on screen)
      const h1 = document.querySelector(".ly-wrap .huge"), right = h1 && h1.firstChild ? (() => {
        const rg = document.createRange(); rg.selectNodeContents(h1); return rg.getBoundingClientRect().right; })() : 0;
      const R = 0.055 * Math.min(H, 1.2 * W), x0 = (Math.max(left + 2.3 * fs, right) + 1.3 * R) / W;
      return SHAPES.stairs({ from: [Math.max(0.45, x0), 0.45], to: [1.08, 0.13], steps: 3, r: 0.055 })(W, H);
    },
    glow: ["#4f6bff", "#1f3cff", "#8fa2ff", "#4f6bff", "#2bd0ff", "#4f6bff"],
  };
});
