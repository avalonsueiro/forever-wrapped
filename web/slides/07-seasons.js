/* Page 07: your year in moods (seasons mood wheel).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("seasons", () => {
    if (!TAGGED) return null;
    const S = D.seasons, prof = (yr() && S.profiles_by_year ? S.profiles_by_year[yr()] : S.profiles) || {};   // the picked year's own seasons
    const SEASONS = ["winter", "spring", "summer", "fall"];
    // each season's biggest group by real share of listening (not "more than usual")
    const lines = SEASONS.filter(s => prof[s]).map(s => {
      const g = moodGroups(prof[s].mood_mix), top = Object.keys(g).reduce((a, b) => (g[b] > g[a] ? b : a));
      return [s, top, g[top]];
    });
    if (!lines.length) return null;                     // a year with too little listening to split by season
    // headline: the season most dominated by one group
    const lead = lines.reduce((a, b) => (b[2] > a[2] ? b : a));
    const wheel = yr() ? S.wheel_by_year[yr()] : S.wheel_all;
    const ac = THEMES.night[2];
    const moodOf = Object.fromEntries(lines);

    // Records: four hills along the bottom edge, one per season (winter to fall, left to right).
    // Each hill glows in that season's mood color.
    const glow = [];
    const hills = (W, H) => {
      const phone = W < 700;
      const r = (phone ? 0.042 : 0.05) * Math.min(H, W * 1.2);
      const top = phone ? 0.075 : 0.1, base = 1.03;
      const curve = t => [(-0.03 + 1.06 * t) * W, (base - top * Math.abs(Math.sin(t * 4 * Math.PI))) * H];
      const pts = shapeSpaced(curve, 2 * r * SHAPE_OVERLAP);
      glow.length = 0;
      pts.forEach(([x]) => {
        const s = SEASONS[Math.max(0, Math.min(3, Math.floor((x / W) * 4)))];
        glow.push(moodOf[s] ? GROUP_COLOR[moodOf[s]] : ac);
      });
      return [{ r, points: pts }];
    };

    return { theme: "night", trail: hills, glow, trailOptions: { totalSeconds: 2.6 },
      html: `<div class="inner ssn"><div class="row ssn-row">
      <div class="grow ssn-text"><p class="kick rise">Your year in moods</p>
        <h1 class="big rise d1 ssn-head">${yr() ? `${cap(lead[0])} went` : `${cap(lead[0])}s go`} <span style="color:${GROUP_COLOR[lead[1]]}">${lead[1]}</span></h1>
        <div class="ssn-list rise d2">${lines.map(([s, m, v]) =>
          `<div class="ssn-line${s === lead[0] ? " ssn-lead" : ""}"><span class="ssn-s">${s}</span><i style="background:${GROUP_COLOR[m]};color:${GROUP_COLOR[m]}"></i><span class="ssn-m" style="color:${GROUP_COLOR[m]}">${m}</span><span class="ssn-pct">${Math.round(v * 100)}%</span></div>`).join("")}</div></div>
      <div class="chart rise d3 ssn-wheel" id="wheel"></div></div></div>`,
      after() {
        if (!wheel) return;
        const Sz = 560, c = Sz / 2, r0 = 70, r1 = c - 62;
        const KEYS = MOOD_GROUPS.map(([g]) => g);
        const rows = d3.range(52).map(w => Object.fromEntries(MOOD_GROUPS.map(([g, ms]) => [g, ms.reduce((a, m) => a + (wheel[m][w] || 0), 0)])));
        const st = d3.stack().keys(KEYS).order(d3.stackOrderInsideOut)(rows);
        const ang = w => ((w - 2.5) / 52) * 2 * Math.PI;
        const rS = d3.scaleLinear().domain([0, 1]).range([r0, r1]);
        const area = d3.areaRadial().angle((d, k) => ang(k)).innerRadius(d => rS(d[0])).outerRadius(d => rS(d[1])).curve(d3.curveCatmullRomClosed);
        const g = d3.select("#wheel").append("svg").attr("viewBox", `0 0 ${Sz} ${Sz}`).append("g").attr("transform", `translate(${c},${c})`);
        // mood bands, split by thin black gaps so each color reads on its own
        g.selectAll("path").data(st).join("path").attr("d", area).attr("fill", s => GROUP_COLOR[s.key])
          .attr("stroke", INK).attr("stroke-width", 2).attr("stroke-linejoin", "round")
          .call(s => hover(s, s => cap(s.key)));
        // center: a dark hole with a faint rim and an accent spindle, like a record
        g.append("circle").attr("r", r0 - 6).attr("fill", INK).attr("stroke", "rgba(255,255,255,.22)").attr("stroke-width", 1.5);
        g.append("circle").attr("r", r0 - 22).attr("fill", "none").attr("stroke", "rgba(255,255,255,.1)");
        g.append("circle").attr("r", 6).attr("fill", ac);
        // season borders: short ticks just outside the wheel, on the diagonals between the labels,
        // carried on through the bands to the center as a dotted line (dark dots read on every color)
        [0, 1, 2, 3].forEach(k => { const a = ang(k * 13 - 4); const x = Math.sin(a), y = -Math.cos(a);
          g.append("line").attr("x1", x * r0).attr("y1", y * r0).attr("x2", x * (r1 - 2)).attr("y2", y * (r1 - 2))
            .attr("stroke", INK).attr("stroke-width", 3).attr("stroke-linecap", "round").attr("stroke-dasharray", "0 8")
            .attr("pointer-events", "none");
          g.append("line").attr("x1", x * (r1 + 8)).attr("y1", y * (r1 + 8)).attr("x2", x * (r1 + 26)).attr("y2", y * (r1 + 26))
            .attr("stroke", "rgba(255,255,255,.35)").attr("stroke-width", 3).attr("stroke-linecap", "round"); });
        // season names around the outside; the headline season lights up in its mood color
        SEASONS.forEach((n, k) => { const a = ang(k * 13 + 2.5), d = r1 + 30;
          const x = Math.sin(a) * d, y = -Math.cos(a) * d;
          g.append("text").attr("class", "ssn-label" + (n === lead[0] ? " on" : ""))
            .attr("x", x).attr("y", y + 7).attr("text-anchor", k === 1 ? "start" : k === 3 ? "end" : "middle")
            .style("fill", n === lead[0] ? GROUP_COLOR[lead[1]] : null).text(n); });
      } };
  });
