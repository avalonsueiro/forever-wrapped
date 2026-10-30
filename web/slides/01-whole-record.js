/* Page 01: N years of spotify: your whole record (a square of records, one per listening day).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */

// One record for every day you listened, in a square grid as close to square as the count allows,
// filled in date order from the top right corner, snaking back and forth so each day slides out from
// the day before. Bigger records = more minutes that day. Each year has its own color.
// Works for any history: records never grow past coin size (a light listener gets a small cluster,
// not a few giant records), and years are labeled beside their bands when every band is at least two
// rows tall, otherwise (and always on a phone) with a small key.
const WR_PALETTE = ["#9d4dff", "#ffe500", "#ff2d87", "#c8ff00", "#4f6bff", "#ff8a00", "#00d1ff", "#ff2e2e"];
const wrDays = () => Object.entries(D.calendar.daily).filter(([, m]) => m > 0).sort(([a], [b]) => (a < b ? -1 : 1));

// years in order, each with a color (next color in the palette, so neighbors never match). Years at
// the very start with only a day or two are merged into one group, e.g. "2020–21".
function wrGroups(days) {
  const byYear = [];
  days.forEach(([day], i) => {
    const y = +day.slice(0, 4), g = byYear.at(-1);
    if (g && g.year === y) { g.last = i; g.count++; } else byYear.push({ year: y, first: i, last: i, count: 1 });
  });
  const groups = [];
  byYear.forEach(g => {
    const prev = groups.at(-1);
    if (prev && prev.tiny && g.count < 3 && groups.length === 1) {
      prev.last = g.last; prev.count += g.count; prev.key = `${prev.year}–${String(g.year).slice(2)}`;
    } else groups.push({ ...g, key: String(g.year), tiny: g.count < 3 });
  });
  groups.forEach((g, k) => { g.color = WR_PALETTE[k % WR_PALETTE.length]; });
  return groups;
}

// the word "years" in the kicker counts years you actually listened in
function wrSpan(days) {
  if (yr()) return [`${days.filter(([d]) => +d.slice(0, 4) === yr()).length} days`, `of spotify in ${yr()}`];
  if (days.length < 30) return [`${days.length} day${days.length === 1 ? "" : "s"}`, "of spotify"];
  const years = new Set(days.map(([d]) => d.slice(0, 4))).size;
  return [`${years} year${years === 1 ? "" : "s"}`, "of spotify"];
}

// where the title's words actually end (its box spans the whole width, the words don't)
function wrTitleBox() {
  const el = document.querySelector(".wr-title");
  if (!el) return null;
  const rects = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {                            // text only: each word's span is full width too
    const rg = document.createRange(); rg.selectNodeContents(walk.currentNode);
    rects.push(...[...rg.getClientRects()].filter(r => r.width));
  }
  return rects.length ? { right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)) } : null;
}

const wholeRecordTrail = (W, H) => {
  if (yr()) return wrYearTrail(W, H);
  document.querySelector("#story .wr-grid")?.remove();
  const days = wrDays(), n = days.length;
  if (!n) return [];
  const groups = wrGroups(days);
  const title = wrTitleBox();
  const phone = W <= 600 || H > W;
  // the area the records may use
  let ax, ay, aw, ah;
  if (phone) {
    // under the one-line title, filling the screen, with a gutter on the right for the year labels
    const below = (title ? title.bottom : 0.3 * H) + 0.035 * H;
    ax = 16; aw = W - 16 - 78; ay = below; ah = H * 0.96 - below;
  } else {
    const right = W - Math.max(0.04 * W, (W - 1240) / 2) - 150;           // room for labels or key on the right
    const left = (title ? title.right : 0.45 * W) + 0.05 * W;
    ax = left; aw = Math.max(right - left, Math.min(0.3 * W, 0.6 * H)); ay = 0.11 * H; ah = 0.84 * H;
  }
  // every year starts on its own new row. Wide screens: pick the width that keeps the whole thing
  // closest to a square. Phones: the width that gives the biggest records in the tall area.
  const rowsFor = c => groups.reduce((a, g) => a + Math.ceil(g.count / c), 0);
  const fit = c => Math.min(aw / c, ah / rowsFor(c));
  let cols = 1;
  for (let c = 1; c <= n; c++)
    if (phone ? fit(c) > fit(cols) : Math.abs(rowsFor(c) - c) < Math.abs(rowsFor(cols) - cols)) cols = c;
  const rows = rowsFor(cols);
  let r = 0;
  groups.forEach(g => { g.row0 = r; r += Math.ceil(g.count / cols); g.row1 = r - 1; });
  // bands only if every year after the first fills at least two rows
  const bands = groups.every((g, k) => k === 0 || g.row1 - g.row0 >= 1);   // 2+ rows each
  const maxCell = Math.min(52, 0.07 * Math.min(W, H));                     // no bigger than a coin
  const cell = Math.min(phone ? fit(cols) : Math.min(aw, ah) / Math.max(cols, rows), maxCell);
  const gw = cols * cell, gh = rows * cell;
  const x0 = phone ? ax + (aw - gw) / 2 : ax + aw - gw;                    // desktop: hug the right, next to the labels
  const y0 = phone ? ay + (ah - gh) / 2 : ay + (ah - gh) / 2;
  wrLabels(groups, n, cols, cell, x0, y0, gw, gh, phone, bands);
  const base = cell * 0.56;                             // a little overlap, like the other record trails
  const points = days.map(([, mins], i) => {
    const g = groups.find(g => i >= g.first && i <= g.last) || groups[0], j = i - g.first;
    const row = g.row0 + Math.floor(j / cols), k = j % cols, col = row % 2 ? k : cols - 1 - k;   // snake, starting top right
    const rr = base * (0.72 + 0.4 * Math.min(1, Math.sqrt(mins / 150)));
    return [x0 + (col + 0.5) * cell, y0 + (row + 0.5) * cell, rr, g.color];
  });
  return [{ r: base, points }];
};

// Year labels. Bands: one beside each year's rows. Key: a short list (right of the square, or a row
// above it on a phone), so nothing has to line up with thin bands. Each shows up as that year's
// first record lands.
const WR_SECONDS = 5, WR_DELAY = 0.15;
function wrLabels(groups, n, cols, cell, x0, y0, gw, gh, phone, bands) {
  const story = document.getElementById("story");
  let box = story.querySelector(".wr-years");
  const first = !box;
  if (first) { box = document.createElement("div"); box.className = "wr-years"; box.setAttribute("aria-hidden", "true"); story.appendChild(box); }
  const at = g => (first ? WR_DELAY + WR_SECONDS * Math.acos(1 - 2 * g.first / Math.max(1, n - 1)) / Math.PI : 0).toFixed(2);
  const days = g => `${g.count.toLocaleString("en-US")} day${g.count === 1 ? "" : "s"}`;
  if (bands) {
    let prev = -Infinity;
    box.className = "wr-years" + (phone ? " wr-phone" : "");
    box.removeAttribute("style");
    box.innerHTML = groups.map(g => {
      const r0 = g.row0, r1 = g.row1;
      const top = Math.max(y0 + ((r0 + r1 + 1) / 2) * cell, prev + (phone ? 30 : 22));   // middle of the year's rows, not on the label above
      prev = top;
      return `<span class="wr-year" style="left:${x0 + gw + (phone ? 10 : 14)}px;top:${top}px;color:${g.color};animation-delay:${at(g)}s">` +
        `<b>${g.key}</b><small>${days(g)}</small></span>`;
    }).join("");
    return;
  }
  box.className = "wr-years wr-key" + (phone ? " wr-phone" : "");
  box.style.cssText = `left:${x0 + gw + (phone ? 10 : 22)}px;top:${y0}px`;
  box.innerHTML = groups.map(g => `<span class="wr-k" style="animation-delay:${at(g)}s"><i style="background:${g.color};color:${g.color}"></i>` +
    `<b style="color:${g.color}">${g.key}</b><small>${days(g)}</small></span>`).join("");
}

// One year: a calendar instead of the square. A row per month, a column per day of the month (1 to
// 31), a record on every day you listened and a gap where you didn't, so streaks and breaks show.
// Each month is its own chain, sliding out left to right, and all twelve form at once. Months after
// the end of your data (the current year) are left off.
const WR_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function wrYearTrail(W, H) {
  const y = yr(), daily = D.calendar.daily;
  const lastMonth = +D.overview.last.slice(0, 4) === y ? +D.overview.last.slice(5, 7) : 12;
  const months = Array.from({ length: lastMonth }, (_, m) => {
    const days = [];
    for (let d = 1; d <= 31; d++) {
      const mins = daily[`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`];
      if (mins > 0) days.push([d, mins]);
    }
    return { m, key: WR_MONTHS[m], days, count: days.length, color: WR_PALETTE[m % WR_PALETTE.length] };
  });
  if (!months.some(mo => mo.count)) return [];
  const title = wrTitleBox();
  const phone = W <= 600 || H > W;
  let ax, ay, aw, ah;
  if (phone) {
    const below = (title ? title.bottom : 0.45 * H) + 0.05 * H;
    ax = 0.05 * W; aw = 0.9 * W - 64; ay = below; ah = H * 0.95 - below;   // room for labels on the right
  } else {
    const right = W - Math.max(0.04 * W, (W - 1240) / 2) - 130;
    const left = (title ? title.right : 0.45 * W) + 0.05 * W;
    ax = left; aw = Math.max(right - left, 0.3 * W); ay = 0.14 * H; ah = 0.8 * H;
  }
  const rows = months.length;
  const cell = Math.min(aw / 31, 52);
  // rows a bit apart, so each label has room; on a phone they spread out to use the tall screen
  const pitch = Math.min(phone ? cell * 4 : Math.max(cell * 1.35, 24), ah / rows);
  const gw = 31 * cell, gh = rows * pitch;
  const x0 = phone ? ax : ax + aw - gw, y0 = ay + (ah - gh) / 2 + 10;
  wrMonthLabels(months, cell, pitch, x0, y0, gw, phone);
  wrGrid(y, months, cell, pitch, x0, y0, gh);
  const base = cell * 0.56;
  return months.filter(mo => mo.count).map(mo => ({ r: base, points: mo.days.map(([d, mins]) =>
    [x0 + (d - 0.5) * cell, y0 + (mo.m + 0.5) * pitch, base * (0.72 + 0.4 * Math.min(1, Math.sqrt(mins / 150))), mo.color]) }));
}

// The calendar's gray grid, behind the records: a line along each month (ending on its last day)
// and a faint line down each day, so the records read as the days you listened.
function wrGrid(y, months, cell, pitch, x0, y0, gh) {
  const story = document.getElementById("story");
  let box = story.querySelector(".wr-grid");
  if (!box) { box = document.createElement("div"); box.className = "wr-grid"; box.setAttribute("aria-hidden", "true"); story.prepend(box); }
  const x = d => x0 + (d - 0.5) * cell;
  const cols = Array.from({ length: 31 }, (_, i) => i + 1).map(d =>
    `<line class="${[1, 10, 20, 31].includes(d) ? "wr-gv wr-gv-on" : "wr-gv"}" x1="${x(d)}" x2="${x(d)}" y1="${y0}" y2="${y0 + gh}"/>`).join("");
  const rows = months.map(mo => { const cy = y0 + (mo.m + 0.5) * pitch, last = new Date(y, mo.m + 1, 0).getDate();
    return `<line class="wr-gh" x1="${x(1)}" x2="${x(last)}" y1="${cy}" y2="${cy}"/>` +
      Array.from({ length: last }, (_, i) => `<circle class="wr-gd" cx="${x(i + 1)}" cy="${cy}" r="${Math.max(1.5, cell * 0.08)}"/>`).join(""); }).join("");
  box.innerHTML = `<svg width="100%" height="100%">${cols}${rows}</svg>`;
}

// Month labels on the right of each row ("jan 21 days"), plus a few day numbers along the top.
function wrMonthLabels(months, cell, pitch, x0, y0, gw, phone) {
  const story = document.getElementById("story");
  let box = story.querySelector(".wr-years");
  const first = !box;
  if (first) { box = document.createElement("div"); box.setAttribute("aria-hidden", "true"); story.appendChild(box); }
  box.className = "wr-years wr-cal" + (phone ? " wr-cal-phone" : "");
  box.removeAttribute("style");
  const at = k => (first ? WR_DELAY + 0.25 + k * 0.12 : 0).toFixed(2);
  const ticks = [1, 10, 20, 31].map(d => `<span class="wr-tick" style="left:${x0 + (d - 0.5) * cell}px;top:${y0 - 6}px">${d}</span>`).join("");
  box.innerHTML = ticks + months.map((mo, k) =>
    `<span class="wr-year${mo.count ? "" : " wr-none"}" style="left:${x0 + gw + 12}px;top:${y0 + (mo.m + 0.5) * pitch}px;color:${mo.color};animation-delay:${at(k)}s">` +
    `<b>${mo.key}</b><small>${mo.count} day${mo.count === 1 ? "" : "s"}</small></span>`).join("");
}

defineSlide("whole-record", () => { const [wrN, wrRest] = wrSpan(wrDays()); return { theme: "lemon", html: `
    <div class="wr">
      <p class="kick wr-kick rise"><span class="wr-n">${wrN}</span> ${wrRest}</p>
      <h1 class="wr-title rise d1"><span>Your</span> <span>whole</span> <span>${yr() ? "year" : "record"}</span></h1>
    </div>`,
  trail: wholeRecordTrail,
  after() {
    // the square is sized around the title, so lay it out again once the font has loaded
    // (otherwise it can come out a different size on each visit)
    document.fonts.ready.then(() => { if (current && current.trail === wholeRecordTrail && trail) trail.layout(); });
    return () => document.querySelectorAll("#story .wr-years, #story .wr-grid").forEach(e => e.remove());   // labels and grid go when you leave the page
  },
  // fast: ~1,100 records; no photos (they'd be a few pixels wide), the year colors instead
  trailOptions: { totalSeconds: 5, fast: true, albums: [], glowSize: 0.55, glowPasses: 1 } }; });
