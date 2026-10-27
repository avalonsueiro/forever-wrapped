/* Page 04: your #1 artist, with their Spotify photo.
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */

// The artist's own Spotify profile picture (fetched by the build into web/artists/), round like in
// the Spotify app, with a red and pink LED glow behind it. Right of the name; under it on a phone.
defineSlide("top-artist", () => {
    const a = D.tops[yr() ?? "all"].artists[0];
    // name size: shrink for long names so the longest word stays on one line
    const longest = Math.max(...a.artist.split(/\s+/).map(w => w.length));
    const k = Math.min(1, 9 / Math.max(longest, a.artist.length * 0.62)).toFixed(3);
    return { theme: "flame",
      html: `<div class="inner ta">
      <p class="kick rise ta-kick">your <span class="ta-one">#1</span> artist, ${when()}</p>
      <h1 class="big rise d1 ta-name" style="--k:${k}">${esc(a.artist)}</h1>
      <p class="sub rise d2 ta-sub"><b>${fmt(a.minutes / 60)}</b> hours across <b>${fmt(a.plays)}</b> plays.</p></div>
      ${a.image ? `<figure class="ta-photo rise d2"><img src="${encodeURI(a.image)}" alt="${esc(a.artist)}"></figure>` : ""}` };
  });
