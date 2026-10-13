'use strict';
// ===== 렌더링 =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let terrainCanvas = null;
const spriteCache = new Map();

function sprite(emoji, size) {
  const key = emoji + size;
  let s = spriteCache.get(key);
  if (!s) {
    s = document.createElement('canvas');
    s.width = s.height = size;
    const c = s.getContext('2d');
    c.font = `${Math.floor(size * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(emoji, size / 2, size / 2 + size * 0.05);
    spriteCache.set(key, s);
  }
  return s;
}

function shadeColor(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = clamp(Math.round(r * f), 0, 255); g = clamp(Math.round(g * f), 0, 255); b = clamp(Math.round(b * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function buildTerrainCanvas() {
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = MAP_W * TILE; terrainCanvas.height = MAP_H * TILE;
  const c = terrainCanvas.getContext('2d');
  const r = mulberry32(1234);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const cell = G.cells[idx(x, y)];
    const base = TERRAIN[cell.t].color;
    c.fillStyle = shadeColor(base, 0.92 + r() * 0.16);
    c.fillRect(x * TILE, y * TILE, TILE, TILE);
    // 잔무늬
    for (let k = 0; k < 3; k++) {
      c.fillStyle = shadeColor(base, 0.8 + r() * 0.4);
      c.fillRect(x * TILE + r() * TILE, y * TILE + r() * TILE, 2 + r() * 3, 2 + r() * 3);
    }
    if (cell.t === T.WATER) {
      c.strokeStyle = 'rgba(255,255,255,0.12)';
      c.beginPath(); const yy = y * TILE + 8 + r() * 16; c.moveTo(x * TILE + 4, yy); c.quadraticCurveTo(x * TILE + 16, yy - 4, x * TILE + 28, yy); c.stroke();
    }
  }
}

const cam = { x: 0, y: 0, zoom: 1 };
function worldToScreen(wx, wy) { return [(wx * TILE - cam.x) * cam.zoom, (wy * TILE - cam.y) * cam.zoom]; }
function screenToWorld(sx, sy) { return [(sx / cam.zoom + cam.x) / TILE, (sy / cam.zoom + cam.y) / TILE]; }
function centerCam(wx, wy) {
  cam.x = wx * TILE - canvas.width / 2 / cam.zoom;
  cam.y = wy * TILE - canvas.height / 2 / cam.zoom;
  clampCam();
}
function clampCam() {
  const vw = canvas.width / cam.zoom, vh = canvas.height / cam.zoom;
  cam.x = clamp(cam.x, -200, MAP_W * TILE - vw + 200);
  cam.y = clamp(cam.y, -200, MAP_H * TILE - vh + 200);
}

const STRUCT_COLORS = {
  wall_wood: '#8a5a2e', wall_stone: '#8d8d8d', door: '#a0703c', sandbag: '#b59d6b', turret: '#5d6d7e', spikes: '#6b4e2e',
  bed: '#3e6aa8', table: '#9b6b3c', campfire: '#d35400', workbench: '#7d5a3c', heater: '#c0392b', cooler: '#2e86c1',
};

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(terrainCanvas, 0, 0);

  const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1), y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const x1 = Math.min(MAP_W - 1, Math.ceil((cam.x + W / cam.zoom) / TILE) + 1), y1 = Math.min(MAP_H - 1, Math.ceil((cam.y + H / cam.zoom) / TILE) + 1);
  const small = cam.zoom < 0.55;

  // 구역 / 작물 / 자원
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = G.cells[idx(x, y)];
    const px = x * TILE, py = y * TILE;
    if (c.zone === 1) { ctx.fillStyle = 'rgba(240,200,80,0.16)'; ctx.fillRect(px, py, TILE, TILE); ctx.strokeStyle = 'rgba(240,200,80,0.35)'; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1); }
    if (c.zone === 2) {
      ctx.fillStyle = 'rgba(90,60,30,0.55)'; ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = 'rgba(120,220,90,0.25)'; ctx.fillRect(px, py, TILE, 2);
    }
    if (c.crop) {
      const g = Math.min(1, c.crop.g);
      ctx.fillStyle = g >= 1 ? '#e5c35a' : '#6fbf4a';
      const h = 4 + g * 18;
      for (let k = 0; k < 3; k++) ctx.fillRect(px + 7 + k * 8, py + TILE - 4 - h, 3, h);
    }
    if (c.res) {
      const t = c.res.type;
      if (t === 'rock' || t === 'ore') {
        ctx.fillStyle = t === 'ore' ? '#6f6a66' : '#77736d';
        ctx.fillRect(px, py, TILE, TILE);
        const below = cellAt(x, y + 1), above = cellAt(x, y - 1);
        if (!below || !below.res || !RES[below.res.type].blocks) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(px, py + TILE - 6, TILE, 6); }
        if (!above || !above.res || !RES[above.res.type].blocks) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(px, py, TILE, 3); }
        ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(px + ((x * 7 + y * 13) % 20), py + ((x * 11 + y * 5) % 20), 7, 5);
        if (t === 'ore') { ctx.fillStyle = '#d98e3a'; ctx.fillRect(px + 8, py + 9, 5, 5); ctx.fillRect(px + 19, py + 17, 6, 5); ctx.fillRect(px + 12, py + 22, 4, 4); }
      } else if (!small) {
        const d = RES[t];
        let icon = d.icon;
        if ((t === 'bush' || t === 'herb') && !c.res.grown) { ctx.globalAlpha = 0.45; icon = t === 'bush' ? '🌱' : '🌱'; }
        ctx.drawImage(sprite(icon, 64), px - 2, py - 6, TILE + 4, TILE + 4);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = '#2d5a27'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 10, 0, 7); ctx.fill();
      }
    }
  }

  // 구조물
  for (const s of G.structures) {
    if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
    drawStructure(s);
  }

  // 아이템
  ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = G.cells[idx(x, y)];
    if (!c.item) continue;
    const px = x * TILE, py = y * TILE;
    ctx.drawImage(sprite(ITEMS[c.item.type].icon, 48), px + 5, py + 3, 22, 22);
    if (c.item.n > 1 && !small) {
      ctx.fillStyle = '#000'; ctx.fillText(c.item.n, px + TILE - 1, py + TILE);
      ctx.fillStyle = '#fff'; ctx.fillText(c.item.n, px + TILE - 2, py + TILE - 1);
    }
  }

  // 지정 표시
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = G.cells[idx(x, y)];
    if (!c.des) continue;
    const icon = { chop: '🪓', mine: '⛏️', harvest: '🧺', deconstruct: '🔨' }[c.des];
    ctx.globalAlpha = 0.85;
    ctx.drawImage(sprite(icon, 32), x * TILE + 16, y * TILE, 16, 16);
    ctx.globalAlpha = 1;
  }

  // 유닛
  const units = G.units.filter(u => !u.dead).sort((a, b) => a.y - b.y);
  for (const u of units) {
    if (u.x < x0 - 1 || u.x > x1 + 1 || u.y < y0 - 1 || u.y > y1 + 1) continue;
    drawUnit(u);
  }

  // 효과
  for (const f of G.fx) drawFx(f);

  // 밤 어둠
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const h = (G.time % DAY_MIN) / 60;
  let dark = 0;
  if (h < 5) dark = 0.45; else if (h < 7) dark = 0.45 * (7 - h) / 2; else if (h > 20) dark = 0.45 * Math.min(1, (h - 20) / 2);
  if (G.weather && G.weather.offset < 0) { ctx.fillStyle = 'rgba(180,210,255,0.08)'; ctx.fillRect(0, 0, W, H); }
  if (G.weather && G.weather.offset > 0) { ctx.fillStyle = 'rgba(255,150,60,0.08)'; ctx.fillRect(0, 0, W, H); }
  if (dark > 0) { ctx.fillStyle = `rgba(10,15,40,${dark})`; ctx.fillRect(0, 0, W, H); }

  // 오버레이 (선택/도구)
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
  drawOverlay();
  if (UI.tempOverlay) drawTempOverlay(x0, y0, x1, y1);
}

function drawStructure(s) {
  const d = BUILD[s.type], px = s.x * TILE, py = s.y * TILE;
  const col = STRUCT_COLORS[s.type] || '#888';
  if (!s.built) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#3d7bd9';
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#8fc1ff'; ctx.setLineDash([4, 3]); ctx.strokeRect(px + 2.5, py + 2.5, TILE - 5, TILE - 5); ctx.setLineDash([]);
    if (s.work > 0) { ctx.fillStyle = '#8fc1ff'; ctx.fillRect(px + 3, py + TILE - 6, (TILE - 6) * s.work / d.work, 3); }
    ctx.fillStyle = '#fff'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (cam.zoom > 0.7) ctx.fillText(d.name.slice(0, 4), px + 16, py + 14);
    if (!s.paid && !canAfford(d.cost)) { ctx.drawImage(sprite('❗', 32), px + 18, py, 14, 14); }
    return;
  }
  if (d.wall) {
    ctx.fillStyle = col; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(px, py + TILE - 6, TILE, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(px, py, TILE, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    if (s.type === 'wall_stone') { ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.moveTo(px, py + 13); ctx.lineTo(px + TILE, py + 13); ctx.moveTo(px + 16, py + 13); ctx.lineTo(px + 16, py + 26); ctx.stroke(); }
  } else if (d.door) {
    ctx.fillStyle = '#5a3b1c'; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = col; ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
    ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.arc(px + TILE - 9, py + 16, 2.5, 0, 7); ctx.fill();
  } else if (d.bed) {
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(px + 3, py + 1, TILE - 6, TILE - 2);
    ctx.fillStyle = col; ctx.fillRect(px + 5, py + 10, TILE - 10, TILE - 13);
    ctx.fillStyle = '#eee'; ctx.fillRect(px + 6, py + 3, TILE - 12, 6);
  } else if (d.turret) {
    ctx.fillStyle = '#34495e'; ctx.beginPath(); ctx.arc(px + 16, py + 16, 13, 0, 7); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px + 16, py + 16, 8, 0, 7); ctx.fill();
    ctx.strokeStyle = '#bdc3c7'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(px + 16, py + 16);
    const a = s.aim || 0; ctx.lineTo(px + 16 + Math.cos(a) * 15, py + 16 + Math.sin(a) * 15); ctx.stroke(); ctx.lineWidth = 1;
  } else if (d.cover) {
    ctx.fillStyle = col;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(px + 7 + k * 9, py + 20, 6, 5, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = shadeColor(col, 0.8); ctx.beginPath(); ctx.ellipse(px + 11, py + 13, 6, 5, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(px + 21, py + 13, 6, 5, 0, 0, 7); ctx.fill();
  } else if (d.trap) {
    ctx.strokeStyle = '#ccc';
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(px + 5 + k * 7, py + 26); ctx.lineTo(px + 8 + k * 7, py + 12); ctx.lineTo(px + 11 + k * 7, py + 26); ctx.stroke(); }
  } else {
    ctx.fillStyle = shadeColor(col, 0.6); ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = col; ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
    const icon = { campfire: '🔥', workbench: '🛠️', heater: '♨️', cooler: '❄️', table: '🍽️' }[s.type];
    if (icon) ctx.drawImage(sprite(icon, 48), px + 4, py + 4, 24, 24);
  }
  if (s.hp < d.hp) {
    ctx.fillStyle = '#300'; ctx.fillRect(px + 2, py - 4, TILE - 4, 3);
    ctx.fillStyle = '#e74c3c'; ctx.fillRect(px + 2, py - 4, (TILE - 4) * s.hp / d.hp, 3);
  }
  if (G.cells[idx(s.x, s.y)].des === 'deconstruct') { ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2); ctx.lineWidth = 1; }
}

function drawUnit(u) {
  const px = u.x * TILE, py = u.y * TILE;
  const sel = UI.selected && UI.selected.kind !== 'struct' && UI.selected.id === u.id;
  if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 15, 0, 7); ctx.stroke(); ctx.lineWidth = 1; }
  if (u.kind === 'animal') {
    if (u.huntDes) { ctx.strokeStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(px, py, 14, 0, 7); ctx.stroke(); }
    if (u.manhunter) { ctx.fillStyle = 'rgba(231,76,60,0.35)'; ctx.beginPath(); ctx.arc(px, py, 13, 0, 7); ctx.fill(); }
    const sz = u.atype === 'rabbit' ? 20 : u.atype === 'bear' ? 34 : 28;
    ctx.drawImage(sprite(ANIMALS[u.atype].icon, 64), px - sz / 2, py - sz / 2 - 2, sz, sz);
  } else {
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(px, py + 10, 9, 4, 0, 0, 7); ctx.fill();
    const lying = u.downed || u.sleeping;
    ctx.save();
    ctx.translate(px, py);
    if (lying) ctx.rotate(Math.PI / 2);
    // 몸
    ctx.fillStyle = u.kind === 'raider' ? '#7b241c' : (u.apparel === 'parka' ? '#2e6f9e' : u.apparel === 'armor' ? '#7a5a36' : shadeColor(u.color, 0.7));
    ctx.beginPath(); ctx.ellipse(0, 4, 8, 9, 0, 0, 7); ctx.fill();
    // 머리
    ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(0, -6, 7, 0, 7); ctx.fill();
    ctx.fillStyle = u.kind === 'raider' ? '#222' : u.color;
    ctx.beginPath(); ctx.arc(0, -8, 7, Math.PI, 0); ctx.fill();
    if (u.kind === 'raider') { ctx.fillStyle = '#c0392b'; ctx.fillRect(-7, -8, 14, 3); }
    ctx.restore();
    // 무기
    if (u.weapon && !lying) ctx.drawImage(sprite(ITEMS[u.weapon].icon, 32), px + 3, py - 2, 14, 14);
    if (u.carry) ctx.drawImage(sprite(ITEMS[u.carry.type].icon, 32), px - 8, py - 26, 16, 16);
    if (u.sleeping) { ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Z' + (G.tick % 40 < 20 ? 'z' : ''), px + 8, py - 12); }
    if (u.drafted) { ctx.drawImage(sprite('⚔️', 32), px - 18, py - 20, 12, 12); }
    if (u.kind === 'colonist' && G.time < u.breakUntil) { ctx.drawImage(sprite('😵', 32), px + 6, py - 22, 14, 14); }
    if (u.kind === 'colonist' && cam.zoom > 0.5) {
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; const w = ctx.measureText(u.name).width + 6;
      ctx.fillRect(px - w / 2, py + 14, w, 13);
      ctx.fillStyle = u.downed ? '#ff7675' : '#fff'; ctx.fillText(u.name, px, py + 15);
    }
  }
  if (u.hp < u.maxHp) {
    ctx.fillStyle = '#300'; ctx.fillRect(px - 12, py - 20, 24, 3);
    ctx.fillStyle = u.hp / u.maxHp > 0.5 ? '#2ecc71' : '#e74c3c'; ctx.fillRect(px - 12, py - 20, 24 * Math.max(0, u.hp) / u.maxHp, 3);
  }
}

function drawFx(f) {
  if (f.type === 'shot') {
    ctx.strokeStyle = f.color; ctx.globalAlpha = f.life / 6; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(f.x0 * TILE, f.y0 * TILE); ctx.lineTo(f.x1 * TILE, f.y1 * TILE); ctx.stroke();
    ctx.lineWidth = 1; ctx.globalAlpha = 1;
  } else if (f.type === 'slash') {
    ctx.strokeStyle = '#fff'; ctx.globalAlpha = f.life / 8; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.x * TILE, f.y * TILE, 10 + (8 - f.life), -1, 1); ctx.stroke();
    ctx.lineWidth = 1; ctx.globalAlpha = 1;
  } else if (f.type === 'text') {
    ctx.globalAlpha = Math.min(1, f.life / 15); ctx.fillStyle = f.color; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x * TILE, f.y * TILE - (30 - f.life) * 0.6); ctx.globalAlpha = 1;
  } else if (f.type === 'spark') {
    ctx.fillStyle = '#ffd27f'; ctx.globalAlpha = f.life / 6;
    for (let k = 0; k < 3; k++) ctx.fillRect(f.x * TILE + (rand() - 0.5) * 16, f.y * TILE + (rand() - 0.5) * 16, 2, 2);
    ctx.globalAlpha = 1;
  } else if (f.type === 'boom') {
    ctx.strokeStyle = '#ffb347'; ctx.globalAlpha = f.life / 40; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(f.x * TILE, f.y * TILE, (40 - f.life) * 1.5, 0, 7); ctx.stroke();
    ctx.lineWidth = 1; ctx.globalAlpha = 1;
  }
}

function drawOverlay() {
  // 선택된 건물
  if (UI.selected && UI.selected.kind === 'struct') {
    const s = UI.selected.ref;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(s.x * TILE, s.y * TILE, TILE, TILE); ctx.lineWidth = 1;
    if (BUILD[s.type].turret) { ctx.strokeStyle = 'rgba(155,231,255,0.4)'; ctx.beginPath(); ctx.arc(s.x * TILE + 16, s.y * TILE + 16, WEAPONS.turret.range * TILE, 0, 7); ctx.stroke(); }
  }
  // 선택된 정착민 경로 / 사거리
  if (UI.selected && UI.selected.kind !== 'struct') {
    const u = unitById(UI.selected.id);
    if (u && u.path && u.path.length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(u.x * TILE, u.y * TILE);
      for (const i of u.path) ctx.lineTo(cx_(i) * TILE + 16, cy_(i) * TILE + 16);
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (u && u.drafted && !weaponOf(u).melee) { ctx.strokeStyle = 'rgba(255,230,140,0.3)'; ctx.beginPath(); ctx.arc(u.x * TILE, u.y * TILE, weaponOf(u).range * TILE, 0, 7); ctx.stroke(); }
  }
  // 도구 미리보기
  const m = UI.mouse;
  if (!m.inside) return;
  const [wx, wy] = screenToWorld(m.x, m.y);
  const tx = Math.floor(wx), ty = Math.floor(wy);
  if (UI.tool) {
    let rx0 = tx, ry0 = ty, rx1 = tx, ry1 = ty;
    if (UI.drag) { rx0 = Math.min(UI.drag.x, tx); ry0 = Math.min(UI.drag.y, ty); rx1 = Math.max(UI.drag.x, tx); ry1 = Math.max(UI.drag.y, ty); }
    const cells = toolCells(rx0, ry0, rx1, ry1);
    ctx.fillStyle = UI.tool.type === 'build' ? 'rgba(80,160,255,0.35)' : UI.tool.id === 'cancel' || UI.tool.id === 'clearzone' || UI.tool.id === 'deconstruct' ? 'rgba(255,90,90,0.3)' : 'rgba(255,255,255,0.22)';
    for (const [x, y] of cells) ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    if (UI.tool.type === 'build') {
      const cost = BUILD[UI.tool.id].cost, n = cells.length;
      const txt = Object.keys(cost).map(k => `${ITEMS[k].name} ${cost[k] * n}`).join(', ');
      ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(txt, (tx + 1) * TILE, ty * TILE - 4);
    } else if (UI.drag) {
      ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.fillText(`${rx1 - rx0 + 1}×${ry1 - ry0 + 1}`, (tx + 1) * TILE, ty * TILE - 4);
    }
  } else if (inb(tx, ty)) {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
  }
}

function drawTempOverlay(x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = tempAt(x + 0.5, y + 0.5);
    const f = clamp((t + 20) / 60, 0, 1);
    ctx.fillStyle = `hsla(${(1 - f) * 230},80%,50%,0.35)`;
    ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
  }
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
  for (const r of G.rooms) {
    if (!r || r.outdoor || !r.cells.length) continue;
    const i = r.cells[Math.floor(r.cells.length / 2)];
    ctx.fillText(Math.round(r.temp) + '°C', cx_(i) * TILE + 16, cy_(i) * TILE + 20);
  }
}
