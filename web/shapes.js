/* Record shapes for the slides. Each SHAPES.* call returns a function (W, H) => [{ r, points }]
   that RecordRing's `paths` option understands: one chain of records per entry, spaced evenly along
   the curve and slightly overlapping, like the title page ring.

   Units, so a shape fits any window:
     positions  fractions of the screen: x 0 = left edge, 1 = right edge; y 0 = top, 1 = bottom
                (values outside 0..1 are off screen, e.g. y: 1 puts record centers on the bottom
                edge so the edge cuts them in half)
     r          record radius as a fraction of the screen's short side (min of height and 1.2 x width)

   House rule: no rings, circles or arcs. The ring belongs to the title page (and maybe the end
   screen). Lines, waves, zigzags, diagonals, stairs, S-curves and single records are all fine. */

const SHAPE_OVERLAP = 0.82;   // spacing between record centers as a fraction of the diameter (same as the ring)

const shapeUnit = (W, H) => Math.min(H, W * 1.2);

// Walk along fn(t), t from 0 to 1, and drop a record center every `step` pixels of curve length.
function shapeSpaced(fn, step) {
  const pts = [], N = 2000;
  let prev = fn(0), acc = step;     // acc = step so the very first point is placed
  for (let i = 0; i <= N; i++) {
    const p = fn(i / N);
    acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    if (acc >= step) { pts.push(p); acc = 0; }
    prev = p;
  }
  return pts;
}

// Build one chain from a curve given in screen fractions.
function shapeChain(curve, r) {
  return (W, H) => {
    const R = r * shapeUnit(W, H);
    return [{ r: R, points: shapeSpaced(t => { const [x, y] = curve(t); return [x * W, y * H]; }, 2 * R * SHAPE_OVERLAP) }];
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

const SHAPES = {
  /** Straight line from `from` to `to`, e.g. { from: [1.05, 0.9], to: [0.55, 0.1], r: 0.08 }. */
  line: ({ from, to, r = 0.07 }) => shapeChain(t => [lerp(from[0], to[0], t), lerp(from[1], to[1], t)], r),

  /** A row along one screen edge with every record cut in half by it.
      edge: "top" | "bottom" | "left" | "right"; span: [start, end] along that edge. */
  edge: ({ edge = "bottom", span = [-0.05, 1.05], r = 0.06 }) => {
    const along = t => lerp(span[0], span[1], t);
    const curve = { top: t => [along(t), 0], bottom: t => [along(t), 1], left: t => [0, along(t)], right: t => [1, along(t)] }[edge];
    return shapeChain(curve, r);
  },

  /** Sine wave from x0 to x1 around height y. amp is in screen heights, waves = number of full waves. */
  wave: ({ y = 0.85, amp = 0.06, waves = 1.5, x0 = -0.05, x1 = 1.05, phase = 0, r = 0.06 }) =>
    shapeChain(t => [lerp(x0, x1, t), y + amp * Math.sin(phase + t * waves * 2 * Math.PI)], r),

  /** Vertical sine wave (a wave running top to bottom) around x. amp is in screen widths. */
  vwave: ({ x = 0.85, amp = 0.05, waves = 1.5, y0 = -0.05, y1 = 1.05, phase = 0, r = 0.06 }) =>
    shapeChain(t => [x + amp * Math.sin(phase + t * waves * 2 * Math.PI), lerp(y0, y1, t)], r),

  /** Zigzag between two points; zigs = number of corners, amp = sideways size in screen fractions. */
  zigzag: ({ from, to, zigs = 4, amp = 0.08, r = 0.05 }) => shapeChain(t => {
    const x = lerp(from[0], to[0], t), y = lerp(from[1], to[1], t);
    const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy) || 1;
    const tri = 1 - Math.abs(((t * zigs * 2) % 2) - 1);          // 0 → 1 → 0 triangle wave
    const off = (tri - 0.5) * 2 * amp;
    return [x - (dy / len) * off, y + (dx / len) * off];          // push sideways, perpendicular to the line
  }, r),

  /** Smooth S-curve between two points (cubic ease), good for a sweep across a corner. */
  scurve: ({ from, to, r = 0.07 }) => shapeChain(t => {
    const e = t * t * (3 - 2 * t);
    return [lerp(from[0], to[0], t), lerp(from[1], to[1], e)];
  }, r),

  /** Staircase: `steps` flat runs that drop (or climb) between `from` and `to`. */
  stairs: ({ from, to, steps = 4, r = 0.05 }) => shapeChain(t => {
    const seg = Math.min(steps - 1e-9, t * steps), k = Math.floor(seg), f = seg - k;
    const runFrac = 0.7;                                          // 70% of each step is flat, 30% the drop
    const yk = k + (f < runFrac ? 0 : (f - runFrac) / (1 - runFrac));
    return [lerp(from[0], to[0], t), lerp(from[1], to[1], yk / steps)];
  }, r),

  /** Straight segments through the given points (screen fractions), records evenly spaced along them.
      Sharper than zigzag, which bunches records at its corners. e.g. { points: [[0, 1], [0.3, 0.6], [0.6, 0.9]] } */
  polyline: ({ points, r = 0.05 }) => shapeChain(t => {
    const segs = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
    let d = t * segs.reduce((a, b) => a + b, 0), i = 0;
    while (i < segs.length - 1 && d > segs[i]) d -= segs[i++];
    const f = segs[i] ? d / segs[i] : 0;
    return [lerp(points[i][0], points[i + 1][0], f), lerp(points[i][1], points[i + 1][1], f)];
  }, r),

  /** One record (no motion), e.g. a big one half off a corner: { x: 1, y: 1, r: 0.35 }. */
  one: ({ x, y, r = 0.2 }) => (W, H) => [{ r: r * shapeUnit(W, H), points: [[x * W, y * H]] }],

  /** Several shapes at once; they all form at the same time. */
  combine: (...shapes) => (W, H) => shapes.flatMap(s => s(W, H)),
};
