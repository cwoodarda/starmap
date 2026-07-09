/* sensors.js — device orientation, compass heading and geolocation.
 * Produces a device->world rotation matrix (world = ENU: East,North,Up) with
 * screen orientation and a calibration offset folded in, plus the observer's
 * lat/lon for the astronomy layer. Attaches a global `Sensors`. */
(function (global) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const state = {
    orientationOK: false, gpsOK: false, ios: false, northRef: false,
    alpha: 0, beta: 0, gamma: 0, compassHeading: null, compassAccuracy: null,
    screenAngle: 0,
    lat: null, lon: null, alt: 0, accuracy: null, geoError: null,
  };

  const LOC_KEY = 'starmap.lastLocation';
  function saveLoc(lat, lon) {
    try { localStorage.setItem(LOC_KEY, JSON.stringify({ lat, lon })); } catch (e) {}
  }
  function loadLoc() {
    try { return JSON.parse(localStorage.getItem(LOC_KEY) || 'null'); } catch (e) { return null; }
  }

  // Human-readable reason for a geolocation failure.
  function geoErrText(e) {
    if (!e) return 'Location unavailable.';
    if (e.code === 1) return 'Location is blocked. Turn it on in Settings → Privacy & Security → ' +
      'Location Services → Safari Websites (set to "While Using"), then reload. Or enter coordinates below.';
    if (e.code === 2) return 'Location is unavailable (no GPS/network fix).';
    if (e.code === 3) return 'Location timed out — try again with a clear sky view.';
    return e.message || 'Location unavailable.';
  }

  function readScreenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number')
      return screen.orientation.angle;
    if (typeof window.orientation === 'number') return window.orientation;
    return 0;
  }

  function onOrient(e) {
    if (e.alpha == null) return;
    state.alpha = e.alpha; state.beta = e.beta; state.gamma = e.gamma;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      state.compassHeading = e.webkitCompassHeading;
      state.compassAccuracy = e.webkitCompassAccuracy;
      state.northRef = true; state.ios = true;
    } else if (e.absolute === true) {
      state.northRef = true;
    }
    state.orientationOK = true;
  }

  let onLocationCb = null;
  function onPos(p) {
    state.lat = p.coords.latitude;
    state.lon = p.coords.longitude;
    state.alt = p.coords.altitude || 0;
    state.accuracy = p.coords.accuracy;
    state.gpsOK = true;
    state.geoError = null;
    saveLoc(state.lat, state.lon);
    if (onLocationCb) onLocationCb(state);
  }
  function onGeoErr(e) { state.geoError = geoErrText(e); }

  // W3C device-orientation rotation matrix: maps a device-frame vector to the
  // Earth frame ENU (X=East, Y=North, Z=Up). alpha/beta/gamma in radians.
  function deviceToENU(alpha, beta, gamma) {
    const cA = Math.cos(alpha), sA = Math.sin(alpha);
    const cB = Math.cos(beta), sB = Math.sin(beta);
    const cG = Math.cos(gamma), sG = Math.sin(gamma);
    return [
      [cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB],
      [cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB],
      [-cB * sG, sB, cB * cG],
    ];
  }

  function rotZ(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  }

  const Sensors = {
    state,

    // iOS 13+ needs a user-gesture-triggered permission request.
    async requestPermission() {
      const req = async (Evt) => {
        if (Evt && typeof Evt.requestPermission === 'function') {
          try { return (await Evt.requestPermission()) === 'granted'; }
          catch (e) { return false; }
        }
        return true; // no gated permission (Android/desktop)
      };
      const a = await req(global.DeviceOrientationEvent);
      await req(global.DeviceMotionEvent);
      return a;
    },

    start() {
      state.screenAngle = readScreenAngle();
      // Prefer absolute (north-referenced) orientation where available.
      global.addEventListener('deviceorientationabsolute', onOrient, true);
      global.addEventListener('deviceorientation', onOrient, true);
      const upd = () => { state.screenAngle = readScreenAngle(); };
      global.addEventListener('orientationchange', upd);
      if (screen.orientation) screen.orientation.addEventListener('change', upd);

      if ('geolocation' in navigator) {
        navigator.geolocation.watchPosition(onPos, onGeoErr, {
          enableHighAccuracy: true, maximumAge: 10000, timeout: 20000,
        });
      } else {
        state.geoError = 'This browser has no location support.';
      }
    },

    // Fire `cb(state)` the first time (and each time) a real fix arrives.
    onLocation(cb) { onLocationCb = cb; },

    // One-shot high-accuracy retry, for a "Use my GPS location" button.
    retryLocation() {
      return new Promise((resolve) => {
        if (!('geolocation' in navigator)) { state.geoError = 'No location support.'; resolve(false); return; }
        navigator.geolocation.getCurrentPosition(
          (p) => { onPos(p); resolve(true); },
          (e) => { onGeoErr(e); resolve(false); },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
        );
      });
    },

    lastKnownLocation() { return loadLoc(); },

    setLocationManually(lat, lon, altM = 0) {
      state.lat = lat; state.lon = lon; state.alt = altM; state.gpsOK = true;
      state.geoError = null; saveLoc(lat, lon);
    },

    // Device->world (ENU) matrix with screen orientation + calibration applied.
    // cal = { yaw, pitch } in radians (yaw about world Up, pitch about view-right).
    worldMatrix(cal) {
      let alphaDeg = state.alpha;
      // On iOS the raw alpha isn't north-referenced; derive it from the compass.
      if (state.ios && state.compassHeading != null) alphaDeg = 360 - state.compassHeading;

      let R = deviceToENU(alphaDeg * D2R, state.beta * D2R, state.gamma * D2R);
      // Fold in display rotation (portrait/landscape). Identity in portrait.
      R = Mat.mulM(R, rotZ(-state.screenAngle * D2R));

      if (cal && (cal.yaw || cal.pitch)) {
        // yaw about world Up (+Z), then pitch about the current view-right axis.
        R = Mat.mulM(rotZ(cal.yaw), R);
        const right = Mat.col(R, 0); // device x-axis (screen right) in world
        if (cal.pitch) R = Mat.mulM(Mat.axisAngle(right, cal.pitch), R);
      }
      return R;
    },

    // Direction the rear camera points, in world ENU (= -deviceZ).
    viewDir(R) { return [-R[0][2], -R[1][2], -R[2][2]]; },

    // Human-readable heading/altitude of the view centre, for the HUD.
    lookAngles(R) {
      const v = this.viewDir(R);
      let az = Math.atan2(v[0], v[1]) * R2D; if (az < 0) az += 360;
      const alt = Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D;
      return { az, alt };
    },
  };

  global.Sensors = Sensors;
})(window);
