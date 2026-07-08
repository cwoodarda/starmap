/* facts.js — turns a star's spectral classification into human-readable physics:
 * type, colour, temperature, estimated mass, main-sequence lifespan and makeup.
 * Everything here is a baked lookup / simple formula (no data files), so it works
 * offline for any star that carries a `sp` (spectral) field. Attaches `Facts`.
 *
 * Spectral strings from HYG are messy — "A0Vvar", "F7:Ib-IIv SB", "M1Ib + B2.5V",
 * "DA2", "sdB". parseSpectral() is deliberately forgiving and reads only the
 * primary component (before any "+").
 */
(function (global) {
  'use strict';

  const CLASS_ORDER = { O: 0, B: 1, A: 2, F: 3, G: 4, K: 5, M: 6 };

  // Per Harvard class: colour, plain-language colour, temperature range (K) and
  // the dominant spectral signature that hints at composition/conditions.
  const CLASS_INFO = {
    O: { colour: 'blue',        hex: '#9bb0ff', temp: [30000, 50000],
         feature: 'ionised helium and other highly ionised lines — extremely hot and luminous' },
    B: { colour: 'blue-white',  hex: '#aabfff', temp: [10000, 30000],
         feature: 'neutral helium and strong hydrogen lines' },
    A: { colour: 'white',       hex: '#cad7ff', temp: [7500, 10000],
         feature: 'the strongest hydrogen (Balmer) lines of any star' },
    F: { colour: 'yellow-white', hex: '#f4f4ff', temp: [6000, 7500],
         feature: 'weaker hydrogen and rising ionised-metal lines (Ca II)' },
    G: { colour: 'yellow',      hex: '#fff3d6', temp: [5200, 6000],
         feature: 'strong ionised calcium and many neutral metals (Sun-like)' },
    K: { colour: 'orange',      hex: '#ffd2a1', temp: [3700, 5200],
         feature: 'neutral metals and the first molecular bands' },
    M: { colour: 'red-orange',  hex: '#ffb56c', temp: [2400, 3700],
         feature: 'titanium-oxide molecular bands — cool enough for molecules to survive' },
  };

  // Luminosity class -> size/evolutionary descriptor. onMS = still core-H-burning.
  // For evolved stars the spectral (temperature) class no longer tracks mass, so
  // we give qualitative ranges keyed to the luminosity class instead of the
  // main-sequence formula.
  const LUM_INFO = {
    Ia: { label: 'luminous supergiant', onMS: false, mass: '10–40 M☉',
          life: 'a few million years in total', fate: 'is destined to explode as a supernova' },
    Iab: { label: 'supergiant', onMS: false, mass: '10–30 M☉',
           life: 'only a few million years in total', fate: 'will end as a supernova' },
    Ib: { label: 'supergiant', onMS: false, mass: '8–25 M☉',
          life: 'only a few million years in total', fate: 'will end as a supernova' },
    I:  { label: 'supergiant', onMS: false, mass: '10–30 M☉',
          life: 'only a few million years in total', fate: 'will end as a supernova' },
    II: { label: 'bright giant', onMS: false, mass: '6–12 M☉',
          life: 'tens of millions of years', fate: 'is fusing helium and heavier elements' },
    III: { label: 'giant', onMS: false, mass: '1–8 M☉',
           life: 'a few billion years total', fate: 'is now fusing helium in its core' },
    IV: { label: 'subgiant', onMS: false, mass: 'near its original mass',
          life: 'a few billion years', fate: 'is just finishing core hydrogen burning' },
    V:  { label: 'main-sequence dwarf', onMS: true },
    VI: { label: 'subdwarf', onMS: true },
  };

  // Anchor points: spectral index (classOrder*10 + subclass) -> typical
  // main-sequence mass (solar masses). Interpolated between anchors.
  const MASS_ANCHORS = [
    [0, 60], [5, 40], [10, 16], [15, 6.5], [20, 3.2], [25, 2.1],
    [30, 1.7], [35, 1.3], [40, 1.1], [45, 0.93], [50, 0.88],
    [55, 0.7], [60, 0.5], [65, 0.21], [68, 0.10],
  ];

  function specIndex(cls, sub) {
    return CLASS_ORDER[cls] * 10 + (isFinite(sub) ? sub : 0);
  }

  function massFromIndex(idx) {
    const a = MASS_ANCHORS;
    if (idx <= a[0][0]) return a[0][1];
    if (idx >= a[a.length - 1][0]) return a[a.length - 1][1];
    for (let i = 1; i < a.length; i++) {
      if (idx <= a[i][0]) {
        const [x0, y0] = a[i - 1], [x1, y1] = a[i];
        const t = (idx - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
      }
    }
    return 1;
  }

  // Main-sequence lifetime ~ 10 Gyr * (M/Msun)^-2.5 (Sun ~10 Gyr).
  function msLifetimeYears(mass) {
    return 1e10 * Math.pow(mass, -2.5);
  }

  function formatYears(y) {
    if (!isFinite(y) || y <= 0) return '—';
    if (y >= 1e12) return (y / 1e12).toFixed(1).replace(/\.0$/, '') + ' trillion yr';
    if (y >= 1e9) return (y / 1e9).toFixed(y < 1e10 ? 1 : 0).replace(/\.0$/, '') + ' billion yr';
    if (y >= 1e6) return (y / 1e6).toFixed(0) + ' million yr';
    return Math.round(y).toLocaleString() + ' yr';
  }

  function formatMass(m) {
    if (m >= 10) return m.toFixed(0) + ' M☉';
    if (m >= 1) return m.toFixed(1) + ' M☉';
    return m.toFixed(2) + ' M☉';
  }

  function formatTemp(t) {
    return t[0].toLocaleString() + '–' + t[1].toLocaleString() + ' K';
  }

  // "A0Vvar" -> {cls:'A', sub:0, lum:'V', whiteDwarf, subdwarf}
  function parseSpectral(sp) {
    if (!sp) return null;
    const primary = String(sp).split(/[+/]/)[0].trim(); // first component of a multiple
    // White dwarf: leading D (DA, DB, DA2...). Treat as a remnant.
    if (/^D/.test(primary)) return { whiteDwarf: true, raw: primary };
    // Subdwarf: leading "sd".
    const subdwarf = /^sd/i.test(primary);
    const body = primary.replace(/^sd/i, '');
    const m = body.match(/^([OBAFGKM])\s*(\d(?:\.\d)?)?/);
    if (!m) return { raw: primary, unknownClass: true };
    const cls = m[1];
    const sub = m[2] != null ? parseFloat(m[2]) : NaN;
    // Luminosity class directly follows the temperature part (optionally after a
    // ':' or space). Anchored so we don't grab a stray 'V' from a suffix, but the
    // class may be glued to a peculiarity code, e.g. "A0Vvar" -> "V".
    const lumMatch = body.slice(m[0].length).match(/^[\s:]*(Iab|Ia\+?|Ib|III|II|IV|VI|V|I)/);
    const lum = lumMatch ? lumMatch[1].replace('+', '') : null;
    return { cls, sub, lum, subdwarf, raw: primary };
  }

  const Facts = {
    parseSpectral,
    formatYears,

    // Build a structured description of a catalog star.
    // star = { n, b, m, sp, ly, ... }. Returns fields the info card renders.
    describeStar(star) {
      const out = {
        kind: 'star',
        name: star.n || star.b || 'Star',
        designation: star.b || null,
        magnitude: star.m,
        distanceLy: (star.ly != null) ? star.ly : null,
        spectral: star.sp || null,
        rows: [],           // [ [label, value], ... ]
        typeLabel: 'Star',
        colourHex: '#ffffff',
        summary: '',
      };

      const p = star.sp ? parseSpectral(star.sp) : null;

      if (p && p.whiteDwarf) {
        out.typeLabel = 'White dwarf (stellar remnant)';
        out.colourHex = '#dfe8ff';
        out.rows.push(['Type', 'White dwarf — Earth-sized ember of a dead star']);
        out.rows.push(['Makeup', 'Electron-degenerate carbon–oxygen core; no fusion']);
        out.rows.push(['Fate', 'Slowly cooling and fading over billions of years']);
        out.summary = 'The exposed, Earth-sized core left behind after a Sun-like star ' +
          'shed its outer layers. It no longer fuses anything and simply cools for aeons.';
      } else if (p && p.cls && CLASS_INFO[p.cls]) {
        const ci = CLASS_INFO[p.cls];
        const li = p.lum ? LUM_INFO[p.lum] : LUM_INFO.V; // no class given -> assume dwarf
        const evolved = li ? !li.onMS : false;
        const sizeLabel = li ? li.label : 'main-sequence dwarf';
        const art = /^[aeiou]/i.test(ci.colour) ? 'An' : 'A';

        out.colourHex = ci.hex;
        out.typeLabel = `${ci.colour} ${sizeLabel}`.replace(/^(\w)/, (c) => c.toUpperCase());
        out.evolved = evolved;

        out.rows.push(['Spectral type', star.sp]);
        out.rows.push(['Colour', `${ci.colour} (class ${p.cls})`]);
        out.rows.push(['Surface temp', formatTemp(ci.temp)]);

        let lifeSentence;
        if (evolved) {
          // The cool/bloated surface no longer tracks mass, so use qualitative
          // ranges tied to the luminosity class rather than the MS formula.
          out.rows.push(['Est. mass', li.mass]);
          out.rows.push(['Life stage', `${li.label} — ${li.fate}`]);
          out.rows.push(['Total lifespan', li.life]);
          lifeSentence =
            `It has evolved off the main sequence into a ${li.label}: ${li.fate}. ` +
            `Stars like this live ${li.life}.`;
        } else {
          const mass = massFromIndex(specIndex(p.cls, p.sub));
          const life = msLifetimeYears(mass);
          out.rows.push(['Typical mass', '≈ ' + formatMass(mass)]);
          out.rows.push(['Main-seq. lifespan', '≈ ' + formatYears(life)]);
          lifeSentence =
            `As a ${sizeLabel} it fuses hydrogen into helium in its core, a stable phase ` +
            `lasting roughly ${formatYears(life)}.`;
        }
        out.rows.push(['Makeup', '~71% hydrogen, ~27% helium (by mass), plus traces of heavier elements']);

        out.summary =
          `${art} ${ci.colour} ${sizeLabel} (spectral ${p.cls}${isFinite(p.sub) ? p.sub : ''}` +
          `${p.lum ? ' ' + p.lum : ''}) with a surface around ${formatTemp(ci.temp)}, whose ` +
          `spectrum shows ${ci.feature}. ${lifeSentence}`;
      } else {
        out.typeLabel = 'Star';
        out.rows.push(['Type', 'Star' + (star.sp ? ` (spectral ${star.sp})` : ' (type not catalogued)')]);
        out.rows.push(['Makeup', 'Mostly hydrogen and helium fusing under its own gravity']);
        out.summary = 'A star — a self-luminous sphere of plasma held together by gravity, ' +
          'shining by fusing hydrogen in its core.';
      }

      if (star.m != null) out.rows.push(['Apparent brightness', 'mag ' + Number(star.m).toFixed(2)]);
      if (star.ly != null) out.rows.push(['Distance', star.ly.toLocaleString() + ' light-years']);
      return out;
    },
  };

  global.Facts = Facts;
})(window);
