// Leonida Nights — the city of Vice Shores, as data.
//
// buildCity() procedurally lays out the same city the game plays in and
// returns plain data: building boxes, ground quads (sidewalks, lane dashes,
// crosswalks, beach, sea), lamps, palms, neon signs, the pier, and the
// building colliders the physics uses. Nothing here draws anything —
// render.js turns this data into pictures. Cars and people are plain
// objects too ({x, z, heading, ...}); the renderer draws them.
//
// All geometry is original and generated from a seed, so the city is the
// same every run. No external art, no network.

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

// A flat quad on the ground: [p1, p2, p3, p4, colour]. y is kept just
// above 0 so tiles never z-fight with each other.
function groundQuad(x1, z1, x2, z2, colour, y) {
  const yy = y === undefined ? 0.01 : y;
  return [
    { x: x1, y: yy, z: z1 }, { x: x2, y: yy, z: z1 },
    { x: x2, y: yy, z: z2 }, { x: x1, y: yy, z: z2 }, colour,
  ];
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

export function buildCity(seed) {
  const rng = mulberry32(seed);
  const colliders = [];
  const buildings = [];
  const benches = [];
  const lamps = [];
  const palms = [];
  const pierPlanks = [];
  const groundQuads = [];

  // Whole-ground asphalt base, then sidewalk blocks on top of it.
  groundQuads.push(groundQuad(-WORLD / 2, -WORLD / 2, WORLD / 2, WORLD / 2, 0x464650, 0.0));
  for (let i = -GRID; i <= GRID; i++) {
    for (let j = -GRID; j <= GRID; j++) {
      const x1 = i * PITCH - BLOCK / 2, z1 = j * PITCH - BLOCK / 2;
      const x2 = x1 + BLOCK, z2 = z1 + BLOCK;
      const col = (i + j) % 2 === 0 ? 0x5b5b66 : 0x51515c;
      groundQuads.push(groundQuad(x1, z1, x2, z2, col, 0.02));
      // A slightly darker inner slab so each block reads as a slab.
      groundQuads.push(groundQuad(x1 + 2, z1 + 2, x2 - 2, z2 - 2, 0x62626d, 0.03));
    }
  }
  // Lane dashes along every road centreline.
  for (let k = -GRID - 1; k <= GRID; k++) {
    const line = (k + 0.5) * PITCH;
    for (let d = -WORLD / 2 + 8; d < WORLD / 2 - 8; d += 16) {
      groundQuads.push(groundQuad(line - 1, d, line + 1, d + 8, 0xd8b45a, 0.04));
      groundQuads.push(groundQuad(d, line - 1, d + 8, line + 1, 0xd8b45a, 0.04));
    }
  }
  // Crosswalk stripes at intersections (five stripes each, both ways).
  for (let i = -GRID - 1; i <= GRID; i++) {
    for (let j = -GRID - 1; j <= GRID; j++) {
      const cx = (i + 0.5) * PITCH, cz = (j + 0.5) * PITCH;
      for (let s = -2; s <= 2; s++) {
        groundQuads.push(groundQuad(cx - 12 + s * 5, cz - 8, cx - 10 + s * 5, cz + 8, 0xebebeb, 0.05));
        groundQuads.push(groundQuad(cx - 8, cz - 12 + s * 5, cx + 8, cz - 10 + s * 5, 0xebebeb, 0.05));
      }
    }
  }
  // Beach (east) and sea.
  groundQuads.push(groundQuad(210, -230, 320, 230, 0xc9a86a, 0.02));
  groundQuads.push(groundQuad(320, -230, 540, 230, 0x14506e, 0.03));

  // Buildings, with a plaza at the centre block (0,0) instead of towers.
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
        buildings.push({
          x, z, w, d, h,
          color: BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)],
          seed: Math.floor(rng() * 1e9),
          roof: rng() < 0.5,
        });
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
      }
    }
  }

  // Central plaza: fountain collider + benches.
  colliders.push({ minX: -8, maxX: 8, minZ: -8, maxZ: 8 });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    benches.push({ x: Math.cos(a) * 15, z: Math.sin(a) * 15, heading: -a });
  }

  // Street lamps at intersections.
  for (const lx of roadLines()) {
    for (const lz of roadLines()) {
      if (rng() < 0.45) continue;
      lamps.push({ x: lx + 8, z: lz + 8 });
    }
  }

  // Palms along the beach.
  for (let z = -200; z <= 200; z += 26) {
    palms.push({ x: 222, z });
    colliders.push({ minX: 221.4, maxX: 222.6, minZ: z - 0.6, maxZ: z + 0.6 });
    if (rng() < 0.4) {
      palms.push({ x: 196, z: z + 10 });
      colliders.push({ minX: 195.4, maxX: 196.6, minZ: z + 9.4, maxZ: z + 10.6 });
    }
  }

  // Neon signs on towers near the centre.
  const neon = NEON.map((sign, idx) => {
    const a = (idx / NEON.length) * Math.PI * 2;
    return {
      text: sign.text, color: sign.color,
      x: Math.cos(a) * 62, y: 16 + idx * 3, z: Math.sin(a) * 62,
    };
  });

  // The pier (mission 4 destination), east beach, jutting into the sea.
  for (let x = 250; x <= 330; x += 8) pierPlanks.push({ x, z: 120 });
  colliders.push({ minX: 327, maxX: 337, minZ: 115, maxZ: 125 });

  return { colliders, buildings, benches, lamps, palms, neon, pierPlanks, groundQuads, rng };
}

// --- Vehicles and people (plain data; render.js draws them) ---------------

export const CAR_COLORS = [0xd83a3a, 0x3a7dd8, 0xe8c33a, 0x3ad87d, 0xe8e8e8, 0x222228, 0xd86ab0, 0x8a5ad8];
export const PED_SHIRTS = [0xe86a6a, 0x6aa8e8, 0xe8d86a, 0x6ae8a0, 0xe8e8e8, 0xd88a3a, 0xa06ae8];

export function makeCar(color, opts = {}) {
  return { color, police: !!opts.police, x: 0, z: 0, heading: 0 };
}

export function makePerson(shirt) {
  return { shirt, x: 0, z: 0, heading: 0, phase: 0, down: false };
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
