// Drawing only: the world's state and the current screen in, pixels out. Every frame is
// drawn with triangles through one WebGL program (vertex colour, one sun, fog); the shaders
// are strings in this file, nothing is loaded from anywhere else. The HUD is DOM text over
// the canvas, never a 2D canvas. All 3D shapes are triangle meshes built here: the terrain
// heightfield, the runway, Aurelia's buildings, the Kestrel, the clouds and the rings.
import { PALETTE, RUNWAY, WEATHER, WORLD_SIZE } from './config.js';
import { terrainHeight } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

export const VIEW_COCKPIT = 0;
export const VIEW_CHASE = 1;
export const VIEW_TOWER = 2;

/* ---------- tiny mat4 helpers (column-major, as WebGL wants them) ---------- */
function matIdentity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function matMultiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
function matPerspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far);
  o[11] = -1; o[14] = (2 * far * near) / (near - far);
  return o;
}
function matLookAt(eye, center, up) {
  const zx = eye.x - center.x, zy = eye.y - center.y, zz = eye.z - center.z;
  const zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const xx = up.y * z[2] - up.z * z[1], xy = up.z * z[0] - up.x * z[2], xz = up.x * z[1] - up.y * z[0];
  const xl = Math.hypot(xx, xy, xz) || 1;
  const x = [xx / xl, xy / xl, xz / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const o = matIdentity();
  o[0] = x[0]; o[1] = y[0]; o[2] = z[0];
  o[4] = x[1]; o[5] = y[1]; o[6] = z[1];
  o[8] = x[2]; o[9] = y[2]; o[10] = z[2];
  o[12] = -(x[0] * eye.x + x[1] * eye.y + x[2] * eye.z);
  o[13] = -(y[0] * eye.x + y[1] * eye.y + y[2] * eye.z);
  o[14] = -(z[0] * eye.x + z[1] * eye.y + z[2] * eye.z);
  return o;
}
function matTranslate(x, y, z) {
  const o = matIdentity();
  o[12] = x; o[13] = y; o[14] = z;
  return o;
}
function matScale(x, y, z) {
  const o = matIdentity();
  o[0] = x; o[5] = y; o[10] = z;
  return o;
}
function matRotateX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = matIdentity();
  o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
  return o;
}
function matRotateY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = matIdentity();
  o[0] = c; o[2] = -s; o[8] = s; o[10] = c;
  return o;
}
function matRotateZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const o = matIdentity();
  o[0] = c; o[1] = s; o[4] = -s; o[5] = c;
  return o;
}
/** The plane's orientation: yaw from its heading, then pitch, then roll. */
function planeMatrix(p) {
  const yaw = Math.PI / 2 - p.heading;
  return matMultiply(
    matTranslate(p.x, p.y, p.z),
    matMultiply(matRotateY(yaw), matMultiply(matRotateZ(p.pitch), matRotateX(p.roll))),
  );
}

/* ---------- mesh building: triangles in, WebGL buffers out ---------- */
function builder() {
  const pos = [];
  const col = [];
  const nor = [];
  function tri(ax, ay, az, bx, by, bz, cx, cy, cz, color) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i += 1) col.push(color[0], color[1], color[2]);
    for (let i = 0; i < 3; i += 1) nor.push(nx, ny, nz);
  }
  function quad(a, b, c, d, color) {
    tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], color);
    tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], color);
  }
  function box(cx, cy, cz, sx, sy, sz, color, topColor) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    const top = topColor || color;
    quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], color);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], color);
    quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], color);
    quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], color);
    quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], color);
  }
  function prism(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color) {
    // A four-sided pyramid (a nose cone): apex a, base b-c-d.
    tri(ax, ay, az, bx, by, bz, cx, cy, cz, color);
    tri(ax, ay, az, cx, cy, cz, dx, dy, dz, color);
    tri(ax, ay, az, dx, dy, dz, bx, by, bz, color);
    tri(bx, by, bz, dx, dy, dz, cx, cy, cz, color);
  }
  function sphere(cx, cy, cz, r, color, stacks, slices) {
    for (let i = 0; i < stacks; i += 1) {
      const t0 = (i / stacks) * Math.PI;
      const t1 = ((i + 1) / stacks) * Math.PI;
      for (let j = 0; j < slices; j += 1) {
        const p0 = (j / slices) * Math.PI * 2;
        const p1 = ((j + 1) / slices) * Math.PI * 2;
        const v = (t, p) => [
          cx + r * Math.sin(t) * Math.cos(p),
          cy + r * Math.cos(t),
          cz + r * Math.sin(t) * Math.sin(p),
        ];
        const a = v(t0, p0), b = v(t0, p1), c = v(t1, p1), d = v(t1, p0);
        quad(a, b, c, d, color);
      }
    }
  }
  function torus(cx, cy, cz, radius, tube, color, segments) {
    for (let i = 0; i < segments; i += 1) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      for (let j = 0; j < 6; j += 1) {
        const b0 = (j / 6) * Math.PI * 2;
        const b1 = ((j + 1) / 6) * Math.PI * 2;
        const v = (a, b) => [
          cx + (radius + tube * Math.cos(b)) * Math.cos(a),
          cy + tube * Math.sin(b),
          cz + (radius + tube * Math.cos(b)) * Math.sin(a),
        ];
        const p00 = v(a0, b0), p01 = v(a0, b1), p11 = v(a1, b1), p10 = v(a1, b0);
        quad(p00, p01, p11, p10, color);
      }
    }
  }
  return { pos, col, nor, tri, quad, box, prism, sphere, torus };
}

function toBuffer(gl, data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return buffer;
}

const VERT_SRC = `
attribute vec3 aPos;
attribute vec3 aColor;
attribute vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
varying vec3 vColor;
varying vec3 vNormal;
varying float vDepth;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 view = uView * world;
  vColor = aColor;
  vNormal = mat3(uModel) * aNormal;
  vDepth = -view.z;
  gl_Position = uProj * view;
}`;
const FRAG_SRC = `
precision mediump float;
varying vec3 vColor;
varying vec3 vNormal;
varying float vDepth;
uniform vec3 uLight;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uEmissive;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLight)), 0.0);
  float lit = uEmissive > 0.5 ? 1.0 : 0.55 + 0.45 * diff;
  vec3 color = vColor * lit;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  gl_FragColor = vec4(mix(color, uFogColor, clamp(f, 0.0, 1.0)), 1.0);
}`;

function terrainColor(h) {
  if (h < -1) return PALETTE.sand;
  if (h < 45) return PALETTE.grass;
  if (h < 120) return PALETTE.grassDry;
  if (h < 240) return PALETTE.rock;
  return PALETTE.snow;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL is not available');

  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, VERT_SRC);
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, FRAG_SRC);
  gl.compileShader(fs);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);
  const loc = {
    pos: gl.getAttribLocation(program, 'aPos'),
    color: gl.getAttribLocation(program, 'aColor'),
    normal: gl.getAttribLocation(program, 'aNormal'),
    proj: gl.getUniformLocation(program, 'uProj'),
    view: gl.getUniformLocation(program, 'uView'),
    model: gl.getUniformLocation(program, 'uModel'),
    light: gl.getUniformLocation(program, 'uLight'),
    fogColor: gl.getUniformLocation(program, 'uFogColor'),
    fogDensity: gl.getUniformLocation(program, 'uFogDensity'),
    emissive: gl.getUniformLocation(program, 'uEmissive'),
  };
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  function meshFrom(b) {
    const count = b.pos.length / 3;
    return {
      count,
      pos: toBuffer(gl, b.pos),
      col: toBuffer(gl, b.col),
      nor: toBuffer(gl, b.nor),
    };
  }
  function bind(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos);
    gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(loc.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.col);
    gl.vertexAttribPointer(loc.color, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(loc.color);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nor);
    gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(loc.normal);
  }
  function drawMesh(mesh, model, emissive) {
    gl.uniformMatrix4fv(loc.model, false, model);
    gl.uniform1f(loc.emissive, emissive ? 1 : 0);
    bind(mesh);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  // ---- static world meshes (built once) ----
  const terrain = (() => {
    const b = builder();
    const N = 96;
    const size = WORLD_SIZE;
    const step = size / N;
    const heights = [];
    for (let j = 0; j <= N; j += 1) {
      heights.push([]);
      for (let i = 0; i <= N; i += 1) {
        heights[j].push(terrainHeight(-size / 2 + i * step, -size / 2 + j * step));
      }
    }
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const x0 = -size / 2 + i * step;
        const z0 = -size / 2 + j * step;
        const x1 = x0 + step;
        const z1 = z0 + step;
        const h00 = heights[j][i], h10 = heights[j][i + 1];
        const h01 = heights[j + 1][i], h11 = heights[j + 1][i + 1];
        const avg = (h00 + h10 + h01 + h11) / 4;
        const color = terrainColor(avg);
        b.quad([x0, h00, z0], [x1, h10, z0], [x1, h11, z1], [x0, h01, z1], color);
      }
    }
    return meshFrom(b);
  })();

  const water = (() => {
    const b = builder();
    for (let i = 0; i < 24; i += 1) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 1) / 24) * Math.PI * 2;
      b.tri(-1500, -2, -1200,
        -1500 + Math.cos(a0) * 700, -2, -1200 + Math.sin(a0) * 500,
        -1500 + Math.cos(a1) * 700, -2, -1200 + Math.sin(a1) * 500, PALETTE.water);
    }
    return meshFrom(b);
  })();

  const runway = (() => {
    const b = builder();
    const L = RUNWAY.length, W = RUNWAY.width;
    b.quad([-L / 2, 0.6, -W / 2], [L / 2, 0.6, -W / 2], [L / 2, 0.6, W / 2], [-L / 2, 0.6, W / 2], PALETTE.asphalt);
    // Threshold bars and the centreline dashes.
    for (const side of [-1, 1]) {
      const x = side * (L / 2 - 18);
      for (let k = -2; k <= 2; k += 1) {
        b.quad([x - 8, 0.8, k * 6 - 1.5], [x + 8, 0.8, k * 6 - 1.5], [x + 8, 0.8, k * 6 + 1.5], [x - 8, 0.8, k * 6 + 1.5], PALETTE.marking);
      }
    }
    for (let x = -L / 2 + 60; x < L / 2 - 40; x += 60) {
      b.quad([x, 0.8, -1.2], [x + 28, 0.8, -1.2], [x + 28, 0.8, 1.2], [x, 0.8, 1.2], PALETTE.marking);
    }
    // Edge lights: small bright boxes along both edges.
    for (let x = -L / 2; x <= L / 2; x += 100) {
      for (const z of [-W / 2 - 2, W / 2 + 2]) {
        b.box(x, 1.2, z, 1.2, 1.2, 1.2, [1.0, 0.85, 0.3]);
      }
    }
    // Windsock at the threshold.
    b.box(-L / 2 - 30, 6, -25, 0.6, 12, 0.6, [0.9, 0.9, 0.9]);
    b.prism(-L / 2 - 24, 11.5, -25, -L / 2 - 30, 11.5, -27, -L / 2 - 30, 11.5, -23, -L / 2 - 30, 9.5, -25, [1.0, 0.5, 0.1]);
    return meshFrom(b);
  })();

  const city = (() => {
    const b = builder();
    return { build(buildings) {
      const bb = builder();
      for (const bd of buildings) {
        const color = bd.glass ? PALETTE.buildingGlass : PALETTE.building;
        bb.box(bd.x, bd.h / 2, bd.z, bd.w, bd.h, bd.d, color, [0.75, 0.72, 0.68]);
      }
      return meshFrom(bb);
    } };
  })();

  // The Kestrel, in local space: nose +X, up +Y, right wing +Z.
  const planeMesh = (() => {
    const b = builder();
    const W = PALETTE.planeWhite, R = PALETTE.planeRed, D = PALETTE.planeDark;
    b.box(0, 0, 0, 5.4, 1.3, 1.3, W);
    b.prism(4.2, 0, 0, 2.7, 0.65, 0.65, 2.7, -0.65, 0.65, 2.7, 0, -0.65, W);
    b.prism(-2.7, 0, 0, -4.0, 0.5, 0.5, -4.0, -0.5, 0.5, -4.0, 0, -0.5, W);
    b.box(0.3, 0.55, 0, 1.6, 0.7, 1.1, D);
    b.box(0.2, -0.1, 0, 3.4, 0.18, 12.4, W);
    b.box(0.2, -0.1, -5.6, 3.4, 0.18, 1.2, R);
    b.box(0.2, -0.1, 5.6, 3.4, 0.18, 1.2, R);
    b.box(-3.4, 0.1, 0, 1.6, 0.14, 4.6, W);
    b.box(-3.4, 0.7, 0, 1.4, 1.5, 0.16, R);
    b.box(0, -0.9, -0.9, 0.5, 0.7, 0.3, D);
    b.box(0, -0.9, 0.9, 0.5, 0.7, 0.3, D);
    b.box(-2.2, -0.9, 0, 0.5, 0.7, 0.3, D);
    return meshFrom(b);
  })();

  const propMesh = (() => {
    const b = builder();
    b.box(2.9, 0, 0, 0.25, 0.5, 0.5, PALETTE.planeDark);
    b.box(3.05, 1.1, 0, 0.12, 2.0, 0.3, PALETTE.planeDark);
    b.box(3.05, -1.1, 0, 0.12, 2.0, 0.3, PALETTE.planeDark);
    return meshFrom(b);
  })();

  const cloudMesh = (() => {
    const b = builder();
    b.sphere(0, 0, 0, 1, PALETTE.cloud, 6, 10);
    return meshFrom(b);
  })();

  const ringMesh = (() => {
    const b = builder();
    b.torus(0, 0, 0, 40, 1.4, PALETTE.ring, 20);
    return meshFrom(b);
  })();

  // The dashboard panel shown in the cockpit view: a dark slab under the nose.
  const dashMesh = (() => {
    const b = builder();
    b.box(1.6, -0.55, 0, 0.5, 0.5, 3.2, [0.08, 0.09, 0.12]);
    b.box(1.35, -0.28, -0.9, 0.1, 0.12, 0.5, [0.2, 0.9, 0.4]);
    b.box(1.35, -0.28, 0, 0.1, 0.12, 0.5, [0.95, 0.75, 0.2]);
    b.box(1.35, -0.28, 0.9, 0.1, 0.12, 0.5, [0.9, 0.25, 0.2]);
    return meshFrom(b);
  })();

  let cityMesh = null;
  let proj = matIdentity();

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    proj = matPerspective((68 * Math.PI) / 180, canvas.width / canvas.height, 0.5, 12000);
  }

  /** The camera for a view: eye, centre and up. */
  function cameraFor(state, view, time) {
    const p = state.plane;
    const yaw = Math.PI / 2 - p.heading;
    const fwd = {
      x: Math.sin(p.heading) * Math.cos(p.pitch),
      y: Math.sin(p.pitch),
      z: -Math.cos(p.heading) * Math.cos(p.pitch),
    };
    // The plane's up vector: Ry(yaw) * Rz(pitch) * Rx(roll) applied to (0, 1, 0), so the
    // cockpit camera banks with the plane and the horizon tilts.
    const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const up = {
      x: -cy * sp * cr + sy * sr,
      y: cp * cr,
      z: sy * sp * cr + cy * sr,
    };
    if (view === VIEW_COCKPIT) {
      const eye = { x: p.x + fwd.x * 1.1 + up.x * 0.75, y: p.y + fwd.y * 1.1 + up.y * 0.75, z: p.z + fwd.z * 1.1 + up.z * 0.75 };
      const center = { x: eye.x + fwd.x, y: eye.y + fwd.y, z: eye.z + fwd.z };
      return { eye, center, up };
    }
    if (view === VIEW_CHASE) {
      const back = { x: Math.sin(p.heading), y: 0, z: -Math.cos(p.heading) };
      const eye = { x: p.x - back.x * 30, y: p.y + 7, z: p.z - back.z * 30 };
      const center = { x: p.x + fwd.x * 10, y: p.y + fwd.y * 10, z: p.z + fwd.z * 10 };
      return { eye, center, up: { x: 0, y: 1, z: 0 } };
    }
    // Tower: a fixed point by the runway, tracking the plane.
    return {
      eye: { x: -60, y: 28, z: -90 },
      center: { x: p.x, y: p.y, z: p.z },
      up: { x: 0, y: 1, z: 0 },
    };
  }

  /** Paint one frame. `screen` is title/play/paused/over; `time` is seconds. */
  function draw(state, screen, view, time) {
    resize();
    const weather = WEATHER[state.scenario.weather];
    const dusk = weather.dusk;
    const sky = dusk ? PALETTE.skyDusk : weather.fog > 0.0005 ? PALETTE.skyStorm : PALETTE.skyClear;
    const fog = dusk ? PALETTE.fogDusk : weather.fog > 0.0005 ? PALETTE.fogStorm : PALETTE.fogClear;
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(loc.proj, false, proj);
    gl.uniform3f(loc.light, 0.5, dusk ? 0.25 : 0.8, 0.35);
    gl.uniform3f(loc.fogColor, fog[0], fog[1], fog[2]);
    gl.uniform1f(loc.fogDensity, weather.fog);

    let cam;
    if (screen === SCREEN_TITLE) {
      const a = time * 0.05;
      cam = {
        eye: { x: Math.cos(a) * 900, y: 260, z: Math.sin(a) * 900 },
        center: { x: 0, y: 20, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      };
    } else {
      cam = cameraFor(state, view, time);
    }
    gl.uniformMatrix4fv(loc.view, false, matLookAt(cam.eye, cam.center, cam.up));

    if (!cityMesh) cityMesh = city.build(state.buildings);
    drawMesh(terrain, matIdentity(), false);
    drawMesh(water, matIdentity(), false);
    drawMesh(runway, matIdentity(), false);
    drawMesh(cityMesh, matIdentity(), false);

    // Clouds drift with the wind.
    for (const cloud of state.clouds) {
      const cx = cloud.x + state.wind.x * time * 0.6;
      const cz = cloud.z + state.wind.z * time * 0.6;
      const model = matMultiply(
        matTranslate(cx, cloud.y, cz),
        matScale(cloud.s, cloud.s * 0.42, cloud.s),
      );
      drawMesh(cloudMesh, model, false);
    }

    // Rings: the next one bright, the rest dim and only while the flight runs. Each ring
    // stands vertical, facing the direction the plane approaches it from.
    if (screen !== SCREEN_TITLE) {
      state.rings.forEach((ring, index) => {
        if (ring.done) return;
        const from = index === 0 ? state.scenario.start : state.rings[index - 1];
        const dx = ring.x - from.x, dz = ring.z - from.z;
        const yaw = Math.atan2(dx, dz);
        const bright = index === state.ringIndex;
        const model = matMultiply(
          matTranslate(ring.x, ring.y, ring.z),
          matMultiply(matRotateY(yaw), matRotateX(Math.PI / 2)),
        );
        drawMesh(ringMesh, model, bright);
      });
    }

    // The Kestrel, and its spinning propeller.
    const pm = planeMatrix(state.plane);
    drawMesh(planeMesh, pm, false);
    drawMesh(propMesh, matMultiply(pm, matRotateX(time * 22)), false);
    if (view === VIEW_COCKPIT && screen !== SCREEN_TITLE) {
      drawMesh(dashMesh, pm, false);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
