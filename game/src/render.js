// Leonida Nights — hand-written Canvas 2D renderer.
//
// There is no 3D library here on purpose: this file projects the low-poly
// city onto a 2D canvas itself. Every frame the game hands it boxes,
// polygons and lines in world space; the renderer clips them against the
// near plane, projects them with a perspective camera, sorts the faces
// far-to-near (painter's algorithm) and fills them. Buildings get lit
// windows, cars and people are small boxes with moving limbs, and the
// ground is a set of precomputed quads (sidewalks, lane dashes,
// crosswalks, beach, sea, pier). Nothing is downloaded and nothing is
// copied in: the whole 3D look is these few hundred lines.

const NEAR = 0.6;
const FOV_HALF_TAN = Math.tan((62 / 2) * Math.PI / 180);

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

// Hex colour (0xRRGGBB) scaled by a brightness factor -> css rgb string.
export function shade(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return `rgb(${r},${g},${b})`;
}
function rgba(hex, f, a) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return `rgba(${r},${g},${b},${a})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.cam = { x: 0, y: 40, z: 80, yaw: 0, pitch: 0.42 };
    this.night = 0;
    this.W = 0;
    this.H = 0;
    this.F = 600;
    this.resize();
  }

  resize() {
    this.W = this.canvas.width = window.innerWidth;
    this.H = this.canvas.height = window.innerHeight;
    this.F = (this.H / 2) / FOV_HALF_TAN;
  }

  // Camera looks along (sin yaw, cos yaw) in the ground plane, tilted down
  // by `pitch` radians below horizontal.
  setCamera(x, y, z, yaw, pitch) {
    this.cam = { x, y, z, yaw, pitch };
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    this.fwd = { x: sy * cp, y: -sp, z: cy * cp };
    this.right = { x: cy, y: 0, z: -sy };
    // up = fwd x right
    this.up = {
      x: this.fwd.y * this.right.z - this.fwd.z * this.right.y,
      y: this.fwd.z * this.right.x - this.fwd.x * this.right.z,
      z: this.fwd.x * this.right.y - this.fwd.y * this.right.x,
    };
  }

  toCam(p) {
    const dx = p.x - this.cam.x, dy = p.y - this.cam.y, dz = p.z - this.cam.z;
    return {
      x: dx * this.right.x + dy * this.right.y + dz * this.right.z,
      y: dx * this.up.x + dy * this.up.y + dz * this.up.z,
      z: dx * this.fwd.x + dy * this.fwd.y + dz * this.fwd.z,
    };
  }

  // Clip a polygon (camera-space points) against the near plane z >= NEAR.
  clipPoly(pts) {
    let out = pts;
    const clip = (list) => {
      const res = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i], b = list[(i + 1) % list.length];
        const aIn = a.z >= NEAR, bIn = b.z >= NEAR;
        if (aIn) res.push(a);
        if (aIn !== bIn) {
          const t = (NEAR - a.z) / (b.z - a.z);
          res.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR });
        }
      }
      return res;
    };
    out = clip(out);
    return out.length >= 3 ? out : null;
  }

  project(c) {
    return { x: this.W / 2 + (c.x / c.z) * this.F, y: this.H / 2 - (c.y / c.z) * this.F, z: c.z };
  }

  // Queue a filled polygon given world-space points {x,y,z}.
  poly(pts, fill, stroke) {
    const cam = pts.map((p) => this.toCam(p));
    const clipped = this.clipPoly(cam);
    if (!clipped) return;
    const sp = clipped.map((c) => this.project(c));
    let depth = 0;
    for (const c of clipped) depth += c.z;
    depth /= clipped.length;
    this.items.push({ depth, draw: (g) => {
      g.beginPath();
      g.moveTo(sp[0].x, sp[0].y);
      for (let i = 1; i < sp.length; i++) g.lineTo(sp[i].x, sp[i].y);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
    } });
  }

  quad(a, b, c, d, fill, stroke) { this.poly([a, b, c, d], fill, stroke); }

  // Queue a 3D line; width is in world units at the line's depth.
  line3(a, b, color, width) {
    const ca = this.toCam(a), cb = this.toCam(b);
    if (ca.z < NEAR && cb.z < NEAR) return;
    let pa = ca, pb = cb;
    if (pa.z < NEAR) { const t = (NEAR - pa.z) / (pb.z - pa.z); pa = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, z: NEAR }; }
    if (pb.z < NEAR) { const t = (NEAR - pb.z) / (pa.z - pb.z); pb = { x: pb.x + (pa.x - pb.x) * t, y: pb.y + (pa.y - pb.y) * t, z: NEAR }; }
    const sa = this.project(pa), sb = this.project(pb);
    const depth = (pa.z + pb.z) / 2;
    const w = Math.max(1, ((width || 0.15) * this.F) / depth);
    this.items.push({ depth, draw: (g) => {
      g.beginPath();
      g.moveTo(sa.x, sa.y);
      g.lineTo(sb.x, sb.y);
      g.strokeStyle = color;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.stroke();
    } });
  }

  // Screen-space text anchored at a world point (for neon signs).
  text3(x, y, z, str, color, sizeWorld) {
    const c = this.toCam({ x, y, z });
    if (c.z < NEAR + 2) return;
    const s = this.project(c);
    const px = Math.max(8, (sizeWorld * this.F) / c.z);
    this.items.push({ depth: c.z, draw: (g) => {
      g.font = `bold ${px.toFixed(1)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = color;
      g.shadowBlur = Math.max(4, px * 0.45);
      g.fillStyle = color;
      g.fillText(str, s.x, s.y);
      g.shadowBlur = 0;
    } });
  }

  // A box from precomputed world-space corners (8 points, in the order:
  // bottom 4 (+x+z, -x+z, -x-z, +x-z), then top 4 in the same order).
  // colours: {top, side} as hex; faces facing the sun are brightened.
  // `heading` rotates the side-face normals (cars/people are yawed).
  boxFromCorners(c, colours, sun, heading) {
    const ch = Math.cos(heading || 0), sh = Math.sin(heading || 0);
    const rot = (nx, nz) => ({ x: nx * ch + nz * sh, y: 0, z: -nx * sh + nz * ch });
    const faces = [
      { idx: [4, 5, 6, 7], col: colours.top, n: { x: 0, y: 1, z: 0 } },
      { idx: [0, 1, 5, 4], col: colours.side, n: rot(0, 1) },
      { idx: [1, 2, 6, 5], col: colours.side, n: rot(-1, 0) },
      { idx: [2, 3, 7, 6], col: colours.side, n: rot(0, -1) },
      { idx: [3, 0, 4, 7], col: colours.side, n: rot(1, 0) },
    ];
    for (const f of faces) {
      const ctr = { x: 0, y: 0, z: 0 };
      for (const i of f.idx) { ctr.x += c[i].x; ctr.y += c[i].y; ctr.z += c[i].z; }
      ctr.x /= 4; ctr.y /= 4; ctr.z /= 4;
      // Backface cull: only draw faces whose outward normal points at the camera.
      const toCam = { x: this.cam.x - ctr.x, y: this.cam.y - ctr.y, z: this.cam.z - ctr.z };
      if (f.n.x * toCam.x + f.n.y * toCam.y + f.n.z * toCam.z <= 0) continue;
      const sunDot = sun ? Math.max(0, f.n.x * sun.x + f.n.y * sun.y + f.n.z * sun.z) : 0;
      const bright = (1 - this.night * 0.62) * (0.72 + 0.38 * sunDot);
      this.poly(f.idx.map((i) => c[i]), shade(f.col, bright));
    }
  }

  // Axis-aligned box rotated by `heading` (yaw) about its centre column.
  // (x, z) is the centre, yBase the bottom, w/d the footprint, h the height.
  box(x, yBase, z, w, h, d, heading, colours, sun) {
    const hw = w / 2, hd = d / 2;
    const ch = Math.cos(heading), sh = Math.sin(heading);
    const corner = (lx, ly, lz) => ({
      x: x + lx * ch + lz * sh,
      y: yBase + ly,
      z: z - lx * sh + lz * ch,
    });
    const c = [
      corner(hw, 0, hd), corner(-hw, 0, hd), corner(-hw, 0, -hd), corner(hw, 0, -hd),
      corner(hw, h, hd), corner(-hw, h, hd), corner(-hw, h, -hd), corner(hw, h, -hd),
    ];
    this.boxFromCorners(c, colours, sun, heading);
    return c;
  }

  // Box tilted by `tilt` radians about its local X axis around a pivot
  // point (used for swinging arms and legs). Pivot is the top centre.
  tiltedBox(px, py, pz, w, h, d, heading, tilt, colours, sun) {
    const hw = w / 2, hd = d / 2;
    const ch = Math.cos(heading), sh = Math.sin(heading);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    // Local point: (lx, -down, lz) relative to the pivot, rotated about X
    // (forward axis), then yawed by heading.
    const corner = (lx, down, lz) => {
      const y1 = -down * ct - lz * st;
      const z1 = -down * st + lz * ct;
      return {
        x: px + lx * ch + z1 * sh,
        y: py + y1,
        z: pz - lx * sh + z1 * ch,
      };
    };
    // Corners in boxFromCorners order: bottom 4 (down = h), then top 4 (pivot plane).
    const c = [
      corner(hw, h, hd), corner(-hw, h, hd), corner(-hw, h, -hd), corner(hw, h, -hd),
      corner(hw, 0, hd), corner(-hw, 0, hd), corner(-hw, 0, -hd), corner(hw, 0, -hd),
    ];
    this.boxFromCorners(c, colours, sun, heading);
  }

  // Vertical cylinder (fountain, lamp bulbs) as side quads + a top polygon.
  cyl(x, z, r, yBase, h, colour, segments) {
    const n = segments || 10;
    const top = [], bottom = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      top.push({ x: x + Math.cos(a) * r, y: yBase + h, z: z + Math.sin(a) * r });
      bottom.push({ x: x + Math.cos(a) * r, y: yBase, z: z + Math.sin(a) * r });
    }
    const sun = this.sunDir;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mid = { x: (top[i].x + top[j].x) / 2, y: yBase + h / 2, z: (top[i].z + top[j].z) / 2 };
      const nrm = { x: Math.cos(((i + 0.5) / n) * Math.PI * 2), y: 0, z: Math.sin(((i + 0.5) / n) * Math.PI * 2) };
      const toCam = { x: this.cam.x - mid.x, y: this.cam.y - mid.y, z: this.cam.z - mid.z };
      if (nrm.x * toCam.x + nrm.y * toCam.y + nrm.z * toCam.z <= 0) continue;
      const sunDot = sun ? Math.max(0, nrm.x * sun.x + nrm.z * sun.z) : 0;
      const bright = (1 - this.night * 0.62) * (0.72 + 0.38 * sunDot);
      this.quad(bottom[i], bottom[j], top[j], top[i], shade(colour, bright));
    }
    this.poly(top, shade(colour, (1 - this.night * 0.62) * 1.05));
  }

  // Soft dark ellipse under a car or person so it sits on the ground.
  groundShadow(x, z, rx, rz) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      pts.push({ x: x + Math.cos(a) * rx, y: 0.03, z: z + Math.sin(a) * rz });
    }
    this.poly(pts, `rgba(0,0,0,${0.30 - this.night * 0.08})`);
  }

  begin(night) {
    this.night = night;
    const g = this.ctx;
    this.items.length = 0;
    // Sunset sky: golden-hour purple-orange by day, near-black by night.
    const top = shade(0x2a1e3f, 1 - night * 0.75);
    const horizon = shade(0xd86a3a, (1 - night) * 0.9 + 0.08);
    const grad = g.createLinearGradient(0, 0, 0, this.H);
    grad.addColorStop(0, top);
    grad.addColorStop(0.62, night > 0.5 ? shade(0x0a0c1c, 1) : horizon);
    grad.addColorStop(1, shade(0x1a1426, 1 - night * 0.5));
    g.fillStyle = grad;
    g.fillRect(0, 0, this.W, this.H);
    // Sun low on the horizon by day, moon by night.
    const sunX = this.W * 0.72, sunY = this.H * (0.30 + night * 0.12);
    const sr = Math.max(26, this.H * 0.045);
    g.beginPath();
    g.arc(sunX, sunY, sr, 0, Math.PI * 2);
    g.fillStyle = night > 0.5 ? '#dfe8ff' : '#ffd9a0';
    g.globalAlpha = night > 0.5 ? 0.9 : 0.95;
    g.fill();
    g.globalAlpha = 1;
    this.sunDir = { x: 0.55, y: 0.65, z: 0.35 };
  }

  end() {
    this.items.sort((a, b) => b.depth - a.depth);
    const g = this.ctx;
    for (const it of this.items) it.draw(g);
    this.items.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Scene drawing. `city` is the object buildCity() returns (see city.js).
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawCity(r, city, night) {
  const sun = r.sunDir;
  const cam = r.cam;
  const dist2 = (x, z) => (x - cam.x) * (x - cam.x) + (z - cam.z) * (z - cam.z);
  // Ground tiles: asphalt, sidewalks, lane dashes, crosswalks, beach, sea.
  for (const q of city.groundQuads) r.quad(q[0], q[1], q[2], q[3], shade(q[4], (1 - night * 0.55)));
  // Buildings, with lit windows on the faces near the camera.
  for (const b of city.buildings) {
    const corners = r.box(b.x, 0, b.z, b.w, b.h, b.d, 0, { top: 0x3a3a44, side: b.color }, sun);
    if (b.h > 3 && dist2(b.x, b.z) < 150 * 150) drawWindows(r, b, corners, night);
    if (b.roof) r.box(b.x, b.h, b.z, b.w * 0.4, 3, b.d * 0.4, 0, { top: 0x2c2c34, side: 0x3a3a44 }, sun);
  }
  // Fountain, benches, pier, shack.
  r.cyl(0, 0, 7.5, 0, 2.2, 0x4f7ea8, 14);
  for (const bn of city.benches) r.box(bn.x, 0, bn.z, 5, 1, 1.6, bn.heading, { top: 0x8a6a45, side: 0x7a5a3a }, sun);
  for (const pl of city.pierPlanks) r.box(pl.x, 0.8, pl.z, 8, 0.8, 10, 0, { top: 0x8a6a40, side: 0x7a5a34 }, sun);
  r.box(332, 1.2, 120, 9, 6, 8, 0, { top: 0x7a4030, side: 0x8c4a3a }, sun);
  // Street lamps: pole + glowing bulb.
  for (const l of city.lamps) {
    r.line3({ x: l.x, y: 0, z: l.z }, { x: l.x, y: 7, z: l.z }, '#222226', 0.3);
    const c = r.toCam({ x: l.x, y: 7.2, z: l.z });
    if (c.z > NEAR) {
      const s = r.project(c);
      const rad = Math.max(2, (0.9 * r.F) / c.z);
      r.items.push({ depth: c.z, draw: (g) => {
        g.beginPath(); g.arc(s.x, s.y, rad, 0, Math.PI * 2);
        g.fillStyle = night > 0.4 ? '#ffe9a8' : '#fff6d8';
        g.shadowColor = '#ffe9a8'; g.shadowBlur = rad * 2.2;
        g.fill(); g.shadowBlur = 0;
      } });
    }
  }
  // Palms: trunk + leaf crown.
  for (const p of city.palms) {
    r.line3({ x: p.x, y: 0, z: p.z }, { x: p.x, y: 8, z: p.z }, '#6a4a2a', 0.6);
    r.poly(
      [{ x: p.x - 3.4, y: 8, z: p.z }, { x: p.x + 3.4, y: 8, z: p.z }, { x: p.x, y: 12.4, z: p.z }],
      shade(0x2e7d4f, (1 - night * 0.6) * 0.95));
    r.poly(
      [{ x: p.x, y: 8, z: p.z - 3.4 }, { x: p.x, y: 8, z: p.z + 3.4 }, { x: p.x, y: 12.4, z: p.z }],
      shade(0x2e7d4f, (1 - night * 0.6) * 0.8));
  }
  // Neon signs, billboarded at their anchor points.
  for (const s of city.neon) r.text3(s.x, s.y, s.z, s.text, s.color, 3.2);
}

// Lit windows on a building's two street-facing sides. `corners` is the
// 8-corner array box() returned; faces +z and +x get the windows.
function drawWindows(r, b, corners, night) {
  const rng = mulberry32(b.seed);
  const faces = [
    { a: corners[0], b: corners[1], c: corners[5], d: corners[4] }, // +z face
    { a: corners[3], b: corners[0], c: corners[4], d: corners[7] }, // +x face
  ];
  for (const f of faces) {
    // Skip faces pointing away from the camera.
    const cx = (f.a.x + f.b.x + f.c.x + f.d.x) / 4;
    const cz = (f.a.z + f.b.z + f.c.z + f.d.z) / 4;
    const nx = f.b.x - f.a.x, nz = f.b.z - f.a.z;
    const toCamX = r.cam.x - cx, toCamZ = r.cam.z - cz;
    const faceNx = nz, faceNz = -nx;
    if (faceNx * toCamX + faceNz * toCamZ <= 0) continue;
    const cols = Math.max(2, Math.floor(b.w / 3.4));
    const rows = Math.max(2, Math.floor(b.h / 4.2));
    for (let ci = 0; ci < cols; ci++) {
      for (let ri = 0; ri < rows; ri++) {
        const u = (ci + 0.5) / cols, v = (ri + 0.5) / rows;
        // Bilinear point on the face (v runs bottom->top).
        const px = (f.a.x + (f.b.x - f.a.x) * u) * (1 - v) + (f.d.x + (f.c.x - f.d.x) * u) * v;
        const py = (f.a.y + (f.b.y - f.a.y) * u) * (1 - v) + (f.d.y + (f.c.y - f.d.y) * u) * v;
        const pz = (f.a.z + (f.b.z - f.a.z) * u) * (1 - v) + (f.d.z + (f.c.z - f.d.z) * u) * v;
        const lit = rng() < (night > 0.4 ? 0.55 : 0.4);
        const wx = 1.1, wy = 1.5;
        // Small quad facing the same way as the face (offset slightly out).
        const fl = Math.hypot(faceNx, faceNz) || 1;
        const ox = (faceNx / fl) * 0.06, oz = (faceNz / fl) * 0.06;
        // Window quad: horizontal span along the face, vertical span in y.
        const ux = (f.b.x - f.a.x) / cols / 2, uz = (f.b.z - f.a.z) / cols / 2;
        const p1 = { x: px - ux + ox, y: py - wy / 2, z: pz - uz + oz };
        const p2 = { x: px + ux + ox, y: py - wy / 2, z: pz + uz + oz };
        const p3 = { x: px + ux + ox, y: py + wy / 2, z: pz + uz + oz };
        const p4 = { x: px - ux + ox, y: py + wy / 2, z: pz - uz + oz };
        r.quad(p1, p2, p3, p4, lit ? (night > 0.4 ? '#ffd88a' : '#ffe9b0') : '#1a2233');
      }
    }
  }
}

// A low-poly car: body, cabin, wheels, headlights, optional police bar.
export function drawCar(r, car) {
  const sun = r.sunDir;
  r.groundShadow(car.x, car.z, 2.6, 1.6);
  r.box(car.x, 0.25, car.z, 2.1, 0.75, 4.6, car.heading, { top: car.color, side: car.color }, sun);
  // Cabin sits slightly behind the car's centre.
  const cabX = car.x - Math.sin(car.heading) * 0.25, cabZ = car.z - Math.cos(car.heading) * 0.25;
  r.box(cabX, 1.0, cabZ, 1.85, 0.65, 2.3, car.heading, { top: 0x18242e, side: 0x18242e }, sun);
  // Wheels.
  for (const [lx, lz] of [[-1.0, 1.5], [1.0, 1.5], [-1.0, -1.5], [1.0, -1.5]]) {
    const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
    const wx = car.x + lx * ch + lz * sh, wz = car.z - lx * sh + lz * ch;
    r.box(wx, 0, wz, 0.32, 0.84, 0.84, car.heading, { top: 0x141416, side: 0x141416 }, sun);
  }
  // Headlights (front = +z in car space).
  for (const sx of [-0.65, 0.65]) {
    const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
    const lx = sx, lz = 2.3;
    const wx = car.x + lx * ch + lz * sh, wz = car.z - lx * sh + lz * ch;
    r.box(wx, 0.62, wz, 0.35, 0.18, 0.1, car.heading, { top: 0xfff2b0, side: 0xfff2b0 }, null);
  }
  if (car.police) {
    const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
    const lx = 0, lz = -0.25;
    const wx = car.x + lx * ch + lz * sh, wz = car.z - lx * sh + lz * ch;
    const flash = Math.floor(performance.now() / 300) % 2 ? 0xff2a2a : 0x2a6bff;
    r.box(wx, 1.62, wz, 1.2, 0.22, 0.5, car.heading, { top: flash, side: flash }, null);
  }
}

// A person: torso, head, swinging legs and arms. `phase` drives the walk
// cycle; `down` lays the body flat (knocked out).
export function drawPerson(r, p) {
  const sun = r.sunDir;
  const shirt = p.shirt, skin = 0xd8a075, pants = 0x2a3242;
  if (p.down) {
    r.box(p.x, 0.1, p.z, 0.62, 0.4, 1.8, p.heading, { top: shirt, side: shirt }, sun);
    r.box(p.x, 0.1, p.z + 1.0, 0.4, 0.4, 0.4, p.heading, { top: skin, side: skin }, sun);
    return;
  }
  r.groundShadow(p.x, p.z, 0.7, 0.7);
  const swing = Math.sin(p.phase || 0) * 0.55;
  // Lateral offsets so the two legs / two arms do not overlap.
  const lx = Math.cos(p.heading) * 0.16, lz = -Math.sin(p.heading) * 0.16;
  const ax = Math.cos(p.heading) * 0.4, az = -Math.sin(p.heading) * 0.4;
  // Legs pivot at the hips (y 0.72), arms at the shoulders (y 1.44).
  r.tiltedBox(p.x - lx, 0.72, p.z - lz, 0.24, 0.72, 0.26, p.heading, swing, { top: pants, side: pants }, sun);
  r.tiltedBox(p.x + lx, 0.72, p.z + lz, 0.24, 0.72, 0.26, p.heading, -swing, { top: pants, side: pants }, sun);
  r.box(p.x, 0.76, p.z, 0.62, 0.72, 0.34, p.heading, { top: shirt, side: shirt }, sun);
  r.box(p.x, 1.48, p.z, 0.4, 0.4, 0.38, p.heading, { top: skin, side: skin }, sun);
  r.tiltedBox(p.x - ax, 1.44, p.z - az, 0.18, 0.62, 0.2, p.heading, -swing * 0.8, { top: shirt, side: shirt }, sun);
  r.tiltedBox(p.x + ax, 1.44, p.z + az, 0.18, 0.62, 0.2, p.heading, swing * 0.8, { top: shirt, side: shirt }, sun);
}

// Mission beacon: two crossed translucent pillars + a spinning diamond.
export function drawBeacon(r, x, z, t) {
  const y0 = 0, y1 = 34;
  const w = 3.2;
  r.quad({ x: x - w, y: y0, z }, { x: x + w, y: y0, z }, { x: x + w, y: y1, z }, { x: x - w, y: y1, z }, 'rgba(255,210,61,0.20)');
  r.quad({ x, y: y0, z: z - w }, { x, y: y0, z: z + w }, { x, y: y1, z: z + w }, { x, y: y1, z: z - w }, 'rgba(255,210,61,0.20)');
  const dy = 26 + Math.sin(t / 400) * 1.2;
  const s = 1.6;
  const top = { x, y: dy + s, z }, bot = { x, y: dy - s, z };
  const ring = [
    { x: x + s, y: dy, z }, { x, y: dy, z: z + s },
    { x: x - s, y: dy, z }, { x, y: dy, z: z - s },
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    r.poly([top, ring[i], ring[j]], '#ffd23d');
    r.poly([bot, ring[j], ring[i]], '#d8a81e');
  }
}

// Headlight cone on the road ahead of the player's car, at night.
export function drawHeadlight(r, car, night) {
  if (night < 0.5) return;
  const ch = Math.sin(car.heading), cz = Math.cos(car.heading);
  const px = -Math.cos(car.heading), pz = Math.sin(car.heading);
  r.quad(
    { x: car.x + ch * 2, y: 0.05, z: car.z + cz * 2 },
    { x: car.x + ch * 2 + px * 1.2, y: 0.05, z: car.z + cz * 2 + pz * 1.2 },
    { x: car.x + ch * 20 + px * 6, y: 0.05, z: car.z + cz * 20 + pz * 6 },
    { x: car.x + ch * 20 - px * 6, y: 0.05, z: car.z + cz * 20 - pz * 6 },
    'rgba(255,242,176,0.14)');
}
