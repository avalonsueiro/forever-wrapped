/* Page 14: most of your songs were about ... (theme streamgraph).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style.
   Wide screens: time runs left to right. Phones: time runs top to bottom, so the stream uses the tall
   screen instead of shrinking to a thin strip. */
const THEMES14_COLORS = ["#ff2d87", "#ffe500", "#2f6bff", "#c8ff00", "#ff8a00", "#9d4dff"];

// Two wavy rows of records that mirror each other, one under the top bar and one cut by the bottom
// edge, like the two banks of the stream. They swell apart where the other one pulls in.
function themesTrail(W, H) {
  const phone = W < 700;
  const r = phone ? 0.066 : 0.05;
  const top = phone ? { y: 0.122, amp: 0.012 } : { y: 0.138, amp: 0.022 };
  const bottom = phone ? { y: 0.975, amp: 0.012 } : { y: 0.935, amp: 0.022 };
  const waves = phone ? 1 : 1.5;
  return SHAPES.combine(
    SHAPES.wave({ ...top, waves, r, phase: Math.PI, x0: -0.06, x1: 1.06 }),
    SHAPES.wave({ ...bottom, waves, r, phase: 0, x0: 1.06, x1: -0.06 }),
  )(W, H);
}

defineSlide("themes", () => {
    if (!TAGGED) return null;
    const T = D.theme_timeline, keep = T.themes.filter(t => t !== "other").slice(0, 6);
    const color = d3.scaleOrdinal(keep, THEMES14_COLORS);
    return { theme: "night", html: `<div class="inner th">
      <div class="th-head">
        <p class="kick rise">Most of your songs were about</p>
        <h1 class="big th-big rise d1" style="color:${color(keep[0])}">${esc(keep[0])}</h1>
      </div>
      <div class="chart th-chart rise d2" id="stream"></div>
      <div class="th-legend rise d3">${keep.map((t, k) => `<span class="${k === 0 ? "th-top" : ""}"><i style="background:${color(t)}"></i>${esc(t)}</span>`).join("")}</div>
    </div>`,
      after() { drawThemeStream(T, keep, color); },
      // no records here: the streamgraph is busy enough on its own
    };
  });

function drawThemeStream(T, keep, color) {
  const box = document.getElementById("stream");
  if (!box) return;
  const tall = innerWidth < 700;                         // phone: time runs down the screen
  const rows = T.months.map((m, k) => Object.fromEntries(keep.map(t => [t, T.series[t][k]])));
  const st = d3.stack().keys(keep).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut)(rows);
  const lo = d3.min(st, s => d3.min(s, d => d[0])), hi = d3.max(st, s => d3.max(s, d => d[1]));

  // where each year starts (the months have gaps, so the axis follows the data, not the calendar)
  const yearStarts = [];
  T.months.forEach((m, k) => { const y = m.slice(0, 4); if (!yearStarts.length || yearStarts.at(-1).y !== y) yearStarts.push({ y, k }); });

  const svg = d3.select(box).append("svg");
  let W, H, time, band, area;
  if (tall) {
    W = Math.max(260, box.clientWidth || 330);
    H = Math.round(Math.min(440, Math.max(300, innerHeight * 0.46)));
    const gut = 44;                                        // room for the year labels on the left
    time = d3.scaleLinear().domain([0, T.months.length - 1]).range([6, H - 6]);
    band = d3.scaleLinear().domain([lo, hi]).range([gut, W]);
    area = d3.area().y((d, k) => time(k)).x0(d => band(d[0])).x1(d => band(d[1])).curve(d3.curveBasis);
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("class", "th-tall");
    let last = -Infinity;
    yearStarts.forEach(({ y, k }) => {
      const p = time(k);
      if (p - last < 28) return;                           // skip a year that would sit on top of the last
      last = p;
      svg.append("line").attr("class", "th-grid").attr("x1", gut - 6).attr("x2", W).attr("y1", p).attr("y2", p);
      svg.append("text").attr("class", "th-yr").attr("x", 0).attr("y", p + 5).text(y);
    });
  } else {
    W = Math.max(600, box.clientWidth || 1100);
    H = Math.round(Math.min(380, Math.max(200, innerHeight * 0.36)));
    const axis = 30;                                       // room for the year labels underneath
    time = d3.scaleLinear().domain([0, T.months.length - 1]).range([0, W]);
    band = d3.scaleLinear().domain([lo, hi]).range([H - axis - 4, 4]);
    area = d3.area().x((d, k) => time(k)).y0(d => band(d[0])).y1(d => band(d[1])).curve(d3.curveBasis);
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    let last = -Infinity;
    yearStarts.forEach(({ y, k }) => {
      const p = time(k);
      if (p - last < 56) return;
      last = p;
      svg.append("line").attr("class", "th-grid").attr("x1", p).attr("x2", p).attr("y1", 0).attr("y2", H - axis + 4);
      svg.append("text").attr("class", "th-yr").attr("x", p + 2).attr("y", H - 4).text(y);
    });
  }

  // the bands; the top theme drawn last so it sits on top where curves touch
  svg.append("g").selectAll("path").data(st).join("path")
    .attr("class", s => s.key === keep[0] ? "th-band th-main" : "th-band")
    .attr("fill", s => color(s.key)).style("--th-c", s => color(s.key)).attr("d", area);

  // hover: a line at the month under the pointer, and a tip with that month's themes, biggest first;
  // the band under the pointer is the bold line in the tip
  const guide = svg.append("line").attr("class", "th-guide").style("display", "none");
  const monthName = m => new Date(m + "-15T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }).toLowerCase();
  svg.append("rect").attr("data-hover", "").attr("x", 0).attr("y", 0).attr("width", W).attr("height", H)
    .attr("fill", "transparent").style("cursor", "crosshair")
    .on("mousemove", e => {
      const [px, py] = d3.pointer(e);
      const k = Math.max(0, Math.min(T.months.length - 1, Math.round(time.invert(tall ? py : px))));
      const at = tall ? band.invert(px) : band.invert(py);
      const under = st.find(s => at >= s[k][0] && at <= s[k][1]);
      const tot = d3.sum(keep, t => rows[k][t]) || 1;
      const p = time(k);
      guide.style("display", null).attr(tall ? "y1" : "x1", p).attr(tall ? "y2" : "x2", p)
        .attr(tall ? "x1" : "y1", tall ? 0 : 0).attr(tall ? "x2" : "y2", tall ? W : H - 26);
      tip.innerHTML = `<b>${monthName(T.months[k])}</b><br>` + keep.slice().sort((a, b) => rows[k][b] - rows[k][a])
        .filter(t => rows[k][t] > 0).map(t => `<span style="color:${color(t)}">●</span> ${t === (under && under.key) ? `<b>${t}</b>` : t} ${Math.round(rows[k][t] / tot * 100)}%`).join("<br>");
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - 200) + "px"; tip.style.top = e.clientY + 14 + "px";
      svg.selectAll(".th-band").classed("th-dim", s => under && s.key !== under.key);
    })
    .on("mouseleave", () => { tip.hidden = true; guide.style("display", "none"); svg.selectAll(".th-band").classed("th-dim", false); });
}
