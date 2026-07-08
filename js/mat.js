/* mat.js — minimal 3-vector and 3x3 matrix helpers (row-major).
 * A matrix is [[r0c0,r0c1,r0c2],[r1..],[r2..]]; m[row][col].
 * No dependencies; attaches a global `Mat`. */
(function (global) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const Mat = {
    D2R, R2D,

    // --- vectors (plain [x,y,z] arrays) ---
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    norm: (a) => {
      const L = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / L, a[1] / L, a[2] / L];
    },

    identity: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]],

    // matrix * vector  (m applied to column vector v)
    mulV: (m, v) => [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ],

    // transpose(m) * vector — useful for orthonormal (world->local) transforms
    mulTV: (m, v) => [
      m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
      m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
      m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
    ],

    mulM: (a, b) => {
      const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
      return r;
    },

    transpose: (m) => [
      [m[0][0], m[1][0], m[2][0]],
      [m[0][1], m[1][1], m[2][1]],
      [m[0][2], m[1][2], m[2][2]],
    ],

    col: (m, j) => [m[0][j], m[1][j], m[2][j]],

    // rotation by `angle` (radians) about a unit `axis` (Rodrigues)
    axisAngle: (axis, angle) => {
      const [x, y, z] = Mat.norm(axis);
      const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
      return [
        [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
      ];
    },
  };

  global.Mat = Mat;
})(window);
