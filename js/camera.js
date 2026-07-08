/* camera.js — starts the rear ("environment") camera and pipes it into the
 * background <video>. Attaches a global `Camera`. */
(function (global) {
  'use strict';
  const Camera = {
    stream: null,
    async start(videoEl) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not available (needs HTTPS and a supported browser).');
      }
      const tryGet = (constraints) => navigator.mediaDevices.getUserMedia(constraints);
      try {
        this.stream = await tryGet({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (e) {
        // fall back to any camera
        this.stream = await tryGet({ video: true, audio: false });
      }
      videoEl.srcObject = this.stream;
      await videoEl.play().catch(() => {}); // autoplay may resolve on user gesture
      return this.stream;
    },
    stop() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    },
  };
  global.Camera = Camera;
})(window);
