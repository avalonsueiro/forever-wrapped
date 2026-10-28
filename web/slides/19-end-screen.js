/* Page 19: end screen: a share card made to be screenshotted and sent to someone else. Kept to a
   few big things so it reads at a glance: whose and when, the #1 album, the identity, three numbers.
   A portrait card sized from the window height, so one screenshot always catches all of it. */
defineSlide("end-screen", () => {
  const y = yr();
  const daily = Object.entries(D.calendar.daily).filter(([d, m]) => m > 0 && (!y || d.startsWith(y)));
  if (!daily.length) return null;
  const mins = y ? yearRow().minutes : D.overview.total_minutes;
  const countries = (D.locations.countries || []).filter(c => !y || c.by_year[y]).length;
  const album = y ? (D.year_albums || {})[y] : COVERS[0];
  // longest run of days in a row with music, within the picked year (all time: from the build)
  const streak = !y ? D.calendar.longest_streak.days : (() => {
    let best = 0, run = 0, prev = null;
    daily.map(([d]) => d).sort().forEach(d => {
      const t = new Date(d + "T12:00:00");
      run = prev && (t - prev) / 864e5 < 1.5 ? run + 1 : 1; best = Math.max(best, run); prev = t;
    });
    return best;
  })();
  const T = D.tops[y ?? "all"], song = T.songs[0], artist = T.artists[0], skipped = y ? (D.skips.most_skipped_by_year || {})[y] : D.skips.most_skipped[0];
  // four covers: the song, the artist, the album, and the one you kept skipping
  const tiles = [
    song && song.cover && { src: song.cover.src, glow: song.cover.glow, label: "top song", name: clean(song.track) },
    artist && artist.image && { src: artist.image, glow: "#ff2d87", label: "top artist", name: artist.artist, round: true },
    album && { src: album.src, glow: album.glow, label: "top album", name: album.album || "" },
    skipped && skipped.cover && { src: skipped.cover.src, glow: skipped.cover.glow, label: "most skipped", name: clean(skipped.track) },
  ].filter(Boolean);
  // what most of the songs were about (same as the themes page), in that theme's color there
  const TT = D.theme_timeline, tl = TT && (y ? (TT.by_year || {})[y] : TT);
  const top = tl && tl.themes.find(t => t !== "other");
  const about = top && { theme: top, color: THEMES14_COLORS[0] };
  const span = y ? `my spotify ${y}` : `my spotify ${D.overview.first.slice(0, 4)}–${D.overview.last.slice(0, 4)}`;
  const stat = (n, label) => `<div class="es-stat"><b>${n}</b><span>${label}</span></div>`;
  return {
    theme: "lemon",
    noForward: true,                    // nothing after this page; clicking back still works
    html: `<div class="es-stage"><article class="es-card rise">
      <p class="es-span">${span}</p>
      <div class="es-covers">${tiles.map(t => `<figure class="es-tile${t.round ? " es-round" : ""}" style="--glow:${t.glow}">
        <img src="${encodeURI(t.src)}" alt=""><figcaption><span>${t.label}</span><b>${esc(t.name)}</b></figcaption></figure>`).join("")}</div>
      ${about ? `<div class="es-theme"><p class="es-about">most of my songs were about</p><h1 class="es-id" style="color:${about.color}">${esc(about.theme)}</h1></div>` : ""}
      <div class="es-stats">
        ${stat(fmt(mins), "minutes")}
        ${stat(fmt(streak), "day streak")}
        ${stat(countries, countries === 1 ? "country" : "countries")}
      </div>
    </article></div>`,
  };
});
