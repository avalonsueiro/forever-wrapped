/* Page 06: top 5 songs.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("top-songs", () => {
  const list = D.tops[yr() ?? "all"].songs.slice(0, 5);
  if (!list.length) return null;
  const top = list[0].plays || 1;
  // one row per song; the thin bar under it shows plays compared to #1
  const row = (s, k) => `<li class="ts-row rise d${k + 1}" style="--w:${Math.min(100, s.plays / top * 100).toFixed(1)}%">
      <span class="ts-n">${k + 1}</span>
      <span class="ts-t"><b>${esc(clean(s.track))}</b><small>${esc(s.artist)}</small></span>
      <span class="ts-v">${fmt(s.plays)}<em> plays</em></span>
      <i class="ts-bar"></i></li>`;
  return {
    theme: "lemon",
    html: `<div class="inner ts">
      <p class="kick rise">Top songs, ${when()}</p>
      <ol class="ts-list">${list.map(row).join("")}</ol></div>`,
    // records ride a sound wave along the bottom, under the list
    trail: (W, H) => W < 700
      ? SHAPES.wave({ y: 0.94, amp: 0.03, waves: 1.25, x0: -0.15, x1: 1.15, r: 0.11 })(W, H)
      : SHAPES.wave({ y: 1.02, amp: 0.035, waves: 2, x0: -0.04, x1: 1.04, r: 0.07 })(W, H),
  };
});
