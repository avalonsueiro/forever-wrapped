/* Page 07: night owl / early bird (24-hour listening clock).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */

// Records sweep through the bottom-left corner in an S-curve, like the day flowing past.
// On a phone they run along the bottom under the clock instead.
const clockTrail = (W, H) => W / H < 0.8
  ? SHAPES.scurve({ from: [-0.12, 0.985], to: [1.12, 0.885], r: 0.105 })(W, H)
  : SHAPES.scurve({ from: [-0.06, 0.79], to: [0.52, 1.05], r: 0.066 })(W, H);

defineSlide("listening-clock", () => {
    const L = D.listening;
    const hrs = yr() ? L.radial_by_year[yr()] : d3.range(24).map(h => d3.sum(Object.values(L.radial_by_year), v => v[h]));
    const peak = d3.maxIndex(hrs);
    const persona = peak >= 21 || peak < 4 ? "Night owl" : peak < 10 ? "Early bird" : peak < 17 ? "Daytime listener" : "Evening listener";
    return { theme: "violet", html: `<div class="inner lc"><div class="lc-row">
      <div class="lc-text"><p class="kick rise">You're a</p><h1 class="big lc-big rise d1">${persona}</h1>
      <p class="sub rise d2">Your peak hour ${when()}: <b class="lc-peak">${hourLabel(peak)}</b>.</p></div>
      <div class="chart lc-clock rise d2" id="clock"></div></div></div>`,
      trail: clockTrail,
      glow: ["#ffe500", "#ff8a00", "#ff2d87", "#9d6bff", "#4f6bff"],   // dawn to night
      after() {
        const S = 480, c = S / 2, r0 = 82, r1 = 196, mx = d3.max(hrs) || 1, [, , ac] = THEMES.violet;
        const TAU = 2 * Math.PI, ang = h => h / 24 * TAU;
        const svg = d3.select("#clock").append("svg").attr("viewBox", `0 0 ${S} ${S}`)
          .attr("role", "img").attr("aria-label", `Listening by hour of the day, peak at ${hourLabel(peak)}`);
        // soft glow for the peak bar
        svg.append("defs").html(`<filter id="lc-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
        const g = svg.append("g").attr("transform", `translate(${c},${c})`);

        // faint guide rings, then the outer dial with a tick per hour
        [0.33, 0.66, 1].forEach(f => g.append("circle").attr("r", r0 + (r1 - r0) * f)
          .attr("fill", "none").attr("stroke", "#fff").attr("stroke-opacity", 0.07).attr("stroke-dasharray", "2 5"));
        g.append("circle").attr("r", r1 + 14).attr("fill", "none").attr("stroke", "#fff").attr("stroke-opacity", 0.18);
        d3.range(24).forEach(h => { const a = ang(h), big = h % 6 === 0, rA = r1 + 14, rB = rA + (big ? 9 : 5);
          g.append("line").attr("x1", Math.sin(a) * rA).attr("y1", -Math.cos(a) * rA).attr("x2", Math.sin(a) * rB).attr("y2", -Math.cos(a) * rB)
            .attr("stroke", "#fff").attr("stroke-opacity", big ? 0.5 : 0.22).attr("stroke-width", big ? 2 : 1.2); });

        // one bar per hour: brighter white the more you listened, the peak hour in the accent
        const arc = d3.arc();
        hrs.forEach((v, h) => g.append("path").attr("d", arc({ innerRadius: r0, outerRadius: r0 + (r1 - r0) * (0.1 + 0.9 * v / mx),
          startAngle: ang(h) + 0.035, endAngle: ang(h + 1) - 0.035, cornerRadius: 3 }))
          .attr("fill", h === peak ? ac : "#fff").attr("fill-opacity", h === peak ? 1 : 0.18 + 0.62 * v / mx)
          .attr("filter", h === peak ? "url(#lc-glow)" : null)
          .call(s => hover(s, () => `${hourLabel(h)} · ${fmt(v)} min`)));

        // center: a dark label with the peak hour
        g.append("circle").attr("r", r0 - 10).attr("fill", "#0b0b0b").attr("stroke", "#fff").attr("stroke-opacity", 0.12);
        g.append("text").attr("class", "lc-hour").attr("y", 8).attr("text-anchor", "middle").attr("fill", ac).text(hourLabel(peak));
        g.append("text").attr("class", "lc-cap").attr("y", 30).attr("text-anchor", "middle").text("peak");

        // hour names at the four quarters
        [0, 6, 12, 18].forEach(h => { const a = ang(h), rr = r1 + 32;
          g.append("text").attr("class", "lc-q").attr("x", Math.sin(a) * rr).attr("y", -Math.cos(a) * rr + (h === 12 ? 12 : h === 0 ? 0 : 5))
            .attr("text-anchor", h === 6 ? "start" : h === 18 ? "end" : "middle").text(hourLabel(h)); });
      } };
  });
