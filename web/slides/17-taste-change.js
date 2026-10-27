/* Page 17: your taste changed most (year to year, artists in/out).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */

// The records: a fork. Two chains come in together from the left edge and split apart: the
// artists that came in climb away along the top of the page, the artists that went out run along
// the bottom: a mirror image, same size records. Same idea on a phone, under the text.
function tasteForkTrail(W, H) {
  const u = shapeUnit(W, H), wide = W / H > 0.9;
  const ease = t => t * t * (3 - 2 * t);
  // one branch: a shared stem from s0 to s1, a quick turn to [xTurn, yTurn], then a straight run to `end`
  const branch = (s0, s1, xTurn, yTurn, end) => {
    const L1 = s1[0] - s0[0], L2 = xTurn - s1[0], L3 = end[0] - xTurn, L = L1 + L2 + L3;
    return t => {
      const x = s0[0] + t * L;
      if (x < s1[0]) return [x, s0[1]];
      if (x < xTurn) return [x, lerp(s1[1], yTurn, ease((x - s1[0]) / L2))];
      return [x, lerp(yTurn, end[1], (x - xTurn) / L3)];
    };
  };
  // mirrored: both branches the same size, splitting the same distance up and down from the stem
  let inCurve, outCurve, rIn, rOut;
  if (wide) {
    // turn in the middle of the left margin (the text is at most 1100px wide and centered)
    const xTurn = Math.max(0.12, (W - 1100) / 2 / W - 0.07);
    // centre the fork on the text: measure where the words actually are, and run the two branches
    // the same distance above and below them
    const box = document.querySelector("#slide .inner")?.getBoundingClientRect();
    const c = box && box.height ? (box.top + box.bottom) / 2 / H : 0.5;
    const half = Math.min(0.42, Math.max(0.3, box && box.height ? box.height / 2 / H + 0.1 : 0.36));
    const s0 = [-0.07, c], s1 = [xTurn - 0.095, c];
    inCurve = branch(s0, s1, xTurn, c - half, [1.07, c - half - 0.03]);
    outCurve = branch(s0, s1, xTurn, c + half, [1.07, c + half + 0.03]);
    rIn = rOut = 0.04;
  } else {
    const c = 0.88, s0 = [-0.12, c], s1 = [0.1, c];
    inCurve = branch(s0, s1, 0.42, c - 0.1, [1.12, c - 0.12]);
    outCurve = branch(s0, s1, 0.42, c + 0.1, [1.12, c + 0.12]);
    rIn = rOut = 0.058;
  }
  const chain = (curve, r) => {
    const R = r * u;
    return { r: R, points: shapeSpaced(t => { const [x, y] = curve(t); return [x * W, y * H]; }, 2 * R * SHAPE_OVERLAP) };
  };
  // "out" first so the brighter "in" branch sits on top where they share the stem
  return [chain(outCurve, rOut), chain(inCurve, rIn)];
}

defineSlide("taste-change", () => {
    const b = D.yvy && D.yvy.biggest_shift;
    if (!b) return null;
    const list = a => a.slice(0, 2).map(n => `<li>${esc(n)}</li>`).join("");
    return { theme: "flame", html: `<div class="inner tc">
      <p class="kick rise tc-kick">Your taste changed most</p>
      <h1 class="huge rise d1 tc-years">${b.from}<span class="tc-arrow">→</span>${String(b.to).slice(2)}</h1>
      <div class="tc-cols rise d2">
        <div class="tc-col tc-out"><span class="tag tc-tag">Out</span><ul class="tc-list">${list(b.drivers.artists_down)}</ul></div>
        <div class="tc-col tc-in"><span class="tag tc-tag">In</span><ul class="tc-list">${list(b.drivers.artists_up)}</ul></div>
      </div></div>`,
      trail: tasteForkTrail,
      glow: ["#ff2e2e", "#ff2d87", "#ff2e2e", "#ffe500"] };
  });
