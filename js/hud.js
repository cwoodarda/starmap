/* hud.js — lightweight debug readout (lat/lon, heading, FPS, calibration).
 * Toggled from the UI. Attaches a global `HUD`. */
(function (global) {
  'use strict';
  const HUD = {
    el: null,
    attach(el) { this.el = el; },
    update(o) {
      if (!this.el || this.el.hidden) return;
      const f = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d));
      this.el.textContent =
        `lat ${f(o.lat, 4)}  lon ${f(o.lon, 4)}  ±${f(o.accuracy, 0)}m\n` +
        `look az ${f(o.az)}°  alt ${f(o.alt)}°\n` +
        `compass ${o.northRef ? 'true-N' : 'relative'}` +
        `${o.compassHeading != null ? ' ' + f(o.compassHeading) + '°' : ''}` +
        `  screen ${f(o.screenAngle, 0)}°\n` +
        `cal yaw ${o.calYaw}°  pitch ${o.calPitch}°\n` +
        `fov ${f(o.fov, 0)}°   fps ${f(o.fps, 0)}`;
    },
  };
  global.HUD = HUD;
})(window);
