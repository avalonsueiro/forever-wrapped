/* The era page: opens full screen when you click an era on page 13 (openEra / closeEra).
   One file, owned by one agent; see web/slides/README.md for the house style. */
// The era detail view: full screen, accented in that era's highlighter color.
const eraView = document.createElement("div");
eraView.id = "eraview"; eraView.hidden = true; eraView.setAttribute("role", "dialog");
document.body.appendChild(eraView);
let openIndex = -1;

// Small copies of the era photos (600px, about 70KB) live in photos-thumbs/, same folder names.
// The originals are 2-9MB phone shots, far too slow to open with. If a thumb is missing we fall back.
const eraThumb = p => encodeURI(p.replace(/^photos\//, "photos-thumbs/"));

// The era's records: their own canvas inside #eraview, made when an era opens and thrown away
// when it closes or changes. Labels show the era's most played albums.
let eraTrail = null;
function stopEraTrail() { if (eraTrail) { eraTrail.destroy(); eraTrail = null; } }

// Where the records go: one slow wave down the empty strip right of the page (the content sits
// left of centre to make room). On narrow screens (phones) there's no room, so no records.
function eraPaths(W, H) {
  const unit = Math.min(H, W * 1.2);
  const parts = [...eraView.querySelectorAll(".ev-text, .ev-photos")].map(el => el.getBoundingClientRect()).filter(r => r.width);
  if (!parts.length) return [];
  const right = W - Math.max(...parts.map(r => r.right));
  const chain = (R, fn) => ({ r: R, points: shapeSpaced(fn, 2 * R * SHAPE_OVERLAP) });
  const R = Math.min(unit * 0.075, (right - 40) * 0.34);
  if (R >= 30) {
    const amp = Math.max(0, right / 2 - R - 24), x = W - right / 2 + 8;
    return [chain(R, t => [x - amp * Math.sin(t * 2.5 * Math.PI), lerp(1.08, -0.08, t) * H])];
  }
  return [];
}

function startEraTrail(e) {
  stopEraTrail();
  const c = eraView.querySelector(".ev-trail");
  if (!c || typeof RecordRing === "undefined") return;
  // labels: the albums you played most during this era, each glowing in its cover's neon
  const covers = e.covers && e.covers.length ? e.covers : COVERS;
  eraTrail = new RecordRing(c, { labelColors: [e.pen], glowColors: [e.pen], glowSize: 0.7, glowPasses: 2,
    spinSpeed: 2.5, loop: false, totalSeconds: 2.2, startDelay: 0.2, paths: eraPaths,
    albums: covers.map(c => encodeURI(c.src)), labelGlows: covers.map(c => c.glow || e.pen) });
}
// Content moves when photos load or the window changes size, so lay the records out again.
function relayEraTrail() { if (eraTrail) requestAnimationFrame(() => eraTrail && eraTrail.layout()); }
addEventListener("resize", relayEraTrail);

function openEra(i) {
  if (i < 0 || i >= ERAS.length) return;
  openIndex = i; tip.hidden = true;
  const e = ERAS[i];
  const songs = (e.top_songs || []).slice(0, 3).map(s => s.split(" by "));
  const lived = e.lived_in || "";
  const where = lived ? `Living in ${esc(lived)}` : "";                  // unknown: no chip
  const homeName = ((D.locations && D.locations.countries) || []).find(c => c.code === D.locations.home)?.name;
  const away = (e.countries || []).filter(c => c && c !== homeName && !lived.includes(c));   // only trips abroad
  const photos = (e.photos || []).slice(0, 6);
  const tilt = k => [-3, 2.5, -1.5, 3, -2.5, 1.5][k % 6];
  eraView.style.setProperty("--pen", e.pen);
  eraView.innerHTML = `
    <canvas class="ev-trail" aria-hidden="true"></canvas>
    <button class="ev-close" type="button" aria-label="Close">✕</button>
    <div class="ev-body">
      <div class="ev-text">
        <p class="ev-kick">${eraRange(e)}</p>
        <h1 class="ev-name" style="--nl:${Math.max(4, ...String(e.name).split(/\s+/).map(w => w.length))}">${esc(e.name)}</h1>
        ${e.tagline ? `<p class="ev-tagline">${esc(e.tagline)}</p>` : ""}
        <div class="ev-chips">
          ${where ? `<span class="tag">${where}</span>` : ""}
          ${(() => {   // the main other city your photos place you in during this era (from GPS)
            const trips = (e.places || "").split(/,\s*(?![^()]*\))/).map(x => x.trim()).filter(x => x && !x.startsWith(lived + " ("));
            return trips.length ? `<span class="tag ghost">also in ${esc(trips[0].replace(/\s*\(.*\)/, ""))}</span>` : "";
          })()}
        </div>
        <div class="ev-sec">
          <p class="ev-label">On repeat</p>
          <ol class="ev-songs">${songs.map(([t, a], k) => `<li><b>${k + 1}</b> <em>${esc(clean(t))}</em> <span>${esc(a || "")}</span></li>`).join("")}</ol>
        </div>
      </div>
      <div class="ev-photos${photos.length > 4 ? " many" : ""}">${photos.length ? photos.map((p, k) =>
        `<figure style="--tilt:${tilt(k)}deg"><img src="${eraThumb(p)}" data-full="${encodeURI(p)}" alt="Photo from ${esc(e.name)}" decoding="async"></figure>`).join("")
        : `<figure class="empty" style="--tilt:-2deg"><span>Drop photos from these weeks into<br><b>web/photos/${esc(e.photo_folder || "")}/</b><br>then run build again</span></figure>`}</div>
    </div>
    <div class="ev-nav">
      <button type="button" data-d="-1" ${i ? "" : "disabled"}>← Previous era</button>
      <button type="button" data-d="1" ${i < ERAS.length - 1 ? "" : "disabled"}>Next era →</button>
    </div>`;
  eraView.hidden = false;
  eraView.scrollTop = 0;
  eraView.querySelector(".ev-close").onclick = closeEra;
  eraView.querySelectorAll(".ev-nav button").forEach(b => b.onclick = () => openEra(openIndex + +b.dataset.d));
  // focus the page itself (not the pinned close button) so arrow keys, space and page down scroll it
  eraView.tabIndex = -1;
  eraView.focus({ preventScroll: true });
  fitEra();
  startEraTrail(e);
  // photos change the height; each frame stays dark until its photo is in, so it never flashes white
  eraView.querySelectorAll(".ev-photos img").forEach(img => {
    const done = () => { img.parentElement.classList.add("loaded"); fitEra(); relayEraTrail(); };
    img.addEventListener("load", done);
    img.addEventListener("error", () => { if (!img.dataset.tried) { img.dataset.tried = 1; img.src = img.dataset.full; } });
    if (img.complete && img.naturalWidth) done();
  });
}
function closeEra() { stopEraTrail(); eraView.hidden = true; openIndex = -1; }
