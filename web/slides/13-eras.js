/* Page 13: your eras (calendar with a highlighter stroke per era; click one to open it).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style.
   Wide screens: one row per year, time runs left to right. Phones: one column per year, time runs
   top to bottom, so the calendar uses the tall screen instead of shrinking to a strip. */
function eraCalendar() {
  return () => {
    if (!ERAS.length) return null;
    const years = yr() ? [yr()] : (D.overview.picker_years || YEARS);
    const shown = ERAS.filter(e => years.some(y => e.start.slice(0, 4) <= String(y) && e.end.slice(0, 4) >= String(y)));
    if (!shown.length) return null;
    return { theme: "card", interactive: true, html: `<div class="inner ec">
      <div class="ec-head">
        <h1 class="big ec-big rise d1">your eras${yr() ? ` in ${yr()}` : ""}</h1>
        <p class="sub rise d2">Each highlight is an era. Click one to open it.</p>
      </div>
      <div class="chart ec-chart rise d3" id="eracal"></div></div>`,
      after() { drawEraCalendar(years, shown); },
      // no records here: the calendar is the picture
    };
  };
}

function drawEraCalendar(years, shown) {
  const box = document.getElementById("eracal");
  if (!box) return;
  const tall = innerWidth < 700;                               // phone: years as columns
  const daily = D.calendar.daily, q = d3.quantile(Object.values(daily).sort(d3.ascending), 0.95) || 1;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  // Layout. "time" is the axis the days run along, "band" is one year's row (or column).
  let W, H, t0, t1, b0, bandSize;
  if (tall) {
    W = Math.max(280, box.clientWidth || 330);
    const room = innerHeight - box.getBoundingClientRect().top - 56;
    H = Math.max(380, Math.min(620, room));
    t0 = 34; t1 = H - 4; b0 = 30;                               // month labels on the left, years on top
    bandSize = (W - b0) / years.length;
  } else {
    W = 1100;
    const single = years.length === 1;
    bandSize = single ? 170 : Math.max(58, Math.min(80, 390 / years.length));
    t0 = 70; t1 = W - 6; b0 = 30;                               // years on the left, months on top
    H = b0 + years.length * bandSize;
  }
  const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`)
    .attr("class", tall ? "ec-tall" : "ec-wide").attr("role", "img").attr("aria-label", "calendar of your eras");
  const defs = svg.append("defs");

  // A rectangle given in (time, band) terms, turned into screen x/y/width/height.
  const box2 = (ta, tb, ba, bb) => tall ? { x: ba, y: ta, w: bb - ba, h: tb - ta } : { x: ta, y: ba, w: tb - ta, h: bb - ba };

  // Month labels once, along the time axis (they line up for every year).
  const ref = d3.scaleTime().domain([new Date(2001, 0, 1), new Date(2002, 0, 1)]).range([t0, t1]);
  d3.range(12).forEach(m => {
    const p = ref(new Date(2001, m, 1));
    svg.append("text").attr("class", "ec-month")
      .attr("x", tall ? 0 : p + 6).attr("y", tall ? p + 12 : 16).text(MONTHS[m]);
  });

  years.forEach((y, r) => {
    const time = d3.scaleTime().domain([new Date(y, 0, 1), new Date(y + 1, 0, 1)]).range([t0, t1]);
    const ba = b0 + r * bandSize, bb = ba + bandSize - (tall ? 6 : 8);   // a small gap between years
    const g = svg.append("g").attr("class", "ec-year");

    // year label
    if (tall) g.append("text").attr("class", "ec-yr").attr("x", ba + (bb - ba) / 2).attr("y", 18).attr("text-anchor", "middle").text(String(y).slice(2).padStart(3, "'"));
    else g.append("text").attr("class", "ec-yr").attr("x", 0).attr("y", ba + (bb - ba) / 2 + 7).text(y);

    // faint band and month lines
    const bg = box2(t0, t1, ba, bb);
    g.append("rect").attr("class", "ec-band").attr("x", bg.x).attr("y", bg.y).attr("width", bg.w).attr("height", bg.h).attr("rx", 6);
    d3.range(1, 12).forEach(m => {
      const p = time(new Date(y, m, 1)), l = box2(p, p, ba + 3, bb - 3);
      g.append("line").attr("class", "ec-grid").attr("x1", l.x).attr("x2", l.x + l.w).attr("y1", l.y).attr("y2", l.y + l.h);
    });

    // daily listening as thin ticks, one path per year (cheap to draw twice)
    let ticks = "";
    const day = Math.max(1, (t1 - t0) / 366 - 0.5), depth = (bb - ba) - 8;
    for (let d = new Date(y, 0, 1); d.getFullYear() === y; d.setDate(d.getDate() + 1)) {
      const iso = `${y}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, v = daily[iso] || 0;
      if (!v) continue;
      const len = Math.max(1.5, depth * Math.min(1, v / q)), p = time(d);
      // wide: bars stand on the row's floor; tall: bars grow right from the column's left edge
      const k = tall ? box2(p, p + day, ba + 4, ba + 4 + len) : box2(p, p + day, bb - 4 - len, bb - 4);
      ticks += `M${k.x.toFixed(1)} ${k.y.toFixed(1)}h${k.w.toFixed(1)}v${k.h.toFixed(1)}h${(-k.w).toFixed(1)}Z`;
    }
    g.append("path").attr("class", "ec-ticks").attr("d", ticks);

    // highlighter strokes: overlapping eras get their own parallel lane so none is hidden
    const inRow = shown.filter(e => e.start.slice(0, 4) <= String(y) && e.end.slice(0, 4) >= String(y)).map(e => ({ e,
      s: new Date(Math.max(new Date(e.start + "T00:00:00"), new Date(y, 0, 1))),
      t: new Date(Math.min(new Date(e.end + "T23:59:00"), new Date(y, 11, 31, 23))) }));
    const laneEnd = [];
    inRow.forEach(o => { let k = laneEnd.findIndex(v => v < o.s); if (k < 0) { k = laneEnd.length; laneEnd.push(0); } laneEnd[k] = o.t; o.lane = k; });
    const lanes = Math.max(1, laneEnd.length), laneSize = (bb - ba - 4) / lanes;

    const clipId = `ec-clip-${y}`, clip = defs.append("clipPath").attr("id", clipId);
    // layers: strokes (clickable), then dark ink showing through them, then the labels
    const pens = g.append("g").attr("class", "ec-pens");
    g.append("path").attr("class", "ec-ink").attr("d", ticks).attr("clip-path", `url(#${clipId})`);
    const labels = g.append("g").attr("class", "ec-labels");
    inRow.forEach(({ e, s, t, lane }) => {
      const a = time(s), z = Math.max(a + 10, time(t));
      const la = ba + 2 + lane * laneSize + 1.5, lb = la + Math.max(7, laneSize - 3);
      const k = box2(a, z, la, lb), d = chisel(k, tall);
      clip.append("path").attr("d", d);
      const hl = pens.append("g").attr("class", "hl ec-hl").style("--pen", e.pen)
        .attr("tabindex", 0).attr("role", "button").attr("aria-label", `${e.name}, ${eraRange(e)}`)
        .on("click", () => openEra(ERAS.indexOf(e)))
        .on("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openEra(ERAS.indexOf(e)); } })
        .call(sel => hover(sel, () => `<b>${esc(e.name)}</b><br>${eraRange(e)}`));
      hl.append("path").attr("class", "ec-stroke").attr("d", d).attr("fill", e.pen);
      // number (and the name when there's room) written on the stroke
      const across = tall ? k.w : k.h, along = tall ? k.h : k.w;
      const fs = Math.max(9, Math.min(tall ? 12 : 15, across - 5));
      if (across < 10 || along < fs * 1.1) return;
      const lbl = labels.append("text").attr("class", "ec-lbl").style("font-size", `${fs}px`);
      if (tall) {
        lbl.attr("x", k.x + k.w / 2).attr("y", k.y + fs + 3).attr("text-anchor", "middle").text(e.n);
        // a wide column (one year picked) has room for the name too
        if (k.w > 90) { lbl.attr("x", k.x + 7).attr("text-anchor", null);
          const nm = lbl.append("tspan").attr("class", "ec-name").attr("dx", fs * 0.45).text(e.name);
          if (lbl.node().getComputedTextLength() > k.w - 14) nm.remove(); }
      }
      else {
        lbl.attr("x", k.x + 7).attr("y", k.y + k.h / 2 + fs * 0.36);
        lbl.append("tspan").text(e.n);
        // the name only when it fits whole; a cut-off name reads worse than just the number
        const nm = lbl.append("tspan").attr("class", "ec-name").attr("dx", fs * 0.45).text(e.name);
        if (lbl.node().getComputedTextLength() > k.w - 16) nm.remove();
      }
    });
  });
}

// A highlighter stroke: a rectangle with slanted ends, like a chisel tip marker.
function chisel(k, tall) {
  const s = Math.min(5, (tall ? k.h : k.w) * 0.2);
  if (tall) return `M${k.x} ${k.y + s}L${k.x + k.w} ${k.y}L${k.x + k.w} ${k.y + k.h - s}L${k.x} ${k.y + k.h}Z`;
  return `M${k.x + s} ${k.y}L${k.x + k.w} ${k.y}L${k.x + k.w - s} ${k.y + k.h}L${k.x} ${k.y + k.h}Z`;
}
defineSlide("eras", eraCalendar());
