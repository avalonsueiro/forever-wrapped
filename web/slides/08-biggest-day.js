/* Page 08: your biggest day + longest streak.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("biggest-day", () => {
    const daily = Object.entries(D.calendar.daily).filter(([d]) => !yr() || d.startsWith(yr()));
    if (!daily.length) return null;
    const [day, mins] = daily.reduce((a, b) => b[1] > a[1] ? b : a);
    // longest run of days in a row with music (a picked year: within that year)
    const st = !yr() ? D.calendar.longest_streak : { days: (() => {
      let best = 0, run = 0, prev = null;
      daily.filter(([, m]) => m > 0).map(([d]) => d).sort().forEach(d => {
        const t = new Date(d + "T12:00:00");
        run = prev && (t - prev) / 864e5 < 1.5 ? run + 1 : 1; best = Math.max(best, run); prev = t;
      });
      return best;
    })() };

    // the three weeks around the big day, so the spike shows (days with no data count as 0)
    const SPAN = 10, t0 = new Date(day + "T12:00:00");
    const around = d3.range(-SPAN, SPAN + 1).map(k => {
      const d = new Date(t0); d.setDate(d.getDate() + k);
      const key = d.toISOString().slice(0, 10);
      return { key, k, v: D.calendar.daily[key] || 0 };
    });

    // records: three parallel diagonals bursting up out of the bottom right corner, like light rays
    // from one huge day. Steep on wide screens (right of the text), shallow on a phone (below it).
    const burst = (W, H) => {
      const phone = W < 700, u = shapeUnit(W, H);
      const r = phone ? 0.08 : 0.054, R = r * u;
      const ang = (phone ? 30 : 62) * Math.PI / 180, dx = -Math.cos(ang), dy = -Math.sin(ang);
      const step = 2.7 * R / Math.sin(ang);                 // gap between lines, measured along the bottom edge
      const x0 = phone ? W + 1.6 * step : W + 0.4 * step;   // where the rightmost line leaves the bottom edge
      const lens = phone ? [1.55 * W, 1.45 * W, 1.2 * W] : [0.6 * H, 0.98 * H, 0.52 * H];
      return lens.flatMap((len, i) => {
        const fx = x0 - i * step, fy = H + R;
        return SHAPES.line({ from: [fx / W, fy / H], to: [(fx + dx * len) / W, (fy + dy * len) / H], r })(W, H);
      });
    };

    return { theme: "sunset",
      // one hero (the minutes); the date steps back into a sentence underneath
      html: `<div class="inner bd8">
        <p class="kick rise">Your biggest day, ${when()}</p>
        <h1 class="bd8-mins rise d1"><span class="bd8-num" data-count="${mins}">${fmt(mins)}</span><span class="bd8-unit">minutes in one day</span></h1>
        <p class="bd8-when rise d2">that's ${(mins / 60).toFixed(1)} hours, on <b>${new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })}, ${date(day)}</b>.</p>
        <div class="bd8-chart rise d3" id="bd8-chart"></div>
        <p class="bd8-streak rise d4"><b>${st.days}</b> days in a row: your longest streak${yr() ? ` of ${yr()}` : ""}.</p>
      </div>`,
      after() {
        const el = document.getElementById("bd8-chart"); if (!el) return;
        const W = 520, H = 140, pad = 22, mx = d3.max(around, d => d.v) || 1, ac = THEMES.sunset[2];
        const x = d3.scaleBand().domain(around.map(d => d.k)).range([0, W]).padding(0.28);
        const y = d3.scaleLinear().domain([0, mx]).range([0, H - pad - 18]);
        const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMinYMax meet");
        svg.append("line").attr("x1", 0).attr("x2", W).attr("y1", H - 17).attr("y2", H - 17).attr("stroke", "#fff").attr("stroke-opacity", 0.2);
        svg.selectAll("rect").data(around).join("rect")
          .attr("x", d => x(d.k)).attr("width", x.bandwidth()).attr("rx", Math.min(4, x.bandwidth() / 2))
          .attr("y", d => H - 18 - Math.max(2, y(d.v))).attr("height", d => Math.max(2, y(d.v)))
          .attr("fill", d => d.k === 0 ? ac : "#fff").attr("fill-opacity", d => d.k === 0 ? 1 : 0.28)
          .call(s => hover(s, d => `${fmtDay(d.key)} · ${fmt(d.v)} min`));
        const peak = around.find(d => d.k === 0);                // name the spike, so it's clearly that day
        svg.append("text").attr("x", x(0) + x.bandwidth() / 2).attr("y", H - 22 - Math.max(2, y(peak.v)))
          .attr("text-anchor", "middle").style("fill", ac).style("font-weight", 900).text(fmtDay(day));
        svg.append("text").attr("x", 0).attr("y", H - 2).attr("opacity", 0.5).text(fmtDay(around[0].key));
        svg.append("text").attr("x", W).attr("y", H - 2).attr("text-anchor", "end").attr("opacity", 0.5).text(fmtDay(around[around.length - 1].key));
      },
      trail: burst,
      glow: ["#ff2d87", "#ffe500", "#ff2e2e", "#9d6bff"],
    };
  });
