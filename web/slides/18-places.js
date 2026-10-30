/* Page 18: you pressed play in N countries (world map).
   One file per page. build() returns { theme, html, after?, trail?, glow?, interactive? } or null to skip
   the page; see web/slides/README.md for what each field does and the house style. */
defineSlide("places", () => {
    const Lc = D.locations, cs = Lc.countries.filter(c => !yr() || c.by_year[yr()]);
    const val = c => yr() ? (c.by_year[yr()] || 0) : c.minutes;
    const away = cs.filter(c => c.code !== Lc.home).sort((a, b) => val(b) - val(a))[0];

    // Records: a flight path that takes off from the bottom left and climbs off the right edge,
    // under the text and the map. On a phone it sweeps across the empty bottom half instead.
    const ease = t => t * t * (3 - 2 * t);
    const flight = (W, H) => {
      const phone = W < 700, R = (phone ? 0.095 : 0.058) * shapeUnit(W, H);
      const [x0, y0, x1, y1] = phone ? [-0.12, 0.74, 1.12, 0.95] : [-0.04, 0.985, 1.05, 0.875];
      const curve = t => [lerp(x0, x1, t) * W, lerp(y0, y1, ease(t)) * H];
      return [{ r: R, points: shapeSpaced(curve, 2 * R * SHAPE_OVERLAP) }];
    };

    return { theme: "lime",   // no records on a wide screen (the map is the picture); a phone gets the flight under it
      trail: (W, H) => (W < 700 ? flight(W, H) : []),
      html: `<div class="inner pl"><div class="row pl-row">
      <div class="grow pl-copy"><p class="kick rise">You pressed play in</p>
        <h1 class="big rise d1 pl-head"><span class="pl-n">${cs.length}</span><br>${cs.length === 1 ? "country" : "countries"}</h1>
        ${away ? `<p class="sub rise d2">Away from home, you listened most in <b class="pl-away">${esc(away.name)}</b>.</p>` : ""}</div>
      <div class="chart rise d2 pl-map" id="map"></div></div></div>`,
      after() {
        const W = 900, ac = THEMES.lime[2];
        // Crop the map to where people live: no Antarctica, no empty Arctic.
        const frame = { type: "MultiPoint", coordinates: [[-180, 0], [180, 0], [0, 80], [0, -56], [-180, 60], [180, 60], [-180, -50], [180, -50]] };
        const proj = d3.geoNaturalEarth1().fitWidth(W, frame), path = d3.geoPath(proj);
        const [[, top], [, bot]] = path.bounds(frame), H = Math.ceil(bot - top);
        proj.translate([proj.translate()[0], proj.translate()[1] - top]);
        const svg = d3.select("#map").append("svg").attr("viewBox", `0 0 ${W} ${H}`);
        const defs = svg.append("defs");
        defs.append("filter").attr("id", "pl-glow").attr("x", "-100%").attr("y", "-100%").attr("width", "300%").attr("height", "300%")
          .append("feGaussianBlur").attr("stdDeviation", 7);

        // Land as a grid of dots: paint the land on a hidden canvas, then keep the grid points that land on it.
        if (window.LAND && window.topojson) {
          const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
          const cx = cv.getContext("2d");
          d3.geoPath(proj, cx)(topojson.feature(LAND, LAND.objects.land));
          cx.fill();
          const px = cx.getImageData(0, 0, W, H).data, step = 9, dots = [];
          for (let y = step / 2; y < H; y += step)
            for (let x = step / 2; x < W; x += step)
              if (px[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] > 100) dots.push([x, y]);
          svg.append("g").attr("class", "pl-land").selectAll("circle").data(dots).join("circle")
            .attr("cx", d => d[0]).attr("cy", d => d[1]).attr("r", 2.6);
        }

        const pts = (Lc.cities && Lc.cities.length > 1 ? Lc.cities.map(c => ({ ...c, name: c.city })) : cs)
          .filter(p => p.lat != null).map(p => ({ ...p, v: val(p) })).filter(p => p.v > 0).sort((a, b) => b.v - a.v);
        const xy = p => proj([p.lon, p.lat]);
        const home = pts.find(p => p.code === Lc.home);

        // (no flight lines: just the dots)

        const r = d3.scaleSqrt().domain([0, d3.max(pts, p => p.v) || 1]).range([5, 34]);
        svg.append("g").attr("filter", "url(#pl-glow)").selectAll("circle").data(pts).join("circle")
          .attr("cx", p => xy(p)[0]).attr("cy", p => xy(p)[1]).attr("r", p => r(p.v) * 1.15).attr("fill", ac).attr("opacity", 0.55);
        svg.append("g").attr("class", "pl-pins").selectAll("circle").data(pts).join("circle")
          .attr("cx", p => xy(p)[0]).attr("cy", p => xy(p)[1]).attr("r", p => r(p.v)).attr("fill", ac)
          .call(s => hover(s, p => `${esc(p.name)} · ${fmt(p.v / 60)} hrs`));

        // Name the two places the page talks about: home and the top place away.
        const tags = [home && { p: home, t: "home" }, away && pts.find(p => p.code === away.code) && { p: pts.find(p => p.code === away.code), t: away.name }].filter(Boolean);
        svg.append("g").attr("class", "pl-tags").selectAll("text").data(tags).join("text")
          .attr("x", d => xy(d.p)[0]).attr("y", d => xy(d.p)[1] - r(d.p.v) - 10).attr("text-anchor", "middle").text(d => d.t);
      } };
  });
