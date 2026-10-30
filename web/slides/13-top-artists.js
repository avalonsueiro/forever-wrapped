/* Page 13: top 5 artists.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("top-artists", () => {
    const list = D.tops[yr() ?? "all"].artists.slice(0, 5);
    if (!list.length) return null;
    const top = list[0].minutes || 1;
    // each row: rank, name, and a bar sized against the #1 artist, hours at the right
    const rows = list.map((a, k) => `<li class="ta-row rise d${k + 1}" style="--w:${Math.max(0.04, a.minutes / top).toFixed(3)}">
        <span class="ta-n">${k + 1}</span>
        <span class="ta-t">${esc(a.artist)}</span>
        <span class="ta-meter"><i class="ta-track"><i class="ta-fill"></i></i><b class="ta-v">${fmt(a.minutes / 60)}h</b></span>
      </li>`).join("");
    return {
      theme: "lime",
      html: `<div class="inner ta"><p class="kick ta-kick rise">Top artists, ${when()}</p><ol class="ta-list">${rows}</ol></div>`,
      // a column of records waving down the right side; on a phone it runs along the bottom instead
      trail: (W, H) => W / H < 0.8
        ? SHAPES.wave({ y: 0.85, amp: 0.022, waves: 1, x0: -0.15, x1: 1.15, r: 0.16 })(W, H)
        : SHAPES.vwave({ x: 0.86, amp: 0.035, waves: 1.25, y0: 0.27, y1: 1.15, r: 0.13 })(W, H),
      glow: ["#c8ff00", "#4f6bff"],
    };
  });
