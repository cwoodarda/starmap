/* catalog.js — loads the star/constellation/asterism/DSO data and precomputes
 * each object's unit vector in the J2000 equatorial (EQJ) frame, so per-frame
 * rendering only needs one rotation (EQJ -> horizontal). Attaches `Catalog`. */
(function (global) {
  'use strict';
  const D2R = Math.PI / 180;

  // RA/Dec in degrees -> EQJ cartesian unit vector.
  function eqj(raDeg, decDeg) {
    const ra = raDeg * D2R, dec = decDeg * D2R, cd = Math.cos(dec);
    return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
  }

  function mapLines(lines) {
    // [[ [ra,dec], ... ], ...]  ->  [[ vec, ... ], ...]
    return lines.map((seg) => seg.map((p) => eqj(p[0], p[1])));
  }

  const Catalog = {
    stars: [], constellations: [], asterisms: [], dsos: [], loaded: false,

    async load(base = 'data/') {
      const get = (f) => fetch(base + f).then((r) => {
        if (!r.ok) throw new Error(`failed to load ${f}: ${r.status}`);
        return r.json();
      });
      const [stars, cons, ast, dsos] = await Promise.all([
        get('stars.json'), get('constellations.json'),
        get('asterisms.json'), get('dsos.json'),
      ]);

      this.stars = stars.stars.map((s) => ({
        v: eqj(s.r, s.d),
        mag: s.m,
        name: s.n || null,          // proper name (e.g. "Vega")
        bayer: s.b || null,         // Bayer/Flamsteed designation (e.g. "α Lyr")
        sp: s.sp || null,           // spectral class (e.g. "A0V") for identify
        ly: (s.ly != null) ? s.ly : null,  // distance in light-years
      }));

      this.constellations = cons.constellations.map((c) => ({
        id: c.id, name: c.name,
        lines: mapLines(c.lines),
        anchor: eqj(c.anchor[0], c.anchor[1]),
      }));

      this.asterisms = ast.asterisms.map((a) => ({
        name: a.name,
        lines: mapLines(a.lines),
        anchor: eqj(a.anchor[0], a.anchor[1]),
      }));

      this.dsos = dsos.dsos.map((d) => ({
        v: eqj(d.r, d.d),
        name: d.name || d.desig, desig: d.desig, type: d.type, mag: d.mag,
      }));

      this.loaded = true;
      return this;
    },
  };

  global.Catalog = Catalog;
})(window);
