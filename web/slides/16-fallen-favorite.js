/* Page 16: you used to love ... (fallen favorite).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("fallen-favorite", () => {
    // one year: the favorite you turned on that year (no such song, no page)
    const f = yr() ? (D.fallen_by_year || {})[yr()] : (D.fallen || [])[0];
    if (!f) return null;
    const ac = THEMES.cobalt[2];
    const skipped = Math.round(f.late_rate * 100);

    // records: a favorite falling. they sit level for a moment, then tip over and drop off the screen.
    // desktop: down the empty right side, clear of the hint in the corner. phone: along the bottom, under the chart.
    const falling = (W, H) => {
      const phone = W / H < 0.8;
      const curve = phone
        ? t => [lerp(-0.12, 1.1, t), 0.75 + 0.36 * Math.pow(t, 3)]
        : t => [lerp(0.67, 0.86, t), 0.21 + 0.94 * Math.pow(t, 2.6)];
      return shapeChain(curve, phone ? 0.08 : 0.065)(W, H);
    };

    return { theme: "cobalt", html: `<div class="inner ff16"><p class="kick rise">You used to love</p>
      <h1 class="big ff16-title rise d1" style="${fit(clean(f.track))}">${esc(clean(f.track))}</h1>
      <p class="sub rise d2">Then you started skipping it${f.burnout_date ? `, around ${date(f.burnout_date)}` : ""}.</p>
      <div class="chart ff16-chart rise d3" id="fall"></div></div>
      ${f.cover ? `<figure class="song-cover rise d2" style="--glow:${f.cover.glow}"><img src="${encodeURI(f.cover.src)}" alt=""></figure>` : ""}`,
      after() {
        // the same skip curve, drawn as how often it got played through (1 - skip rate),
        // so the line falls the way the love did
        const box = document.getElementById("fall");
        const W = Math.max(280, box.clientWidth || 1000), small = W < 560;
        const H = small ? 150 : 170, top = 14, pad = 10;
        const c = f.curve.map(v => 1 - v);
        const x = d3.scaleLinear().domain([0, c.length - 1]).range([pad, W - pad]);
        const y = d3.scaleLinear().domain([0, 1]).range([top + H, top]);
        const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${top + H + (small ? 30 : 38)}`)
          .attr("role", "img").attr("aria-label", `played through at first, skipped ${skipped}% of the time by the end`);

        // faint guides: "always played through" on top, "always skipped" at the bottom
        [0, 1].forEach(v => svg.append("line").attr("x1", 0).attr("x2", W).attr("y1", y(v)).attr("y2", y(v))
          .attr("stroke", "#fff").attr("stroke-opacity", v ? 0.15 : 0.3).attr("stroke-dasharray", v ? "2 6" : null));

        const curve = d3.curveMonotoneX;
        svg.append("path").datum(c).attr("fill", ac).attr("fill-opacity", 0.16)
          .attr("d", d3.area().x((d, i) => x(i)).y0(y(0)).y1(d => y(d)).curve(curve));
        const line = svg.append("path").datum(c).attr("fill", "none").attr("stroke", ac)
          .attr("stroke-width", small ? 4 : 5).attr("stroke-linecap", "round").attr("stroke-linejoin", "round")
          .attr("d", d3.line().x((d, i) => x(i)).y(d => y(d)).curve(curve));
        line.style("filter", `drop-shadow(0 0 10px ${ac})`);

        // draw the line in from the left, unless screenshots want the last frame
        if (!window.RING_STILL) {
          const len = line.node().getTotalLength();
          line.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
            .transition().delay(350).duration(1400).ease(d3.easeCubicInOut).attr("stroke-dashoffset", 0);
        }

        // a dot where it started and where it ended up
        const last = c.length - 1;
        [[0, "#fff"], [last, ac]].forEach(([i, col]) => svg.append("circle").attr("cx", x(i)).attr("cy", y(c[i]))
          .attr("r", small ? 6 : 8).attr("fill", col).attr("stroke", "#121212").attr("stroke-width", 3));

        const ty = top + H + (small ? 24 : 30), fs = small ? "13px" : "16px";
        svg.append("text").attr("x", 0).attr("y", ty).style("font-size", fs).text("First plays");
        svg.append("text").attr("x", W).attr("y", ty).attr("text-anchor", "end").style("font-size", fs)
          .style("fill", ac).text(`Skipped ${skipped}% of the time`);
      } ,
      // the song's album cover instead of records
    };
  });
