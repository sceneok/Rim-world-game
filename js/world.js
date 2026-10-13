'use strict';
// ===== 전역 게임 상태 =====
let G = null;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(Date.now() & 0xffffffff);
const rand = () => rng();
const randi = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = arr => arr[Math.floor(rand() * arr.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

const idx = (x, y) => y * MAP_W + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
const cellAt = (x, y) => inb(x, y) ? G.cells[idx(x, y)] : null;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ===== 노이즈 =====
function makeNoise(seed) {
  const r = mulberry32(seed);
  const SZ = 256, perm = new Float32Array(SZ * SZ);
  for (let i = 0; i < perm.length; i++) perm[i] = r();
  const v = (x, y) => perm[((y & 255) * SZ) + (x & 255)];
  const sm = t => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    const u = sm(xf), w = sm(yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return (x, y) => {
    let s = 0, amp = 1, f = 1, tot = 0;
    for (let o = 0; o < 4; o++) { s += noise(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return s / tot;
  };
}

function newCell() {
  return { t: T.GRASS, res: null, st: null, item: null, zone: 0, des: null, crop: null, room: 0, fert: 1 };
}

// ===== 맵 생성 =====
function generateMap(seed) {
  const elev = makeNoise(seed), moist = makeNoise(seed + 99), detail = makeNoise(seed + 7);
  const cells = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const c = newCell();
    let e = elev(x / 22, y / 22);
    const m = moist(x / 16, y / 16);
    // 가장자리에 산이 많도록
    const ex = Math.min(x, MAP_W - 1 - x) / MAP_W, ey = Math.min(y, MAP_H - 1 - y) / MAP_H;
    e += (0.12 - Math.min(ex, ey)) * 0.6;
    if (e > 0.64) {
      c.t = T.STONE;
      c.res = { type: (detail(x / 4, y / 4) > 0.68 && rand() < 0.6) ? 'ore' : 'rock', work: 0 };
    } else if (e < 0.25) {
      c.t = T.WATER;
    } else if (e < 0.29) {
      c.t = T.SAND;
    } else {
      c.t = m > 0.62 ? T.MARSH : (m < 0.38 ? T.DIRT : T.GRASS);
      const r = rand();
      const treeP = m > 0.5 ? 0.16 : 0.05;
      if (r < treeP) c.res = { type: rand() < 0.5 ? 'tree' : 'pine', work: 0 };
      else if (r < treeP + 0.014) c.res = { type: 'bush', work: 0, grown: true };
      else if (r < treeP + 0.022) c.res = { type: 'herb', work: 0, grown: true };
    }
    c.fert = TERRAIN[c.t].fertile;
    cells.push(c);
  }
  return cells;
}

function findStart() {
  // 중앙 근처에서 통행 가능한 넓은 지역 탐색
  let best = null, bestScore = -1;
  for (let i = 0; i < 300; i++) {
    const x = randi(20, MAP_W - 21), y = randi(16, MAP_H - 17);
    let score = 0;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const c = G.cells[idx(x + dx, y + dy)];
      if (c.t !== T.WATER && !(c.res && RES[c.res.type].blocks)) score++;
    }
    score -= dist(x, y, MAP_W / 2, MAP_H / 2) * 0.5;
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  // 시작 지점 정리
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const c = cellAt(best.x + dx, best.y + dy);
    if (!c) continue;
    if (c.t === T.WATER || c.t === T.STONE || c.t === T.MARSH) { c.t = T.GRASS; c.fert = 1; }
    if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) c.res = null;
    else if (c.res && RES[c.res.type].blocks) c.res = null;
  }
  return best;
}

// ===== 통행 판정 =====
function blocksMove(c, forEnemy) {
  if (!TERRAIN[c.t].pass) return true;
  if (c.res && RES[c.res.type].blocks) return true;
  if (c.st && c.st.built) {
    const d = BUILD[c.st.type];
    if (d.blocks) return true;
    if (d.door && forEnemy) return true;
  }
  return false;
}
function isWallish(c) { // 방 경계
  if (c.res && RES[c.res.type].blocks) return true;
  if (c.st && c.st.built) { const d = BUILD[c.st.type]; return !!(d.wall || d.door); }
  return false;
}
function blocksSight(c) {
  if (c.res && RES[c.res.type].blocks) return true;
  if (c.st && c.st.built) { const d = BUILD[c.st.type]; return !!(d.wall || (d.door)); }
  return false;
}
function lineOfSight(x0, y0, x1, y1) {
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
  while (true) {
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    if (x0 === x1 && y0 === y1) return true;
    if (blocksSight(G.cells[idx(x0, y0)])) return false;
  }
}

// ===== 방 / 온도 =====
function recomputeRooms() {
  const old = G.rooms || [];
  const oldIds = G.cells.map(c => c.room);
  const rooms = [{ id: 0, outdoor: true, temp: outdoorTemp(), cells: [] }];
  for (const c of G.cells) c.room = -1;
  const stack = [];
  for (let i = 0; i < G.cells.length; i++) {
    const c0 = G.cells[i];
    if (c0.room !== -1 || isWallish(c0)) continue;
    const id = rooms.length, list = [];
    let edge = false;
    stack.push(i); c0.room = id;
    while (stack.length) {
      const j = stack.pop(); list.push(j);
      const x = j % MAP_W, y = (j / MAP_W) | 0;
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) edge = true;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of nb) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const k = idx(nx, ny), c = G.cells[k];
        if (c.room !== -1 || isWallish(c)) continue;
        c.room = id; stack.push(k);
      }
    }
    if (edge || list.length > MAX_ROOM) {
      for (const j of list) G.cells[j].room = 0;
      rooms[0].cells.push(...list);
      rooms.push(null); // 자리 유지
    } else {
      // 이전 온도 계승
      let temp = null;
      for (const j of list) { const o = old[oldIds[j]]; if (o && !o.outdoor) { temp = o.temp; break; } }
      if (temp === null) temp = outdoorTemp();
      rooms.push({ id, outdoor: false, temp, cells: list });
    }
  }
  // 벽 칸은 인접한 방 소속으로 표시하지 않음 (-1 → 0)
  for (const c of G.cells) if (c.room === -1) c.room = 0;
  G.rooms = rooms;
  G.roomsDirty = false;
}

function seasonIndex(min) { return Math.floor(min / DAY_MIN / SEASON_DAYS) % 4; }
function outdoorTemp() {
  const day = G.time / DAY_MIN;
  const sp = day / SEASON_DAYS;
  const si = Math.floor(sp) % 4, f = sp - Math.floor(sp);
  const a = SEASONS[si].temp, b = SEASONS[(si + 1) % 4].temp;
  // 계절 후반부에 다음 계절로 보간
  const base = f < 0.6 ? a : a + (b - a) * ((f - 0.6) / 0.4);
  const hour = (G.time % DAY_MIN) / 60;
  const daily = -Math.cos((hour - 3) / 24 * Math.PI * 2) * 6;
  return base + daily + (G.weather ? G.weather.offset : 0);
}

function updateTemperatures(dtMin) {
  const out = outdoorTemp();
  G.rooms[0].temp = out;
  for (const r of G.rooms) {
    if (!r || r.outdoor) continue;
    r.heat = 0;
  }
  for (const s of G.structures) {
    if (!s.built) continue;
    const d = BUILD[s.type];
    const r = G.rooms[G.cells[idx(s.x, s.y)].room];
    if (!r || r.outdoor) continue;
    if (d.heater && r.temp < 22) r.temp += Math.min(22 - r.temp, 30 / r.cells.length * dtMin);
    if (d.cooler && r.temp > 18) r.temp -= Math.min(r.temp - 18, 30 / r.cells.length * dtMin);
    if (d.heat && r.temp < 30) r.temp += Math.min(30 - r.temp, 9 / r.cells.length * dtMin);
  }
  for (const r of G.rooms) {
    if (!r || r.outdoor) continue;
    r.temp += (out - r.temp) * Math.min(1, 0.006 * dtMin);
  }
}

function tempAt(x, y) {
  const c = cellAt(Math.floor(x), Math.floor(y));
  if (!c) return outdoorTemp();
  const r = G.rooms[c.room];
  if (r && !r.outdoor) return r.temp;
  let t = G.rooms[0].temp;
  // 실외 모닥불 근처는 따뜻함
  for (const s of G.fires) {
    const d = dist(s.x + 0.5, s.y + 0.5, x, y);
    if (d < 4.5) t += BUILD[s.type].heat * 1.6 * (1 - d / 4.5);
  }
  return t;
}
function isIndoor(x, y) { const c = cellAt(Math.floor(x), Math.floor(y)); return c && G.rooms[c.room] && !G.rooms[c.room].outdoor; }

// ===== 아이템 / 비축 =====
function canHoldItem(c, type) {
  if (!c || !TERRAIN[c.t].pass) return false;
  if (c.res && RES[c.res.type].blocks) return false;
  if (c.st && (c.st.built || c.st.type)) {
    const d = BUILD[c.st.type];
    if (c.st.built && (d.blocks || d.door || d.bed || d.station || d.table || d.heater || d.cooler)) return false;
  }
  if (!c.item) return true;
  return c.item.type === type && c.item.n < ITEMS[type].stack;
}
function dropItem(x, y, type, n) {
  // 나선형으로 빈 칸을 찾아 내려놓음
  for (let r = 0; r < 8 && n > 0; r++) {
    for (let dy = -r; dy <= r && n > 0; dy++) for (let dx = -r; dx <= r && n > 0; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const c = cellAt(x + dx, y + dy);
      if (!canHoldItem(c, type)) continue;
      if (!c.item) c.item = { type, n: 0 };
      const add = Math.min(n, ITEMS[type].stack - c.item.n);
      c.item.n += add; n -= add;
    }
  }
  G.stockDirty = true;
  return n;
}

function recountStock() {
  const s = {};
  for (const k in ITEMS) s[k] = 0;
  for (const i of G.stockCells) {
    const c = G.cells[i];
    if (c.item) s[c.item.type] += c.item.n;
  }
  s.raw = RAW_FOODS.reduce((a, k) => a + s[k], 0);
  G.stock = s;
  G.stockDirty = false;
}
function stockOf(type) { if (G.stockDirty) recountStock(); return G.stock[type] || 0; }
function canAfford(cost) {
  for (const k in cost) if (stockOf(k) < cost[k]) return false;
  return true;
}
function takeStock(type, n) {
  const types = type === 'raw' ? RAW_FOODS : [type];
  for (const i of G.stockCells) {
    if (n <= 0) break;
    const c = G.cells[i];
    if (c.item && types.includes(c.item.type)) {
      const t = Math.min(n, c.item.n);
      c.item.n -= t; n -= t;
      if (c.item.n <= 0) c.item = null;
    }
  }
  G.stockDirty = true;
  return n <= 0;
}
function payCost(cost) {
  if (!canAfford(cost)) return false;
  for (const k in cost) takeStock(k, cost[k]);
  return true;
}
function refund(cost, x, y, frac) {
  for (const k in cost) { const n = Math.floor(cost[k] * frac); if (n > 0) dropItem(x, y, k, n); }
}
function rebuildStockCells() {
  G.stockCells = [];
  G.cells.forEach((c, i) => { if (c.zone === 1) G.stockCells.push(i); });
  G.stockDirty = true;
}

// ===== 구조물 =====
function placeBlueprint(x, y, type) {
  const c = cellAt(x, y);
  if (!c || c.st || !TERRAIN[c.t].pass || c.t === T.WATER) return false;
  if (c.res && RES[c.res.type].blocks) return false;
  const s = { id: G.nextId++, type, x, y, built: false, paid: false, work: 0, hp: BUILD[type].hp, bills: [], cd: 0 };
  c.st = s;
  G.structures.push(s);
  // 나무가 있으면 벌목 지정
  if (c.res) c.des = 'chop'; // 식물 제거 후 건설
  return true;
}
function removeStructure(s, refundFrac) {
  const c = G.cells[idx(s.x, s.y)];
  if (c.st === s) c.st = null;
  G.structures = G.structures.filter(o => o !== s);
  if (refundFrac > 0) refund(BUILD[s.type].cost, s.x, s.y, s.built ? refundFrac : 1);
  if (s.built && (BUILD[s.type].wall || BUILD[s.type].door)) G.roomsDirty = true;
  refreshFires();
}
function completeStructure(s) {
  s.built = true; s.work = 0; s.hp = BUILD[s.type].hp;
  const c = G.cells[idx(s.x, s.y)];
  const d = BUILD[s.type];
  if (d.wall || d.door) G.roomsDirty = true;
  if (c.item && (d.blocks || d.door || d.bed || d.station || d.table)) {
    const it = c.item; c.item = null; dropItem(s.x, s.y, it.type, it.n);
  }
  if (d.blocks) c.zone = 0;
  refreshFires();
  rebuildStockCells();
}
function refreshFires() { G.fires = G.structures.filter(s => s.built && BUILD[s.type].heat); }
