'use strict';
// ===== 스토리텔러 / 이벤트 =====
const dayNum = () => Math.floor(G.time / DAY_MIN) + 1;

function edgeSpot() {
  for (let k = 0; k < 200; k++) {
    const side = randi(0, 3);
    let x, y;
    if (side === 0) { x = randi(0, MAP_W - 1); y = 0; }
    else if (side === 1) { x = randi(0, MAP_W - 1); y = MAP_H - 1; }
    else if (side === 2) { x = 0; y = randi(0, MAP_H - 1); }
    else { x = MAP_W - 1; y = randi(0, MAP_H - 1); }
    if (!blocksMove(G.cells[idx(x, y)], false) && PF.find(x, y, G.home.x, G.home.y, { enemy: true, max: 9000 })) return { x, y };
  }
  return { x: G.home.x, y: 0 };
}
function nearSpot(x, y, r) {
  for (let k = 0; k < 100; k++) {
    const nx = clamp(x + randi(-r, r), 0, MAP_W - 1), ny = clamp(y + randi(-r, r), 0, MAP_H - 1);
    if (!blocksMove(G.cells[idx(nx, ny)], false)) return { x: nx, y: ny };
  }
  return { x, y };
}

function raidWeapon() {
  const d = dayNum();
  const pool = ['club', 'club', 'bow', null, null];
  if (d >= 6) pool.push('spear', 'bow', 'spear');
  if (d >= 9) pool.push('rifle', 'spear', 'rifle');
  if (d >= 15) pool.push('rifle', 'rifle');
  return pick(pool);
}
function spawnRaid(bonus = 0) {
  const d = dayNum();
  const n = clamp(Math.round(0.2 + d * 0.2 + colonists().length * 0.2 + rand() * 1.2 + bonus), 1, 16);
  const p = edgeSpot();
  const gid = G.nextId++;
  for (let i = 0; i < n; i++) {
    const s = nearSpot(p.x, p.y, 3);
    G.units.push(makeRaider(s.x, s.y, raidWeapon(), gid));
  }
  G.raids.push({ id: gid, total: n });
  G.stats.raids++;
  log(`⚔️ 습격! 약탈자 ${n}명이 접근합니다!`, 'bad');
  alertModal('⚔️ 습격', `약탈자 ${n}명이 정착지를 습격합니다!\n정착민을 [소집]하여 방어하세요. (단축키 R: 전원 소집)`, true);
  G.camTo = { x: p.x, y: p.y };
}
function checkRaids() {
  for (const r of G.raids) {
    if (r.done) continue;
    const mem = G.units.filter(u => u.group === r.id && !u.dead);
    if (!mem.length) { r.done = true; if (r.looted) { log('약탈자들이 떠났습니다.', 'warn'); continue; } log('✅ 습격을 막아냈습니다!', 'good'); for (const c of colonists()) addThought(c, '습격 격퇴', 0.08, DAY_MIN); continue; }
    if (!r.fleeing && mem.length / r.total < 0.4) {
      r.fleeing = true;
      for (const m of mem) { m.fleeing = true; m.fleeTo = edgeSpot(); m.path = null; m.pathGoal = null; }
      log('약탈자들이 도주합니다!', 'good');
    }
  }
}

function joinColonist(x, y, opts, msg) {
  const c = makeColonist(x, y, opts);
  if (rand() < 0.5) c.weapon = pick(['club', 'bow', 'spear']);
  G.units.push(c);
  for (const o of colonists()) if (o !== c) addThought(o, '새 동료', 0.05, DAY_MIN);
  log(msg || `${c.name}이(가) 합류했습니다.`, 'good');
  return c;
}

const EVENTS = [
  { id: 'wanderer', w: 10, min: 1, run() {
    const p = edgeSpot();
    const c = joinColonist(p.x, p.y, {}, null);
    const tr = TRAITS.find(t => t.id === c.trait);
    alertModal('🚶 방랑자 합류', `${c.name}(${c.age}세)이(가) 정착지에 합류하고 싶어합니다.\n특성: ${tr.name} — ${tr.desc}\n\n${c.name}이(가) 동료가 되었습니다!`);
    G.camTo = p;
  } },
  { id: 'pod', w: 7, min: 1, run() {
    const s = nearSpot(G.home.x + randi(-15, 15), G.home.y + randi(-12, 12), 3);
    const c = makeColonist(s.x, s.y, { hp: 20, downed: true });
    G.units.push(c);
    G.fx.push({ type: 'boom', x: s.x + 0.5, y: s.y + 0.5, life: 40 });
    log(`🚀 탈출 포드 추락! ${c.name}이(가) 부상당한 채 발견되었습니다.`, 'warn');
    alertModal('🚀 탈출 포드 추락', `궤도에서 탈출 포드가 근처에 추락했습니다.\n안에 있던 ${c.name}이(가) 크게 다쳤습니다.\n\n침대를 준비하면 정착민이 구조하여 치료합니다. 회복하면 동료가 됩니다.`);
    G.camTo = s;
  } },
  { id: 'refugee', w: 6, min: 3, run() {
    const name = pick(SURNAMES) + pick(NAMES);
    choiceModal('🏃 피난민의 요청', `${name}이(가) 추격자들에게 쫓기고 있다며 보호를 요청합니다.\n받아들이면 동료가 되지만 추격대가 습격해올 수 있습니다.`, [
      { label: '받아들인다', fn() {
        const p = edgeSpot();
        joinColonist(p.x, p.y, { name }, `${name}이(가) 합류했습니다.`);
        G.camTo = p;
        if (rand() < 0.6) G.scheduled.push({ at: G.time + randi(200, 500), type: 'raid', bonus: -1 });
      } },
      { label: '거절한다', fn() { log(`${name}의 요청을 거절했습니다.`); } },
    ]);
  } },
  { id: 'coldsnap', w: 6, min: 2, run() {
    G.weather = { name: '한파', offset: -20, until: G.time + DAY_MIN * randi(2, 3) };
    log('❄️ 한파가 찾아왔습니다! 기온이 크게 떨어집니다.', 'bad');
    alertModal('❄️ 한파', '기온이 급격히 떨어집니다. (-20°C)\n벽으로 둘러싼 방에 난방기나 모닥불을 설치하고, 파카를 제작하세요.');
  } },
  { id: 'heatwave', w: 5, min: 2, cond: () => seasonIndex(G.time) === 1 || seasonIndex(G.time) === 0, run() {
    G.weather = { name: '폭염', offset: 16, until: G.time + DAY_MIN * randi(1, 2) };
    log('🔥 폭염이 찾아왔습니다! 열사병에 주의하세요.', 'bad');
    alertModal('🔥 폭염', '기온이 크게 오릅니다. (+16°C)\n냉각기가 있는 실내에서 쉬게 하세요.');
  } },
  { id: 'drop', w: 8, min: 1, run() {
    const s = nearSpot(G.home.x + randi(-10, 10), G.home.y + randi(-10, 10), 3);
    const opts = [['steel', randi(30, 60)], ['meal', randi(10, 20)], ['medicine', randi(4, 8)], ['wood', randi(60, 120)], ['leather', randi(30, 60)], [pick(['bow', 'spear', 'rifle', 'parka']), 1]];
    const [type, n] = pick(opts);
    dropItem(s.x, s.y, type, n);
    G.fx.push({ type: 'boom', x: s.x + 0.5, y: s.y + 0.5, life: 40 });
    log(`📦 보급 포드: ${ITEMS[type].name} x${n}이(가) 떨어졌습니다.`, 'good');
    G.camTo = s;
  } },
  { id: 'herd', w: 6, min: 1, run() {
    const p = edgeSpot(), type = pick(['deer', 'deer', 'rabbit', 'boar']);
    const n = randi(3, 7);
    for (let i = 0; i < n; i++) { const s = nearSpot(p.x, p.y, 3); G.units.push(makeAnimal(s.x, s.y, type, false)); }
    log(`🦌 ${ANIMALS[type].name} 무리(${n}마리)가 이동해 왔습니다. 사냥 기회!`, 'good');
  } },
  { id: 'manhunter', w: 5, min: 4, run() {
    const type = pick(dayNum() >= 10 ? ['wolf', 'wolf', 'boar', 'bear'] : ['wolf', 'boar']);
    const n = type === 'bear' ? 1 : randi(2, 2 + Math.floor(dayNum() / 6));
    const p = edgeSpot();
    for (let i = 0; i < n; i++) { const s = nearSpot(p.x, p.y, 3); const a = makeAnimal(s.x, s.y, type, true); a.calmAt = G.time + DAY_MIN; G.units.push(a); }
    log(`🐺 광폭화된 ${ANIMALS[type].name} ${n}마리가 공격해옵니다!`, 'bad');
    alertModal('🐺 광폭화 동물', `광폭화된 ${ANIMALS[type].name} ${n}마리가 정착민을 노립니다!\n문을 닫고 실내로 피하거나 소집하여 싸우세요.`, true);
    G.camTo = p;
  } },
  { id: 'trader', w: 6, min: 2, run() { openTrade(); } },
  { id: 'blight', w: 3, min: 5, cond: () => G.cells.some(c => c.crop), run() {
    let k = 0;
    for (const c of G.cells) if (c.crop && rand() < 0.6) { c.crop = null; k++; }
    log(`🦠 병충해로 작물 ${k}칸이 죽었습니다.`, 'bad');
  } },
  { id: 'luckyore', w: 3, min: 1, run() {
    const s = nearSpot(G.home.x + randi(-14, 14), G.home.y + randi(-14, 14), 2);
    const c = G.cells[idx(s.x, s.y)];
    if (!c.st && !c.item) { c.res = { type: 'ore', work: 0 }; c.des = 'mine'; G.roomsDirty = true; }
    G.fx.push({ type: 'boom', x: s.x + 0.5, y: s.y + 0.5, life: 40 });
    log('☄️ 운석이 떨어져 강철 광맥이 생겼습니다! (채굴 지정됨)', 'good');
  } },
];

function randomEvent() {
  const d = dayNum();
  const pool = EVENTS.filter(e => d >= e.min && (!e.cond || e.cond()));
  // 인원이 너무 많으면 합류 이벤트 감소
  const nCol = colonists().length;
  let tot = 0;
  const ws = pool.map(e => { let w = e.w; if ((e.id === 'wanderer' || e.id === 'pod' || e.id === 'refugee') && nCol >= 8) w *= 0.3; tot += w; return w; });
  let r = rand() * tot;
  for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) { pool[i].run(); return; } }
}

function updateStoryteller() {
  if (G.weather && G.time > G.weather.until) { log(`${G.weather.name}이(가) 끝났습니다.`, 'good'); G.weather = null; }
  if (G.time >= G.nextRaid) { spawnRaid(); G.nextRaid = G.time + DAY_MIN * (2.2 + rand() * 1.8); }
  if (G.time >= G.nextEvent) { randomEvent(); G.nextEvent = G.time + DAY_MIN * (0.6 + rand() * 0.8); }
  for (const s of G.scheduled) if (!s.done && G.time >= s.at) {
    s.done = true;
    if (s.type === 'raid') spawnRaid(s.bonus || 0);
  }
  G.scheduled = G.scheduled.filter(s => !s.done);
  // 광폭화 진정
  for (const u of G.units) if (u.kind === 'animal' && u.manhunter && u.calmAt && G.time > u.calmAt) { u.manhunter = false; u.faction = 'wild'; }
  // 야생동물 보충
  const wild = G.units.filter(u => u.kind === 'animal' && !u.dead).length;
  if (wild < 8 && rand() < 0.002) {
    const p = edgeSpot();
    G.units.push(makeAnimal(p.x, p.y, pick(['deer', 'rabbit', 'rabbit', 'boar', 'deer']), false));
  }
  checkRaids();
}

// ===== 상인 =====
const TRADES = [
  { give: { wood: 60 }, get: { steel: 20 }, label: '목재 60 → 강철 20' },
  { give: { stone: 60 }, get: { steel: 15 }, label: '석재 60 → 강철 15' },
  { give: { leather: 30 }, get: { medicine: 4 }, label: '가죽 30 → 약품 4' },
  { give: { steel: 40 }, get: { rifle: 1 }, label: '강철 40 → 소총' },
  { give: { wood: 40 }, get: { meal: 6 }, label: '목재 40 → 식사 6' },
  { give: { steel: 25 }, get: { parka: 1 }, label: '강철 25 → 파카' },
  { give: { raw: 50 }, get: { steel: 15 }, label: '날음식 50 → 강철 15' },
];
function openTrade() {
  const offers = [...TRADES].sort(() => rand() - 0.5).slice(0, 4);
  log('🐫 상인 캐러밴이 도착했습니다.', 'good');
  const render = () => offers.map(o => ({
    label: o.label + (canAfford(o.give) ? '' : ' (부족)'),
    keep: true,
    disabled: !canAfford(o.give),
    fn() {
      if (!payCost(o.give)) return;
      for (const k in o.get) dropItem(G.home.x, G.home.y, k, o.get[k]);
      log(`거래 완료: ${o.label}`, 'good');
    },
  })).concat([{ label: '떠나보낸다', fn() { log('상인이 떠났습니다.'); } }]);
  choiceModal('🐫 상인 캐러밴', '상인이 물물교환을 제안합니다. (비축 구역의 자원으로 거래, 물품은 정착지 중심에 놓입니다)', render(), render);
}
