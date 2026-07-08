/* astro.js — thin wrapper over Astronomy Engine.
 * Given an observer (lat/lon) and a time it produces:
 *   - a rotation from J2000 equatorial (EQJ) to local world ENU (East,North,Up),
 *     used to place the whole star catalog with a single matrix per frame;
 *   - world-ENU vectors for the Sun, Moon (with phase) and planets.
 * Attaches a global `Astro`. Requires window.Astronomy. */
(function (global) {
  'use strict';
  const A = global.Astronomy;
  const D2R = Math.PI / 180;

  // Astronomy's horizontal (HOR) frame is x=North, y=West, z=Up.
  // Our world frame is ENU: [East, North, Up] = [-W, N, U].
  function horToENU(h) { return [-h[1], h[0], h[2]]; }

  function altAzToENU(altDeg, azDeg) {
    const alt = altDeg * D2R, az = azDeg * D2R, ca = Math.cos(alt);
    return [ca * Math.sin(az), ca * Math.cos(az), Math.sin(alt)]; // [E,N,U]
  }

  // Naked-eye planets first; outer two are faint (off by default in UI).
  const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

  const Astro = {
    observer: null,
    rot: null,        // EQJ -> HOR rotation matrix (Astronomy's [i][j] convention)
    bodies: [],       // [{name, kind, world:[E,N,U], mag, illum, phaseAngle, radiusDeg}]

    setObserver(latDeg, lonDeg, heightM = 0) {
      this.observer = new A.Observer(latDeg, lonDeg, heightM || 0);
    },

    hasObserver() { return !!this.observer; },

    // Recompute the sky for `date`. Cheap; safe to call a few times per second.
    update(date) {
      if (!this.observer) return;
      this.rot = A.Rotation_EQJ_HOR(date, this.observer).rot;

      const out = [];
      // Sun
      out.push(this._body('Sun', 'sun', date, 0.267));
      // Moon (angular radius ~0.259 deg) + phase
      const moon = this._body('Moon', 'moon', date, 0.259);
      if (moon) {
        moon.phase = A.MoonPhase(date);            // 0=new,90=1stQ,180=full,270=lastQ
        const ill = A.Illumination(A.Body.Moon, date);
        moon.illum = ill.phase_fraction;           // 0..1 lit fraction
        moon.mag = ill.mag;
      }
      if (moon) out.push(moon);
      // Planets
      for (const p of PLANETS) {
        const b = this._body(p, 'planet', date, 0);
        if (b) {
          try { b.mag = A.Illumination(A.Body[p], date).mag; } catch (e) { b.mag = 6; }
          b.faint = (p === 'Uranus' || p === 'Neptune');
          out.push(b);
        }
      }
      this.bodies = out;
    },

    _body(name, kind, date, radiusDeg) {
      try {
        const eq = A.Equator(A.Body[name], date, this.observer, true, true); // ra(h),dec(deg)
        const hor = A.Horizon(date, this.observer, eq.ra, eq.dec, 'normal');
        return {
          name, kind, radiusDeg,
          world: altAzToENU(hor.altitude, hor.azimuth),
          mag: kind === 'sun' ? -26.7 : undefined,
        };
      } catch (e) { return null; }
    },

    // Rotate a precomputed EQJ unit vector into world ENU using the cached matrix.
    // Astronomy applies rotation as out[j] = sum_i rot[i][j] * v[i].
    eqjToWorld(v) {
      const r = this.rot;
      const hx = r[0][0] * v[0] + r[1][0] * v[1] + r[2][0] * v[2];
      const hy = r[0][1] * v[0] + r[1][1] * v[1] + r[2][1] * v[2];
      const hz = r[0][2] * v[0] + r[1][2] * v[1] + r[2][2] * v[2];
      return horToENU([hx, hy, hz]);
    },

    altAzToENU,
  };

  global.Astro = Astro;
})(window);
