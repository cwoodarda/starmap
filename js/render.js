/* render.js — draws the sky overlay onto the 2D canvas each frame, given the
 * current device->world matrix and the loaded catalog / computed bodies.
 * Respects layer toggles in `settings`. Attaches a global `Renderer`. */
(function (global) {
  'use strict';
  const R2D = 180 / Math.PI;
  const HORIZON_CULL = Math.sin(-2 * Math.PI / 180); // hide objects >2 deg below horizon

  const COLORS = {
    constellation: 'rgba(120,170,255,0.55)',
    constellationName: 'rgba(150,190,255,0.75)',
    asterism: 'rgba(90,220,190,0.6)',
    asterismName: 'rgba(120,230,200,0.85)',
    star: '255,255,255',
    starName: 'rgba(255,255,255,0.9)',
    bayer: 'rgba(210,220,255,0.7)',
    dso: 'rgba(255,150,220,0.9)',
    horizon: 'rgba(255,255,255,0.25)',
    cardinal: 'rgba(255,230,140,0.95)',
    planet: '#ffd27f',
  };
  const PLANET_COLORS = {
    Mercury: '#c9c2b8', Venus: '#f5e6b8', Mars: '#ff7043', Jupiter: '#e8c9a0',
    Saturn: '#e6d59a', Uranus: '#aee3e8', Neptune: '#7f9bff',
  };

  let projected = []; // cache of on-screen labelled objects this frame (for calibration picks)

  function star2world(v) { return Astro.eqjToWorld(v); }

  function drawPolyline(ctx, segEqj, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const seg of segEqj) {
      let started = false;
      for (const vec of seg) {
        const w = star2world(vec);
        const p = Projection.project(w, Renderer.R);
        if (!p.inFront || p.depth < 0.05) { started = false; continue; }
        if (!started) { ctx.beginPath(); ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      if (started) ctx.stroke();
    }
  }

  function label(ctx, text, x, y, color, font) {
    ctx.font = font || '13px system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  const Renderer = {
    R: Mat.identity(),

    draw(ctx, R, W, H, settings) {
      this.R = R;
      projected = [];
      ctx.clearRect(0, 0, W, H);

      if (settings.horizon) this._horizon(ctx);
      if (settings.constellations) this._constellations(ctx, settings);
      if (settings.asterisms) this._asterisms(ctx, settings);
      if (settings.stars) this._stars(ctx, settings);
      if (settings.dsos) this._dsos(ctx, settings);
      if (settings.planets) this._bodies(ctx, settings);
    },

    // Point-like objects a user can align to during calibration (nearest wins).
    // Only labelled points (named stars, planets, Sun, Moon, DSOs) — not the
    // extended constellation/asterism anchors or unnamed stars.
    pickNearest(px, py) {
      const CAL = { star: 1, planet: 1, moon: 1, sun: 1, dso: 1 };
      let best = null, bestD = 1e9;
      for (const o of projected) {
        if (!o.label || !CAL[o.kind]) continue;
        const d = Math.hypot(o.x - px, o.y - py);
        if (d < bestD) { bestD = d; best = o; }
      }
      return bestD < 80 ? best : null;
    },

    // Any object near the tap, for the "identify" info card (nearest wins).
    // Considers every kind, including unnamed stars and constellation labels.
    pickForInfo(px, py, radius) {
      const R = radius || 44;
      let best = null, bestD = 1e9;
      for (const o of projected) {
        const d = Math.hypot(o.x - px, o.y - py);
        if (d < bestD) { bestD = d; best = o; }
      }
      return bestD < R ? best : null;
    },

    _horizon(ctx) {
      ctx.strokeStyle = COLORS.horizon;
      ctx.lineWidth = 1.5;
      let started = false;
      ctx.beginPath();
      for (let az = 0; az <= 360; az += 3) {
        const p = Projection.project(Astro.altAzToENU(0, az), this.R);
        if (!p.inFront) { started = false; continue; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      const marks = [['N', 0], ['E', 90], ['S', 180], ['W', 270],
        ['NE', 45], ['SE', 135], ['SW', 225], ['NW', 315]];
      for (const [name, az] of marks) {
        const p = Projection.project(Astro.altAzToENU(0, az), this.R);
        if (p.onScreen) {
          ctx.fillStyle = COLORS.cardinal;
          ctx.font = (name.length === 1 ? '18px' : '13px') + ' system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(name, p.x, p.y);
        }
      }
    },

    _constellations(ctx, s) {
      for (const c of Catalog.constellations) {
        drawPolyline(ctx, c.lines, COLORS.constellation, 1.2);
        const w = star2world(c.anchor);
        if (w[2] < HORIZON_CULL) continue;
        const p = Projection.project(w, this.R);
        if (!p.onScreen) continue;
        if (s.labels) label(ctx, c.name, p.x + 4, p.y, COLORS.constellationName,
          '13px system-ui, sans-serif');
        projected.push({ x: p.x, y: p.y, world: w, kind: 'constellation', ref: c, label: c.name });
      }
    },

    _asterisms(ctx, s) {
      for (const a of Catalog.asterisms) {
        drawPolyline(ctx, a.lines, COLORS.asterism, 1.6);
        const w = star2world(a.anchor);
        if (w[2] < HORIZON_CULL) continue;
        const p = Projection.project(w, this.R);
        if (!p.onScreen) continue;
        if (s.labels) label(ctx, a.name, p.x + 4, p.y, COLORS.asterismName,
          'italic 12px system-ui, sans-serif');
        projected.push({ x: p.x, y: p.y, world: w, kind: 'asterism', ref: a, label: a.name });
      }
    },

    _stars(ctx, s) {
      const limit = s.magLimit != null ? s.magLimit : 6;
      for (const st of Catalog.stars) {
        if (st.mag > limit) continue;
        const w = star2world(st.v);
        if (w[2] < HORIZON_CULL) continue;
        const p = Projection.project(w, this.R);
        if (!p.onScreen) continue;
        const r = Math.max(0.6, (6.5 - st.mag) * 0.55);
        const a = Math.min(1, 0.35 + (6.5 - st.mag) * 0.12);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${COLORS.star},${a})`;
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (st.mag < 1.6) { // soft glow for the brightest
          ctx.beginPath();
          ctx.fillStyle = `rgba(${COLORS.star},0.15)`;
          ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (st.name) {
          if (s.labels) label(ctx, st.name, p.x + r + 3, p.y, COLORS.starName,
            '12px system-ui, sans-serif');
        } else if (s.labels && st.bayer && st.mag < 3.2) {
          label(ctx, st.bayer, p.x + r + 3, p.y, COLORS.bayer, '11px system-ui, sans-serif');
        }
        // Every on-screen star is tappable for identify; label used by calibration.
        projected.push({ x: p.x, y: p.y, world: w, kind: 'star', ref: st,
          label: st.name || null });
      }
    },

    _dsos(ctx, s) {
      for (const d of Catalog.dsos) {
        const w = star2world(d.v);
        if (w[2] < HORIZON_CULL) continue;
        const p = Projection.project(w, this.R);
        if (!p.onScreen) continue;
        ctx.strokeStyle = COLORS.dso; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.stroke();
        if (s.labels) label(ctx, d.name, p.x + 8, p.y, COLORS.dso, '11px system-ui, sans-serif');
        projected.push({ x: p.x, y: p.y, world: w, kind: 'dso', ref: d, label: d.name });
      }
    },

    _bodies(ctx, s) {
      for (const b of Astro.bodies) {
        if (b.faint && !s.faintPlanets) continue;
        if (b.world[2] < HORIZON_CULL) continue;
        const p = Projection.project(b.world, this.R);
        if (!p.onScreen) continue;
        if (b.kind === 'sun') this._sun(ctx, p);
        else if (b.kind === 'moon') this._moon(ctx, p, b);
        else this._planet(ctx, p, b);
        if (s.labels) {
          const col = b.kind === 'planet' ? (PLANET_COLORS[b.name] || COLORS.planet)
            : (b.kind === 'moon' ? '#f0f0f0' : '#ffcf5a');
          label(ctx, b.name, p.x + 12, p.y, col, '12px system-ui, sans-serif');
        }
        projected.push({ x: p.x, y: p.y, world: b.world, kind: b.kind, ref: b, label: b.name });
      }
    },

    _sun(ctx, p) {
      const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 20);
      g.addColorStop(0, 'rgba(255,240,180,1)');
      g.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill();
    },

    _planet(ctx, p, b) {
      const r = b.mag != null ? Math.max(2.5, 5 - b.mag * 0.8) : 3;
      ctx.fillStyle = PLANET_COLORS[b.name] || COLORS.planet;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    },

    // Moon disk with a simple phase terminator.
    _moon(ctx, p, b) {
      const R = 12;
      const ill = b.illum != null ? b.illum : 1;
      const waxing = b.phase != null ? (b.phase < 180) : true; // lit side (approx, no parallactic)
      ctx.save();
      ctx.translate(p.x, p.y);
      // dark disk
      ctx.fillStyle = 'rgba(60,62,70,1)';
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
      // lit region: a semicircle on the sunlit limb + an elliptical terminator
      const t = 2 * ill - 1; // +1 full, 0 quarter, -1 new
      ctx.fillStyle = 'rgba(235,238,245,1)';
      ctx.beginPath();
      const s = waxing ? 1 : -1;               // +1 lit on right, -1 lit on left
      ctx.ellipse(0, 0, R, R, 0, -Math.PI / 2, Math.PI / 2, s < 0); // sunlit limb semicircle
      ctx.ellipse(0, 0, Math.abs(R * t), R, 0, Math.PI / 2, -Math.PI / 2, (t >= 0) === (s > 0));
      ctx.fill();
      ctx.restore();
    },
  };

  global.Renderer = Renderer;
})(window);
