/* info.js — the "tap to identify" card. Given a picked object (from
 * Renderer.pickForInfo), it assembles a human-readable description from
 * facts.js (star physics), the loaded Catalog/Astro state (live position) and
 * data/descriptions.json (curated flavour), and shows a bottom sheet.
 * Attaches a global `Info`. */
(function (global) {
  'use strict';

  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  function compass(az) { return COMPASS[Math.round(((az % 360) / 22.5)) % 16]; }

  function moonPhaseName(phaseDeg) {
    const names = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
      'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
    const i = Math.floor(((phaseDeg % 360) + 22.5) / 45) % 8;
    return names[i];
  }

  const Info = {
    descriptions: { stars: {}, constellations: {}, dsos: {}, bodies: {}, typeNames: {} },
    el: {},

    async load(base = 'data/') {
      try {
        const r = await fetch(base + 'descriptions.json');
        if (r.ok) this.descriptions = await r.json();
      } catch (e) { /* curated text is optional; derived facts still work */ }
      return this;
    },

    attach() {
      const $ = (id) => document.getElementById(id);
      this.el = {
        panel: $('info-panel'), close: $('info-close'), swatch: $('info-swatch'),
        title: $('info-title'), subtitle: $('info-subtitle'), warn: $('info-warn'),
        facts: $('info-facts'), summary: $('info-summary'), desc: $('info-desc'),
        foot: $('info-foot'),
      };
      if (this.el.close) this.el.close.addEventListener('click', () => this.hide());
    },

    hide() { if (this.el.panel) this.el.panel.hidden = true; },
    isOpen() { return this.el.panel && !this.el.panel.hidden; },

    // picked = { kind, ref, world, label } from Renderer.pickForInfo.
    showFor(picked) {
      if (!picked || !this.el.panel) return;
      const card = this._build(picked);
      this._render(card, picked.world);
    },

    // ---- card builders -------------------------------------------------

    _build(picked) {
      switch (picked.kind) {
        case 'star': return this._star(picked.ref);
        case 'sun':
        case 'moon':
        case 'planet': return this._body(picked.ref);
        case 'dso': return this._dso(picked.ref);
        case 'constellation': return this._constellation(picked.ref);
        case 'asterism': return this._asterism(picked.ref);
        default: return { title: picked.label || 'Object', rows: [] };
      }
    },

    _star(st) {
      // Catalog stars use {name,bayer,mag,sp,ly}; facts.js expects {n,b,m,sp,ly}.
      const f = Facts.describeStar({ n: st.name, b: st.bayer, m: st.mag, sp: st.sp, ly: st.ly });
      const desc = st.name && this.descriptions.stars[st.name];
      return {
        title: st.name || st.bayer || 'Star',
        subtitle: (st.bayer && st.name ? st.bayer + ' · ' : '') + f.typeLabel,
        swatch: f.colourHex,
        rows: f.rows,
        summary: f.summary,
        desc: desc || null,
        foot: f.footnote || null,
      };
    },

    _body(b) {
      const d = this.descriptions.bodies[b.name] || {};
      const rows = (d.facts ? d.facts.slice() : []);
      if (b.kind === 'moon') {
        if (b.phase != null) rows.push(['Phase', moonPhaseName(b.phase)]);
        if (b.illum != null) rows.push(['Illuminated', Math.round(b.illum * 100) + '%']);
      }
      if (b.kind === 'planet' && b.mag != null) {
        rows.push(['Brightness now', 'mag ' + b.mag.toFixed(1)]);
      }
      return {
        title: b.name,
        subtitle: d.subtitle || (b.kind === 'planet' ? 'Planet' : b.name),
        rows,
        summary: null,
        desc: d.text || null,
        warn: d.warn || null,
      };
    },

    _dso(o) {
      const d = this.descriptions.dsos[o.desig] || {};
      const typeName = this.descriptions.typeNames[o.type] || 'deep-sky object';
      const rows = [['Type', typeName.charAt(0).toUpperCase() + typeName.slice(1)]];
      if (d.dist) rows.push(['Distance', d.dist]);
      if (o.mag != null) rows.push(['Brightness', 'mag ' + o.mag]);
      return {
        title: o.name || o.desig,
        subtitle: (o.desig && o.desig !== o.name ? o.desig + ' · ' : '') + typeName,
        rows,
        desc: d.text || null,
      };
    },

    _constellation(c) {
      return {
        title: c.name,
        subtitle: 'Constellation · ' + c.id,
        rows: [],
        desc: this.descriptions.constellations[c.id] || null,
      };
    },

    _asterism(a) {
      return {
        title: a.name,
        subtitle: 'Asterism (star pattern)',
        rows: [],
        desc: 'An asterism is a familiar pattern of stars that isn’t one of the 88 ' +
          'official constellations — it may be part of one, or span several.',
      };
    },

    // ---- rendering -----------------------------------------------------

    _render(card, world) {
      const e = this.el;
      e.title.textContent = card.title || 'Object';
      e.subtitle.textContent = card.subtitle || '';

      if (card.swatch) { e.swatch.hidden = false; e.swatch.style.background = card.swatch; }
      else e.swatch.hidden = true;

      if (card.warn) { e.warn.hidden = false; e.warn.textContent = '⚠️ ' + card.warn; }
      else e.warn.hidden = true;

      // live position row (append to the fact rows)
      const rows = (card.rows || []).slice();
      if (world && global.Projection) {
        const aa = Projection.worldToAltAz(world);
        const pos = aa.alt < -1
          ? 'below the horizon'
          : `${Math.round(aa.alt)}° up, bearing ${Math.round(aa.az)}° ${compass(aa.az)}`;
        rows.push(['In your sky', pos]);
      }

      e.facts.innerHTML = '';
      for (const [k, v] of rows) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        e.facts.appendChild(dt); e.facts.appendChild(dd);
      }

      const setText = (node, text) => {
        node.textContent = text || '';
        node.hidden = !text;
      };
      setText(e.summary, card.summary);
      setText(e.desc, card.desc);
      setText(e.foot, card.foot);

      e.panel.hidden = false;
      e.panel.scrollTop = 0;
    },
  };

  global.Info = Info;
})(window);
