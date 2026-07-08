/* calibration.js — manual alignment nudge. The user taps a known bright object,
 * then taps where it really is in the sky; the angular delta becomes a persisted
 * yaw/pitch offset applied on top of the sensor orientation, correcting the
 * (often 10-30 deg) magnetometer error. Attaches a global `Calibration`. */
(function (global) {
  'use strict';
  const D2R = Math.PI / 180;
  const KEY = 'starmap_cal_v1';

  // If, on-device, the vertical nudge moves the sky the wrong way, flip this to -1.
  const PITCH_SIGN = 1;

  function norm180(deg) {
    let d = deg % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  const Calibration = {
    offset: { yaw: 0, pitch: 0 }, // radians
    reference: null,              // { world:[E,N,U], label } captured on first tap

    load() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY));
        if (s) this.offset = { yaw: s.yaw || 0, pitch: s.pitch || 0 };
      } catch (e) { /* ignore */ }
      return this.offset;
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.offset)); } catch (e) {}
    },

    reset() {
      this.offset = { yaw: 0, pitch: 0 };
      this.reference = null;
      this.save();
    },

    // Step 1: remember the true direction of the object the user picked.
    setReference(world, label) {
      this.reference = { world: world.slice(), label: label || 'object' };
    },

    // Step 2: user taps where that object actually appears. Update the offset so
    // the reference would project onto the tapped pixel.
    applyTap(px, py, R) {
      if (!this.reference) return false;
      const worldTap = Projection.screenToWorld(px, py, R);
      const tap = Projection.worldToAltAz(worldTap);
      const ref = Projection.worldToAltAz(this.reference.world);
      this.offset.yaw += norm180(tap.az - ref.az) * D2R;
      this.offset.pitch += PITCH_SIGN * (tap.alt - ref.alt) * D2R;
      this.reference = null;
      this.save();
      return true;
    },

    describe() {
      return {
        yawDeg: (this.offset.yaw / D2R).toFixed(1),
        pitchDeg: (this.offset.pitch / D2R).toFixed(1),
      };
    },
  };

  global.Calibration = Calibration;
})(window);
