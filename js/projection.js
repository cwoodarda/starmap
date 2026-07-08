/* projection.js — pinhole projection between world ENU directions and screen
 * pixels, given the device->world matrix. The camera looks along the device's
 * -Z axis; a world vector is in view when its device-frame Z component is < 0.
 * Attaches a global `Projection`. */
(function (global) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const Projection = {
    W: 1, H: 1, fovV: 55, tanHalfV: 0, tanHalfH: 0,

    // fovV = vertical field of view in degrees (anchor; horizontal derived from aspect).
    setViewport(W, H, fovVdeg) {
      this.W = W; this.H = H;
      if (fovVdeg) this.fovV = fovVdeg;
      this.tanHalfV = Math.tan((this.fovV * D2R) / 2);
      this.tanHalfH = this.tanHalfV * (W / H);
    },

    // world ENU unit vector + device->world matrix R  ->  screen projection.
    project(world, R) {
      const cam = Mat.mulTV(R, world); // R^T * world = world expressed in device frame
      const z = cam[2];
      const inFront = z < 0;
      const depth = -z;
      let x = 0, y = 0, onScreen = false;
      if (inFront && depth > 1e-6) {
        const ndcX = (cam[0] / depth) / this.tanHalfH;
        const ndcY = (cam[1] / depth) / this.tanHalfV;
        x = (0.5 + 0.5 * ndcX) * this.W;
        y = (0.5 - 0.5 * ndcY) * this.H;
        onScreen = Math.abs(ndcX) <= 1.15 && Math.abs(ndcY) <= 1.15;
      }
      return { x, y, depth, inFront, onScreen };
    },

    // Screen pixel -> world ENU unit direction (used by calibration taps).
    screenToWorld(px, py, R) {
      const ndcX = (2 * px / this.W) - 1;
      const ndcY = 1 - (2 * py / this.H);
      const camDir = Mat.norm([ndcX * this.tanHalfH, ndcY * this.tanHalfV, -1]);
      return Mat.norm(Mat.mulV(R, camDir));
    },

    // world ENU -> {az, alt} degrees (for calibration bookkeeping / HUD).
    worldToAltAz(w) {
      let az = Math.atan2(w[0], w[1]) * R2D; if (az < 0) az += 360;
      const alt = Math.asin(Math.max(-1, Math.min(1, w[2]))) * R2D;
      return { az, alt };
    },
  };

  global.Projection = Projection;
})(window);
