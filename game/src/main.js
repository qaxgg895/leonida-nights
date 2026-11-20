// Leonida Nights — an original open-world crime game set in the fictional city
// of Vice Shores. The city is rendered by our own Canvas 2D renderer
// (render.js): a hand-written perspective projection with painter's-algorithm
// faces — no 3D library, no downloads, no network at runtime. Everything
// else — missions, traffic, police, wanted level, HUD, minimap, save,
// sound — is hand-written here and in city.js / audio.js.
// No Rockstar content, no network requests at runtime, no audio files.
import { Renderer, drawCity, drawCar, drawPerson, drawBeacon, drawHeadlight } from './render.js';
import { buildCity, roadLines, makeLoop, makeCar, makePerson, collideCircle,
  CAR_COLORS, PED_SHIRTS, PITCH } from './city.js';
import { SoundBank } from './audio.js';

const $ = (id) => document.getElementById(id);
const errBox = $('err');
function showError(msg) {
  console.error(msg);
  errBox.classList.remove('hidden');
  errBox.textContent = 'ERROR: ' + msg;
}
window.addEventListener('error', (e) => showError(String(e.message || e.error)));

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1', 10) || 1;
const SHOT = params.get('shot') || '';
const SAVE_KEY = 'leonida-nights.save.v1';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const rand = (a, b) => a + rng() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------------------------------------------------------------- state ---
const MISSIONS = [
  { tag: 'MISSION 1 · THE CALL', text: 'Meet Rico at the plaza fountain', target: { x: 0, z: 0 }, radius: 11, reward: 200 },
  { tag: 'MISSION 2 · THE GETAWAY', text: 'Steal the gold getaway car — watch the guards', target: { x: 87, z: -60 }, radius: 6, reward: 300 },
  { tag: 'MISSION 3 · LOSE THE COPS', text: 'Lose the cops — lay low, no more crimes', target: null, radius: 0, reward: 500 },
  { tag: 'MISSION 4 · THE DELIVERY', text: 'Deliver the package to the pier shack', target: { x: 328, z: 120 }, radius: 9, reward: 1000 },
];

const state = {
  started: false,
  paused: false,
  over: false,
  autoDrive: false,
  money: 0,
  health: 100,
  wanted: 0,
  mission: 0,
  done: false,
  clockMin: 17 * 60 + 40, // 17:40, golden hour
  inCar: null,            // the car object the player drives, or null
  speed: 0,               // car speed (signed) or foot speed
  camYaw: Math.PI * 0.75,
  camPitch: 0.42,
  dragYaw: 0,
  crimeTimer: 0,          // seconds since last crime
  decayTimer: 0,
  policeTimer: 0,
  bustedTimer: 0,
  saveTimer: 0,
  shotsFired: 0,
  carsStolen: 0,
  bannerUntil: 0,
};

const sound = new SoundBank();

// ---------------------------------------------------------------- renderer --
const canvas = $('game');
const renderer = new Renderer(canvas);
window.addEventListener('resize', () => renderer.resize());

const city = buildCity(SEED);
const colliders = city.colliders;
const LINES = roadLines();

// Camera position, smoothed toward its target every frame.
const camPos = { x: -60, y: 40, z: 80 };

// ---------------------------------------------------------------- player ----
const player = {
  shirt: 0x3a7dd8,
  pos: { x: -24, z: 30 },
  heading: Math.PI * 0.25,
  phase: 0,
  moving: false,
  visible: true,
};

// ---------------------------------------------------------------- cars ------
function spotClear(x, z, r) {
  for (const c of colliders) {
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return false;
  }
  return true;
}
function clearRoadSpot(x, z, r) {
  for (let d = 0; d <= 44; d += 4) {
    if (spotClear(x, z + d, r)) return { x, z: z + d };
    if (spotClear(x, z - d, r)) return { x, z: z - d };
  }
  return { x, z };
}
const parkedCars = [];
function addParkedCar(x, z, heading, color, getaway) {
  const spot = clearRoadSpot(x, z, 2.6);
  const car = makeCar(color, { police: false });
  car.pos = { x: spot.x, z: spot.z };
  car.heading = heading;
  car.speed = 0;
  car.parked = true;
  car.getaway = !!getaway;
  car.taken = false;
  parkedCars.push(car);
  return car;
}
const getawayCar = addParkedCar(87, -60, 0, 0xe8c33a, true);
addParkedCar(-29, 40, Math.PI / 2, 0xd83a3a);
addParkedCar(29, 101.5, 0, 0x3ad87d);
addParkedCar(-87, -101.5, Math.PI, 0xe8e8e8);
addParkedCar(-87, 14.5, -Math.PI / 2, 0x8a5ad8);
addParkedCar(145, -43.5, Math.PI, 0x3a7dd8);

// Traffic: cars looping the road grid.
const traffic = [];
for (let i = 0; i < 10; i++) {
  const loop = makeLoop(rng);
  const car = makeCar(CAR_COLORS[i % CAR_COLORS.length], { police: false });
  car.loop = loop;
  car.wp = 0;
  car.speed = rand(9, 13);
  car.pos = { x: loop[0].x, z: loop[0].z };
  car.heading = 0;
  car._v = car.speed;
  traffic.push(car);
}

// Police pool: spawned in as the wanted level rises.
const police = [];
for (let i = 0; i < 4; i++) {
  const car = makeCar(0x1a1a22, { police: true });
  car.pos = { x: 0, z: 0 };
  car.heading = 0;
  car.speed = 0;
  car.health = 4;
  car.hitCooldown = 0;
  car.active = false;
  police.push(car);
}

// ---------------------------------------------------------------- peds ------
const peds = [];
function addPed(x, z) {
  const ped = makePerson(PED_SHIRTS[Math.floor(rng() * PED_SHIRTS.length)]);
  ped.pos = { x, z };
  ped.heading = rand(0, Math.PI * 2);
  ped.speed = rand(1.2, 2.2);
  ped.state = 'walk';
  ped.timer = rand(2, 6);
  ped.down = 0;
  peds.push(ped);
  return ped;
}
for (let i = 0; i < 14; i++) {
  addPed(rand(-170, 170), rand(-170, 170));
}

// Rival guards around the getaway car (mission 2 combat).
const rivals = [];
for (let i = 0; i < 3; i++) {
  const r = makePerson(0xd83a3a);
  const a = (i / 3) * Math.PI * 2;
  const spot = clearRoadSpot(
    getawayCar.pos.x + Math.cos(a) * 7,
    getawayCar.pos.z + Math.sin(a) * 7, 1);
  r.pos = { x: spot.x, z: spot.z };
  r.heading = a;
  r.health = 3;
  r.alive = true;
  r.shootTimer = rand(1, 2);
  r.flash = 0;
  rivals.push(r);
}

// Cash pickups scattered around the city.
const pickups = [];
for (let i = 0; i < 6; i++) {
  pickups.push({
    pos: { x: rand(-180, 180), z: rand(-180, 180) },
    taken: false, spin: 0,
  });
}

// Tracers for gunfire (fading lines).
const tracers = [];
function addTracer(from, to) {
  tracers.push({ from, to, life: 0.12 });
}

// ------------------------------------------------------------------ input ---
const keys = new Set();
let dragging = false, lastX = 0, lastY = 0, moved = 0;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (e.code === 'KeyM') { sound.setMuted(!sound.muted); toast(sound.muted ? 'Sound muted' : 'Sound on'); return; }
  keys.add(e.code);
  if (e.code === 'KeyE') tryEnterCar();
  if (e.code === 'Space') e.preventDefault();
  sound.unlock();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
  sound.unlock();
});
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  moved += Math.abs(dx) + Math.abs(dy);
  lastX = e.clientX; lastY = e.clientY;
  state.camYaw -= dx * 0.005;
  state.camPitch = clamp(state.camPitch + dy * 0.003, 0.12, 1.1);
});
window.addEventListener('pointerup', () => {
  if (dragging && moved < 6 && state.started && !state.paused) attack();
  dragging = false;
});
window.addEventListener('blur', () => keys.clear());

// ------------------------------------------------------------------ HUD -----
const hud = $('hud'), moneyEl = $('money'), healthEl = $('healthfill'),
  wantedEl = $('wanted'), clockEl = $('clock'), speedEl = $('speed'),
  objTagEl = $('objtag'), objTextEl = $('objtext'), bannerEl = $('banner'),
  toastEl = $('toast');
const minimap = $('minimap').getContext('2d');
let toastUntil = 0;
function toast(msg, secs = 3) {
  toastEl.textContent = msg;
  toastUntil = performance.now() / 1000 + secs;
}
let bannerTimer = null;
function showBanner(main, sub, secs = 3.2) {
  bannerEl.innerHTML = main + (sub ? '<small>' + sub + '</small>' : '');
  bannerEl.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), secs * 1000);
}
function fmtClock() {
  const h = Math.floor(state.clockMin / 60) % 24;
  const m = Math.floor(state.clockMin % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function updateHUD() {
  moneyEl.textContent = '$' + state.money.toLocaleString('en-US');
  healthEl.style.width = Math.max(0, state.health) + '%';
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < state.wanted ? '★' : '<span class="off">★</span>';
  wantedEl.innerHTML = stars;
  clockEl.textContent = fmtClock();
  const mph = Math.round(Math.abs(state.speed) * 2.2);
  speedEl.textContent = state.inCar ? mph + ' mph · driving' : (state.moving ? 'on foot · running' : 'on foot');
  if (state.done) {
    objTagEl.textContent = 'FREE ROAM · VICE SHORES';
    objTextEl.textContent = 'All four jobs done. The city is yours — drive, explore, cause trouble.';
  } else {
    const m = MISSIONS[state.mission];
    objTagEl.textContent = m.tag;
    objTextEl.textContent = m.text + (m.reward ? '  ·  $' + m.reward : '');
  }
  if (performance.now() / 1000 > toastUntil) toastEl.textContent = '';
}

function drawMinimap() {
  const S = 180, C = S / 2;
  const scale = S / 560; // world -280..280 maps onto the canvas
  const px = (x) => C + x * scale;
  const pz = (z) => C + z * scale;
  minimap.fillStyle = '#10131f';
  minimap.fillRect(0, 0, S, S);
  // Sea + beach.
  minimap.fillStyle = '#14506e';
  minimap.fillRect(px(210), 0, S - px(210), S);
  minimap.fillStyle = '#c9a86a';
  minimap.fillRect(px(190), 0, px(210) - px(190), S);
  // Roads.
  minimap.strokeStyle = '#4a4a55';
  minimap.lineWidth = 4;
  for (const l of LINES) {
    minimap.beginPath(); minimap.moveTo(px(l), 0); minimap.lineTo(px(l), S); minimap.stroke();
    minimap.beginPath(); minimap.moveTo(0, pz(l)); minimap.lineTo(S, pz(l)); minimap.stroke();
  }
  // Mission marker.
  if (!state.done && MISSIONS[state.mission].target) {
    const t = MISSIONS[state.mission].target;
    minimap.fillStyle = '#ffd23d';
    minimap.beginPath(); minimap.arc(px(t.x), pz(t.z), 5, 0, Math.PI * 2); minimap.fill();
    minimap.strokeStyle = '#ffd23d'; minimap.lineWidth = 2;
    minimap.beginPath(); minimap.arc(px(t.x), pz(t.z), 9, 0, Math.PI * 2); minimap.stroke();
  }
  const dot = (x, z, color, r) => {
    minimap.fillStyle = color;
    minimap.beginPath(); minimap.arc(px(x), pz(z), r, 0, Math.PI * 2); minimap.fill();
  };
  for (const c of traffic) dot(c.pos.x, c.pos.z, '#dddddd', 2);
  for (const p of peds) if (!p.down) dot(p.pos.x, p.pos.z, '#8b93a3', 1.5);
  for (const p of police) if (p.active) dot(p.pos.x, p.pos.z, '#4f8dff', 3);
  if (getawayCar && !getawayCar.taken) dot(getawayCar.pos.x, getawayCar.pos.z, '#ffd23d', 3);
  // Player arrow.
  const pp = state.inCar ? state.inCar.pos : player.pos;
  const hd = state.inCar ? state.inCar.heading : player.heading;
  minimap.save();
  minimap.translate(px(pp.x), pz(pp.z));
  minimap.rotate(Math.atan2(Math.sin(hd), Math.cos(hd)) * -1 + Math.PI);
  minimap.fillStyle = '#ff5fa2';
  minimap.beginPath(); minimap.moveTo(0, -6); minimap.lineTo(4.5, 5); minimap.lineTo(-4.5, 5); minimap.closePath(); minimap.fill();
  minimap.restore();
}

// --------------------------------------------------------------- missions ---
function missionTarget() {
  return state.done ? null : MISSIONS[state.mission].target;
}
function completeMission() {
  const m = MISSIONS[state.mission];
  state.money += m.reward;
  sound.sting();
  showBanner('MISSION COMPLETE', '+$' + m.reward + '  ·  ' + m.tag);
  state.mission++;
  if (state.mission === 2) {
    // Mission 3 starts hot: the getaway theft put three stars on you.
    setTimeout(() => startMission3(), 1200);
  }
  if (state.mission >= MISSIONS.length) {
    state.done = true;
    showBanner('NIGHT COMPLETE', 'All four jobs done — Vice Shores is yours', 5);
  }
  saveGame();
}
function checkMission(dt) {
  if (state.done) return;
  const m = MISSIONS[state.mission];
  if (state.mission === 2) {
    // Lose the cops: complete once the wanted level hits zero.
    if (state.wanted === 0) completeMission();
    return;
  }
  if (!m.target) return;
  const p = state.inCar ? state.inCar.pos : player.pos;
  if (dist2d(p, m.target) < m.radius) {
    if (state.mission === 1 && !getawayCar.taken) return; // must be in the car
    completeMission();
  }
}
function startMission3() {
  addWanted(3);
  toast('The cops are onto you — lay low until the heat dies down.', 5);
}

// ------------------------------------------------------------ wanted/police --
function addWanted(n, reason) {
  if (state.wanted >= 5) return;
  state.wanted = Math.min(5, state.wanted + n);
  state.crimeTimer = 0;
  state.decayTimer = 0;
  if (reason) toast(reason, 2.5);
}
function spawnPolice() {
  const want = Math.min(state.wanted, 3);
  const active = police.filter((p) => p.active).length;
  for (let i = active; i < want; i++) {
    const p = police.find((q) => !q.active);
    if (!p) break;
    const pp = state.inCar ? state.inCar.pos : player.pos;
    const a = rand(0, Math.PI * 2);
    p.pos.x = clamp(pp.x + Math.cos(a) * 70, -200, 200);
    p.pos.z = clamp(pp.z + Math.sin(a) * 70, -200, 200);
    p.heading = a;
    p.speed = 0;
    p.health = 4;
    p.active = true;
  }
}
function updatePolice(dt) {
  const pp = state.inCar ? state.inCar.pos : player.pos;
  const want = state.wanted;
  for (const p of police) {
    if (!p.active) continue;
    if (want === 0) { p.active = false; continue; }
    if (p.hitCooldown > 0) p.hitCooldown -= dt;
    // Steer toward the player, faster than traffic, ramming speed.
    const desired = Math.atan2(pp.x - p.pos.x, pp.z - p.pos.z);
    p.heading += clamp(angleDiff(desired, p.heading), -2.4 * dt, 2.4 * dt);
    p.speed = lerp(p.speed, 30, dt * 0.8);
    p.pos.x += Math.sin(p.heading) * p.speed * dt;
    p.pos.z += Math.cos(p.heading) * p.speed * dt;
    collideCircle(colliders, p.pos, 2.2);
    // Ram: damage the player and shove their car.
    const d = dist2d(p.pos, pp);
    if (d < 3.6 && p.hitCooldown <= 0) {
      p.hitCooldown = 1.2;
      state.health -= state.inCar ? 8 : 20;
      sound.punch();
      if (state.inCar) {
        state.speed *= 0.55;
        state.inCar.pos.x += Math.sin(p.heading) * 2.5;
        state.inCar.pos.z += Math.cos(p.heading) * 2.5;
      }
      if (state.health <= 0) busted();
    }
  }
}

// ------------------------------------------------------------ combat --------
function nearestShootable(from, dirX, dirZ, maxDist) {
  // Returns {kind, obj, dist} for the closest ped / rival / police car inside a cone.
  let best = null;
  const consider = (x, z, kind, obj) => {
    const dx = x - from.x, dz = z - from.z;
    const d = Math.hypot(dx, dz);
    if (d > maxDist || d < 0.5) return;
    const dot = (dx * dirX + dz * dirZ) / d;
    if (dot < 0.86) return; // ~30-degree cone
    if (!best || d < best.dist) best = { kind, obj, dist: d };
  };
  for (const p of peds) if (!p.down) consider(p.pos.x, p.pos.z, 'ped', p);
  for (const r of rivals) if (r.alive) consider(r.pos.x, r.pos.z, 'rival', r);
  for (const p of police) if (p.active) consider(p.pos.x, p.pos.z, 'police', p);
  return best;
}
function attack() {
  const from = state.inCar ? state.inCar.pos : player.pos;
  const hd = state.inCar ? state.inCar.heading : player.heading;
  const dirX = Math.sin(hd), dirZ = Math.cos(hd);
  // Punch when someone is right in front of you on foot.
  if (!state.inCar) {
    const near = nearestShootable(from, dirX, dirZ, 2.4);
    if (near) {
      sound.punch();
      if (near.kind === 'ped') knockPed(near.obj);
      else if (near.kind === 'rival') hurtRival(near.obj, 1);
      addWanted(1, 'Assault — the cops noticed');
      return;
    }
  }
  // Otherwise shoot.
  sound.shot();
  state.shotsFired++;
  const end = { x: from.x + dirX * 34, y: 1.3, z: from.z + dirZ * 34 };
  const start = { x: from.x, y: 1.3, z: from.z };
  const hit = nearestShootable(from, dirX, dirZ, 34);
  if (hit) {
    end.x = hit.obj.pos.x; end.z = hit.obj.pos.z;
    if (hit.kind === 'ped') { knockPed(hit.obj); addWanted(1, 'Someone saw that'); }
    else if (hit.kind === 'rival') hurtRival(hit.obj, 1);
    else if (hit.kind === 'police') {
      hit.obj.health -= 1;
      if (hit.obj.health <= 0) {
        hit.obj.active = false;
        state.money += 100;
        toast('Cop car disabled — +$100', 2.5);
      }
      addWanted(1, 'You shot a cop car');
    }
  }
  addTracer(start, { x: end.x, y: 1.3, z: end.z });
}
function knockPed(ped) {
  ped.down = 4;
}
function hurtRival(r, dmg) {
  r.health -= dmg;
  r.flash = 0.25;
  r.shirt = 0xffffff;
  if (r.health <= 0) {
    r.alive = false;
    r.down = 999;
    state.money += 50;
    toast('Guard down — +$50', 2);
  }
}

// -------------------------------------------------------------- cars --------
function tryEnterCar() {
  if (!state.started || state.paused || state.over) return;
  if (state.inCar) {
    // Exit: step out beside the car.
    const car = state.inCar;
    state.inCar = null;
    car.speed = 0;
    player.pos.x = car.pos.x + Math.cos(car.heading) * 3;
    player.pos.z = car.pos.z - Math.sin(car.heading) * 3;
    player.heading = car.heading;
    player.visible = true;
    sound.blip(300, 0.08, 'sine', 0.08);
    return;
  }
  let best = null, bestD = 4.2;
  for (const c of parkedCars) {
    if (c.taken) continue;
    const d = dist2d(player.pos, c.pos);
    if (d < bestD) { best = c; bestD = d; }
  }
  if (!best) return;
  best.taken = true;
  best.parked = false;
  state.inCar = best;
  state.speed = 0;
  state.carsStolen++;
  player.visible = false;
  sound.pickup();
  if (best.getaway) {
    addWanted(1, 'You stole the getaway car!');
    toast('Getaway car stolen — get out of here!', 3);
  } else {
    addWanted(1, 'Grand theft auto — the cops noticed');
  }
  saveGame();
}

// ------------------------------------------------------------------ AI ------
function updateTraffic(dt) {
  for (const c of traffic) {
    const wp = c.loop[c.wp];
    const dx = wp.x - c.pos.x, dz = wp.z - c.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 4) { c.wp = (c.wp + 1) % c.loop.length; continue; }
    const desired = Math.atan2(dx, dz);
    c.heading += clamp(angleDiff(desired, c.heading), -1.8 * dt, 1.8 * dt);
    // Brake for the car ahead.
    let blocked = false;
    for (const o of traffic) {
      if (o === c) continue;
      const ox = o.pos.x - c.pos.x, oz = o.pos.z - c.pos.z;
      if (Math.hypot(ox, oz) < 9 && (ox * Math.sin(c.heading) + oz * Math.cos(c.heading)) > 0) { blocked = true; break; }
    }
    const target = blocked ? 0 : c.speed;
    c._v = lerp(c._v || c.speed, target, dt * 2);
    c.pos.x += Math.sin(c.heading) * c._v * dt;
    c.pos.z += Math.cos(c.heading) * c._v * dt;
  }
}
function updatePeds(dt) {
  for (const p of peds) {
    if (p.down) {
      p.down -= dt;
      if (p.down <= 0) p.down = 0;
      continue;
    }
    const pp = state.inCar ? state.inCar.pos : player.pos;
    const dPlayer = dist2d(p.pos, pp);
    // Flee from a speeding car or a recent gunshot nearby.
    if ((state.inCar && Math.abs(state.speed) > 6 && dPlayer < 9) || (state.shotsFired > 0 && dPlayer < 14 && p.state !== 'flee')) {
      p.state = 'flee';
      p.timer = 2.5;
    }
    if (p.state === 'flee') {
      p.timer -= dt;
      const away = Math.atan2(p.pos.x - pp.x, p.pos.z - pp.z);
      p.heading = away;
      p.pos.x += Math.sin(p.heading) * 5.5 * dt;
      p.pos.z += Math.cos(p.heading) * 5.5 * dt;
      if (p.timer <= 0) p.state = 'walk';
    } else {
      p.timer -= dt;
      if (p.timer <= 0) {
        p.heading = rand(0, Math.PI * 2);
        p.timer = rand(3, 8);
      }
      p.pos.x += Math.sin(p.heading) * p.speed * dt;
      p.pos.z += Math.cos(p.heading) * p.speed * dt;
    }
    // Hit by the player's car?
    if (state.inCar && Math.abs(state.speed) > 3 && dPlayer < 2.6) {
      knockPed(p);
      addWanted(1, 'You hit a pedestrian!');
      state.speed *= 0.7;
    }
    collideCircle(colliders, p.pos, 0.6);
    p.phase += dt * p.speed * 1.6;
  }
}
function updateRivals(dt) {
  const pp = state.inCar ? state.inCar.pos : player.pos;
  for (const r of rivals) {
    if (!r.alive) continue;
    if (r.flash > 0) {
      r.flash -= dt;
      if (r.flash <= 0) r.shirt = 0xd83a3a;
    }
    const d = dist2d(r.pos, pp);
    if (d < 26 && state.mission === 1) {
      r.heading = Math.atan2(pp.x - r.pos.x, pp.z - r.pos.z);
      r.shootTimer -= dt;
      if (r.shootTimer <= 0) {
        r.shootTimer = rand(1.4, 2.2);
        addTracer({ x: r.pos.x, y: 1.4, z: r.pos.z }, { x: pp.x, y: 1.2, z: pp.z });
        sound.shot();
        if (rng() < 0.45) {
          state.health -= 6;
          toast('You\'re being shot at!', 1.5);
          if (state.health <= 0) busted();
        }
      }
    }
  }
}
function updatePickups(dt) {
  const pp = state.inCar ? state.inCar.pos : player.pos;
  for (const p of pickups) {
    if (p.taken) continue;
    p.spin += dt;
    if (dist2d(p.pos, pp) < 2.4) {
      p.taken = true;
      state.money += 50;
      sound.pickup();
      toast('Found $50 on the street', 2);
    }
  }
}

// ------------------------------------------------------- player + driving ---
function updatePlayer(dt) {
  const fwd = keys.has('KeyW') || keys.has('ArrowUp');
  const back = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');

  if (state.inCar) {
    const car = state.inCar;
    // Autopilot for the screenshot scenes: random-walk the intersection
    // graph, so the car always stays on roads (never cuts through blocks).
    let throttle = 0, steer = 0;
    if (state.autoDrive) {
      if (!state._auto) {
        // Start from the nearest intersection in front of the car, so the
        // autopilot never has to U-turn out of its parking spot.
        const nx = LINES.reduce((a, b) => (Math.abs(b - car.pos.x) < Math.abs(a - car.pos.x) ? b : a));
        const nz = LINES.reduce((a, b) => (Math.abs(b - car.pos.z) < Math.abs(a - car.pos.z) ? b : a));
        const fwdX = Math.sin(car.heading), fwdZ = Math.cos(car.heading);
        let best = { x: nx, z: nz }, bestScore = Infinity;
        for (const l of LINES) {
          for (const [cx, cz] of [[nx, l], [l, nz]]) {
            const dx = cx - car.pos.x, dz = cz - car.pos.z;
            const d = Math.hypot(dx, dz);
            if (d < 3) continue;
            const ahead = dx * fwdX + dz * fwdZ;
            const score = ahead > 0 ? d : d + 1000;
            if (score < bestScore) { bestScore = score; best = { x: cx, z: cz }; }
          }
        }
        state._auto = { tx: best.x, tz: best.z, px: car.pos.x, pz: car.pos.z };
      }
      const a = state._auto;
      const dx = a.tx - car.pos.x, dz = a.tz - car.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 5) {
        // Pick a neighbouring intersection (not the one we came from, usually).
        const opts = [];
        for (const l of LINES) {
          if (l !== a.tx) opts.push({ x: l, z: a.tz });
          if (l !== a.tz) opts.push({ x: a.tx, z: l });
        }
        const away = opts.filter((o) => Math.hypot(o.x - a.px, o.z - a.pz) > 1);
        const pool = (away.length && rng() < 0.8) ? away : opts;
        const pick = pool[Math.floor(rng() * pool.length)];
        a.px = a.tx; a.pz = a.tz;
        a.tx = pick.x; a.tz = pick.z;
      }
      const desired = Math.atan2(a.tx - car.pos.x, a.tz - car.pos.z);
      steer = clamp(angleDiff(desired, car.heading) * 1.8, -1, 1);
      const targetSpeed = d < 18 ? 5 : 9;
      throttle = state.speed < targetSpeed ? 1 : 0;
      // Stuck against a wall? Back up briefly, then carry on.
      if (Math.abs(state.speed) < 1) state._stuck = (state._stuck || 0) + dt;
      else state._stuck = 0;
      if (state._stuck > 1.2) { state._stuck = 0; state._rev = 0.9; }
      if (state._rev > 0) {
        state._rev -= dt;
        throttle = -1;
        steer = -steer;
      }
    } else {
      throttle = (fwd ? 1 : 0) - (back ? 0.7 : 0);
      steer = (left ? 1 : 0) - (right ? 1 : 0);
    }
    const handbrake = keys.has('Space');
    const maxSpeed = 34;
    if (throttle > 0) state.speed += 15 * dt * throttle;
    else if (throttle < 0) state.speed -= (state.speed > 0 ? 24 : 10) * dt;
    else state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), 8 * dt);
    if (handbrake) state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), 30 * dt);
    state.speed = clamp(state.speed, -10, maxSpeed);
    const steerAmount = steer * (1.9 + (handbrake ? 0.9 : 0)) * clamp(Math.abs(state.speed) / 6, 0, 1);
    car.heading += steerAmount * dt * Math.sign(state.speed || 1);
    car.pos.x += Math.sin(car.heading) * state.speed * dt;
    car.pos.z += Math.cos(car.heading) * state.speed * dt;
    if (collideCircle(colliders, car.pos, 2.2)) {
      // Scraped a building: lose speed, spark of damage at high speed.
      if (Math.abs(state.speed) > 12) { state.health -= 2; }
      state.speed *= 0.45;
    }
    // Bump into traffic cars.
    for (const t of traffic) {
      if (dist2d(car.pos, t.pos) < 3.4) {
        const push = 3.4 - dist2d(car.pos, t.pos);
        const a = Math.atan2(car.pos.x - t.pos.x, car.pos.z - t.pos.z);
        car.pos.x += Math.sin(a) * push;
        car.pos.z += Math.cos(a) * push;
        state.speed *= 0.6;
      }
    }
    // Camera follows behind the car.
    state.camYaw = car.heading + Math.PI + state.dragYaw;
    sound.engine(Math.abs(state.speed) / 34, true);
    return;
  }

  // On foot: camera-relative WASD, character turns toward movement.
  const fX = Math.sin(state.camYaw), fZ = Math.cos(state.camYaw);
  const rX = Math.cos(state.camYaw), rZ = -Math.sin(state.camYaw);
  let mx = 0, mz = 0;
  if (fwd) { mx += fX; mz += fZ; }
  if (back) { mx -= fX; mz -= fZ; }
  if (right) { mx += rX; mz += rZ; }
  if (left) { mx -= rX; mz -= rZ; }
  const len = Math.hypot(mx, mz);
  state.moving = len > 0;
  if (state.moving) {
    const speed = run ? 9 : 5;
    mx /= len; mz /= len;
    player.pos.x += mx * speed * dt;
    player.pos.z += mz * speed * dt;
    player.heading = Math.atan2(mx, mz);
    player.phase += dt * speed * 1.6;
  }
  collideCircle(colliders, player.pos, 0.6);
  state.speed = state.moving ? (run ? 9 : 5) : 0;
  sound.engine(0, false);
}

// ---------------------------------------------------------------- camera ----
function updateCamera(dt) {
  const focus = state.inCar ? state.inCar.pos : player.pos;
  const focusHeading = state.inCar ? state.inCar.heading : player.heading;
  const yaw = state.camYaw;
  const dist = state.inCar ? 14 : 8.5;
  const height = 5.2 + Math.sin(state.camPitch) * dist * 0.6;
  const back = dist * Math.cos(state.camPitch);
  const cx = focus.x - Math.sin(yaw) * back;
  const cz = focus.z - Math.cos(yaw) * back;
  camPos.x = lerp(camPos.x, cx, 1 - Math.pow(0.001, dt));
  camPos.y = lerp(camPos.y, height, 1 - Math.pow(0.001, dt));
  camPos.z = lerp(camPos.z, cz, 1 - Math.pow(0.001, dt));
  renderer.setCamera(camPos.x, camPos.y, camPos.z, yaw, state.camPitch);
}

// ------------------------------------------------------------ time of day ---
function nightFactor() {
  // 0 in daylight (before 18:30), 1 after 20:30.
  const t = state.clockMin;
  if (t < 18 * 60 + 30) return 0;
  if (t > 20 * 60 + 30) return 1;
  return (t - (18 * 60 + 30)) / 120;
}

// ------------------------------------------------------------ rendering -----
function renderScene() {
  const night = nightFactor();
  renderer.begin(night);
  drawCity(renderer, city, night);
  // Parked cars, traffic, police. (A stolen car stays in the world even
  // after the player steps out of it.)
  for (const c of parkedCars) {
    if (c === state.inCar) continue; // drawn below, with headlights
    drawCar(renderer, { x: c.pos.x, z: c.pos.z, heading: c.heading, color: c.color, police: false });
  }
  for (const c of traffic) drawCar(renderer, { x: c.pos.x, z: c.pos.z, heading: c.heading, color: c.color, police: false });
  for (const p of police) {
    if (!p.active) continue;
    drawCar(renderer, { x: p.pos.x, z: p.pos.z, heading: p.heading, color: p.color, police: true });
  }
  if (state.inCar) {
    const c = state.inCar;
    drawCar(renderer, { x: c.pos.x, z: c.pos.z, heading: c.heading, color: c.color, police: false });
    drawHeadlight(renderer, { x: c.pos.x, z: c.pos.z, heading: c.heading }, night);
  }
  // People: the player, pedestrians, rival guards.
  if (player.visible) {
    drawPerson(renderer, {
      x: player.pos.x, z: player.pos.z, heading: player.heading,
      shirt: player.shirt, phase: player.phase, down: false,
    });
  }
  for (const p of peds) {
    drawPerson(renderer, {
      x: p.pos.x, z: p.pos.z, heading: p.heading,
      shirt: p.shirt, phase: p.phase, down: !!p.down,
    });
  }
  for (const r of rivals) {
    drawPerson(renderer, {
      x: r.pos.x, z: r.pos.z, heading: r.heading,
      shirt: r.shirt, phase: 0, down: !r.alive,
    });
  }
  // Cash pickups: spinning green bricks.
  for (const p of pickups) {
    if (p.taken) continue;
    const y = 0.8 + Math.sin(p.spin * 2) * 0.15;
    renderer.box(p.pos.x, y - 0.35, p.pos.z, 1.1, 0.7, 0.35, p.spin, { top: 0x2fd35a, side: 0x2fd35a }, renderer.sunDir);
  }
  // Mission beacon + diamond.
  const t = missionTarget();
  if (t && !state.done) drawBeacon(renderer, t.x, t.z, performance.now());
  // Gunfire tracers.
  for (const tr of tracers) {
    const a = Math.max(0, tr.life / 0.12);
    renderer.line3(tr.from, tr.to, `rgba(255,233,168,${a.toFixed(2)})`, 0.18);
  }
  renderer.end();
}

// --------------------------------------------------------------- save -------
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: state.money, mission: state.mission, done: state.done,
      health: state.health, clockMin: state.clockMin,
      x: player.pos.x, z: player.pos.z,
      carsStolen: state.carsStolen, shotsFired: state.shotsFired,
    }));
  } catch (e) { /* private mode: saving is best-effort */ }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

// ------------------------------------------------------------ game flow -----
function busted() {
  if (state.over) return;
  state.over = true;
  sound.busted();
  sound.engine(0, false);
  const lost = Math.min(state.money, 200);
  state.money -= lost;
  state.wanted = 0;
  for (const p of police) p.active = false;
  if (state.inCar) { state.inCar.speed = 0; state.inCar = null; player.visible = true; }
  player.pos.x = -24; player.pos.z = 30; // hospital plaza
  state.health = 100;
  state.speed = 0;
  $('bustedText').textContent = 'The night got the better of you. You wake up at the plaza, $' + lost + ' lighter, pride intact.';
  $('busted').classList.remove('hidden');
  saveGame();
}
function togglePause() {
  if (!state.started || state.over) return;
  state.paused = !state.paused;
  $('pause').classList.toggle('hidden', !state.paused);
}
function startGame(fromSave) {
  sound.unlock();
  const save = fromSave ? loadSave() : null;
  if (save) {
    state.money = save.money || 0;
    state.mission = Math.min(save.mission || 0, MISSIONS.length);
    state.done = !!save.done || state.mission >= MISSIONS.length;
    state.health = save.health || 100;
    state.clockMin = save.clockMin || state.clockMin;
    player.pos.x = save.x ?? -24;
    player.pos.z = save.z ?? 30;
    state.carsStolen = save.carsStolen || 0;
    state.shotsFired = save.shotsFired || 0;
    // Resuming mid-chase: the cops are still on you.
    if (state.mission === 2) state.wanted = 3;
  }
  state._orbit = false;
  state.started = true;
  $('start').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('busted').classList.add('hidden');
  hud.classList.remove('hidden');
  updateHUD();
  if (!save) toast('Meet Rico at the plaza fountain — follow the gold beacon.', 5);
  else toast('Welcome back — the night continues.', 3);
}
$('playBtn').addEventListener('click', () => startGame(true));
$('resumeBtn').addEventListener('click', togglePause);
$('retryBtn').addEventListener('click', () => {
  state.over = false;
  $('busted').classList.add('hidden');
});
(function showSaveNote() {
  const s = loadSave();
  if (s) $('saveNote').textContent = 'Save found: $' + (s.money || 0) + ' · mission ' + Math.min((s.mission || 0) + 1, 4) + ' of 4 — starting resumes it.';
})();

// --------------------------------------------------------- screenshot shots -
function stageShot(name) {
  if (name === 'start') {
    // Title screen over a slow orbit of the city at golden hour.
    $('start').style.background = 'linear-gradient(160deg, rgba(20,8,40,0.55), rgba(8,10,26,0.72))';
    state._orbit = true;
    return;
  }
  // Every other shot plays the real game.
  startGame(false);
  if (name === 'night') {
    state.clockMin = 22 * 60;
    enterCarForShot(getawayCar);
    state.autoDrive = true;
    fastForward(5);
    return;
  }
  if (name === 'end') {
    // Mission complete: final banner, three wanted stars, cop cars closing in.
    state.money = 2000;
    state.mission = 3;
    state.clockMin = 18 * 60 + 50;
    enterCarForShot(getawayCar);
    completeMission(); // completes mission 4 -> NIGHT COMPLETE banner
    showBanner('NIGHT COMPLETE', 'All four jobs done — Vice Shores is yours', 30);
    state.wanted = 3;
    spawnPolice();
    // Park the police close by for the frame, but not on top of the player.
    const pp = state.inCar.pos;
    police.forEach((p, i) => {
      if (!p.active) return;
      const a = (i / 3) * Math.PI * 2 + 0.6;
      p.pos.x = pp.x + Math.cos(a) * 22;
      p.pos.z = pp.z + Math.sin(a) * 22;
    });
    updateCamera(1 / 60);
    return;
  }
  // play (default): driving the getaway car through traffic at golden hour.
  enterCarForShot(getawayCar);
  state.autoDrive = true;
  state.money = 350;
  fastForward(6);
}
function enterCarForShot(car) {
  car.taken = true;
  car.parked = false;
  state.inCar = car;
  state.speed = 0;
  player.visible = false;
  // Put the car on a road heading north through downtown.
  car.pos.x = 29; car.pos.z = -60;
  car.heading = 0;
  state.camYaw = Math.PI;
}
function fastForward(seconds) {
  // Step the simulation with fixed 1/60 steps so the shot frame is what a
  // short real play session looks like (same seed -> same frame).
  const steps = Math.floor(seconds * 60);
  for (let i = 0; i < steps; i++) update(1 / 60, true);
  updateCamera(1 / 60);
  updateHUD();
  drawMinimap();
}

// ------------------------------------------------------------------ loop ----
let lastT = performance.now();
let hudTimer = 0;
function update(dt, silent) {
  // Clock: one game minute every two real seconds.
  state.clockMin = (state.clockMin + dt / 2) % (24 * 60);
  // Wanted decay: no crimes for a while -> heat dies down.
  state.crimeTimer += dt;
  const decayAfter = state.mission === 2 ? 9 : 20;
  if (state.wanted > 0 && state.crimeTimer > decayAfter) {
    state.decayTimer += dt;
    if (state.decayTimer > 4) {
      state.wanted--;
      state.decayTimer = 0;
      state.crimeTimer = 0;
      if (state.wanted === 0) toast('You lost them — the heat is off.', 3);
    }
  }
  state.policeTimer += dt;
  if (state.policeTimer > 1.5) {
    state.policeTimer = 0;
    spawnPolice();
  }
  updatePlayer(dt);
  updateTraffic(dt);
  updatePeds(dt);
  updateRivals(dt);
  updatePolice(dt);
  updatePickups(dt);
  checkMission(dt);
  // Health slowly recovers when nobody is after you.
  if (state.wanted === 0 && state.health < 100) state.health = Math.min(100, state.health + 1.5 * dt);
  // Tracers fade.
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) tracers.splice(i, 1);
  }
  // Autosave.
  state.saveTimer += dt;
  if (state.saveTimer > 10) { state.saveTimer = 0; if (state.started) saveGame(); }
  sound.siren(dt, state.wanted);
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - lastT) / 1000, 0.001, 0.05);
  lastT = now;
  if (state._orbit) {
    // Slow cinematic orbit for the title screen.
    const a = now / 14000;
    const ox = Math.cos(a) * 150, oz = Math.sin(a) * 150;
    const yaw = Math.atan2(0 - ox, 0 - oz);
    const pitch = Math.atan2(70 - 10, 150);
    renderer.setCamera(ox, 70, oz, yaw, pitch);
    state.clockMin = (state.clockMin + dt / 4) % (24 * 60);
  } else if (state.started && !state.paused && !state.over) {
    update(dt, false);
    updateCamera(dt);
  }
  hudTimer += dt;
  if (hudTimer > 0.15 && state.started) {
    hudTimer = 0;
    updateHUD();
    drawMinimap();
  }
  renderScene();
}

// ------------------------------------------------------------------ boot ----
try {
  if (SHOT) stageShot(SHOT);
  else {
    // Idle title backdrop: orbit the city behind the start screen.
    state._orbit = true;
  }
  requestAnimationFrame(frame);
} catch (e) {
  showError('Boot failed: ' + (e && e.stack || e));
}

// Test hooks for the headless play-test (not part of the game UI).
window.LN = {
  get ready() { return !!renderer; },
  state: () => ({
    started: state.started, paused: state.paused, over: state.over,
    money: state.money, health: Math.round(state.health), wanted: state.wanted,
    mission: state.mission, done: state.done, inCar: !!state.inCar,
    speed: Math.round(state.speed * 10) / 10,
    x: Math.round((state.inCar ? state.inCar.pos.x : player.pos.x) * 10) / 10,
    z: Math.round((state.inCar ? state.inCar.pos.z : player.pos.z) * 10) / 10,
    clock: fmtClock(),
    traffic: traffic.length, peds: peds.length,
    police: police.filter((p) => p.active).length,
    shotsFired: state.shotsFired, carsStolen: state.carsStolen,
  }),
  start: () => startGame(true),
  warp: (x, z) => { player.pos.x = x; player.pos.z = z; },
  press: (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); },
  release: (code) => { window.dispatchEvent(new KeyboardEvent('keyup', { code })); },
  click: () => attack(),
  completeMission: () => completeMission(),
  step: (n) => { for (let i = 0; i < (n || 60); i++) update(1 / 60, true); updateCamera(1 / 60); },
  heading: () => (state.inCar ? state.inCar.heading : player.heading),
  debug: () => {
    const p = state.inCar ? state.inCar.pos : player.pos;
    return {
      car: { x: p.x, z: p.z },
      nearColliders: colliders.filter((c) => p.x > c.minX - 6 && p.x < c.maxX + 6 && p.z > c.minZ - 6 && p.z < c.maxZ + 6),
      nearTraffic: traffic.filter((t) => dist2d(p, t.pos) < 16).map((t) => ({ x: Math.round(t.pos.x * 10) / 10, z: Math.round(t.pos.z * 10) / 10, v: Math.round((t._v || 0) * 10) / 10 })),
      nearPeds: peds.filter((q) => dist2d(p, q.pos) < 6).length,
      auto: state._auto,
    };
  },
};
console.log('Leonida Nights ready. seed=' + SEED + ' shot=' + (SHOT || 'none'));
