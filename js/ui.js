'use strict';
// ===== UI 상태 =====
const UI = {
  selected: null, tool: null, mouse: { x: 0, y: 0, inside: false }, drag: null,
  tempOverlay: false, cat: 'orders', modalQueue: [], modalOpen: false, lastHtml: {},
};
const $ = id => document.getElementById(id);

function log(msg, type = '') {
  const day = G ? dayNum() : 1;
  G.logs.push({ msg, type, day });
  if (G.logs.length > 80) G.logs.shift();
  UI.logDirty = true;
}

// ===== 모달 =====
function alertModal(title, text, important) {
  UI.modalQueue.push({ title, text, options: [{ label: '확인', fn() {} }], important });
  showNextModal();
}
function choiceModal(title, text, options, rerender) {
  UI.modalQueue.push({ title, text, options, rerender });
  showNextModal();
}
function showNextModal() {
  if (UI.modalOpen || !UI.modalQueue.length) return;
  const m = UI.modalQueue.shift();
  UI.modalOpen = m;
  UI.wasPaused = G.paused;
  G.paused = true;
  renderModal(m);
  $('modal').classList.remove('hidden');
}
function renderModal(m) {
  $('modal-title').textContent = m.title;
  $('modal-text').textContent = m.text;
  $('modal-btns').innerHTML = m.options.map((o, i) => `<button data-act="modal" data-i="${i}" ${o.disabled ? 'disabled' : ''}>${o.label}</button>`).join('');
}
function modalChoose(i) {
  const m = UI.modalOpen; if (!m) return;
  const o = m.options[i]; if (!o || o.disabled) return;
  o.fn();
  if (UI.modalOpen !== m) return; // fn 안에서 새 게임 등으로 모달이 교체됨
  if (o.keep && m.rerender) { m.options = m.rerender(); renderModal(m); return; }
  $('modal').classList.add('hidden');
  UI.modalOpen = null;
  G.paused = UI.wasPaused;
  showNextModal();
}

// ===== 빌드 메뉴 =====
function renderBuildMenu() {
  $('cats').innerHTML = BUILD_CATS.map(c => `<button data-act="cat" data-id="${c.id}" class="${UI.cat === c.id ? 'on' : ''}">${c.name}</button>`).join('');
  let items = [];
  if (UI.cat === 'orders') items = ORDERS.map(o => ({ type: 'order', id: o.id, name: o.name, desc: o.desc }));
  else if (UI.cat === 'zones') items = ZONES.map(o => ({ type: 'zone', id: o.id, name: o.name, desc: o.desc }));
  else items = Object.keys(BUILD).filter(k => BUILD[k].cat === UI.cat).map(k => ({ type: 'build', id: k, name: BUILD[k].name, desc: BUILD[k].desc + '\n비용: ' + costText(BUILD[k].cost) }));
  $('tools').innerHTML = items.map(t => {
    const on = UI.tool && UI.tool.id === t.id;
    const afford = t.type !== 'build' || canAfford(BUILD[t.id].cost);
    return `<button data-act="tool" data-type="${t.type}" data-id="${t.id}" class="${on ? 'on' : ''} ${afford ? '' : 'poor'}" title="${t.desc}">${t.name}${t.type === 'build' ? `<small>${costText(BUILD[t.id].cost)}</small>` : ''}</button>`;
  }).join('');
}
function inText(cost) { return Object.keys(cost).map(k => `${k === 'raw' ? '날음식' : ITEMS[k].name}${cost[k]}`).join(' '); }
function costText(cost) { return Object.keys(cost).map(k => `${ITEMS[k].name}${cost[k]}`).join(' '); }

function toolCells(x0, y0, x1, y1) {
  const out = [];
  const t = UI.tool;
  if (!t) return out;
  if (t.type === 'build') {
    const d = BUILD[t.id];
    if (d.wall || d.cover || d.trap) {
      if (x1 - x0 > 0 && y1 - y0 > 0) {
        for (let x = x0; x <= x1; x++) { out.push([x, y0]); out.push([x, y1]); }
        for (let y = y0 + 1; y < y1; y++) { out.push([x0, y]); out.push([x1, y]); }
      } else for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
    } else out.push([x1 === x0 ? x0 : (UI.drag ? UI.drag.x : x0), y1 === y0 ? y0 : (UI.drag ? UI.drag.y : y0)]);
    return out.filter(([x, y]) => inb(x, y));
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) out.push([x, y]);
  return out;
}

function applyTool(x0, y0, x1, y1) {
  const t = UI.tool;
  const cells = toolCells(x0, y0, x1, y1);
  let changed = 0;
  if (t.type === 'build') {
    for (const [x, y] of cells) if (placeBlueprint(x, y, t.id)) changed++;
    if (!changed) flash('여기에 건설할 수 없습니다.');
  } else if (t.type === 'zone') {
    for (const [x, y] of cells) {
      const c = G.cells[idx(x, y)];
      if (t.id === 'clearzone') { c.zone = 0; c.crop = null; changed++; continue; }
      if (c.t === T.WATER || (c.res && RES[c.res.type].blocks) || (c.st && c.st.built && BUILD[c.st.type].blocks)) continue;
      if (t.id === 'stockpile') { c.zone = 1; c.crop = null; changed++; }
      if (t.id === 'farm' && c.fert > 0 && !c.st) { c.zone = 2; changed++; if (c.res && !RES[c.res.type].blocks) c.des = 'chop'; }
    }
    rebuildStockCells();
  } else if (t.type === 'order') {
    const id = t.id;
    if (id === 'hunt' || id === 'cancel') {
      for (const a of G.units) {
        if (a.kind !== 'animal' || a.dead) continue;
        const ax = Math.floor(a.x), ay = Math.floor(a.y);
        if (ax >= x0 - (x0 === x1 ? 1 : 0) && ax <= x1 + (x0 === x1 ? 1 : 0) && ay >= y0 - (y0 === y1 ? 1 : 0) && ay <= y1 + (y0 === y1 ? 1 : 0)) { a.huntDes = id === 'hunt'; changed++; }
      }
    }
    for (const [x, y] of cells) {
      const c = G.cells[idx(x, y)];
      if (id === 'chop' && c.res && (c.res.type === 'tree' || c.res.type === 'pine')) { c.des = 'chop'; changed++; }
      if (id === 'mine' && c.res && RES[c.res.type].job === 'mine') { c.des = 'mine'; changed++; }
      if (id === 'harvest' && c.res && RES[c.res.type].job === 'harvest') { c.des = 'harvest'; changed++; }
      if (id === 'deconstruct' && c.st) {
        if (c.st.built) c.des = 'deconstruct'; else removeStructure(c.st, c.st.paid ? 1 : 0);
        changed++;
      }
      if (id === 'cancel') {
        if (c.des) { c.des = null; changed++; }
        if (c.st && !c.st.built) { removeStructure(c.st, c.st.paid ? 1 : 0); changed++; }
      }
    }
  }
}

let flashT = 0;
function flash(msg) { $('flash').textContent = msg; $('flash').classList.add('show'); flashT = 60; }

// ===== 선택 =====
function selectAt(wx, wy) {
  let best = null, bd = 0.8;
  for (const u of G.units) {
    if (u.dead) continue;
    const d = dist(u.x, u.y, wx, wy) - (u.kind === 'colonist' ? 0.2 : 0);
    if (d < bd) { bd = d; best = u; }
  }
  if (best) { UI.selected = { kind: best.kind, id: best.id }; return; }
  const c = cellAt(Math.floor(wx), Math.floor(wy));
  if (c && c.st) { UI.selected = { kind: 'struct', ref: c.st }; return; }
  UI.selected = null;
}
function selectedUnit() { return UI.selected && UI.selected.kind !== 'struct' ? unitById(UI.selected.id) : null; }

function rightClick(wx, wy) {
  if (UI.tool) { UI.tool = null; UI.drag = null; renderBuildMenu(); return; }
  const u = selectedUnit();
  if (!u || u.kind !== 'colonist' || u.downed) return;
  if (!u.drafted) { setDraft(u, true); }
  const tx = Math.floor(wx), ty = Math.floor(wy);
  const enemy = G.units.find(o => !o.dead && hostileOrPrey(u, o) && dist(o.x, o.y, wx, wy) < 0.8);
  if (enemy) { u.order = { type: 'attack', id: enemy.id }; u.path = null; u.pathGoal = null; G.fx.push({ type: 'text', x: enemy.x, y: enemy.y - 1, text: '공격', life: 25, color: '#ff7675' }); return; }
  const c = cellAt(tx, ty);
  if (!c || blocksMove(c, false)) return;
  u.order = { type: 'move', x: tx, y: ty }; u.path = null; u.pathGoal = null;
  G.fx.push({ type: 'text', x: tx + 0.5, y: ty + 0.5, text: '▼', life: 20, color: '#fff' });
}
function hostileOrPrey(u, o) { return hostile(u, o) || o.kind === 'animal' || o.faction === 'enemy'; }
function setDraft(u, v) {
  if (u.downed || u.dead) return;
  if (v && G.time < u.breakUntil) { flash(`${u.name}은(는) 정신이상 상태입니다.`); return; }
  u.drafted = v; u.order = null;
  endJob(u);
}
function draftAll() {
  const cs = colonists().filter(c => !c.downed);
  const any = cs.some(c => !c.drafted);
  cs.forEach(c => setDraft(c, any));
  flash(any ? '전원 소집!' : '소집 해제');
}

// ===== 패널 렌더 =====
const JOB_NAMES = {
  wander: '배회', flee: '도망', eat: '식사', sleep: '수면', comfort: '체온 조절', equip: '장비 착용', gather: '채집/채굴', build: '건설',
  deconstruct: '철거', farm: '농사', haul: '운반', craft: '제작', hunt: '사냥', treat: '치료', rescue: '구조', feed: '환자 급식', fight: '싸움',
};
function activityOf(u) {
  if (u.dead) return '사망';
  if (u.downed) return u.inBed ? '요양 중' : '쓰러짐';
  if (u.carriedBy) return '운반되는 중';
  if (G.time < u.breakUntil) return '정신이상: 방황';
  if (u.drafted) return u.order ? (u.order.type === 'move' ? '소집: 이동' : '소집: 공격') : '소집: 대기';
  if (!u.job) return '대기';
  if (u.job.type === 'gather') { const c = G.cells[u.job.cell]; return c.res ? (RES[c.res.type].job === 'mine' ? '채굴' : RES[c.res.type].job === 'chop' ? '벌목' : '채집') : '채집'; }
  if (u.job.type === 'craft') { const s = G.structures.find(s => s.id === u.job.sid); const b = s && s.bills.find(b => b.id === u.job.bill); return b ? RECIPES[b.recipe].name + ' 제작' : '제작'; }
  return JOB_NAMES[u.job.type] || u.job.type;
}
function bar(v, cls) { return `<div class="bar ${cls}"><i style="width:${Math.round(clamp(v, 0, 1) * 100)}%"></i></div>`; }
function tempState(u) {
  if (u.hypo > 1) return '<span class="bad">저체온증!</span>';
  if (u.hypo > 0.3) return '<span class="warn">추움</span>';
  if (u.heatst > 1) return '<span class="bad">열사병!</span>';
  if (u.heatst > 0.3) return '<span class="warn">더움</span>';
  return '';
}

function setHtml(id, html) { if (UI.lastHtml[id] !== html) { UI.lastHtml[id] = html; $(id).innerHTML = html; } }

function renderTop() {
  const day = dayNum(), si = seasonIndex(G.time);
  const h = Math.floor((G.time % DAY_MIN) / 60), m = Math.floor(G.time % 60);
  const temp = outdoorTemp();
  let html = `<span class="date">${day}일차 · ${SEASONS[si].name} · ${String(h).padStart(2, '0')}:${String(m - m % 10).padStart(2, '0')}</span>`;
  html += `<span class="temp ${temp < 0 ? 'cold' : temp > 32 ? 'hot' : ''}">🌡 ${temp.toFixed(0)}°C</span>`;
  if (G.weather) html += `<span class="weather">${G.weather.name}</span>`;
  setHtml('time', html);
  const res = RES_DISPLAY.map(k => {
    const n = stockOf(k);
    const name = k === 'raw' ? '날음식' : ITEMS[k].name, icon = k === 'raw' ? '🍖' : ITEMS[k].icon;
    return `<span class="res ${k === 'meal' || k === 'raw' ? (stockOf('meal') * 18 + stockOf('raw') < colonists().length * 20 ? 'low' : '') : ''}" title="${name}">${icon} ${n}</span>`;
  }).join('');
  setHtml('resources', res);
  setHtml('speed', [0, 1, 2, 3].map(s => `<button data-act="speed" data-s="${s}" class="${(s === 0 ? G.paused : !G.paused && G.speed === s) ? 'on' : ''}">${['⏸', '▶', '▶▶', '▶▶▶'][s]}</button>`).join(''));
}

function renderColonists() {
  const cs = colonists();
  const html = cs.map(u => {
    const sel = UI.selected && UI.selected.id === u.id;
    return `<div class="card ${sel ? 'sel' : ''} ${u.downed ? 'down' : ''}" data-act="selcol" data-id="${u.id}">
      <div class="row"><span class="dot" style="background:${u.color}"></span><b>${u.name}</b>
      <button class="draft ${u.drafted ? 'on' : ''}" data-act="draft" data-id="${u.id}" title="소집 (F)">⚔</button></div>
      <div class="act">${activityOf(u)} ${tempState(u)}</div>
      <div class="bars">
        <label>체력</label>${bar(u.hp / u.maxHp, 'hp')}
        <label>허기</label>${bar(u.food, 'food')}
        <label>수면</label>${bar(u.rest, 'rest')}
        <label>기분</label>${bar(u.mood, 'mood')}
      </div></div>`;
  }).join('');
  setHtml('colonists', `<div class="head">정착민 ${cs.length}명 <button data-act="draftall" title="R">전원 소집</button></div>` + html);
}

function renderInfo() {
  const sel = UI.selected;
  let html = '';
  if (sel && sel.kind === 'struct') {
    const s = sel.ref;
    if (!G.structures.includes(s)) { UI.selected = null; setHtml('info', ''); $('info').classList.add('hidden'); return; }
    const d = BUILD[s.type];
    html += `<h3>${d.name}${s.built ? '' : ' (청사진)'}</h3><div class="desc">${d.desc}</div>`;
    html += `<div>내구도: ${Math.round(s.hp)} / ${d.hp}</div>`;
    if (!s.built) html += `<div>비용: ${costText(d.cost)} ${s.paid ? '(지불됨)' : canAfford(d.cost) ? '' : '<span class="bad">(자원 부족)</span>'}</div><div>진행: ${Math.round(s.work / d.work * 100)}%</div>`;
    if (d.bed && s.owner) { const o = unitById(s.owner); if (o) html += `<div>주인: ${o.name}</div>`; }
    const r = G.rooms[G.cells[idx(s.x, s.y)].room];
    html += `<div>위치 온도: ${tempAt(s.x + 0.5, s.y + 0.5).toFixed(1)}°C ${r && !r.outdoor ? '(실내)' : '(실외)'}</div>`;
    if (s.built && d.station) {
      html += `<h4>작업 목록</h4>`;
      if (!s.bills.length) html += '<div class="muted">작업 없음</div>';
      for (const b of s.bills) {
        const rec = RECIPES[b.recipe];
        const modeTxt = b.mode === 'count' ? `${b.n}개 만들기` : b.mode === 'until' ? `${b.n}개 유지` : '계속 반복';
        html += `<div class="bill ${b.paused ? 'paused' : ''}"><b>${rec.name}</b> <span class="muted">(${inText(rec.in)})</span><br>
          <button data-act="bill" data-op="mode" data-b="${b.id}">${modeTxt}</button>
          <button data-act="bill" data-op="dec" data-b="${b.id}">-</button><button data-act="bill" data-op="inc" data-b="${b.id}">+</button>
          <button data-act="bill" data-op="pause" data-b="${b.id}">${b.paused ? '재개' : '중지'}</button>
          <button data-act="bill" data-op="del" data-b="${b.id}">✕</button>
          ${canAfford(rec.in) ? '' : '<span class="bad">재료 부족</span>'}</div>`;
      }
      html += `<div class="addbill">` + Object.keys(RECIPES).filter(k => RECIPES[k].station === d.station).map(k => `<button data-act="addbill" data-r="${k}">+ ${RECIPES[k].name}</button>`).join('') + '</div>';
    }
    html += `<div class="btns"><button data-act="decon">${s.built ? '철거 지정' : '청사진 취소'}</button></div>`;
  } else if (sel) {
    const u = unitById(sel.id);
    if (!u) { UI.selected = null; setHtml('info', ''); $('info').classList.add('hidden'); return; }
    if (u.kind === 'colonist') {
      const tr = TRAITS.find(t => t.id === u.trait);
      const [lo, hi] = comfortRange(u);
      html += `<h3><span class="dot" style="background:${u.color}"></span>${u.name} <small>${u.age}세</small></h3>`;
      html += `<div class="muted">${activityOf(u)}</div>`;
      html += `<div>특성: <b title="${tr.desc}">${tr.name}</b> <span class="muted">${tr.desc}</span></div>`;
      html += `<div>체력 ${Math.round(u.hp)}/${u.maxHp} · 허기 ${Math.round(u.food * 100)}% · 수면 ${Math.round(u.rest * 100)}% · 기분 ${Math.round(u.mood * 100)}%</div>`;
      html += `<div>현재 온도 ${(u.curTemp ?? 0).toFixed(1)}°C · 쾌적 ${lo}~${hi}°C ${tempState(u)}</div>`;
      if (u.hypo > 0.05) html += `<div>저체온증 ${Math.round(u.hypo * 100)}%</div>`;
      if (u.heatst > 0.05) html += `<div>열사병 ${Math.round(u.heatst * 100)}%</div>`;
      if (u.treatedUntil > G.time) html += `<div class="good">치료받음 (회복 촉진)</div>`;
      html += `<div>무기: ${u.weapon ? ITEMS[u.weapon].name : '맨손'} ${u.weapon ? `<button data-act="dropw">버리기</button>` : ''} · 의복: ${u.apparel ? ITEMS[u.apparel].name : '없음'}</div>`;
      html += `<h4>기술</h4><div class="skills">` + Object.keys(SKILLS).map(k => `<span>${SKILLS[k]} <b>${Math.floor(u.skills[k])}</b></span>`).join('') + '</div>';
      if (u.moodReasons && u.moodReasons.length) html += `<h4>기분 요인</h4><div class="thoughts">` + u.moodReasons.map(([t, v]) => `<span class="${v > 0 ? 'good' : 'bad'}">${t} ${v > 0 ? '+' : ''}${Math.round(v * 100)}</span>`).join('') + '</div>';
      html += `<div class="btns"><button data-act="draft" data-id="${u.id}">${u.drafted ? '소집 해제' : '소집'} (F)</button></div>`;
    } else if (u.kind === 'raider') {
      html += `<h3 class="bad">${u.name} (적)</h3><div>체력 ${Math.round(u.hp)}/${u.maxHp}</div><div>무기: ${u.weapon ? ITEMS[u.weapon].name : '맨손'}</div>`;
    } else {
      const a = ANIMALS[u.atype];
      html += `<h3>${a.icon} ${a.name} ${u.manhunter ? '<span class="bad">(광폭화)</span>' : ''}</h3><div>체력 ${Math.round(u.hp)}/${u.maxHp}</div><div>${a.passive ? '온순함 — 공격받으면 도망' : '공격받으면 반격'}</div><div>사냥 시: ${costText(a.yield)}</div>`;
      html += `<div class="btns"><button data-act="hunt" data-id="${u.id}">${u.huntDes ? '사냥 취소' : '사냥 지정'}</button></div>`;
    }
  }
  $('info').classList.toggle('hidden', !html);
  setHtml('info', html);
}

function renderLog() {
  if (!UI.logDirty) return;
  UI.logDirty = false;
  $('log').innerHTML = G.logs.slice(-7).reverse().map(l => `<div class="${l.type}"><span class="muted">${l.day}일</span> ${l.msg}</div>`).join('');
}

function renderHover() {
  const m = UI.mouse;
  if (!m.inside) return;
  const [wx, wy] = screenToWorld(m.x, m.y);
  const c = cellAt(Math.floor(wx), Math.floor(wy));
  if (!c) { setHtml('hover', ''); return; }
  const parts = [TERRAIN[c.t].name];
  if (c.res) parts.push(RES[c.res.type].name + (c.res.grown === false ? '(재성장 중)' : ''));
  if (c.st) parts.push(BUILD[c.st.type].name + (c.st.built ? '' : '(청사진)'));
  if (c.item) parts.push(`${ITEMS[c.item.type].name} x${c.item.n}`);
  if (c.zone === 1) parts.push('비축 구역');
  if (c.zone === 2) parts.push('재배 구역' + (c.crop ? ` (성장 ${Math.round(Math.min(1, c.crop.g) * 100)}%)` : ''));
  const r = G.rooms[c.room];
  parts.push(`${tempAt(wx, wy).toFixed(0)}°C ${r && !r.outdoor ? '실내' : '실외'}`);
  setHtml('hover', parts.join(' · '));
}

function openWorkTab() {
  const cs = colonists();
  let html = `<table class="work"><tr><th></th>${WORKTYPES.map(w => `<th>${w.name}</th>`).join('')}</tr>`;
  for (const u of cs) {
    html += `<tr><td><span class="dot" style="background:${u.color}"></span>${u.name}</td>` + WORKTYPES.map(w => {
      const lv = w.skill ? Math.floor(u.skills[w.skill]) : '';
      return `<td><button class="wk ${u.work[w.id] ? 'on' : ''}" data-act="work" data-id="${u.id}" data-w="${w.id}">${u.work[w.id] ? '✔' : ''}<small>${lv}</small></button></td>`;
    }).join('') + '</tr>';
  }
  html += '</table><p class="muted">왼쪽 작업일수록 우선합니다. 숫자는 관련 기술 레벨.</p>';
  $('work-body').innerHTML = html;
  $('worktab').classList.remove('hidden');
}

function openHelp() { $('help').classList.remove('hidden'); }

// ===== 버튼 처리 (pointerdown 위임) =====
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const a = el.dataset.act;
  e.stopPropagation();
  switch (a) {
    case 'modal': modalChoose(+el.dataset.i); break;
    case 'cat': UI.cat = el.dataset.id; UI.tool = null; renderBuildMenu(); break;
    case 'tool':
      if (UI.tool && UI.tool.id === el.dataset.id) UI.tool = null;
      else { UI.tool = { type: el.dataset.type, id: el.dataset.id }; UI.selected = null; }
      renderBuildMenu(); break;
    case 'speed': { const s = +el.dataset.s; if (s === 0) G.paused = !G.paused; else { G.speed = s; G.paused = false; } break; }
    case 'selcol': {
      if (e.target.closest('[data-act="draft"]')) break;
      const u = unitById(+el.dataset.id);
      if (u) { if (UI.selected && UI.selected.id === u.id) centerCam(u.x, u.y); UI.selected = { kind: 'colonist', id: u.id }; }
      break;
    }
    case 'draft': { const u = unitById(+el.dataset.id); if (u) setDraft(u, !u.drafted); break; }
    case 'draftall': draftAll(); break;
    case 'bill': {
      const s = UI.selected && UI.selected.ref; if (!s) break;
      const b = s.bills.find(b => b.id === +el.dataset.b); if (!b) break;
      const op = el.dataset.op;
      if (op === 'mode') b.mode = b.mode === 'count' ? 'until' : b.mode === 'until' ? 'forever' : 'count';
      if (op === 'inc') b.n = (b.n || 0) + (e.shiftKey ? 10 : 1);
      if (op === 'dec') b.n = Math.max(1, (b.n || 1) - (e.shiftKey ? 10 : 1));
      if (op === 'pause') b.paused = !b.paused;
      if (op === 'del') s.bills = s.bills.filter(o => o !== b);
      break;
    }
    case 'addbill': {
      const s = UI.selected && UI.selected.ref; if (!s) break;
      const r = el.dataset.r;
      s.bills.push({ id: G.nextId++, recipe: r, mode: r.startsWith('meal') ? 'until' : 'count', n: r.startsWith('meal') ? 10 : 1 });
      break;
    }
    case 'decon': {
      const s = UI.selected && UI.selected.ref; if (!s) break;
      if (s.built) G.cells[idx(s.x, s.y)].des = 'deconstruct'; else { removeStructure(s, s.paid ? 1 : 0); UI.selected = null; }
      break;
    }
    case 'dropw': { const u = selectedUnit(); if (u && u.weapon) { dropItem(Math.floor(u.x), Math.floor(u.y), u.weapon, 1); u.weapon = null; u.idleCheck = G.tick + 2000; } break; }
    case 'hunt': { const u = unitById(+el.dataset.id); if (u) u.huntDes = !u.huntDes; break; }
    case 'work': { const u = unitById(+el.dataset.id); if (u) { u.work[el.dataset.w] = !u.work[el.dataset.w]; openWorkTab(); } break; }
    case 'worktab': openWorkTab(); break;
    case 'closework': $('worktab').classList.add('hidden'); break;
    case 'temp': UI.tempOverlay = !UI.tempOverlay; break;
    case 'help': openHelp(); break;
    case 'closehelp': $('help').classList.add('hidden'); break;
    case 'save': saveGame(); break;
    case 'load': loadGame(); break;
    case 'new': choiceModal('새 게임', '현재 진행 상황을 버리고 새 게임을 시작할까요?', [{ label: '새 게임', fn() { newGame(); } }, { label: '취소', fn() {} }]); break;
    case 'restart': $('gameover').classList.add('hidden'); newGame(); break;
  }
  UI.lastHtml = {};
  refreshPanels();
}, true);

function refreshPanels() {
  renderTop(); renderColonists(); renderInfo(); renderLog();
}

// ===== 캔버스 입력 =====
function setupInput() {
  const keys = {};
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousemove', e => {
    UI.mouse.x = e.offsetX; UI.mouse.y = e.offsetY; UI.mouse.inside = true;
    if (UI.pan) {
      const dx = e.clientX - UI.pan.x, dy = e.clientY - UI.pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) UI.pan.moved = true;
      if (UI.pan.moved) { cam.x = UI.pan.cx - dx / cam.zoom; cam.y = UI.pan.cy - dy / cam.zoom; clampCam(); }
    }
  });
  canvas.addEventListener('mouseleave', () => { UI.mouse.inside = false; });
  canvas.addEventListener('mousedown', e => {
    const [wx, wy] = screenToWorld(e.offsetX, e.offsetY);
    if (e.button === 1 || (e.button === 0 && !UI.tool)) {
      UI.pan = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, button: e.button, wx, wy };
      return;
    }
    if (e.button === 0 && UI.tool) UI.drag = { x: Math.floor(wx), y: Math.floor(wy) };
    if (e.button === 2) rightClick(wx, wy);
  });
  window.addEventListener('mouseup', e => {
    if (UI.pan && e.button === UI.pan.button) {
      if (!UI.pan.moved && UI.pan.button === 0) { selectAt(UI.pan.wx, UI.pan.wy); UI.lastHtml = {}; refreshPanels(); }
      UI.pan = null;
      return;
    }
    if (e.button === 0 && UI.drag && UI.tool) {
      const [wx, wy] = screenToWorld(UI.mouse.x, UI.mouse.y);
      const tx = Math.floor(wx), ty = Math.floor(wy);
      applyTool(Math.min(UI.drag.x, tx), Math.min(UI.drag.y, ty), Math.max(UI.drag.x, tx), Math.max(UI.drag.y, ty));
      UI.drag = null;
      renderBuildMenu();
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [wx, wy] = screenToWorld(e.offsetX, e.offsetY);
    cam.zoom = clamp(cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.35, 2.5);
    cam.x = wx * TILE - e.offsetX / cam.zoom; cam.y = wy * TILE - e.offsetY / cam.zoom;
    clampCam();
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys[e.key.toLowerCase()] = true;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); if (!UI.modalOpen) G.paused = !G.paused; }
    else if (k === '1' || k === '2' || k === '3') { G.speed = +k; G.paused = false; }
    else if (k === 'escape') { UI.tool = null; UI.drag = null; UI.selected = null; ['worktab', 'help'].forEach(id => $(id).classList.add('hidden')); renderBuildMenu(); }
    else if (k === 'r') draftAll();
    else if (k === 'f') { const u = selectedUnit(); if (u && u.kind === 'colonist') setDraft(u, !u.drafted); }
    else if (k === 't') UI.tempOverlay = !UI.tempOverlay;
    else if (k === 'tab') { e.preventDefault(); const cs = colonists(); if (cs.length) { const i = (cs.findIndex(c => UI.selected && c.id === UI.selected.id) + 1) % cs.length; UI.selected = { kind: 'colonist', id: cs[i].id }; centerCam(cs[i].x, cs[i].y); } }
    else if (k === 'enter' && UI.modalOpen) modalChoose(0);
    UI.lastHtml = {}; refreshPanels();
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  UI.keys = keys;
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('view'));
}
function resize() {
  const r = $('view').getBoundingClientRect();
  canvas.width = Math.floor(r.width); canvas.height = Math.floor(r.height);
  clampCam();
}
function panKeys(dtSec) {
  const k = UI.keys, sp = 700 * dtSec / cam.zoom;
  if (k['w'] || k['arrowup']) cam.y -= sp;
  if (k['s'] || k['arrowdown']) cam.y += sp;
  if (k['a'] || k['arrowleft']) cam.x -= sp;
  if (k['d'] || k['arrowright']) cam.x += sp;
  clampCam();
}
