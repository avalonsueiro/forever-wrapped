/* Forever, Wrapped: the shell. Shows the pages from web/slides/ one at a time (render), runs each
 * page's record trail behind it, the title page, keys, the year picker and ?slide= / ?era= links. */
"use strict";
const SLIDES = window.SLIDE_DEFS.map(d => d.build);

/* ---------------- shell ---------------- */
// Each page's records: one canvas behind the page, rebuilt when the page changes.
let trail = null, current = null, trailsOn = false;
let cleanup = null;    // a page's after() may return a function; it runs when you leave the page
const TRAIL_DEFAULTS = { labelColors: RING_COLORS, glowColors: RING_COLORS, glowSize: 0.8, glowPasses: 2,
  spinSpeed: 2.5, loop: false, totalSeconds: 2.4, startDelay: 0.15 };
function startTrail(s) {
  if (trail) { trail.destroy(); trail = null; }
  const c = $("#trail");
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  if (!s || !s.trail) return;
  const L = labels();                   // every page starts from your #1 album (of the picked year); no repeats within a page
  trail = new RecordRing(c, { ...TRAIL_DEFAULTS, paths: s.trail,
    glowColors: s.glow || TRAIL_DEFAULTS.glowColors,
    albums: L.albums, labelGlows: L.glows,
    ...(s.trailOptions || {}) });                                       // a page can override any of these
}

function build(i) { try { return SLIDES[i](); } catch (e) { console.error(e); return null; } }
function render() {
  let s = build(state.i);
  // a slide with nothing to show skips itself in the direction you were going
  while (!s && state.i + state.dir >= 0 && state.i + state.dir < SLIDES.length) { state.i += state.dir; s = build(state.i); }
  if (!s) return;
  const [bg, fg, ac] = THEMES[s.theme], story = $("#story");
  story.style.setProperty("--bg", bg); story.style.setProperty("--fg", fg); story.style.setProperty("--ac", ac);
  story.classList.toggle("interactive", !!s.interactive);
  if (typeof cleanup === "function") try { cleanup(); } catch (e) { console.error(e); }   // the page we're leaving
  cleanup = null;
  $("#slide").innerHTML = `<section class="slide">${s.html}</section>`;
  current = s;
  if (trailsOn) startTrail(s);
  tip.hidden = true;
  if (s.after) try { cleanup = s.after(); } catch (e) { console.error(e); }
  fitSlide();
  document.querySelectorAll("#slide [data-count]").forEach(countUp);
  $("#bars").innerHTML = SLIDES.map((_, k) => `<i class="${k < state.i ? "done" : k === state.i ? "now" : ""}"><b></b></i>`).join("");
  document.querySelectorAll("#years button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.y) === String(state.year)));
}
// Type is sized from the window's width, so on a wide but short window (a MacBook in Chrome) some
// slides are taller than the screen and get cut off. Measure the real content and shrink the box
// just enough to fit. (The records live on their own canvas, so they're not measured.)
function fitToScreen(box, room) {
  if (!box) return;
  box.style.zoom = 1;
  box.classList.add("measuring");                 // measure where things land, not mid-animation
  for (let pass = 0; pass < 2; pass++) {
    const z = +box.style.zoom || 1;
    let top = Infinity, bottom = -Infinity;
    box.querySelectorAll("*").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.height) { top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); }
    });
    const tall = bottom - top;
    if (!(tall > room)) break;
    box.style.zoom = Math.max(0.55, z * room / tall);
  }
  box.classList.remove("measuring");
}
function fitSlide() { fitToScreen($("#slide .slide"), innerHeight - 96 - 40); }
// The era page scrolls like a normal page (as it does on a phone) instead of shrinking to fit,
// so this only clears any old shrink.
function fitEra() { const b = eraView.querySelector(".ev-body"); if (b) b.style.zoom = 1; }
addEventListener("resize", () => { fitSlide(); if (!eraView.hidden) fitEra(); });

function go(d) { const n = state.i + d; if (n >= 0 && n < SLIDES.length) { state.dir = d; state.i = n; render(); } }

if (!D) document.body.innerHTML = "<p style='padding:24px;color:#fff'>No data.js found. Run <code>python run.py build</code> first.</p>";
else {
  $("#years").innerHTML = ["all", ...(D.overview.picker_years || YEARS)].map(y => `<button type="button" data-y="${y}">${y === "all" ? "All time" : y}</button>`).join("");
  $("#years").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { state.year = b.dataset.y === "all" ? "all" : +b.dataset.y; render(); } });
  $("#prev").onclick = () => go(-1);
  $("#next").onclick = () => go(1);
  // Clicking the left or right part of the page flips it, except on things that have their own
  // hover or click (chart bars, the eras highlights, buttons, links)
  const story = $("#story");
  const side = e => {
    if (e.target.closest("[data-hover], button, a, .hl, input, select")) return 0;

    if (e.clientY < 70) return 0;
    const w = story.classList.contains("interactive") ? 0.05 : 0.3, x = e.clientX / innerWidth;
    const d = x < w ? -1 : x > 1 - w ? 1 : 0;
    return d === 1 && current && current.noForward ? 0 : d;   // the end screen: back works, forward doesn't
  };
  story.addEventListener("click", e => { const d = side(e); if (d) go(d); });
  story.addEventListener("mousemove", e => {
    const d = side(e);
    story.classList.toggle("flip-prev", d === -1); story.classList.toggle("flip-next", d === 1);
  });
  // Title page: records spin into a ring, one era photo on each label; "let's go" starts the story.
  const intro = $("#intro");
  // Size the ring from the window height: the top and bottom records' centers sit exactly on the
  // screen edges, so the edges cut them in half. RecordRing puts record centers at
  // size/2 - radius - 3 from the middle (radius = size * sizeFraction / 2); solve that for size.
  const RING_OVERLAP = 0.82;
  const ringFraction = () => innerWidth < 700 ? 0.2 : 0.19;   // each record's size as a share of the ring (bigger on a phone)
  const ringBox = $(".intro-ring");
  // On a phone (narrow screen) that ring would be far wider than the screen, so only its top and
  // bottom would show; there it's sized from the width instead, a little wider than the screen so
  // the side records are just clipped and the whole circle reads.
  const ringSize = () => innerWidth < 700 ? innerWidth * 1.42 : (innerHeight / 2 + 3) / (0.5 - ringFraction() / 2);
  const evenCount = size => {                    // an even number of records puts one exactly at the bottom
    const d = size * ringFraction(), n = Math.round((2 * Math.PI * (size / 2 - d / 2 - 3)) / (d * RING_OVERLAP));
    return n + (n % 2);
  };
  // The canvas is bigger than the ring by a margin (RING_PAD of the canvas on each side) so the
  // colored glows aren't cut off in a straight line where the canvas ends.
  const RING_PAD = 0.1;
  const setRingBox = () => {
    ringBox.style.setProperty("--ring", ringSize() + "px");
    ringBox.style.setProperty("--pad-px", (ringSize() * RING_PAD / (1 - 2 * RING_PAD)) + "px");
  };
  setRingBox();
  const ring = new RecordRing($("#introRing"), {
    albums: LABEL_PHOTOS,                                  // top albums, #1 at the top of the ring
    labelColors: RING_COLORS, glowColors: RING_COLORS, labelGlows: LABEL_GLOWS,
    glowSize: 0.8, glowPasses: 2,                          // big, bright glow
    moveSeconds: 0.26, spinSpeed: 2.5, loop: false,  // about 4.4 s to form the ring once, then the labels keep spinning
    sizeFraction: ringFraction(), overlap: RING_OVERLAP, pad: RING_PAD, count: evenCount(ringSize()),
  });
  // Put the button halfway between the bottom of the title and the top of the bottom record.
  const goBtn = $("#introGo"), title = $(".intro-title");
  const BUTTON_NUDGE = 5;                                      // px above the exact halfway point
  const placeButton = (pauseAnimations) => {
    if (pauseAnimations) intro.classList.add("measuring");      // measure final positions, not mid-animation
    goBtn.style.translate = "0 0";
    const titleBottom = title.getBoundingClientRect().bottom;
    const size = ringSize(), d = size * ringFraction();
    const recordTop = innerHeight / 2 + size / 2 - d - 3;       // bottom record's center is size/2 - d/2 - 3 below the middle
    const b = goBtn.getBoundingClientRect();
    goBtn.style.translate = `0 ${(titleBottom + recordTop) / 2 - (b.top + b.height / 2) - BUTTON_NUDGE}px`;
    if (pauseAnimations) intro.classList.remove("measuring");
  };
  placeButton(true);
  document.fonts.ready.then(() => placeButton(true));          // the title's height depends on the font
  const resizeRing = () => {
    if (intro.hidden) return;
    setRingBox();
    ring.setOptions({ count: evenCount(ringSize()), sizeFraction: ringFraction() });
    placeButton(false);
  };
  addEventListener("resize", resizeRing);
  const start = () => {
    if (intro.classList.contains("out")) return;
    intro.classList.add("out");
    trailsOn = true; startTrail(current);                       // the first page's records start as the title fades
    setTimeout(() => { intro.hidden = true; ring.destroy(); }, 600);
  };
  $("#introGo").onclick = start;

  document.addEventListener("keydown", e => {
    if (!intro.hidden && !intro.classList.contains("out")) {
      if (["Enter", " ", "ArrowRight"].includes(e.key)) { e.preventDefault(); start(); }
      return;
    }
    if (!eraView.hidden) {
      if (e.key === "Escape") closeEra();
      else if (e.key === "ArrowRight") openEra(openIndex + 1);
      else if (e.key === "ArrowLeft") openEra(openIndex - 1);
      else return;          // up/down, space, page up/down: leave them alone so the era page scrolls
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  });
  // Swipe left or right (phones): the next or previous page, or era when an era is open. A short
  // move is a tap and a mostly up-and-down one is a scroll, so those are left alone, and so is a
  // swipe along the row of year buttons (it scrolls sideways).
  let touch = null;
  document.addEventListener("touchstart", e => {
    const t = e.touches[0];
    touch = e.touches.length === 1 && !e.target.closest(".yearpick") ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (!touch) return;
    const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    const d = dx < 0 ? 1 : -1;                                   // finger moves left: forward
    if (!intro.hidden && !intro.classList.contains("out")) { if (d === 1) start(); return; }
    if (!eraView.hidden) { openEra(openIndex + d); return; }
    if (d === 1 && current && current.noForward) return;         // the end screen: back works, forward doesn't
    go(d);
  }, { passive: true });
  // Links straight to a page, for checking pages one at a time:
  //   index.html?slide=7   page 7, title page skipped     ?era=3   era page 3     ?year=2024
  const q = new URLSearchParams(location.search);
  if (q.has("year")) state.year = +q.get("year") || "all";
  if (q.has("slide") || q.has("era")) {
    state.i = Math.min(SLIDES.length - 1, Math.max(0, (+q.get("slide") || 1) - 1));
    intro.hidden = true; ring.destroy(); trailsOn = true;
  }
  render();
  if (q.has("era")) openEra(Math.max(0, +q.get("era") - 1));
}
