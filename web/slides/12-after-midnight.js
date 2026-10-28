/* Page 12: after midnight you get ... (mood by hour strip).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */

// The records: one low, slow wave along the bottom edge, half sunk below it like something drifting
// off to sleep. It sags a little toward the right as the night goes on. Bigger on a phone, where the
// bottom half of the screen is empty.
function afterMidnightTrail(W, H) {
  const tall = W / H < 0.9;
  const y0 = tall ? 0.86 : 0.95, y1 = tall ? 0.92 : 0.99, amp = tall ? 0.025 : 0.018, r = tall ? 0.085 : 0.055;
  return shapeChain(t => [lerp(-0.06, 1.06, t), lerp(y0, y1, t) + amp * Math.sin(t * 2.5 * 2 * Math.PI)], r)(W, H);
}

// Night hours (the ones the headline is about)
const AM_NIGHT = [23, 0, 1, 2, 3];

defineSlide("after-midnight", () => {
    if (!TAGGED) return null;
    // real share of each mood group per hour, and for the night hours together
    // a picked year: that year's own hours (skipped when it had too little late-night listening)
    const M = yr() ? (D.mood_by_hour.by_year || {})[yr()] : D.mood_by_hour.all;
    if (!M) return null;
    const byHour = d3.range(24).map(h => moodGroups(Object.fromEntries(MOODS.map(m => [m, M[m][h]]))));
    const nightMix = moodGroups(Object.fromEntries(MOODS.map(m => [m, d3.sum(AM_NIGHT, h => M[m][h])])));
    const night = topGroup(nightMix);
    const KEYS = MOOD_GROUPS.map(([g]) => g);
    return { theme: "night",
      html: `<div class="inner am">
      <p class="kick rise am-kick">${yr() ? `in ${yr()}, after midnight you got` : "after midnight you get"}</p>
      <h1 class="huge rise d1 am-mood" style="color:${GROUP_COLOR[night]}">${night}</h1>
      <p class="sub rise d1 am-share">${Math.round(nightMix[night] * 100)}% of what you ${yr() ? "played" : "play"} between 11pm and 4am</p>
      <div class="chart rise d2 am-strip" id="hourstrip"></div>
      <div class="rise d3 am-legend"><div class="legend">${KEYS.map(g => `<span><i style="background:${GROUP_COLOR[g]}"></i>${g}</span>`).join("")}</div></div></div>`,
      after() {
        const box = document.getElementById("hourstrip");
        const W = Math.max(300, box.clientWidth || 1100), narrow = W < 600;
        // the day runs noon to noon so the night sits in the middle, all in one piece
        const order = d3.range(24).map(i => (i + 12) % 24);
        const gap = narrow ? 2 : 4, cw = W / 24, top = narrow ? 62 : 74, cellH = narrow ? 96 : 84, lift = narrow ? 30 : 34;
        const fs = narrow ? 12 : 15, H = top + cellH + (narrow ? 26 : 34);
        const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`);
        const isNight = h => AM_NIGHT.includes(h);
        // bracket over the night hours
        const n0 = order.indexOf(23), n1 = order.indexOf(3);
        const bx0 = n0 * cw + gap / 2, bx1 = (n1 + 1) * cw - gap / 2, by = top - lift - 10;
        svg.append("path").attr("class", "am-bracket")
          .attr("d", `M${bx0},${by + 7} V${by} H${bx1} V${by + 7}`);
        svg.append("text").attr("class", "am-brlabel").attr("x", (bx0 + bx1) / 2).attr("y", by - 8)
          .attr("text-anchor", "middle").style("font-size", `${fs}px`).text("after midnight");
        // one bar per hour, stacked by mood group (biggest at the bottom); the night ones stand taller
        // and the rest are dimmed a little so the night reads first
        order.forEach((h, i) => {
          const lit = isNight(h), y0 = lit ? top - lift : top + lift, hh = lit ? cellH + lift : cellH - lift;
          const g = svg.append("g").attr("class", lit ? "am-cell am-lit" : "am-cell").attr("opacity", lit ? 1 : 0.55);
          const clip = `am-clip-${h}`;
          svg.append("clipPath").attr("id", clip).append("rect").attr("x", i * cw + gap / 2).attr("y", y0)
            .attr("width", cw - gap).attr("height", hh).attr("rx", narrow ? 4 : 8);
          g.attr("clip-path", `url(#${clip})`);
          let y = y0 + hh;
          KEYS.slice().sort((a, b) => byHour[h][b] - byHour[h][a]).forEach(k => {
            const part = hh * byHour[h][k]; y -= part;
            g.append("rect").attr("x", i * cw + gap / 2).attr("y", y).attr("width", cw - gap).attr("height", part)
              .attr("fill", GROUP_COLOR[k]);
          });
          const top3 = KEYS.slice().sort((a, b) => byHour[h][b] - byHour[h][a]).slice(0, 3);
          g.call(s => hover(s, () => `${hourLabel(h)} · ${top3.map(k => `${k} ${Math.round(byHour[h][k] * 100)}%`).join(", ")}`));
        });
        // hour labels under the strip
        [12, 18, 0, 6, 11].forEach(h => {
          const i = order.indexOf(h);
          svg.append("text").attr("class", h === 0 ? "am-hr am-hr-mid" : "am-hr")
            .attr("x", i * cw + cw / 2).attr("y", top + cellH + fs + (narrow ? 8 : 12))
            .attr("text-anchor", "middle").style("font-size", `${fs}px`).text(hourLabel(h).toLowerCase());
        });
      },
      // no records here: the hour chart is the picture
    };
  });
