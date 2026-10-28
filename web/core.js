/* Forever, Wrapped: shared data and helpers, loaded before the page files in web/slides/.
 * Reads window.WRAPPED (built by step 5). Each page registers itself with defineSlide(id, build);
 * app.js shows them in the order their <script> tags appear in index.html. */
"use strict";
const D = window.WRAPPED;
const MOODS = D.moods, MC = D.mood_colors, YEARS = D.overview.years;
const state = { i: 0, year: "all", dir: 1 };
const TAGGED = D && D.overview.tagged_share > 0;   // false until step 3 has tagged songs

// Overall vibe: Spotify black with grain on every page (like the title page), white text, and one
// saturated accent per page (the old flat Wrapped background colors). [background, text, accent]
const INK = "#121212";
const THEMES = {
  lemon:  [INK, "#ffffff", "#ffe500"],   // yellow
  sunset: [INK, "#ffffff", "#ff2d87"],   // hot pink
  cobalt: [INK, "#ffffff", "#4f6bff"],   // cobalt (a touch brighter than #1f3cff so it reads on black)
  flame:  [INK, "#ffffff", "#ff2e2e"],   // red
  lime:   [INK, "#ffffff", "#c8ff00"],   // lime
  violet: [INK, "#ffffff", "#9d6bff"],   // violet
  night:  [INK, "#ffffff", "#c8ff00"],   // behind the mood charts
  card:   [INK, "#ffffff", "#ff2d87"],   // the eras calendar and end screen
};
// Mood colors: fully saturated so they pop on black, like the old genre and audio-aura charts
Object.assign(MC, { happy: "#ffe500", sad: "#2f6bff", angry: "#ff2e2e", nostalgic: "#ff9e3d", romantic: "#ff4fa3",
  hyped: "#c8ff00", calm: "#00d1ff", anxious: "#9d4dff", lonely: "#8e9bb5", hopeful: "#2bd96b" });

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = n => Math.round(n).toLocaleString("en-US");
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";
const yr = () => state.year === "all" ? null : state.year;
const when = () => yr() ? `in ${yr()}` : "all time";
const date = s => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const hourLabel = h => (h % 12 || 12) + (h < 12 ? "AM" : "PM");
// Headline-friendly song titles: drop "(feat. ...)", "[...]" and " - Remastered"-style suffixes
const clean = t => String(t ?? "").replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").replace(/\s+-\s+.*$/, "").trim() || String(t ?? "");
// Shrink a headline when the text is long so it stays on two or three lines
const fit = (t, base = 140) => `font-size:clamp(40px,${Math.min(7, 7 * 14 / Math.max(14, t.length)).toFixed(2)}vw,${Math.round(base * Math.min(1, 14 / Math.max(14, t.length)) + 40)}px)`;
const yearRow = () => D.years.find(y => y.year === yr());
const legend = keys => `<div class="legend">${keys.map(k => `<span><i style="background:${MC[k]}"></i>${cap(k)}</span>`).join("")}</div>`;

// Overall mood mix across all years (minutes-weighted), used as the baseline for "standout" moods.
const overallMix = (() => {
  const m = Object.fromEntries(MOODS.map(k => [k, 0]));
  D.years.forEach(y => MOODS.forEach(k => m[k] += y.mood_mix[k] * y.minutes));
  const t = d3.sum(Object.values(m)) || 1;
  MOODS.forEach(k => m[k] /= t);
  return m;
})();
// The mood most over-represented in `mix` compared with `base` (ratio, not raw share), so a
// headline says what's distinctive about a season or hour rather than what's always common.
const standout = (mix, base) => MOODS.reduce((best, m) => mix[m] / (base[m] || 1e-9) > mix[best] / (base[best] || 1e-9) ? m : best, MOODS[0]);

const tip = $("#tip");
const hover = (sel, f) => sel.attr("data-hover", "").on("mouseenter", (e, d) => { tip.innerHTML = f(d); tip.hidden = false; })
  .on("mousemove", e => { tip.style.left = Math.min(e.clientX + 14, innerWidth - 220) + "px"; tip.style.top = e.clientY + 14 + "px"; })
  .on("mouseleave", () => { tip.hidden = true; });
// ?still in the address (used by tools/shoot.sh): every animation jumps to its last frame
window.RING_STILL = new URLSearchParams(location.search).has("still");
if (window.RING_STILL) document.documentElement.classList.add("still");
function countUp(el) {
  const end = +el.dataset.count;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || window.RING_STILL) return;
  const t0 = performance.now();
  const step = t => { const p = Math.min(1, (t - t0) / 1100); el.textContent = fmt(end * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}


/* ---------------- mood groups (pages 9 and 12) ---------------- */
// The 10 moods merged into 7 groups (happy and hyped kept apart, hopeful joins calm), each shown in its first mood's color.
const MOOD_GROUPS = [
  ["hyped", ["hyped"]], ["happy", ["happy"]], ["sad", ["sad", "lonely"]], ["calm", ["calm", "nostalgic", "hopeful"]],
  ["angry", ["angry"]], ["anxious", ["anxious"]], ["romantic", ["romantic"]],
];
const GROUP_COLOR = Object.fromEntries(MOOD_GROUPS.map(([g, ms]) => [g, MC[ms[0]]]));
// share of listening per group (0..1) from a mood mix ({ mood: minutes or share })
const moodGroups = mix => {
  const tot = MOODS.reduce((a, m) => a + (mix[m] || 0), 0) || 1;
  return Object.fromEntries(MOOD_GROUPS.map(([g, ms]) => [g, ms.reduce((a, m) => a + (mix[m] || 0), 0) / tot]));
};
const topGroup = g => Object.keys(g).reduce((a, b) => (g[b] > g[a] ? b : a));

/* ---------------- eras (used by page 13 and the era page) ---------------- */
const HILITE = ["#ffe500", "#ff6fb5", "#b6ff00", "#4fe3ff", "#ffa23d", "#c9a8ff"];   // highlighter pens
const ERAS = (D.eras || []).map((e, i) => ({ ...e, n: i + 1, pen: HILITE[i % HILITE.length] }));
const fmtDay = (d, withYear) => new Date(d + "T12:00:00").toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
const eraRange = e => e.start.slice(0, 4) === e.end.slice(0, 4) ? `${fmtDay(e.start)} – ${fmtDay(e.end, true)}` : `${fmtDay(e.start, true)} – ${fmtDay(e.end, true)}`;

/* ---------------- records (see recordRing.js and shapes.js) ---------------- */
// LED glow and label colors shared by the title page and every page's record trail.
const RING_COLORS = ["#ffe500", "#ff2d87", "#c8ff00", "#1f3cff", "#ff8a00", "#9d4dff"];
// The small 600px copies in photos-thumbs/ (made by the build step), not the 2-9MB originals.
const thumb = p => p.replace(/^photos\//, "photos-thumbs/");
// Record labels: your top album covers, most listened first (the build fetches them into covers/).
// If there are none yet, the era photos stand in.
// No two neighboring records may glow the same color, so nudge the cover order (it stays close to
// your ranking): when a cover would glow like the one before it, swap in the nearest later cover
// with a different glow. The title and end-screen rings close on themselves, so for the ring sizes
// in use (12 to 20 records) the last record must not match the first either.
function spreadGlows(list) {
  const out = list.slice(), g = i => out[i] && out[i].glow;
  for (let i = 1; i < out.length; i++) {
    const ringEnd = i >= 11 && i <= 19;                 // could be a ring's last record
    const bad = k => g(k) === g(i - 1) || (ringEnd && g(k) === g(0));
    if (!bad(i)) continue;
    const j = out.findIndex((c, k) => k > i && !bad(k) && g(k) !== g(i + 1 === k ? i : i + 1));
    if (j > 0) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const COVERS = spreadGlows((D.covers || []).map(c => (typeof c === "string" ? { src: c, glow: null } : c)));
const LABEL_PHOTOS = (COVERS.length ? COVERS.map(c => c.src)
  : [...new Set(ERAS.flatMap(e => e.photos || []))].map(thumb)).map(encodeURI);
// each cover's own neon (picked by the build from the cover's colors), for the record glows
const LABEL_GLOWS = COVERS.length ? COVERS.map(c => c.glow || "#ff2d87") : null;
// With a year picked, the records carry that year's own albums (all time: your top albums overall)
const YEAR_COVERS = Object.fromEntries(Object.entries(D.covers_by_year || {}).map(([y, l]) => [y, spreadGlows(l)]));
const labels = () => {
  const l = yr() && YEAR_COVERS[yr()];
  return l && l.length ? { albums: l.map(c => encodeURI(c.src)), glows: l.map(c => c.glow || "#ff2d87") }
    : { albums: LABEL_PHOTOS, glows: LABEL_GLOWS };
};

/* ---------------- page registry ---------------- */
window.SLIDE_DEFS = [];
function defineSlide(id, build) { window.SLIDE_DEFS.push({ id, build }); }

