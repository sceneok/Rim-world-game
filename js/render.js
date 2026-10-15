'use strict';
// ===== 렌더링 (듀오링고 스타일: 밝은 단색, 둥근 형태, 아래쪽 두꺼운 그림자로 입체감) =====
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let terrainCanvas = null;
let DPR = 1;
const spriteCache = new Map();
const vspriteCache = new Map();

const PAL = {
  green: '#58cc02', greenDk: '#46a302', greenLt: '#89e219',
  blue: '#1cb0f6', blueDk: '#1899d6', blueLt: '#84d8ff',
  red: '#ff4b4b', redDk: '#ea2b2b',
  yellow: '#ffc800', yellowDk: '#e5a400',
  orange: '#ff9600', orangeDk: '#e07b00',
  purple: '#ce82ff',
  ink: '#4b4b4b', inkSoft: '#777777', line: '#e5e5e5', white: '#ffffff',
  skin: '#ffd2a8', skinDk: '#f0b483',
};
const FONT = '"Nunito","Jua","Noto Sans KR",sans-serif';

function viewW() { return canvas.width / DPR; }
function viewH() { return canvas.height / DPR; }

// 이모지 스프라이트 (아이템 아이콘 등)
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

// 벡터 스프라이트: 32x32 논리 좌표로 그린 것을 고해상도로 캐시
function vsprite(key, draw, w = 32, h = 32) {
  let s = vspriteCache.get(key);
  if (!s) {
    const k = 3;
    s = document.createElement('canvas');
    s.width = w * k; s.height = h * k;
    const c = s.getContext('2d');
    c.scale(k, k);
    draw(c);
    vspriteCache.set(key, s);
  }
  return s;
}

function shadeColor(hex, f) {
  if (hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f <= 1) { r *= f; g *= f; b *= f; }
  else { const t = f - 1; r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
  return `rgb(${clamp(Math.round(r), 0, 255)},${clamp(Math.round(g), 0, 255)},${clamp(Math.round(b), 0, 255)})`;
}

function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
function ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
// 듀오링고식 입체 블록: 아래쪽 진한 면 + 위쪽 밝은 면
function chunky(c, x, y, w, h, r, top, side, depth = 4) {
  c.fillStyle = side; rr(c, x, y, w, h, r); c.fill();
  c.fillStyle = top; rr(c, x, y, w, h - depth, r); c.fill();
}
function pillText(text, x, y, opt = {}) {
  ctx.font = `800 ${opt.size || 10}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 10, h = (opt.size || 10) + 6;
  ctx.fillStyle = opt.border || PAL.line; rr(ctx, x - w / 2, y - h / 2, w, h + 2, h / 2); ctx.fill();
  ctx.fillStyle = opt.bg || PAL.white; rr(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.fillStyle = opt.color || PAL.ink; ctx.fillText(text, x, y + 0.5);
}
function pillBar(x, y, w, frac, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; rr(ctx, x - 1, y - 1, w + 2, 6, 3); ctx.fill();
  ctx.fillStyle = PAL.line; rr(ctx, x, y, w, 4, 2); ctx.fill();
  if (frac > 0) { ctx.fillStyle = color; rr(ctx, x, y, Math.max(4, w * frac), 4, 2); ctx.fill(); }
}

// ===== 지형 =====
const TERRAIN_STYLE = [
  { a: '#a5e05a', b: '#9cd752' }, // 풀밭
  { a: '#e6bd7a', b: '#ddb270' }, // 흙
  { a: '#ffe7a3', b: '#fbdf95' }, // 모래
  { a: '#49c0f8', b: '#43b9f2' }, // 물
  { a: '#cfd3dc', b: '#c7cbd5' }, // 암반
  { a: '#8fd3a8', b: '#86cba0' }, // 습지
];

function buildTerrainCanvas() {
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = MAP_W * TILE; terrainCanvas.height = MAP_H * TILE;
  const c = terrainCanvas.getContext('2d');
  const r = mulberry32(1234);
  const tAt = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? -1 : G.cells[idx(x, y)].t;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const t = G.cells[idx(x, y)].t, st = TERRAIN_STYLE[t];
    c.fillStyle = (x + y) % 2 ? st.a : st.b;
    c.fillRect(x * TILE, y * TILE, TILE, TILE);
  }
  // 장식: 풀 무더기, 꽃, 자갈, 물결
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const t = G.cells[idx(x, y)].t, px = x * TILE, py = y * TILE;
    if (t === T.GRASS || t === T.MARSH) {
      if (r() < 0.35) {
        const gx = px + 6 + r() * 20, gy = py + 10 + r() * 16;
        c.strokeStyle = t === T.GRASS ? '#7cc63a' : '#64b088'; c.lineWidth = 2; c.lineCap = 'round';
        c.beginPath(); c.moveTo(gx - 3, gy - 4); c.lineTo(gx - 1, gy); c.lineTo(gx + 1, gy - 5); c.lineTo(gx + 3, gy); c.lineTo(gx + 5, gy - 4); c.stroke();
      }
      if (t === T.GRASS && r() < 0.05) {
        const fx = px + 6 + r() * 20, fy = py + 6 + r() * 20;
        c.fillStyle = ['#ffffff', '#ffc800', '#ff86d0'][Math.floor(r() * 3)];
        for (let k = 0; k < 5; k++) { const a = k * 1.2566; circle(c, fx + Math.cos(a) * 2.2, fy + Math.sin(a) * 2.2, 1.7); c.fill(); }
        c.fillStyle = '#ff9600'; circle(c, fx, fy, 1.4); c.fill();
      }
    } else if (t === T.DIRT || t === T.SAND || t === T.STONE) {
      if (r() < 0.3) {
        c.fillStyle = t === T.SAND ? '#f2cf7a' : t === T.DIRT ? '#cf9f5d' : '#b3b8c4';
        ellipse(c, px + 6 + r() * 20, py + 6 + r() * 20, 2 + r() * 2, 1.5 + r() * 1.5); c.fill();
      }
    }
  }
  // 물가: 밝은 테두리(거품) + 물속 진한 띠
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (tAt(x, y) !== T.WATER) continue;
    const px = x * TILE, py = y * TILE;
    const n = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let d = 0; d < 4; d++) {
      const nt = tAt(x + n[d][0], y + n[d][1]);
      if (nt === T.WATER || nt === -1) continue;
      c.fillStyle = '#2aa3e0';
      if (d === 0) c.fillRect(px, py, TILE, 7);
      if (d === 1) c.fillRect(px + TILE - 5, py, 5, TILE);
      if (d === 2) c.fillRect(px, py + TILE - 5, TILE, 5);
      if (d === 3) c.fillRect(px, py, 5, TILE);
      c.fillStyle = '#d7f3ff';
      if (d === 0) c.fillRect(px, py, TILE, 3);
      if (d === 1) c.fillRect(px + TILE - 3, py, 3, TILE);
      if (d === 2) c.fillRect(px, py + TILE - 3, TILE, 3);
      if (d === 3) c.fillRect(px, py, 3, TILE);
    }
    if (r() < 0.22) {
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2; c.lineCap = 'round';
      const wx = px + 8 + r() * 10, wy = py + 10 + r() * 12;
      c.beginPath(); c.moveTo(wx, wy); c.quadraticCurveTo(wx + 4, wy - 3, wx + 8, wy); c.quadraticCurveTo(wx + 12, wy + 3, wx + 16, wy); c.stroke();
    }
  }
}

// ===== 자연물 스프라이트 =====
function treeSprite(alt) {
  return vsprite('tree' + alt, c => {
    c.fillStyle = 'rgba(0,0,0,0.13)'; ellipse(c, 16, 29, 10, 3); c.fill();
    c.fillStyle = '#a0622d'; rr(c, 13, 18, 6, 12, 3); c.fill();
    c.fillStyle = '#7d4a1f'; rr(c, 16, 18, 3, 12, 2); c.fill();
    const canopy = [[16, 11, 10], [9, 15, 7], [23, 15, 7]];
    c.fillStyle = PAL.greenDk; for (const [x, y, r] of canopy) { circle(c, x, y + 2, r); c.fill(); }
    c.fillStyle = PAL.green; for (const [x, y, r] of canopy) { circle(c, x, y, r); c.fill(); }
    c.fillStyle = PAL.greenLt; circle(c, 12 + alt, 8, 3.5); c.fill(); circle(c, 8, 13, 2); c.fill();
  }, 32, 34);
}
function pineSprite() {
  return vsprite('pine', c => {
    c.fillStyle = 'rgba(0,0,0,0.13)'; ellipse(c, 16, 29, 9, 3); c.fill();
    c.fillStyle = '#8a5326'; rr(c, 13.5, 22, 5, 8, 2); c.fill();
    const tiers = [[16, 25, 13, 10], [16, 18, 10, 9], [16, 11, 7, 8]];
    c.lineJoin = 'round';
    for (const [x, y, w, h] of tiers) {
      for (const [col, dy] of [['#1f8a43', 2], ['#2fb35a', 0]]) {
        c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 3;
        c.beginPath(); c.moveTo(x, y - h + dy); c.lineTo(x + w, y + dy); c.lineTo(x - w, y + dy); c.closePath(); c.fill(); c.stroke();
      }
    }
    c.fillStyle = '#5fd47f'; c.beginPath(); c.moveTo(16, 3.5); c.lineTo(12, 10); c.lineTo(15, 10); c.closePath(); c.fill();
  }, 32, 34);
}
function bushSprite(grown, herb) {
  return vsprite(`bush${grown ? 1 : 0}${herb ? 1 : 0}`, c => {
    if (!grown) {
      c.strokeStyle = '#46a302'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(16, 27); c.lineTo(16, 19); c.stroke();
      c.fillStyle = PAL.greenLt; ellipse(c, 12.5, 19, 4, 2.5); c.fill(); ellipse(c, 19.5, 18, 4, 2.5); c.fill();
      return;
    }
    c.fillStyle = 'rgba(0,0,0,0.12)'; ellipse(c, 16, 27, 10, 3); c.fill();
    if (herb) {
      c.lineCap = 'round';
      const leaves = [[-0.9, 9], [-0.35, 11], [0.25, 11], [0.8, 9]];
      for (const [a, len] of leaves) {
        c.save(); c.translate(16, 26); c.rotate(a);
        c.fillStyle = '#3fa34d'; ellipse(c, 0, -len / 2 - 1, 3.5, len / 2 + 1); c.fill();
        c.fillStyle = '#7ad66a'; ellipse(c, -0.6, -len / 2 - 1.5, 2, len / 2); c.fill();
        c.restore();
      }
      c.fillStyle = PAL.purple; circle(c, 16, 13, 2.2); c.fill(); circle(c, 11, 16, 1.6); c.fill();
      return;
    }
    c.fillStyle = PAL.greenDk; circle(c, 11, 20, 7); c.fill(); circle(c, 21, 20, 7); c.fill(); circle(c, 16, 16, 8); c.fill();
    c.fillStyle = PAL.green; circle(c, 11, 18.5, 6.5); c.fill(); circle(c, 21, 18.5, 6.5); c.fill(); circle(c, 16, 14.5, 7.5); c.fill();
    for (const [x, y] of [[11, 18], [19, 13], [21, 20], [15, 21], [14, 12]]) {
      c.fillStyle = PAL.redDk; circle(c, x, y + 0.6, 2.3); c.fill();
      c.fillStyle = PAL.red; circle(c, x, y, 2.2); c.fill();
      c.fillStyle = '#ffb3b3'; circle(c, x - 0.7, y - 0.7, 0.7); c.fill();
    }
  });
}

const cam = { x: 0, y: 0, zoom: 1 };
function worldToScreen(wx, wy) { return [(wx * TILE - cam.x) * cam.zoom, (wy * TILE - cam.y) * cam.zoom]; }
function screenToWorld(sx, sy) { return [(sx / cam.zoom + cam.x) / TILE, (sy / cam.zoom + cam.y) / TILE]; }
function centerCam(wx, wy) {
  cam.x = wx * TILE - viewW() / 2 / cam.zoom;
  cam.y = wy * TILE - viewH() / 2 / cam.zoom;
  clampCam();
}
function clampCam() {
  const vw = viewW() / cam.zoom, vh = viewH() / cam.zoom;
  cam.x = clamp(cam.x, -200, MAP_W * TILE - vw + 200);
  cam.y = clamp(cam.y, -200, MAP_H * TILE - vh + 200);
}
function worldTransform() { const z = cam.zoom * DPR; ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z); }

function render() {
  const W = viewW(), H = viewH();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#7fd0f5'; ctx.fillRect(0, 0, W, H);
  worldTransform();
  ctx.imageSmoothingEnabled = true;
  // 맵 바깥 테두리
  ctx.fillStyle = '#d7f3ff'; rr(ctx, -10, -10, MAP_W * TILE + 20, MAP_H * TILE + 24, 18); ctx.fill();
  ctx.drawImage(terrainCanvas, 0, 0);

  const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1), y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const x1 = Math.min(MAP_W - 1, Math.ceil((cam.x + W / cam.zoom) / TILE) + 1), y1 = Math.min(MAP_H - 1, Math.ceil((cam.y + H / cam.zoom) / TILE) + 1);

  // 구역 / 작물
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = G.cells[idx(x, y)];
    const px = x * TILE, py = y * TILE;
    if (c.zone === 1) {
      ctx.fillStyle = 'rgba(255,200,0,0.22)'; ctx.fillRect(px, py, TILE, TILE);
      ctx.strokeStyle = 'rgba(229,164,0,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      rr(ctx, px + 2, py + 2, TILE - 4, TILE - 4, 6); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    if (c.zone === 2) {
      ctx.fillStyle = '#b97a3e'; rr(ctx, px + 1, py + 1, TILE - 2, TILE - 2, 6); ctx.fill();
      ctx.fillStyle = '#c98a4b'; rr(ctx, px + 1, py + 1, TILE - 2, TILE - 5, 6); ctx.fill();
      ctx.strokeStyle = '#a86c33'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); for (let k = 0; k < 3; k++) { ctx.moveTo(px + 6, py + 8 + k * 7); ctx.lineTo(px + TILE - 6, py + 8 + k * 7); } ctx.stroke(); ctx.lineWidth = 1;
    }
    if (c.crop) {
      const g = Math.min(1, c.crop.g), ripe = g >= 1;
      const h = 4 + g * 16;
      ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const sx = px + 9 + k * 7, sy = py + TILE - 5;
        ctx.strokeStyle = ripe ? '#d9a400' : PAL.greenDk; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - h); ctx.stroke();
        ctx.fillStyle = ripe ? PAL.yellow : PAL.green; ellipse(ctx, sx, sy - h, ripe ? 3 : 2 + g * 1.5, ripe ? 4.5 : 2 + g * 2); ctx.fill();
      }
      ctx.lineWidth = 1;
    }
  }
  // 바위/광맥 (지형처럼 아래에 깔림)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = G.cells[idx(x, y)];
    if (!c.res || (c.res.type !== 'rock' && c.res.type !== 'ore')) continue;
    drawRock(x, y, c.res.type === 'ore');
  }

  // 구조물
  for (const s of G.structures) {
    if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
    drawStructure(s);
  }

  // 아이템
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = G.cells[idx(x, y)];
    if (!c.item) continue;
    drawItemChip(x * TILE + 16, y * TILE + 15, c.item.type, c.item.n);
  }

  // 나무·덤불 + 유닛 (y 정렬로 겹침 처리)
  const draws = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = G.cells[idx(x, y)];
    if (c.res && c.res.type !== 'rock' && c.res.type !== 'ore') draws.push({ y: y + 0.9, f: () => drawPlant(x, y, c) });
  }
  for (const u of G.units) {
    if (u.dead) continue;
    if (u.x < x0 - 1 || u.x > x1 + 1 || u.y < y0 - 1 || u.y > y1 + 1) continue;
    draws.push({ y: u.y + 0.3, f: () => drawUnit(u) });
  }
  draws.sort((a, b) => a.y - b.y);
  for (const d of draws) d.f();

  // 지정 표시
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = G.cells[idx(x, y)];
    if (!c.des) continue;
    const icon = { chop: '🪓', mine: '⛏️', harvest: '🧺', deconstruct: '🔨' }[c.des];
    const bx = x * TILE + 24, by = y * TILE + 7;
    ctx.fillStyle = c.des === 'deconstruct' ? PAL.redDk : PAL.blueDk; circle(ctx, bx, by + 1.5, 7.5); ctx.fill();
    ctx.fillStyle = PAL.white; circle(ctx, bx, by, 7.5); ctx.fill();
    ctx.drawImage(sprite(icon, 32), bx - 5.5, by - 5.5, 11, 11);
  }

  // 효과
  for (const f of G.fx) drawFx(f);

  // 밤 / 날씨 색조
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const h = (G.time % DAY_MIN) / 60;
  let dark = 0;
  if (h < 5) dark = 0.42; else if (h < 7) dark = 0.42 * (7 - h) / 2; else if (h > 20) dark = 0.42 * Math.min(1, (h - 20) / 2);
  if (G.weather && G.weather.offset < 0) { ctx.fillStyle = 'rgba(200,235,255,0.18)'; ctx.fillRect(0, 0, W, H); }
  if (G.weather && G.weather.offset > 0) { ctx.fillStyle = 'rgba(255,170,60,0.12)'; ctx.fillRect(0, 0, W, H); }
  if (dark > 0) { ctx.fillStyle = `rgba(45,30,110,${dark})`; ctx.fillRect(0, 0, W, H); }

  // 오버레이 (선택/도구)
  worldTransform();
  drawOverlay();
  if (UI.tempOverlay) drawTempOverlay(x0, y0, x1, y1);
}

function drawRock(x, y, ore) {
  const px = x * TILE, py = y * TILE;
  const blk = (xx, yy) => { const c = cellAt(xx, yy); return c && c.res && RES[c.res.type].blocks; };
  const top = ore ? '#bfb6c9' : '#c3c8d3', side = ore ? '#8f84a0' : '#959cab';
  const below = blk(x, y + 1);
  // 이웃과 이어지도록 모서리 둥글기 조절
  const r = 7;
  ctx.fillStyle = side;
  rr(ctx, px - (blk(x - 1, y) ? 2 : 0), py - (blk(x, y - 1) ? 2 : 0), TILE + (blk(x - 1, y) ? 2 : 0) + (blk(x + 1, y) ? 2 : 0), TILE + (blk(x, y - 1) ? 2 : 0), r); ctx.fill();
  ctx.fillStyle = top;
  rr(ctx, px - (blk(x - 1, y) ? 2 : 0), py - (blk(x, y - 1) ? 2 : 0), TILE + (blk(x - 1, y) ? 2 : 0) + (blk(x + 1, y) ? 2 : 0), TILE - (below ? -2 : 6) + (blk(x, y - 1) ? 2 : 0), r); ctx.fill();
  // 결
  ctx.fillStyle = ore ? '#a99fb6' : '#aeb4c1';
  ellipse(ctx, px + 8 + ((x * 7 + y * 13) % 14), py + 8 + ((x * 11 + y * 5) % 10), 4, 2.5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ellipse(ctx, px + 9 + ((x * 3 + y * 7) % 10), py + 6, 3, 1.5); ctx.fill();
  if (ore) {
    for (const [gx, gy] of [[9, 11], [21, 15], [13, 20]]) {
      ctx.fillStyle = PAL.orangeDk; ctx.beginPath(); ctx.moveTo(px + gx, py + gy - 3.5); ctx.lineTo(px + gx + 3.5, py + gy + 1); ctx.lineTo(px + gx, py + gy + 4); ctx.lineTo(px + gx - 3.5, py + gy + 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.yellow; ctx.beginPath(); ctx.moveTo(px + gx, py + gy - 3.5); ctx.lineTo(px + gx + 2.5, py + gy); ctx.lineTo(px + gx, py + gy + 2); ctx.lineTo(px + gx - 2.5, py + gy); ctx.closePath(); ctx.fill();
    }
  }
}

function drawPlant(x, y, c) {
  const px = x * TILE, py = y * TILE, t = c.res.type;
  let spr;
  if (t === 'tree') spr = treeSprite((x * 3 + y) % 3);
  else if (t === 'pine') spr = pineSprite();
  else spr = bushSprite(c.res.grown, t === 'herb');
  const tall = t === 'tree' || t === 'pine';
  // 바람에 살랑
  const sway = tall ? Math.sin(G.tick * 0.04 + x * 0.7 + y * 0.3) * 0.025 : 0;
  ctx.save();
  ctx.translate(px + 16, py + TILE);
  ctx.rotate(sway);
  const s = tall ? 1.18 : 1;
  ctx.drawImage(spr, -16 * s, -(spr.height / 3) * s - (tall ? 2 : 0), 32 * s, (spr.height / 3) * s);
  ctx.restore();
}

function drawItemChip(cx, cy, type, n) {
  ctx.fillStyle = PAL.line; rr(ctx, cx - 11, cy - 10, 22, 23, 7); ctx.fill();
  ctx.fillStyle = PAL.white; rr(ctx, cx - 11, cy - 10, 22, 20, 7); ctx.fill();
  ctx.drawImage(sprite(ITEMS[type].icon, 48), cx - 8.5, cy - 8.5, 17, 17);
  if (n > 1 && cam.zoom > 0.55) {
    ctx.font = `800 9px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const t = String(n), w = Math.max(13, ctx.measureText(t).width + 7);
    ctx.fillStyle = PAL.blueDk; rr(ctx, cx + 13 - w, cy + 4, w, 12, 6); ctx.fill();
    ctx.fillStyle = PAL.blue; rr(ctx, cx + 13 - w, cy + 4, w, 10.5, 5.25); ctx.fill();
    ctx.fillStyle = PAL.white; ctx.fillText(t, cx + 13 - w / 2, cy + 9.5);
  }
}

// ===== 구조물 =====
const WALL_STYLE = {
  wall_wood: { top: '#e0a96a', side: '#a86c33', mid: '#c98a4b' },
  wall_stone: { top: '#d6dae3', side: '#959cab', mid: '#b7bdc9' },
};

function drawStructure(s) {
  const d = BUILD[s.type], px = s.x * TILE, py = s.y * TILE;
  if (!s.built) {
    ctx.fillStyle = 'rgba(28,176,246,0.25)'; rr(ctx, px + 2, py + 2, TILE - 4, TILE - 4, 7); ctx.fill();
    ctx.strokeStyle = PAL.blue; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    rr(ctx, px + 2, py + 2, TILE - 4, TILE - 4, 7); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    if (s.work > 0) pillBar(px + 5, py + TILE - 9, TILE - 10, s.work / d.work, PAL.blue);
    if (cam.zoom > 0.7) {
      ctx.fillStyle = PAL.blueDk; ctx.font = `800 9px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.name.slice(0, 4), px + 16, py + 14);
    }
    if (!s.paid && !canAfford(d.cost)) {
      ctx.fillStyle = PAL.redDk; circle(ctx, px + 26, py + 7.5, 6); ctx.fill();
      ctx.fillStyle = PAL.red; circle(ctx, px + 26, py + 6, 6); ctx.fill();
      ctx.fillStyle = PAL.white; ctx.font = `900 9px ${FONT}`; ctx.fillText('!', px + 26, py + 6.5);
    }
    return;
  }
  if (d.wall) {
    const st = WALL_STYLE[s.type] || WALL_STYLE.wall_wood;
    const isW = (x, y) => { const c = cellAt(x, y), o = c && c.st; return !!(o && o.built && BUILD[o.type].wall); };
    const L = isW(s.x - 1, s.y), R = isW(s.x + 1, s.y), U = isW(s.x, s.y - 1), D = isW(s.x, s.y + 1);
    const x = px - (L ? 1 : 0), y = py - (U ? 4 : 0), w = TILE + (L ? 1 : 0) + (R ? 1 : 0), h = TILE + (U ? 4 : 0);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; if (!D) { rr(ctx, x + 1, py + TILE - 3, w - 2, 6, 3); ctx.fill(); }
    ctx.fillStyle = st.side; rr(ctx, x, y, w, h, 6); ctx.fill();
    ctx.fillStyle = st.top; rr(ctx, x, y, w, h - (D ? 0 : 9), 6); ctx.fill();
    if (s.type === 'wall_wood') {
      ctx.strokeStyle = st.mid; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px + 6, py + 8); ctx.lineTo(px + 26, py + 8); ctx.moveTo(px + 6, py + 15); ctx.lineTo(px + 20, py + 15); ctx.stroke();
    } else {
      ctx.fillStyle = st.mid; rr(ctx, px + 5, py + 5, 10, 6, 3); ctx.fill(); rr(ctx, px + 17, py + 12, 10, 6, 3); ctx.fill();
    }
    ctx.lineWidth = 1;
  } else if (d.door) {
    ctx.fillStyle = '#7d4a1f'; rr(ctx, px, py, TILE, TILE, 6); ctx.fill();
    chunky(ctx, px + 4, py + 3, TILE - 8, TILE - 5, 6, '#e0a96a', '#a86c33', 4);
    ctx.fillStyle = '#c98a4b'; rr(ctx, px + 8, py + 7, TILE - 16, 6, 3); ctx.fill(); rr(ctx, px + 8, py + 16, TILE - 16, 6, 3); ctx.fill();
    ctx.fillStyle = PAL.yellowDk; circle(ctx, px + TILE - 10, py + 16, 2.8); ctx.fill();
    ctx.fillStyle = PAL.yellow; circle(ctx, px + TILE - 10, py + 15.4, 2.3); ctx.fill();
  } else if (d.bed) {
    chunky(ctx, px + 3, py + 1, TILE - 6, TILE - 2, 7, '#c98a4b', '#a86c33', 4);
    chunky(ctx, px + 5, py + 11, TILE - 10, TILE - 15, 6, PAL.blue, PAL.blueDk, 3);
    ctx.fillStyle = PAL.blueLt; rr(ctx, px + 7, py + 13, TILE - 14, 3, 1.5); ctx.fill();
    chunky(ctx, px + 7, py + 3, TILE - 14, 8, 4, PAL.white, PAL.line, 2);
  } else if (d.table) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ellipse(ctx, px + 16, py + 28, 12, 3); ctx.fill();
    ctx.fillStyle = '#a86c33'; rr(ctx, px + 7, py + 18, 4, 10, 2); ctx.fill(); rr(ctx, px + 21, py + 18, 4, 10, 2); ctx.fill();
    chunky(ctx, px + 2, py + 6, TILE - 4, 15, 7, '#e0a96a', '#a86c33', 4);
    ctx.fillStyle = PAL.white; ellipse(ctx, px + 16, py + 11.5, 5, 3); ctx.fill();
  } else if (d.turret) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ellipse(ctx, px + 16, py + 28, 13, 4); ctx.fill();
    chunky(ctx, px + 3, py + 8, TILE - 6, TILE - 9, 8, '#aeb4c1', '#7a8291', 5);
    const a = s.aim || 0;
    ctx.save(); ctx.translate(px + 16, py + 15); ctx.rotate(a);
    ctx.fillStyle = '#5f6675'; rr(ctx, 0, -3, 17, 6, 3); ctx.fill();
    ctx.fillStyle = PAL.ink; rr(ctx, 13, -3.5, 5, 7, 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#7a8291'; circle(ctx, px + 16, py + 16, 8); ctx.fill();
    ctx.fillStyle = PAL.blue; circle(ctx, px + 16, py + 14.5, 7.5); ctx.fill();
    ctx.fillStyle = PAL.white; circle(ctx, px + 16, py + 14.5, 3.5); ctx.fill();
    ctx.fillStyle = PAL.ink; circle(ctx, px + 16 + Math.cos(a) * 1.5, py + 14.5 + Math.sin(a) * 1.5, 1.8); ctx.fill();
  } else if (d.cover) {
    const bag = (x, y) => { chunky(ctx, x - 6.5, y - 5, 13, 10, 5, '#f2cf7a', '#c9a24f', 3); ctx.strokeStyle = '#d9b463'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 3, y - 1); ctx.lineTo(x + 3, y - 1); ctx.stroke(); };
    bag(px + 9, py + 23); bag(px + 23, py + 23); bag(px + 16, py + 14);
    ctx.lineWidth = 1;
  } else if (d.trap) {
    ctx.fillStyle = '#a86c33'; rr(ctx, px + 3, py + 22, TILE - 6, 6, 3); ctx.fill();
    for (let k = 0; k < 4; k++) {
      const sx = px + 7 + k * 6;
      ctx.fillStyle = '#8f96a5'; ctx.beginPath(); ctx.moveTo(sx - 3, py + 24); ctx.lineTo(sx, py + 11); ctx.lineTo(sx + 3, py + 24); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d6dae3'; ctx.beginPath(); ctx.moveTo(sx - 1.5, py + 22); ctx.lineTo(sx, py + 13); ctx.lineTo(sx + 0.5, py + 22); ctx.closePath(); ctx.fill();
    }
  } else if (s.type === 'campfire') {
    ctx.fillStyle = 'rgba(255,150,0,0.18)'; circle(ctx, px + 16, py + 18, 15); ctx.fill();
    ctx.fillStyle = '#959cab'; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; circle(ctx, px + 16 + Math.cos(a) * 11, py + 21 + Math.sin(a) * 6, 3); ctx.fill(); }
    ctx.save(); ctx.translate(px + 16, py + 22);
    ctx.fillStyle = '#7d4a1f'; ctx.rotate(0.45); rr(ctx, -10, -2.5, 20, 5, 2.5); ctx.fill(); ctx.rotate(-0.9); rr(ctx, -10, -2.5, 20, 5, 2.5); ctx.fill();
    ctx.restore();
    const fl = Math.sin(G.tick * 0.3 + s.x) * 1.5, fl2 = Math.cos(G.tick * 0.23 + s.y) * 1.2;
    const flame = (h, w, col, dx) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(px + 16 + dx, py + 21 - h); ctx.quadraticCurveTo(px + 16 + w + dx, py + 15, px + 16 + dx, py + 22); ctx.quadraticCurveTo(px + 16 - w + dx, py + 15, px + 16 + dx, py + 21 - h); ctx.fill(); };
    flame(17 + fl, 8, PAL.red, fl2 * 0.5); flame(14 + fl2, 7, PAL.orange, 0); flame(9 + fl * 0.6, 4.5, PAL.yellow, 0);
  } else {
    const style = {
      workbench: ['#e0a96a', '#a86c33', '🛠️'], heater: ['#ff8b6b', PAL.redDk, '♨️'], cooler: [PAL.blueLt, PAL.blueDk, '❄️'],
    }[s.type] || ['#d6dae3', '#959cab', null];
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ellipse(ctx, px + 16, py + 29, 13, 3); ctx.fill();
    chunky(ctx, px + 2, py + 3, TILE - 4, TILE - 4, 8, style[0], style[1], 5);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; rr(ctx, px + 6, py + 6, 10, 3, 1.5); ctx.fill();
    if (style[2]) ctx.drawImage(sprite(style[2], 48), px + 6, py + 6, 20, 20);
  }
  if (s.hp < d.hp) pillBar(px + 3, py - 6, TILE - 6, s.hp / d.hp, s.hp / d.hp > 0.5 ? PAL.green : PAL.red);
  if (G.cells[idx(s.x, s.y)].des === 'deconstruct') {
    ctx.strokeStyle = PAL.red; ctx.lineWidth = 2.5; ctx.setLineDash([5, 3]); rr(ctx, px + 1, py + 1, TILE - 2, TILE - 2, 7); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
  }
}

// ===== 유닛 =====
function facingOf(u) {
  if (u.path && u.path.length) {
    const dx = cx_(u.path[0]) + 0.5 - u.x;
    if (Math.abs(dx) > 0.05) u._face = dx > 0 ? 1 : -1;
  }
  return u._face || 1;
}
function isMoving(u) { return !!(u.path && u.path.length) && !u.downed && !u.sleeping; }

function drawEyes(c, x, y, face, opt = {}) {
  const sp = opt.spread || 3.2, ry = opt.ry || 3.1, rx = opt.rx || 2.5;
  if (opt.closed) {
    c.strokeStyle = PAL.ink; c.lineWidth = 1.4; c.lineCap = 'round';
    c.beginPath(); c.arc(x - sp, y, 1.8, 0.2, Math.PI - 0.2); c.moveTo(x + sp + 1.8, y); c.arc(x + sp, y, 1.8, 0.2, Math.PI - 0.2); c.stroke();
    c.lineWidth = 1; return;
  }
  if (opt.ko) {
    c.strokeStyle = PAL.ink; c.lineWidth = 1.4; c.lineCap = 'round';
    for (const ex of [x - sp, x + sp]) { c.beginPath(); c.moveTo(ex - 1.7, y - 1.7); c.lineTo(ex + 1.7, y + 1.7); c.moveTo(ex + 1.7, y - 1.7); c.lineTo(ex - 1.7, y + 1.7); c.stroke(); }
    c.lineWidth = 1; return;
  }
  for (const ex of [x - sp, x + sp]) {
    c.fillStyle = PAL.white; ellipse(c, ex, y, rx, ry); c.fill();
    c.fillStyle = opt.pupil || PAL.ink; circle(c, ex + face * 0.9, y + 0.5, rx * 0.62); c.fill();
    c.fillStyle = PAL.white; circle(c, ex + face * 0.9 - 0.6, y - 0.4, 0.55); c.fill();
  }
  if (opt.angry) {
    c.strokeStyle = PAL.ink; c.lineWidth = 1.6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - sp - 2.5, y - ry - 2); c.lineTo(x - sp + 2, y - ry - 0.5); c.moveTo(x + sp + 2.5, y - ry - 2); c.lineTo(x + sp - 2, y - ry - 0.5); c.stroke();
    c.lineWidth = 1;
  }
}

function drawUnit(u) {
  const px = u.x * TILE, py = u.y * TILE;
  const sel = UI.selected && UI.selected.kind !== 'struct' && UI.selected.id === u.id;
  if (sel) {
    ctx.strokeStyle = PAL.blue; ctx.lineWidth = 3; ellipse(ctx, px, py + 10, 14, 6); ctx.stroke();
    ctx.strokeStyle = PAL.white; ctx.lineWidth = 1.5; ellipse(ctx, px, py + 10, 14, 6); ctx.stroke(); ctx.lineWidth = 1;
  }
  if (u.kind === 'animal') drawAnimal(u, px, py);
  else drawPerson(u, px, py);
  if (u.hp < u.maxHp) pillBar(px - 12, py - 27, 24, Math.max(0, u.hp) / u.maxHp, u.hp / u.maxHp > 0.5 ? PAL.green : PAL.red);
}

function drawPerson(u, px, py) {
  const lying = u.downed || u.sleeping;
  const face = facingOf(u), moving = isMoving(u);
  const t = G.tick + u.id * 7;
  const bob = moving ? -Math.abs(Math.sin(t * 0.32)) * 2.5 : Math.sin(t * 0.07) * 0.5;
  const raider = u.kind === 'raider';
  const shirt = raider ? '#e0533d' : u.apparel === 'parka' ? PAL.blue : u.apparel === 'armor' ? '#c98a4b' : u.color;
  const hair = raider ? '#3c3c3c' : shadeColor(u.color, 0.55);

  ctx.fillStyle = 'rgba(0,0,0,0.16)'; ellipse(ctx, px, py + 11, lying ? 13 : 9, 3.5); ctx.fill();
  ctx.save();
  ctx.translate(px, py + bob);
  if (lying) { ctx.translate(0, 5); ctx.rotate(-Math.PI / 2 * face); }
  // 다리
  const step = moving ? Math.sin(t * 0.32) * 2.2 : 0;
  ctx.fillStyle = raider ? '#3c3c3c' : '#5b6170';
  rr(ctx, -6, 6 + Math.max(0, step), 5, 6 - Math.max(0, step), 2.5); ctx.fill();
  rr(ctx, 1, 6 + Math.max(0, -step), 5, 6 - Math.max(0, -step), 2.5); ctx.fill();
  // 몸통
  chunky(ctx, -8, -3, 16, 12, 6, shirt, shadeColor(shirt, 0.78), 3);
  if (u.apparel === 'parka') { ctx.fillStyle = PAL.white; rr(ctx, -8, -4, 16, 4, 2); ctx.fill(); }
  if (u.apparel === 'armor') { ctx.fillStyle = '#a86c33'; rr(ctx, -2, -2, 4, 9, 2); ctx.fill(); }
  // 팔
  const arm = moving ? Math.sin(t * 0.32) * 1.5 : 0;
  ctx.fillStyle = PAL.skin; circle(ctx, -8.5, 3 + arm, 2.6); ctx.fill(); circle(ctx, 8.5, 3 - arm, 2.6); ctx.fill();
  // 머리
  ctx.fillStyle = PAL.skinDk; circle(ctx, 0, -9.5, 8.6); ctx.fill();
  ctx.fillStyle = PAL.skin; circle(ctx, 0, -10.2, 8.3); ctx.fill();
  // 머리카락
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(0, -10.5, 8.6, Math.PI * 1.05, Math.PI * 1.95); ctx.quadraticCurveTo(2 * face, -13, -6 * face, -12); ctx.closePath(); ctx.fill();
  if (!raider) { ctx.beginPath(); ctx.arc(-4 * face, -16, 3.2, 0, Math.PI * 2); ctx.fill(); }
  if (raider) {
    ctx.fillStyle = PAL.red; rr(ctx, -8.6, -16, 17.2, 4.2, 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-7 * face, -14); ctx.lineTo(-12 * face, -11); ctx.lineTo(-10 * face, -15); ctx.closePath(); ctx.fill();
  }
  // 얼굴
  drawEyes(ctx, face * 1.2, -9, face, { closed: u.sleeping && !u.downed, ko: u.downed, angry: raider, spread: 3.1 });
  ctx.fillStyle = 'rgba(255,120,120,0.35)'; circle(ctx, -5.5 + face, -5.5, 1.6); ctx.fill(); circle(ctx, 5.5 + face, -5.5, 1.6); ctx.fill();
  if (!u.sleeping && !u.downed) {
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath();
    if (raider) { ctx.moveTo(face - 1.8, -4.2); ctx.lineTo(face + 1.8, -4.2); }
    else if (u.kind === 'colonist' && G.time < u.breakUntil) { ctx.arc(face, -3.4, 1.8, Math.PI + 0.3, -0.3); }
    else ctx.arc(face, -5.6, 1.8, 0.3, Math.PI - 0.3);
    ctx.stroke(); ctx.lineWidth = 1;
  }
  ctx.restore();

  // 장비/상태 아이콘
  if (u.weapon && !lying) ctx.drawImage(sprite(ITEMS[u.weapon].icon, 32), px + face * 9 - 6, py - 3 + bob, 13, 13);
  if (u.carry) drawItemChip(px, py - 34 + bob, u.carry.type, 0);
  if (u.sleeping) {
    const zt = (G.tick % 60) / 60;
    ctx.font = `900 ${10 + zt * 4}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1 - zt * 0.6; ctx.fillStyle = PAL.white; ctx.strokeStyle = PAL.blueDk; ctx.lineWidth = 3;
    ctx.strokeText('Z', px + 9 + zt * 5, py - 16 - zt * 8); ctx.fillText('Z', px + 9 + zt * 5, py - 16 - zt * 8);
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }
  if (u.drafted) {
    ctx.fillStyle = PAL.redDk; circle(ctx, px - 13, py - 19, 7); ctx.fill();
    ctx.fillStyle = PAL.red; circle(ctx, px - 13, py - 20.5, 7); ctx.fill();
    ctx.drawImage(sprite('⚔️', 32), px - 18, py - 25.5, 10, 10);
  }
  if (u.kind === 'colonist' && G.time < u.breakUntil) ctx.drawImage(sprite('😵', 32), px + 7, py - 30, 14, 14);
  if (u.kind === 'colonist' && cam.zoom > 0.5) {
    pillText(u.name, px, py + 21, { border: u.downed ? PAL.redDk : shadeColor(u.color, 0.75), color: u.downed ? PAL.red : PAL.ink });
  }
}

const ANIMAL_STYLE = {
  deer:   { body: '#d99a5b', dark: '#b07337', belly: '#fbe3c4', scale: 1.0 },
  rabbit: { body: '#f2f2f2', dark: '#cfcfcf', belly: '#ffffff', scale: 0.72 },
  boar:   { body: '#9c6b52', dark: '#74493a', belly: '#c4957c', scale: 1.0 },
  wolf:   { body: '#9aa6bd', dark: '#6f7b93', belly: '#e1e6ef', scale: 1.0 },
  bear:   { body: '#9a5d2e', dark: '#71411d', belly: '#c98a4b', scale: 1.35 },
};

function drawAnimal(u, px, py) {
  const st = ANIMAL_STYLE[u.atype] || ANIMAL_STYLE.deer;
  const face = facingOf(u), moving = isMoving(u);
  const t = G.tick + u.id * 11;
  const bob = moving ? -Math.abs(Math.sin(t * 0.38)) * 2 : 0;
  const sc = st.scale, type = u.atype;
  if (u.manhunter) { ctx.fillStyle = 'rgba(255,75,75,0.25)'; circle(ctx, px, py, 16 * sc); ctx.fill(); }
  if (u.huntDes) { ctx.strokeStyle = PAL.red; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); circle(ctx, px, py, 15 * sc); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
  ctx.fillStyle = 'rgba(0,0,0,0.16)'; ellipse(ctx, px, py + 9 * sc, 11 * sc, 3.5 * sc); ctx.fill();
  ctx.save();
  ctx.translate(px, py + bob);
  ctx.scale(face * sc, sc);
  const legs = moving ? Math.sin(t * 0.38) * 2 : 0;
  ctx.fillStyle = st.dark;
  if (type !== 'rabbit') {
    for (const [lx, ph] of [[-7, 1], [-3, -1], [4, -1], [8, 1]]) { rr(ctx, lx - 1.8, 2, 3.6, 7 + legs * ph * 0.5, 1.8); ctx.fill(); }
  }
  if (type === 'wolf') { ctx.fillStyle = st.body; ctx.save(); ctx.translate(-10, -2); ctx.rotate(-0.6 + legs * 0.08); ellipse(ctx, -3, 0, 5, 2.4); ctx.fill(); ctx.restore(); }
  if (type === 'rabbit') { ctx.fillStyle = PAL.white; circle(ctx, -8, -1, 3.2); ctx.fill(); }
  if (type === 'deer') { ctx.fillStyle = PAL.white; circle(ctx, -10.5, -3, 2.2); ctx.fill(); }
  // 몸통
  ctx.fillStyle = st.dark; ellipse(ctx, 0, 1, type === 'rabbit' ? 8 : 11, type === 'rabbit' ? 7 : 7.5); ctx.fill();
  ctx.fillStyle = st.body; ellipse(ctx, 0, -0.5, type === 'rabbit' ? 8 : 11, type === 'rabbit' ? 6.5 : 6.8); ctx.fill();
  ctx.fillStyle = st.belly; ellipse(ctx, 1, 3, type === 'rabbit' ? 5 : 7, 2.5); ctx.fill();
  if (type === 'deer') { ctx.fillStyle = '#fbe3c4'; circle(ctx, -4, -3, 1.2); ctx.fill(); circle(ctx, 0, -4.5, 1.2); ctx.fill(); circle(ctx, -6.5, -0.5, 1); ctx.fill(); }
  // 머리
  const hx = type === 'rabbit' ? 6 : 10, hy = type === 'rabbit' ? -5 : -6;
  if (type === 'rabbit') {
    ctx.fillStyle = st.dark; ellipse(ctx, hx - 2.5, hy - 8, 2.2, 6); ctx.fill(); ellipse(ctx, hx + 1.5, hy - 8.5, 2.2, 6); ctx.fill();
    ctx.fillStyle = '#ffb3c7'; ellipse(ctx, hx - 2.5, hy - 8, 1, 4.2); ctx.fill(); ellipse(ctx, hx + 1.5, hy - 8.5, 1, 4.2); ctx.fill();
  }
  if (type === 'wolf') {
    ctx.fillStyle = st.dark;
    for (const ex of [-3.5, 2]) { ctx.beginPath(); ctx.moveTo(hx + ex - 2.5, hy - 4); ctx.lineTo(hx + ex, hy - 11); ctx.lineTo(hx + ex + 2.5, hy - 4); ctx.closePath(); ctx.fill(); }
  }
  if (type === 'bear') { ctx.fillStyle = st.dark; circle(ctx, hx - 4.5, hy - 5.5, 3); ctx.fill(); circle(ctx, hx + 3.5, hy - 5.5, 3); ctx.fill(); }
  if (type === 'deer') {
    ctx.strokeStyle = '#a86c33'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx - 1, hy - 5); ctx.lineTo(hx - 3, hy - 12); ctx.lineTo(hx - 6, hy - 14); ctx.moveTo(hx - 3, hy - 10); ctx.lineTo(hx, hy - 13);
    ctx.moveTo(hx + 2, hy - 5); ctx.lineTo(hx + 3, hy - 11); ctx.lineTo(hx + 6, hy - 13); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = st.dark; ellipse(ctx, hx - 6, hy - 3, 3, 1.6); ctx.fill();
  }
  ctx.fillStyle = st.dark; circle(ctx, hx, hy + 0.8, 6.3); ctx.fill();
  ctx.fillStyle = st.body; circle(ctx, hx, hy, 6); ctx.fill();
  // 주둥이
  if (type === 'boar') {
    ctx.fillStyle = '#e8a59a'; ellipse(ctx, hx + 5, hy + 2, 3.2, 2.8); ctx.fill();
    ctx.fillStyle = '#b5675d'; circle(ctx, hx + 4.2, hy + 1.8, 0.7); ctx.fill(); circle(ctx, hx + 6, hy + 1.8, 0.7); ctx.fill();
    ctx.fillStyle = PAL.white; ctx.beginPath(); ctx.moveTo(hx + 2, hy + 4); ctx.lineTo(hx + 3.5, hy); ctx.lineTo(hx + 4, hy + 4); ctx.closePath(); ctx.fill();
  } else if (type === 'wolf' || type === 'bear') {
    ctx.fillStyle = st.belly; ellipse(ctx, hx + 4, hy + 2.5, 3.6, 2.6); ctx.fill();
    ctx.fillStyle = PAL.ink; circle(ctx, hx + 6.6, hy + 1.6, 1.2); ctx.fill();
  } else {
    ctx.fillStyle = type === 'rabbit' ? '#ff86a8' : PAL.ink; circle(ctx, hx + 5.6, hy + 1.2, 1); ctx.fill();
  }
  // 눈 (한쪽 측면이므로 하나)
  ctx.fillStyle = PAL.white; ellipse(ctx, hx + 1.5, hy - 1.2, 2.2, 2.6); ctx.fill();
  ctx.fillStyle = u.manhunter ? PAL.redDk : PAL.ink; circle(ctx, hx + 2.2, hy - 0.8, 1.4); ctx.fill();
  ctx.fillStyle = PAL.white; circle(ctx, hx + 1.7, hy - 1.4, 0.5); ctx.fill();
  if (u.manhunter || !ANIMALS[type].passive) {
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx - 1, hy - 4.6); ctx.lineTo(hx + 3.5, hy - 3.4); ctx.stroke(); ctx.lineWidth = 1;
  }
  ctx.restore();
}

function drawFx(f) {
  if (f.type === 'shot') {
    ctx.globalAlpha = f.life / 6; ctx.lineCap = 'round';
    ctx.strokeStyle = PAL.white; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(f.x0 * TILE, f.y0 * TILE); ctx.lineTo(f.x1 * TILE, f.y1 * TILE); ctx.stroke();
    ctx.strokeStyle = f.color === '#9be7ff' ? PAL.blue : f.color === '#ffe28a' ? PAL.yellow : PAL.red; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(f.x0 * TILE, f.y0 * TILE); ctx.lineTo(f.x1 * TILE, f.y1 * TILE); ctx.stroke();
    ctx.lineWidth = 1; ctx.globalAlpha = 1;
  } else if (f.type === 'slash') {
    ctx.globalAlpha = f.life / 8; ctx.lineCap = 'round';
    ctx.strokeStyle = PAL.white; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(f.x * TILE, f.y * TILE, 10 + (8 - f.life), -1, 1); ctx.stroke();
    ctx.strokeStyle = PAL.yellow; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.x * TILE, f.y * TILE, 10 + (8 - f.life), -1, 1); ctx.stroke();
    ctx.lineWidth = 1; ctx.globalAlpha = 1;
  } else if (f.type === 'text') {
    const p = 1 - f.life / 30, pop = p < 0.15 ? 0.7 + p * 2 : 1;
    ctx.globalAlpha = Math.min(1, f.life / 12);
    ctx.font = `900 ${Math.round(13 * pop)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const x = f.x * TILE, y = f.y * TILE - (30 - f.life) * 0.6;
    ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = PAL.white; ctx.strokeText(f.text, x, y);
    ctx.fillStyle = f.color === '#ff6b6b' ? PAL.red : f.color === '#ccc' ? PAL.inkSoft : f.color;
    ctx.fillText(f.text, x, y);
    ctx.lineWidth = 1; ctx.globalAlpha = 1;
  } else if (f.type === 'spark') {
    ctx.globalAlpha = f.life / 6;
    for (let k = 0; k < 4; k++) { ctx.fillStyle = k % 2 ? PAL.yellow : PAL.orange; circle(ctx, f.x * TILE + (rand() - 0.5) * 18, f.y * TILE + (rand() - 0.5) * 18, 1.8); ctx.fill(); }
    ctx.globalAlpha = 1;
  } else if (f.type === 'boom') {
    const r = (40 - f.life) * 1.5;
    ctx.globalAlpha = f.life / 40;
    ctx.fillStyle = 'rgba(255,200,0,0.35)'; circle(ctx, f.x * TILE, f.y * TILE, r); ctx.fill();
    ctx.strokeStyle = PAL.orange; ctx.lineWidth = 4; circle(ctx, f.x * TILE, f.y * TILE, r); ctx.stroke();
    ctx.lineWidth = 1; ctx.globalAlpha = 1;
  }
}

function drawOverlay() {
  // 선택된 건물
  if (UI.selected && UI.selected.kind === 'struct') {
    const s = UI.selected.ref;
    ctx.strokeStyle = PAL.blue; ctx.lineWidth = 3; rr(ctx, s.x * TILE - 1, s.y * TILE - 1, TILE + 2, TILE + 2, 8); ctx.stroke(); ctx.lineWidth = 1;
    if (BUILD[s.type].turret) {
      ctx.fillStyle = 'rgba(28,176,246,0.08)'; circle(ctx, s.x * TILE + 16, s.y * TILE + 16, WEAPONS.turret.range * TILE); ctx.fill();
      ctx.strokeStyle = 'rgba(28,176,246,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
  }
  // 선택된 정착민 경로 / 사거리
  if (UI.selected && UI.selected.kind !== 'struct') {
    const u = unitById(UI.selected.id);
    if (u && u.path && u.path.length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.setLineDash([2, 7]);
      ctx.beginPath(); ctx.moveTo(u.x * TILE, u.y * TILE);
      for (const i of u.path) ctx.lineTo(cx_(i) * TILE + 16, cy_(i) * TILE + 16);
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      const last = u.path[u.path.length - 1];
      ctx.fillStyle = PAL.blue; circle(ctx, cx_(last) * TILE + 16, cy_(last) * TILE + 16, 4); ctx.fill();
    }
    if (u && u.drafted && !weaponOf(u).melee) {
      ctx.fillStyle = 'rgba(255,200,0,0.07)'; circle(ctx, u.x * TILE, u.y * TILE, weaponOf(u).range * TILE); ctx.fill();
      ctx.strokeStyle = 'rgba(229,164,0,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
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
    const danger = UI.tool.id === 'cancel' || UI.tool.id === 'clearzone' || UI.tool.id === 'deconstruct';
    const col = UI.tool.type === 'build' ? PAL.blue : danger ? PAL.red : PAL.green;
    ctx.fillStyle = col; ctx.globalAlpha = 0.3;
    for (const [x, y] of cells) { rr(ctx, x * TILE + 1.5, y * TILE + 1.5, TILE - 3, TILE - 3, 6); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (UI.drag) { ctx.strokeStyle = col; ctx.lineWidth = 2.5; rr(ctx, rx0 * TILE, ry0 * TILE, (rx1 - rx0 + 1) * TILE, (ry1 - ry0 + 1) * TILE, 8); ctx.stroke(); ctx.lineWidth = 1; }
    let txt = null;
    if (UI.tool.type === 'build') {
      const cost = BUILD[UI.tool.id].cost, n = cells.length;
      txt = Object.keys(cost).map(k => `${ITEMS[k].name} ${cost[k] * n}`).join(', ');
    } else if (UI.drag) txt = `${rx1 - rx0 + 1}×${ry1 - ry0 + 1}`;
    if (txt) {
      ctx.font = `800 12px ${FONT}`;
      const w = ctx.measureText(txt).width;
      pillText(txt, (tx + 1) * TILE + w / 2 + 10, ty * TILE - 6, { size: 12, border: shadeColor(col, 0.85), color: shadeColor(col, 0.75) });
    }
  } else if (inb(tx, ty)) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; rr(ctx, tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2, 6); ctx.stroke(); ctx.lineWidth = 1;
  }
}

function drawTempOverlay(x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = tempAt(x + 0.5, y + 0.5);
    const f = clamp((t + 20) / 60, 0, 1);
    ctx.fillStyle = `hsla(${(1 - f) * 210},95%,60%,0.38)`;
    ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
  }
  for (const r of G.rooms) {
    if (!r || r.outdoor || !r.cells.length) continue;
    const i = r.cells[Math.floor(r.cells.length / 2)];
    const cold = r.temp < 10, hot = r.temp > 30;
    pillText(Math.round(r.temp) + '°C', cx_(i) * TILE + 16, cy_(i) * TILE + 16, { size: 12, color: cold ? PAL.blueDk : hot ? PAL.redDk : PAL.ink, border: cold ? PAL.blueLt : hot ? '#ffb3b3' : PAL.line });
  }
}
