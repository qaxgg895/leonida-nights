// Leonida Nights — the city of Vice Shores. All geometry is procedural low-poly:
// a ground texture painted on one canvas, box buildings with lit-window textures,
// street lamps, palms, neon signs, a beach and a pier. No external art.
import * as THREE from '../vendor/three.module.js';

export const PITCH = 58;          // block + road, in world units
export const BLOCK = 44;          // building block side
export const ROAD = PITCH - BLOCK;
export const GRID = 3;            // block indices run -3..3
export const WORLD = 420;         // ground plane side

const BUILDING_COLORS = [0x8a6f5c, 0x6f7d8c, 0x9c8a7a, 0x5c6b7a, 0xa88f6a, 0x7a6a8c, 0x8c7a5c, 0x6a7a6a];
const NEON = [
  { text: 'VICE SHORES', color: '#ff5fa2' },
  { text: 'HOTEL LUNA', color: '#4fd8ff' },
  { text: 'CASINO SOL', color: '#ffd23d' },
  { text: 'TACOS 24H', color: '#7dff9b' },
  { text: 'NEON MOTEL', color: '#ff9a3d' },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function windowTexture(base, litRatio, rng) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 122; y += 12) {
    for (let x = 6; x < 58; x += 10) {
      const lit = rng() < litRatio;
      g.fillStyle = lit ? (rng() < 0.75 ? '#ffd88a' : '#9fd8ff') : '#1a2233';
      g.fillRect(x, y, 6, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = '#0d0d14';
  g.fillRect(0, 0, 256, 48);
  g.font = 'bold 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 14;
  g.fillStyle = color;
  g.fillText(text, 128, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function groundTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const toPx = (v) => ((v / WORLD) + 0.5) * S;
  g.fillStyle = '#464650'; // asphalt
  g.fillRect(0, 0, S, S);
  // Sidewalk blocks, alternating shades with a darker edge so the grid reads.
  for (let i = -GRID; i <= GRID; i++) {
    for (let j = -GRID; j <= GRID; j++) {
      const x = toPx(i * PITCH - BLOCK / 2);
      const y = toPx(j * PITCH - BLOCK / 2);
      const w = (BLOCK / WORLD) * S;
      g.fillStyle = (i + j) % 2 === 0 ? '#5b5b66' : '#51515c';
      g.fillRect(x, y, w, w);
      g.strokeStyle = '#3a3a44';
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, w - 2, w - 2);
      g.fillStyle = '#62626d';
      g.fillRect(x + 3, y + 3, w - 6, w - 6);
    }
  }
  // Lane dashes along every road centreline.
  g.fillStyle = '#d8b45a';
  for (let k = -GRID - 1; k <= GRID; k++) {
    const line = toPx((k + 0.5) * PITCH);
    for (let d = -WORLD / 2 + 8; d < WORLD / 2 - 8; d += 16) {
      g.fillRect(line - 1, toPx(d), 2, 8);
      g.fillRect(toPx(d), line - 1, 8, 2);
    }
  }
  // Crosswalk stripes at intersections.
  g.fillStyle = 'rgba(235,235,235,0.75)';
  for (let i = -GRID - 1; i <= GRID; i++) {
    for (let j = -GRID - 1; j <= GRID; j++) {
      const cx = toPx((i + 0.5) * PITCH);
      const cz = toPx((j + 0.5) * PITCH);
      for (let s = -3; s <= 3; s++) {
        g.fillRect(cx - 14 + s * 4, cz - 9, 2.5, 18);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Road centreline coordinates (both axes). Traffic drives on these.
export function roadLines() {
  const lines = [];
  for (let k = -GRID - 1; k <= GRID; k++) lines.push((k + 0.5) * PITCH);
  return lines;
}

// A rectangular driving loop on the road grid, for traffic / autopilot.
export function makeLoop(rng) {
  const lines = roadLines();
  const pick = () => lines[Math.floor(rng() * lines.length)];
  let x1 = pick(), x2 = pick();
  let z1 = pick(), z2 = pick();
  if (x1 === x2) x2 = lines[(lines.indexOf(x1) + 2) % lines.length];
  if (z1 === z2) z2 = lines[(lines.indexOf(z1) + 2) % lines.length];
  return [
    { x: Math.min(x1, x2), z: Math.min(z1, z2) },
    { x: Math.max(x1, x2), z: Math.min(z1, z2) },
    { x: Math.max(x1, x2), z: Math.max(z1, z2) },
    { x: Math.min(x1, x2), z: Math.max(z1, z2) },
  ];
}

export function buildCity(scene, seed) {
  const rng = mulberry32(seed);
  const colliders = [];
  const lamps = [];

  scene.background = new THREE.Color(0x2a1e3f);
  scene.fog = new THREE.Fog(0x2a1e3f, 180, 520);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshLambertMaterial({ map: groundTexture() })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Beach (east) and sea.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 460),
    new THREE.MeshLambertMaterial({ color: 0xc9a86a })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(265, 0.02, 0);
  scene.add(sand);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 460),
    new THREE.MeshLambertMaterial({ color: 0x14506e, transparent: true, opacity: 0.92 })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(430, 0.05, 0);
  scene.add(sea);

  // Buildings, with a plaza at the centre block (0,0) instead of towers.
  const winTexes = [
    windowTexture('#8a7a68', 0.55, rng),
    windowTexture('#7a8a9c', 0.5, rng),
    windowTexture('#9c8a72', 0.45, rng),
  ];
  for (let i = -GRID; i <= GRID; i++) {
    for (let j = -GRID; j <= GRID; j++) {
      const cx = i * PITCH, cz = j * PITCH;
      if (i === 0 && j === 0) continue; // central plaza
      const n = 1 + Math.floor(rng() * 2); // 1 or 2 towers per block
      for (let b = 0; b < n; b++) {
        const w = 16 + rng() * 16;
        const d = 16 + rng() * 16;
        const h = 10 + rng() * rng() * 44;
        const ox = n === 1 ? 0 : (b === 0 ? -9 : 9);
        const oz = n === 1 ? 0 : (b === 0 ? 8 : -8);
        const x = cx + ox, z = cz + oz;
        // The tint is baked into the window texture; the material stays white
        // so the facade is never multiplied dark.
        const mat = new THREE.MeshLambertMaterial({
          map: winTexes[Math.floor(rng() * winTexes.length)],
        });
        const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        tower.position.set(x, h / 2, z);
        tower.castShadow = true;
        scene.add(tower);
        // Rooftop box, for silhouette variety.
        if (rng() < 0.5) {
          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(w * 0.4, 3, d * 0.4),
            new THREE.MeshLambertMaterial({ color: 0x3a3a44 })
          );
          roof.position.set(x, h + 1.5, z);
          scene.add(roof);
        }
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
      }
    }
  }

  // Central plaza: fountain + benches.
  const fountain = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 8, 2.2, 20),
    new THREE.MeshLambertMaterial({ color: 0x4f7ea8 })
  );
  fountain.position.set(0, 1.1, 0);
  scene.add(fountain);
  colliders.push({ minX: -8, maxX: 8, minZ: -8, maxZ: 8 });
  for (let k = 0; k < 4; k++) {
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(5, 1, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x7a5a3a })
    );
    const a = (k * Math.PI) / 2;
    bench.position.set(Math.cos(a) * 15, 0.5, Math.sin(a) * 15);
    bench.rotation.y = -a;
    scene.add(bench);
  }

  // Street lamps at intersections.
  const lampGeo = new THREE.CylinderGeometry(0.18, 0.24, 7, 6);
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x222226 });
  const bulbGeo = new THREE.SphereGeometry(0.7, 8, 8);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (const lx of roadLines()) {
    for (const lz of roadLines()) {
      if (rng() < 0.45) continue;
      const pole = new THREE.Mesh(lampGeo, lampMat);
      pole.position.set(lx + 8, 3.5, lz + 8);
      scene.add(pole);
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(lx + 8, 7.2, lz + 8);
      scene.add(bulb);
      lamps.push({ x: lx + 8, z: lz + 8 });
    }
  }

  // Palms along the beach and a few blocks.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e7d4f });
  function palm(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 8, 6), trunkMat);
    trunk.position.set(x, 4, z);
    trunk.rotation.z = (rng() - 0.5) * 0.15;
    scene.add(trunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(3.4, 3.4, 7), leafMat);
    crown.position.set(x, 9.2, z);
    scene.add(crown);
    colliders.push({ minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6 });
  }
  for (let z = -200; z <= 200; z += 26) { palm(222, z); if (rng() < 0.4) palm(196, z + 10); }

  // Neon signs on a few towers near the centre.
  NEON.forEach((sign, idx) => {
    const tex = textTexture(sign.text, sign.color);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 4.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    const a = (idx / NEON.length) * Math.PI * 2;
    mesh.position.set(Math.cos(a) * 62, 16 + idx * 3, Math.sin(a) * 62);
    mesh.lookAt(0, mesh.position.y, 0);
    scene.add(mesh);
  });

  // The pier (mission 4 destination), east beach, jutting into the sea.
  const pierMat = new THREE.MeshLambertMaterial({ color: 0x7a5a34 });
  for (let x = 250; x <= 330; x += 8) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(8, 0.8, 10), pierMat);
    plank.position.set(x, 1.2, 120);
    scene.add(plank);
  }
  const shack = new THREE.Mesh(
    new THREE.BoxGeometry(9, 6, 8),
    new THREE.MeshLambertMaterial({ color: 0x8c4a3a })
  );
  shack.position.set(332, 4.2, 120);
  scene.add(shack);
  colliders.push({ minX: 327, maxX: 337, minZ: 115, maxZ: 125 });

  return { colliders, lamps, rng };
}

// --- Vehicles and people -------------------------------------------------

export const CAR_COLORS = [0xd83a3a, 0x3a7dd8, 0xe8c33a, 0x3ad87d, 0xe8e8e8, 0x222228, 0xd86ab0, 0x8a5ad8];
export const PED_SHIRTS = [0xe86a6a, 0x6aa8e8, 0xe8d86a, 0x6ae8a0, 0xe8e8e8, 0xd88a3a, 0xa06ae8];

export function makeCar(color, opts = {}) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x18242e });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 4.6), bodyMat);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.65, 2.3), glassMat);
  cabin.position.set(0, 1.28, -0.25);
  cabin.castShadow = true;
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141416 });
  g.userData.wheels = [];
  for (const [wx, wz] of [[-1.0, 1.5], [1.0, 1.5], [-1.0, -1.5], [1.0, -1.5]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.42, wz);
    g.add(w);
    g.userData.wheels.push(w);
  }
  // Headlights.
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const sx of [-0.65, 0.65]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), lightMat);
    l.position.set(sx, 0.7, 2.32);
    g.add(l);
  }
  if (opts.police) {
    const barMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.5), barMat);
    bar.position.set(0, 1.72, -0.25);
    g.add(bar);
    g.userData.lightBar = bar;
  }
  g.userData.halfW = 1.15;
  g.userData.halfL = 2.4;
  return g;
}

export function makePerson(shirt) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xd8a075 });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2a3242 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirtMat);
  torso.position.y = 1.12;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.38), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);
  const legs = [];
  for (const sx of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.72, 0.26), pantsMat);
    leg.position.set(sx, 0.36, 0);
    leg.geometry.translate(0, -0.36, 0);
    leg.position.y = 0.72;
    g.add(leg);
    legs.push(leg);
  }
  const arms = [];
  for (const sx of [-0.4, 0.4]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), shirtMat);
    arm.position.set(sx, 1.15, 0);
    arm.geometry.translate(0, -0.28, 0);
    arm.position.y = 1.44;
    g.add(arm);
    arms.push(arm);
  }
  g.userData.legs = legs;
  g.userData.arms = arms;
  return g;
}

// Push a circle (x,z,r) out of every building AABB it overlaps. Returns true if pushed.
export function collideCircle(colliders, p, r) {
  let hit = false;
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(p.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
    const dx = p.x - nx, dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        p.x = nx + (dx / d) * r;
        p.z = nz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pl = Math.min(p.x - c.minX, c.maxX - p.x);
        const pz = Math.min(p.z - c.minZ, c.maxZ - p.z);
        if (pl < pz) p.x = (p.x - c.minX < c.maxX - p.x) ? c.minX - r : c.maxX + r;
        else p.z = (p.z - c.minZ < c.maxZ - p.z) ? c.minZ - r : c.maxZ + r;
      }
    }
  }
  // World bounds: the sea stops you on the east, streets end elsewhere.
  p.x = Math.max(-208, Math.min(248, p.x));
  p.z = Math.max(-208, Math.min(208, p.z));
  return hit;
}
