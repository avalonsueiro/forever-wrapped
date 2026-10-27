/* RecordRing: black vinyl records slide out one at a time from behind the previous record. By
   default they form a ring (the title page); give it a `paths` option and they follow any shape
   instead (lines, waves, zigzags... see shapes.js). Each record's center label shows an image (or a
   flat color if there's none).

   Started as a plain-JavaScript copy of record-ring/src/recordRing.ts (no build step needed here).
   Changes since: the records move as one continuous eased motion instead of stopping between each
   one; the loop fades instead of snapping; `labelColors` (Wrapped palette for labels without an
   image); `glowColors` (a colored underglow that lights the records behind each one); `pad`;
   `paths` (any shape, several chains, a size per chain or per record); `totalSeconds`; `fast`; and one image cache shared
   by every RecordRing on the page. */

const RING_DEFAULTS = {
  sizeFraction: 0.19,      // ring only: record diameter as a fraction of the canvas width
  overlap: 0.82,           // ring only: spacing between neighbouring records as a fraction of the diameter
  moveSeconds: 0.075,      // average seconds per record (the whole thing moves as one smooth motion)
  totalSeconds: null,      // or: how long the whole shape takes to form, however many records it has
  speed: 1,                // playback speed multiplier
  loop: true,              // restart after finishing
  loopPauseSeconds: 1.4,   // how long to hold the finished shape before looping
  spinSpeed: 5,            // label spin, radians per second
  vinylColor: "#141416",
  labelFraction: 0.34,     // label size as a fraction of the record radius
  direction: "clockwise",  // ring only
  labelColors: null,       // e.g. ["#ffe500", "#ff2d87"]; null = a different hue per record
  labelGlows: null,        // a glow color for each label image (same order as albums): the neon that
                           // goes with that album cover. Wins over glowColors and a page's own glow.
  glowColors: null,        // colored underglow behind each record, e.g. on a dark background; null = none
  glowSize: 0.35,          // glow blur as a fraction of the record radius
  glowPasses: 1,           // draw the glow this many times; more = brighter
  pad: 0,                  // ring only: empty margin on each side, as a fraction of the canvas
  paths: null,             // (width, height) => [{ r, points: [[x, y, r?, color?], ...], glow? }, ...]; null = the ring
  startDelay: 0,           // seconds to wait before the first record starts moving
  still: false,            // true: every record is already in place (no sliding in); labels still spin
  fast: false,             // paths only: for hundreds of small records. Finished records are drawn once
                           // and kept (their labels stop spinning), and drawing stops when all are done.
};

const ringEaseInOut = x => (x <= 0 ? 0 : x >= 1 ? 1 : 0.5 - Math.cos(Math.PI * x) / 2);   // gentle start and finish

// Label images, shrunk once to a small square and shared by every RecordRing on the page.
// Drawing full-size phone photos (4000+ px) every frame made the animation stutter.
const RING_IMAGE_CACHE = new Map();
function ringLabelImage(url) {
  if (RING_IMAGE_CACHE.has(url)) return RING_IMAGE_CACHE.get(url);
  const entry = { ready: null };
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    const side = 256, c = document.createElement("canvas");
    c.width = c.height = side;
    const scale = Math.max(side / img.naturalWidth, side / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    c.getContext("2d").drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
    entry.ready = c;
  };
  img.src = url;
  RING_IMAGE_CACHE.set(url, entry);
  return entry;
}

class RecordRing {
  constructor(canvas, options = {}) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("RecordRing: 2D canvas context is not available.");
    this.canvas = canvas;
    this.ctx = ctx;
    const { albums = [], ...rest } = options;
    this.opts = { ...RING_DEFAULTS, ...rest };
    this.images = []; this.chains = [];
    this.W = 0; this.H = 0; this.end = 0;
    this.t = 0; this.last = null;
    this.setAlbums(albums);
    this.layout();
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(canvas);
    if (this.opts.still) this.t = 1e6;                // already formed, but keep spinning
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || window.RING_STILL) {   // RING_STILL: screenshots
      this.opts.loop = false;
      this.t = Number.MAX_SAFE_INTEGER;
    }
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Replace the label images. */
  setAlbums(urls) { this.images = urls; }          // loaded lazily, the first time each label is drawn

  /** Change any option at runtime. Layout options rebuild the shape. */
  setOptions(options) {
    this.opts = { ...this.opts, ...options };
    this.layout();
  }

  replay() { this.t = 0; }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
  }

  // Builds this.chains: each chain is a list of slots { r, label, at(k) }, where at(0) is where the
  // record starts (under the previous record) and at(1) where it ends up.
  layout() {
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (W === 0 || H === 0) return;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = W; this.H = H;
    this.chains = this.opts.paths ? this.pathChains(W, H) : [this.ringChain(W)];
    const longest = Math.max(1, ...this.chains.map(c => c.length));
    this.end = this.opts.totalSeconds ?? (longest - 1) * this.opts.moveSeconds;
    if (this.opts.fast && this.opts.paths) {           // start a fresh layer of finished records
      this.cache = document.createElement("canvas");
      this.cache.width = this.canvas.width; this.cache.height = this.canvas.height;
      this.cacheCtx = this.cache.getContext("2d");
      this.cacheCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.cached = this.chains.map(() => 0);
      if (this.stopped) { this.stopped = false; this.raf = requestAnimationFrame(this.frame); }
    }
  }

  ringChain(size) {
    const inner = size * (1 - 2 * this.opts.pad);      // the ring is laid out inside the margin
    const d = inner * this.opts.sizeFraction, r = d / 2;
    const R = inner / 2 - r - 3, c = size / 2;
    const n = this.opts.count ?? Math.max(3, Math.round((2 * Math.PI * R) / (d * this.opts.overlap)));
    const dir = this.opts.direction === "clockwise" ? 1 : -1;
    const angle = i => -Math.PI / 2 + dir * ((i * 2 * Math.PI) / n);
    // records slide along the circle (not straight across), so the ring stays round while forming
    return Array.from({ length: n }, (_, i) => {
      const a0 = angle(Math.max(0, i - 1)), a1 = angle(i);
      return { r, label: i, at: k => { const a = a0 + (a1 - a0) * k; return [c + R * Math.cos(a), c + R * Math.sin(a)]; } };
    });
  }

  pathChains(W, H) {
    let label = 0;
    return this.opts.paths(W, H).filter(p => p.points.length).map(({ r, points, glow }) =>
      points.map((p1, i) => {
        const p0 = points[Math.max(0, i - 1)];
        return { r: p1[2] ?? r, label: label++, color: p1[3] || null,      // optional own size and color per record
          glow: glow && glow.length ? glow[i % glow.length] : null,          // optional own colors per chain
          at: k => [p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k] };
      }));
  }

  frame(ts) {
    if (this.last === null) this.last = ts;
    this.t += Math.min(0.05, (ts - this.last) / 1000) * this.opts.speed;
    this.last = ts;

    // One continuous motion instead of stop-and-go: progress p runs smoothly from 0 to n-1 (easing
    // in at the start and out at the end). Record i slides out from behind record i-1 while p goes
    // from i-1 to i, so the moment one record arrives the next is already moving at the same speed.
    // Several chains form at the same time and finish together.
    const t = this.t - this.opts.startDelay;
    const u = ringEaseInOut(this.end > 0 ? t / this.end : 1);
    if (this.cache) { this.fastFrame(u); return; }
    const placed = [];
    for (const chain of this.chains) {
      const n = chain.length, p = (n - 1) * u;
      for (let i = n - 1; i >= 0; i--) {             // newest first, so each sits behind the one it came from
        if (i > 0 && p <= i - 1) continue;           // still hidden behind the previous record
        const s = chain[i], [x, y] = s.at(i === 0 ? 1 : Math.min(1, p - (i - 1)));
        placed.push([x, y, s]);
      }
    }

    // Fade the finished shape out before it restarts, and back in after, so the loop doesn't snap.
    const fade = this.opts.loop ? 0.5 : 0;
    const sinceDone = t - this.end;
    let alpha = 1;
    if (fade && t < fade) alpha = Math.max(0, t / fade);
    if (fade && sinceDone > this.opts.loopPauseSeconds - fade) alpha = Math.max(0, (this.opts.loopPauseSeconds - sinceDone) / fade);

    const { ctx } = this;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.globalAlpha = alpha;
    // Back to front, each record's glow right before the record itself: like LEDs underneath, a
    // record's glow lights the records behind it, but never the one in front that it came out from.
    for (const [x, y, s] of placed) {
      this.drawGlow(x, y, s.label, s.r, this.glowFor(s));
      this.drawRecord(x, y, s.label, this.t * this.opts.spinSpeed + s.label, s.r, s.color);
    }
    // Closing the ring: the last record was drawn first, so the first record (and its glow) ended up
    // on top of it, unlike every other pair. Fix just that spot, without disturbing the record the
    // last one came out from ("prev"), which must stay on top of it:
    //   1. the last record's glow, over the first record only
    //   2. the last record itself, everywhere except under prev (covers the first record's glow too)
    //   3. prev's glow again, onto the last record, since prev sits in front of it
    // All of it stays inside the first record's own patch (the record plus its glow), and runs on
    // every frame rather than switching on when the two touch. The last record only reaches that
    // patch as it settles, so it moves in front of the first bit by bit, with no frame where the
    // order flips (the glows reach past the discs, so a switch at first contact showed as a jump).
    if (!this.opts.paths && placed.length > 2 && placed[0][2] === this.chains[0].at(-1)) {
      const last = placed[0], prev = placed[1], first = placed[placed.length - 1];
      const disc = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip(); };
      const notUnder = ([x, y, s]) => {              // everywhere except inside this record's circle
        ctx.beginPath(); ctx.rect(0, 0, this.W, this.H); ctx.arc(x, y, s.r, 0, Math.PI * 2); ctx.clip("evenodd");
      };
      const [lx, ly, ls] = last, [px, py, ps] = prev, [fx, fy, fs] = first;
      const patch = () => { notUnder(prev); disc(fx, fy, fs.r * (1 + this.opts.glowSize * 2) + 2); };
      ctx.save(); patch(); disc(fx, fy, fs.r); this.drawGlow(lx, ly, ls.label, ls.r, this.glowFor(ls)); ctx.restore();
      ctx.save(); patch(); this.drawRecord(lx, ly, ls.label, this.t * this.opts.spinSpeed + ls.label, ls.r, ls.color); ctx.restore();
      ctx.save(); patch(); disc(lx, ly, ls.r); this.drawGlow(px, py, ps.label, ps.r, this.glowFor(ps)); ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (this.opts.loop && sinceDone > this.opts.loopPauseSeconds) this.replay();
    this.raf = requestAnimationFrame(this.frame);
  }

  // fast mode: records that have arrived are drawn once into this.cache, each one behind the ones
  // already there ("destination-over"), so every frame only draws the one or two still moving,
  // with the finished layer on top of them (newer records sit behind older ones).
  fastFrame(u) {
    const moving = [];
    let done = u >= 1;
    this.chains.forEach((chain, c) => {
      const p = (chain.length - 1) * u;
      while (this.cached[c] < chain.length && this.cached[c] <= p) this.keep(chain[this.cached[c]++]);
      const i = this.cached[c];
      if (i < chain.length) {
        done = false;
        if (p > i - 1) moving.push(chain[i].at(Math.min(1, p - (i - 1))).concat([chain[i]]));
      }
    });
    const { ctx } = this;
    ctx.clearRect(0, 0, this.W, this.H);
    for (const [x, y, s] of moving) {
      this.drawGlow(x, y, s.label, s.r, this.glowFor(s));
      this.drawRecord(x, y, s.label, s.label, s.r, s.color);
    }
    ctx.drawImage(this.cache, 0, 0, this.W, this.H);
    if (done) { this.stopped = true; return; }             // nothing moves any more: stop drawing
    this.raf = requestAnimationFrame(this.frame);
  }

  keep(s) {
    const [x, y] = s.at(1), dpr = window.devicePixelRatio || 1;
    const half = Math.ceil(s.r * (1 + this.opts.glowSize * 1.5) + 2);
    const tmp = document.createElement("canvas");
    tmp.width = tmp.height = Math.ceil(2 * half * dpr);
    const tctx = tmp.getContext("2d");
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const main = this.ctx;
    this.ctx = tctx;                                   // draw the record (and its glow) on its own first
    this.drawGlow(half, half, s.label, s.r, this.glowFor(s));
    this.drawRecord(half, half, s.label, s.label, s.r, s.color);
    this.ctx = main;
    this.cacheCtx.globalCompositeOperation = "destination-over";
    this.cacheCtx.drawImage(tmp, x - half, y - half, 2 * half, 2 * half);
    this.cacheCtx.globalCompositeOperation = "source-over";
  }

  // which neon a record glows: its own color (page 1's years), else the one that goes with its
  // album cover, else the page's or chain's colors
  glowFor(s) {
    const lg = this.opts.labelGlows;
    return s.color || (lg && lg.length && this.images.length ? lg[s.label % this.images.length] : null) || s.glow;
  }

  drawGlow(x, y, index, r, color) {
    const glow = this.opts.glowColors;
    if (!color && (!glow || !glow.length)) return;
    const { ctx } = this;
    ctx.save();
    ctx.shadowColor = color || glow[index % glow.length];
    ctx.shadowBlur = r * this.opts.glowSize;
    ctx.fillStyle = this.opts.vinylColor;      // the disc itself is covered by the record drawn next
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    for (let p = 0; p < this.opts.glowPasses; p++) ctx.fill();
    ctx.restore();
  }

  drawRecord(x, y, index, spin, r, labelColor) {
    const { ctx } = this;
    const hue = Math.round((index * 360) / 12) % 360;
    const labelR = r * this.opts.labelFraction;

    ctx.save();
    ctx.translate(x, y);

    // Vinyl
    ctx.fillStyle = this.opts.vinylColor;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Grooves
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = Math.max(0.6, r * 0.012);
    for (let f = 0.94; f > this.opts.labelFraction + 0.08; f -= 0.07) {
      ctx.beginPath();
      ctx.arc(0, 0, r * f, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.rotate(spin);

    // Sheen
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    for (const a of [0, Math.PI]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r * 0.97, a - 0.28, a + 0.28);
      ctx.closePath();
      ctx.fill();
    }

    // Label
    const img = this.images.length ? ringLabelImage(this.images[index % this.images.length]) : undefined;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, labelR, 0, Math.PI * 2);
    ctx.clip();
    if (img && img.ready && !labelColor) {
      ctx.drawImage(img.ready, -labelR, -labelR, labelR * 2, labelR * 2);   // already cropped square
    } else {
      const colors = this.opts.labelColors;
      ctx.fillStyle = labelColor || (colors && colors.length ? colors[index % colors.length] : `hsl(${hue} 72% 55%)`);
      ctx.fillRect(-labelR, -labelR, labelR * 2, labelR * 2);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(-r * 0.2, -r * 0.17, r * 0.4, r * 0.05);
      ctx.fillRect(-r * 0.13, r * 0.12, r * 0.26, r * 0.035);
    }
    ctx.restore();

    // Spindle hole
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.045, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
