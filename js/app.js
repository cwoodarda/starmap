/* app.js — wires the modules together: permission/start flow, the animation
 * loop, calibration taps and the settings UI. Attaches a global `App`. */
(function (global) {
  'use strict';
  const R2D = 180 / Math.PI;

  const SETTINGS_KEY = 'starmap_settings_v1';
  const defaults = {
    stars: true, constellations: true, asterisms: true, planets: true,
    dsos: true, horizon: true, labels: true, faintPlanets: false,
    magLimit: 5.5, fov: 55,
  };

  const App = {
    els: {}, settings: Object.assign({}, defaults),
    ctx: null, dpr: 1, W: 0, H: 0,
    running: false, calibrating: null, demo: false,
    lastAstro: 0, fps: 0, _frames: 0, _fpsT: 0,

    async init() {
      const $ = (id) => document.getElementById(id);
      this.els = {
        video: $('video'), canvas: $('overlay'), start: $('start-screen'),
        startBtn: $('start-btn'), status: $('start-status'), toast: $('toast'),
        panel: $('panel'), hud: $('hud'), reticle: $('reticle'),
        manual: $('manual-location'), lat: $('in-lat'), lon: $('in-lon'),
        magVal: $('mag-val'), fovVal: $('fov-val'),
      };
      this.ctx = this.els.canvas.getContext('2d');
      this.demo = new URLSearchParams(global.location.search).has('demo');
      HUD.attach(this.els.hud);
      Info.attach();
      this.loadSettings();
      Calibration.load();

      this.els.status.textContent = 'Loading star catalog…';
      try {
        await Promise.all([Catalog.load(), Info.load()]);
        this.els.status.textContent =
          `${Catalog.stars.length} stars, ${Catalog.constellations.length} constellations ready.`;
        this.els.startBtn.disabled = false;
        if (this.demo) this.els.startBtn.textContent = 'Enter Demo Sky';
      } catch (e) {
        this.els.status.textContent = 'Failed to load catalog: ' + e.message;
      }

      this.bindUI();
      this.resize();
      global.addEventListener('resize', () => this.resize());
    },

    loadSettings() {
      try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
        if (s) Object.assign(this.settings, s);
      } catch (e) {}
      Projection.fovV = this.settings.fov;
    },
    saveSettings() {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) {}
    },

    bindUI() {
      this.els.startBtn.addEventListener('click', () => this.onStart());

      // layer checkboxes (data-setting attribute)
      document.querySelectorAll('[data-setting]').forEach((cb) => {
        const key = cb.dataset.setting;
        cb.checked = !!this.settings[key];
        cb.addEventListener('change', () => {
          this.settings[key] = cb.checked; this.saveSettings();
        });
      });

      const mag = document.getElementById('mag-slider');
      mag.value = this.settings.magLimit;
      this.els.magVal.textContent = Number(this.settings.magLimit).toFixed(1);
      mag.addEventListener('input', () => {
        this.settings.magLimit = parseFloat(mag.value);
        this.els.magVal.textContent = this.settings.magLimit.toFixed(1);
        this.saveSettings();
      });

      const fov = document.getElementById('fov-slider');
      fov.value = this.settings.fov;
      this.els.fovVal.textContent = this.settings.fov + '°';
      fov.addEventListener('input', () => {
        this.settings.fov = parseFloat(fov.value);
        this.els.fovVal.textContent = this.settings.fov + '°';
        Projection.setViewport(this.W, this.H, this.settings.fov);
        this.saveSettings();
      });

      document.getElementById('btn-panel').addEventListener('click', () =>
        this.els.panel.hidden = !this.els.panel.hidden);
      document.getElementById('btn-hud').addEventListener('click', () =>
        this.els.hud.hidden = !this.els.hud.hidden);
      document.getElementById('btn-calibrate').addEventListener('click', () =>
        this.beginCalibrate());
      document.getElementById('btn-reset-cal').addEventListener('click', () => {
        Calibration.reset(); this.toast('Alignment reset.');
      });
      document.getElementById('btn-set-location').addEventListener('click', () => {
        const la = parseFloat(this.els.lat.value), lo = parseFloat(this.els.lon.value);
        if (isFinite(la) && isFinite(lo)) {
          Sensors.setLocationManually(la, lo);
          Astro.setObserver(la, lo, 0);
          this.els.manual.hidden = true;
          this.toast('Location set manually.');
        }
      });

      this.els.canvas.addEventListener('click', (e) => this.onCanvasTap(e));
    },

    async onStart() {
      this.els.startBtn.disabled = true;

      if (this.demo) {
        // Desktop-testable mode: no camera/GPS/compass. Fixed observer + a
        // slowly panning synthetic orientation so the sky renders and objects
        // can be tapped to test the identify feature.
        Sensors.setLocationManually(40.015, -105.2705, 0);
        Astro.setObserver(40.015, -105.2705, 0);
        Sensors.state.orientationOK = true;
        this.els.start.hidden = true;
        this.els.reticle.hidden = false;
        this.running = true;
        this.toast('Demo sky — tap any star, planet or label to identify it.');
        requestAnimationFrame((t) => this.loop(t));
        return;
      }

      // iOS: DeviceOrientation permission MUST be requested synchronously inside
      // the tap, BEFORE any await — awaiting getUserMedia below would consume the
      // user activation and make iOS silently deny motion. So ask for it first.
      this.els.status.textContent = 'Requesting motion access…';
      const oriOK = await Sensors.requestPermission();
      if (!oriOK) {
        this.els.status.innerHTML =
          'Motion access was blocked. Enable it in <b>Settings → Apps → Safari → ' +
          'Motion &amp; Orientation Access</b> (or Settings → Safari on older iOS), ' +
          'then tap again.';
        this.els.startBtn.disabled = false;
        return;
      }

      this.els.status.textContent = 'Requesting camera…';
      try {
        await Camera.start(this.els.video);
      } catch (e) {
        this.els.status.textContent = 'Camera error: ' + e.message;
        this.els.startBtn.disabled = false;
        return;
      }
      Sensors.start();

      this.els.start.hidden = true;
      this.els.reticle.hidden = false;
      this.running = true;
      // location may take a moment; offer manual entry if it never arrives
      setTimeout(() => { if (!Sensors.state.gpsOK) this.els.manual.hidden = false; }, 6000);
      requestAnimationFrame((t) => this.loop(t));
    },

    // Synthetic device->world matrix for demo mode: look at (alt, az) with the
    // azimuth slowly panning. Columns are the device axes (right, up, -forward).
    _demoMatrix(t) {
      const D2R = Math.PI / 180;
      const alt = 42 * D2R;
      const az = ((t * 0.006) % 360) * D2R;
      const f = [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
      let right = Mat.norm(Mat.cross(f, [0, 0, 1]));
      const up = Mat.cross(right, f);
      return [
        [right[0], up[0], -f[0]],
        [right[1], up[1], -f[1]],
        [right[2], up[2], -f[2]],
      ];
    },

    resize() {
      this.dpr = global.devicePixelRatio || 1;
      this.W = global.innerWidth; this.H = global.innerHeight;
      const c = this.els.canvas;
      c.width = Math.round(this.W * this.dpr);
      c.height = Math.round(this.H * this.dpr);
      c.style.width = this.W + 'px'; c.style.height = this.H + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      Projection.setViewport(this.W, this.H, this.settings.fov);
    },

    loop(t) {
      if (!this.running) return;
      const now = new Date();
      const st = Sensors.state;

      if (st.gpsOK && !Astro.hasObserver()) Astro.setObserver(st.lat, st.lon, st.alt);
      if (Astro.hasObserver() && (t - this.lastAstro > 400)) {
        Astro.update(now); this.lastAstro = t;
      }

      const R = this.demo ? this._demoMatrix(t) : Sensors.worldMatrix(Calibration.offset);
      if (Astro.rot && st.orientationOK) {
        Renderer.draw(this.ctx, R, this.W, this.H, this.settings);
      } else {
        this.ctx.clearRect(0, 0, this.W, this.H);
        this.drawWaiting();
      }

      // fps + HUD
      this._frames++;
      if (t - this._fpsT > 500) { this.fps = this._frames * 1000 / (t - this._fpsT); this._frames = 0; this._fpsT = t; }
      const look = Sensors.lookAngles(R);
      const cal = Calibration.describe();
      HUD.update({
        lat: st.lat, lon: st.lon, accuracy: st.accuracy,
        az: look.az, alt: look.alt, northRef: st.northRef,
        compassHeading: st.compassHeading, screenAngle: st.screenAngle,
        calYaw: cal.yawDeg, calPitch: cal.pitchDeg, fov: this.settings.fov, fps: this.fps,
      });

      requestAnimationFrame((tt) => this.loop(tt));
    },

    drawWaiting() {
      const c = this.ctx;
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.font = '15px system-ui, sans-serif';
      c.textAlign = 'center';
      const msg = !Sensors.state.orientationOK ? 'Move the phone to activate the compass…'
        : !Astro.hasObserver() ? 'Waiting for your location…' : 'Starting…';
      c.fillText(msg, this.W / 2, this.H / 2);
    },

    beginCalibrate() {
      if (!this.running) return;
      this.calibrating = 'pick';
      this.toast('Tap a labelled star, planet or the Moon that you can identify.');
    },

    onCanvasTap(e) {
      const rect = this.els.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;

      if (this.calibrating) {
        const R = this.demo ? this._demoMatrix(performance.now())
          : Sensors.worldMatrix(Calibration.offset);
        if (this.calibrating === 'pick') {
          const near = Renderer.pickNearest(px, py);
          if (!near) { this.toast('No labelled object near there — try again.'); return; }
          Calibration.setReference(near.world, near.label);
          this.calibrating = 'place';
          this.toast(`Now tap where “${near.label}” really is in the sky.`);
        } else if (this.calibrating === 'place') {
          Calibration.applyTap(px, py, R);
          const cal = Calibration.describe();
          this.calibrating = null;
          this.toast(`Aligned. Offset yaw ${cal.yawDeg}°, pitch ${cal.pitchDeg}°.`);
        }
        return;
      }

      // default tap = identify the nearest object (or dismiss the card)
      const near = Renderer.pickForInfo(px, py);
      if (near) Info.showFor(near);
      else if (Info.isOpen()) Info.hide();
    },

    toast(msg) {
      const el = this.els.toast;
      el.textContent = msg; el.hidden = false;
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => { el.hidden = true; }, 4000);
    },
  };

  global.App = App;
  document.addEventListener('DOMContentLoaded', () => App.init());
})(window);
