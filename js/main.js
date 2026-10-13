'use strict';
// ===== 새 게임 =====
const SAVE_KEY = 'rimsurvival_save_v1';

function newGame(seed, quiet) {
  seed = seed || (Date.now() & 0xffffff);
  rng = mulberry32(seed);
  G = {
    seed, cells: null, units: [], structures: [], rooms: null, reserved: new Map(), unreach: new Map(), fx: [], logs: [],
    tick: 0, time: 7 * 60, speed: 1, paused: false, nextId: 1, colorIdx: 0, stockCells: [], stockDirty: true, stock: {},
    fires: [], weather: null, nextRaid: DAY_MIN * 2.6, nextEvent: DAY_MIN * 0.8, scheduled: [], raids: [], graves: [],
    stats: { kills: 0, raids: 0 }, home: null, gameOver: false, roomsDirty: false, lastDay: 1,
  };
  G.cells = generateMap(seed);
  G.home = findStart();
  const hx = G.home.x, hy = G.home.y;
  // 시작 비축 구역 + 물자
  for (let y = hy - 1; y <= hy + 2; y++) for (let x = hx + 2; x <= hx + 6; x++) {
    const c = cellAt(x, y); c.zone = 1; c.res = null; if (c.t === T.WATER) c.t = T.GRASS;
  }
  rebuildStockCells();
  const start = [['wood', 75], ['wood', 75], ['meal', 20], ['berries', 40], ['steel', 50], ['medicine', 6], ['stone', 40], ['leather', 20]];
  let k = 0;
  for (const [type, n] of start) { const i = G.stockCells[k++]; G.cells[i].item = { type, n }; }
  // 정착민 3명
  const gear = ['bow', 'spear', 'club'];
  for (let i = 0; i < 3; i++) {
    const c = makeColonist(hx - 1 + i, hy);
    c.weapon = gear[i];
    G.units.push(c);
  }
  // 야생 동물
  for (let i = 0; i < 10; i++) {
    for (let t = 0; t < 30; t++) {
      const x = randi(2, MAP_W - 3), y = randi(2, MAP_H - 3);
      if (dist(x, y, hx, hy) > 12 && !blocksMove(G.cells[idx(x, y)], false)) { G.units.push(makeAnimal(x, y, pick(['deer', 'deer', 'rabbit', 'rabbit', 'boar']), false)); break; }
    }
  }
  recomputeRooms();
  refreshFires();
  buildTerrainCanvas();
  resize();
  cam.zoom = 1;
  centerCam(hx, hy);
  UI.selected = null; UI.tool = null; UI.lastHtml = {}; UI.modalQueue = [];
  if (UI.modalOpen) { UI.modalOpen = null; $('modal').classList.add('hidden'); }
  log('🛬 추락한 우주선에서 살아남은 3명이 이 낯선 행성에 정착을 시작합니다.', 'good');
  if (!quiet) showIntro();
  renderBuildMenu();
  refreshPanels();
}
function showIntro() {
  alertModal('🛬 생존의 시작',
    '우주선이 추락했습니다. 살아남은 3명의 정착민과 함께 이 행성에서 버텨야 합니다.\n\n' +
    '• 먹고(허기), 자고(수면), 따뜻하게(체온) 지내야 합니다.\n' +
    '• 벌목·채굴로 자원을 모으고 비축 구역에 쌓으세요.\n' +
    '• 벽과 문으로 방을 만들고 침대·모닥불을 놓으세요.\n' +
    '• 3일째부터 약탈자가 습격합니다. 겨울(19일~)은 혹독합니다.\n' +
    '• 이벤트로 새 동료가 합류할 수 있습니다.\n\n' +
    '도움말(?) 버튼에서 조작법을 확인하세요.');
}

// ===== 시뮬레이션 =====
function updateWorldCells(dtMin) {
  const out = outdoorTemp();
  for (const c of G.cells) {
    if (c.crop) {
      if (out < -8) { c.crop = null; continue; }
      if (out > 2 && c.crop.g < 1) c.crop.g += dtMin / (DAY_MIN * 4) * Math.max(0.4, c.fert);
    }
    if (c.res && c.res.grown === false && G.time >= c.res.regrowAt && out > 0) c.res.grown = true;
  }
}

function tick() {
  G.tick++;
  G.time += MIN_PER_TICK;
  if (G.roomsDirty) recomputeRooms();
  if (G.tick % 10 === 0) { updateTemperatures(MIN_PER_TICK * 10); updateWorldCells(MIN_PER_TICK * 10); }
  for (let i = 0; i < G.units.length; i++) {
    const u = G.units[i];
    if (u.dead) continue;
    if (u.kind === 'colonist') updateColonist(u);
    else if (u.kind === 'raider') updateRaider(u);
    else updateAnimal(u);
  }
  for (const s of G.structures) if (s.built && BUILD[s.type].turret) updateTurret(s);
  for (const f of G.fx) f.life--;
  G.fx = G.fx.filter(f => f.life > 0);
  if (G.tick % 60 === 0) {
    G.units = G.units.filter(u => !u.dead);
    for (const [k, v] of G.unreach) if (v < G.tick) G.unreach.delete(k);
  }
  if (G.tick % 20 === 0) updateStoryteller();
  const day = dayNum();
  if (day !== G.lastDay) {
    G.lastDay = day;
    log(`🌅 ${day}일차가 밝았습니다. (${SEASONS[seasonIndex(G.time)].name})`);
    if ((day - 1) % SEASON_DAYS === 0) log(`계절이 ${SEASONS[seasonIndex(G.time)].name}(으)로 바뀌었습니다.`, 'warn');
    saveGame(true);
  }
  if (!colonists().length && !G.gameOver) gameOver();
}

function gameOver() {
  G.gameOver = true; G.paused = true;
  $('go-text').innerHTML = `모든 정착민이 사망했습니다.<br><br>생존 일수: <b>${dayNum()}일</b><br>격퇴한 적: <b>${G.stats.kills}</b><br>겪은 습격: <b>${G.stats.raids}회</b><br><br>` +
    `<div class="muted">추모: ${G.graves.map(g => `${g.name}(${g.day}일)`).join(', ')}</div>`;
  $('gameover').classList.remove('hidden');
}

// ===== 저장 / 불러오기 =====
function saveGame(silent) {
  try {
    const data = {
      v: 1, seed: G.seed, tick: G.tick, time: G.time, speed: G.speed, nextId: G.nextId, colorIdx: G.colorIdx,
      weather: G.weather, nextRaid: G.nextRaid, nextEvent: G.nextEvent, scheduled: G.scheduled, raids: G.raids,
      graves: G.graves, stats: G.stats, home: G.home, lastDay: G.lastDay, logs: G.logs.slice(-30),
      cells: G.cells.map(c => [c.t, c.res, c.item, c.zone, c.des, c.crop, c.fert]),
      structures: G.structures,
      units: G.units.filter(u => !u.dead).map(u => Object.assign({}, u, { job: null, path: null, pathGoal: null, carriedBy: null, sleeping: false, inBed: u.downed ? u.inBed : null })),
      rooms: G.rooms.map(r => r && !r.outdoor ? { temp: r.temp, cell: r.cells[0] } : null),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (!silent) flash('저장되었습니다.');
  } catch (e) { if (!silent) flash('저장 실패: ' + e.message); }
}
function loadGame() {
  let data;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; }
  if (!data) { flash('저장된 게임이 없습니다.'); return; }
  rng = mulberry32((data.seed + data.tick) | 0);
  G = {
    seed: data.seed, cells: [], units: data.units, structures: data.structures, rooms: null, reserved: new Map(), unreach: new Map(),
    fx: [], logs: data.logs || [], tick: data.tick, time: data.time, speed: data.speed, paused: true, nextId: data.nextId,
    colorIdx: data.colorIdx, stockCells: [], stockDirty: true, stock: {}, fires: [], weather: data.weather, nextRaid: data.nextRaid,
    nextEvent: data.nextEvent, scheduled: data.scheduled || [], raids: data.raids || [], graves: data.graves || [], stats: data.stats,
    home: data.home, gameOver: false, roomsDirty: false, lastDay: data.lastDay,
  };
  G.cells = data.cells.map(a => { const c = newCell(); [c.t, c.res, c.item, c.zone, c.des, c.crop, c.fert] = a; return c; });
  for (const s of G.structures) G.cells[idx(s.x, s.y)].st = s;
  // 방 온도 복원
  G.rooms = [];
  recomputeRooms();
  for (const r of data.rooms || []) {
    if (!r) continue;
    const nr = G.rooms[G.cells[r.cell] ? G.cells[r.cell].room : 0];
    if (nr && !nr.outdoor) nr.temp = r.temp;
  }
  rebuildStockCells();
  refreshFires();
  buildTerrainCanvas();
  resize();
  const c0 = colonists()[0];
  centerCam(c0 ? c0.x : G.home.x, c0 ? c0.y : G.home.y);
  UI.selected = null; UI.tool = null; UI.lastHtml = {}; UI.logDirty = true;
  $('gameover').classList.add('hidden');
  renderBuildMenu(); refreshPanels();
  flash('불러왔습니다. (일시정지 상태)');
}

// ===== 메인 루프 =====
let lastT = performance.now(), acc = 0, panelT = 0;
const SPEED_TPS = [0, TICKS_PER_SEC, TICKS_PER_SEC * 2.5, TICKS_PER_SEC * 5];
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  panKeys(dt);
  if (!G.paused && !G.gameOver) {
    acc += dt * SPEED_TPS[G.speed];
    let n = 0;
    while (acc >= 1 && n < 40) { tick(); acc -= 1; n++; }
    if (n >= 40) acc = 0;
  }
  if (G.camTo) { centerCam(G.camTo.x, G.camTo.y); G.camTo = null; }
  render();
  panelT += dt;
  if (panelT > 0.25) { panelT = 0; refreshPanels(); renderHover(); if (G.tick % 40 < 20) renderBuildMenuCosts(); }
  if (flashT > 0 && --flashT === 0) $('flash').classList.remove('show');
  $('pause-ind').classList.toggle('hidden', !G.paused || !!UI.modalOpen || G.gameOver);
  requestAnimationFrame(frame);
}
function renderBuildMenuCosts() {
  // 자원 변화에 따라 버튼의 '부족' 표시 갱신
  document.querySelectorAll('#tools button[data-type="build"]').forEach(b => b.classList.toggle('poor', !canAfford(BUILD[b.dataset.id].cost)));
}

window.addEventListener('load', () => {
  setupInput();
  resize();
  let loaded = false;
  try { loaded = !!localStorage.getItem(SAVE_KEY); } catch (e) { }
  newGame(undefined, loaded);
  if (loaded) {
    choiceModal('💾 저장된 게임', '이전에 저장된 게임이 있습니다. 이어서 할까요?', [
      { label: '이어하기', fn() { setTimeout(loadGame, 0); } },
      { label: '새로 시작', fn() { showIntro(); } },
    ]);
  }
  requestAnimationFrame(frame);
});
