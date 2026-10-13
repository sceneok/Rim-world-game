'use strict';
// ===== 유닛 생성 =====
function makeColonist(x, y, opts = {}) {
  const used = new Set(G.units.filter(u => u.kind === 'colonist').map(u => u.name));
  let name;
  for (let i = 0; i < 30; i++) { name = pick(SURNAMES) + pick(NAMES); if (!used.has(name)) break; }
  const skills = {};
  for (const k in SKILLS) skills[k] = randi(0, 6);
  // 특기 2개
  const ks = Object.keys(SKILLS);
  for (let i = 0; i < 2; i++) skills[pick(ks)] += randi(4, 8);
  for (const k in skills) skills[k] = Math.min(20, skills[k]);
  const work = {};
  WORKTYPES.forEach(w => work[w.id] = true);
  const age = randi(18, 58);
  return Object.assign({
    id: G.nextId++, kind: 'colonist', faction: 'player', name, age,
    x: x + 0.5, y: y + 0.5, path: null, pathGoal: null,
    hp: 100, maxHp: 100, food: 0.8 + rand() * 0.2, rest: 0.8 + rand() * 0.2, mood: 0.6,
    hypo: 0, heatst: 0, weapon: null, apparel: null, skills, trait: pick(TRAITS).id, work,
    job: null, drafted: false, downed: false, dead: false, cd: 0, carry: null, sleeping: false,
    color: COLONIST_COLORS[G.colorIdx++ % COLONIST_COLORS.length], thoughts: [], breakUntil: 0,
    treatedUntil: 0, order: null, lastHurtBy: null, lastHurtT: -999, idleCheck: 0, inBed: null,
  }, opts);
}
function makeRaider(x, y, weapon, groupId) {
  return {
    id: G.nextId++, kind: 'raider', faction: 'enemy', name: pick(RAIDER_NAMES),
    x: x + 0.5, y: y + 0.5, path: null, pathGoal: null, hp: 50 + randi(0, 20) + Math.min(30, Math.floor(G.time / DAY_MIN)), maxHp: 100,
    weapon, apparel: rand() < 0.3 ? 'armor' : null, skills: { shooting: randi(2, 4 + Math.min(6, Math.floor(G.time / DAY_MIN / 3))), melee: randi(2, 4 + Math.min(6, Math.floor(G.time / DAY_MIN / 3))) },
    job: null, cd: randi(0, 30), dead: false, downed: false, target: null, repath: 0, group: groupId,
    color: '#d9534f', lastHurtBy: null, lastHurtT: -999,
  };
}
function makeAnimal(x, y, type, manhunter) {
  const d = ANIMALS[type];
  return {
    id: G.nextId++, kind: 'animal', faction: manhunter ? 'enemy' : 'wild', atype: type, name: d.name,
    x: x + 0.5, y: y + 0.5, path: null, pathGoal: null, hp: d.hp, maxHp: d.hp, manhunter: !!manhunter,
    job: null, cd: 0, dead: false, downed: false, target: null, repath: 0, wait: randi(0, 100),
    skills: { melee: 5 }, lastHurtBy: null, lastHurtT: -999, huntDes: false,
  };
}
const unitById = id => G.units.find(u => u.id === id && !u.dead);
const colonists = () => G.units.filter(u => u.kind === 'colonist' && !u.dead);

function hostile(a, b) {
  if (!a || !b || a.dead || b.dead) return false;
  if (a.faction === 'player' && b.faction === 'enemy') return true;
  if (a.faction === 'enemy' && b.faction === 'player') return true;
  if (a.faction === 'wild' && b.id === a.lastHurtBy && G.tick - a.lastHurtT < 600) return true;
  if (b.faction === 'wild' && b.huntDes && a.faction === 'player') return true;
  return false;
}

// ===== 예약 =====
function reserve(u, key) { G.reserved.set(key, u.id); if (u.job) (u.job.res = u.job.res || []).push(key); }
function resv(u, j, key) { G.reserved.set(key, u.id); (j.res = j.res || []).push(key); }
function isReserved(key, u) { const r = G.reserved.get(key); return r !== undefined && r !== u.id && unitById(r); }
function endJob(u) {
  if (u.job && u.job.res) for (const k of u.job.res) if (G.reserved.get(k) === u.id) G.reserved.delete(k);
  if (u.carry) { dropItem(Math.floor(u.x), Math.floor(u.y), u.carry.type, u.carry.n); u.carry = null; }
  if (u.job && u.job.patient) { const p = unitById(u.job.patient); if (p) p.carriedBy = null; }
  u.job = null; u.path = null; u.pathGoal = null; u.sleeping = false;
}

// ===== 이동 =====
function unitSpeed(u) {
  let s;
  if (u.kind === 'animal') s = ANIMALS[u.atype].speed;
  else s = 0.13;
  if (u.kind === 'colonist') {
    if (u.trait === 'fast') s *= 1.2;
    s *= 0.5 + 0.5 * Math.min(1, u.hp / 70);
    if (u.carry || u.job && u.job.patient) s *= 0.8;
  }
  if (u.kind === 'raider' && u.fleeing) s *= 1.1;
  const c = cellAt(Math.floor(u.x), Math.floor(u.y));
  if (c) s /= TERRAIN[c.t].cost + (c.res && !RES[c.res.type].blocks ? 0.3 : 0) + (c.st && c.st.built && BUILD[c.st.type].cover ? 0.6 : 0);
  return s;
}
// 반환: 'arrived' | 'moving' | 'fail'
function travel(u, tx, ty, adj) {
  const key = tx + ',' + ty + (adj ? 'a' : '');
  const cx = Math.floor(u.x), cy = Math.floor(u.y);
  if (u.pathGoal !== key || !u.path) {
    if ((adj && Math.abs(cx - tx) <= 1 && Math.abs(cy - ty) <= 1 && !(adj === 'strict' && cx === tx && cy === ty)) || (!adj && cx === tx && cy === ty)) {
      if (centerOn(u)) return 'arrived';
      return 'moving';
    }
    const p = PF.find(cx, cy, tx, ty, { adj: !!adj, enemy: u.faction === 'enemy' && u.kind === 'raider' });
    if (!p) return 'fail';
    u.path = p; u.pathGoal = key;
  }
  if (u.path.length === 0) { if (centerOn(u)) return 'arrived'; return 'moving'; }
  const r = stepPath(u);
  if (r === 'blocked') { u.path = null; u.pathGoal = null; return 'fail'; }
  return 'moving';
}
function centerOn(u) {
  const tx = Math.floor(u.x) + 0.5, ty = Math.floor(u.y) + 0.5;
  const d = dist(u.x, u.y, tx, ty), sp = unitSpeed(u);
  if (d <= sp) { u.x = tx; u.y = ty; return true; }
  u.x += (tx - u.x) / d * sp; u.y += (ty - u.y) / d * sp;
  return false;
}
function stepPath(u) {
  const ni = u.path[0], nx = ni % MAP_W, ny = (ni / MAP_W) | 0;
  const c = G.cells[ni];
  const enemy = u.faction === 'enemy' && u.kind === 'raider';
  if (blocksMove(c, enemy)) {
    if (enemy && c.st && c.st.built) { // 부수기
      tryAttackStructure(u, c.st);
      return 'bashing';
    }
    return 'blocked';
  }
  const tx = nx + 0.5, ty = ny + 0.5, dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
  const sp = unitSpeed(u);
  if (d <= sp) {
    u.x = tx; u.y = ty; u.path.shift();
    if (u.faction === 'enemy' && c.st && c.st.built && BUILD[c.st.type].trap) {
      damage(u, 38, null); log(`${u.name}이(가) 가시 함정을 밟았습니다!`, 'good');
      removeStructure(c.st, 0);
    }
  } else { u.x += dx / d * sp; u.y += dy / d * sp; }
  return 'ok';
}

// ===== 전투 =====
function weaponOf(u) {
  if (u.kind === 'animal') return WEAPONS.bite;
  return WEAPONS[u.weapon] || WEAPONS.fists;
}
function hasCover(t) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = cellAt(Math.floor(t.x) + dx, Math.floor(t.y) + dy);
    if (c && c.st && c.st.built && (BUILD[c.st.type].cover || BUILD[c.st.type].wall)) return true;
  }
  return false;
}
function canHit(u, t) {
  const w = weaponOf(u), d = dist(u.x, u.y, t.x, t.y);
  if (w.melee) return d <= 1.95;
  return d <= w.range && lineOfSight(u.x, u.y, t.x, t.y);
}
function tryAttack(u, t) {
  if (!canHit(u, t)) return false;
  if (u.cd > 0) return true;
  const w = weaponOf(u), d = dist(u.x, u.y, t.x, t.y);
  u.cd = w.cd;
  let chance, dmg = w.dmg * (0.75 + rand() * 0.5);
  if (u.kind === 'animal') dmg *= ANIMALS[u.atype].dmgMul || 1;
  if (w.melee) {
    chance = 0.72 + (u.skills.melee || 0) * 0.015;
    dmg *= 1 + (u.skills.melee || 0) * 0.03;
    G.fx.push({ type: 'slash', x: t.x, y: t.y, life: 8 });
  } else {
    chance = w.acc * (0.75 + (u.skills.shooting || 0) * 0.03) * (1 - d / w.range * 0.3);
    if (u.trait === 'sharpshooter') chance += 0.15;
    if (hasCover(t) && d > 2) chance *= 0.45;
    G.fx.push({ type: 'shot', x0: u.x, y0: u.y, x1: t.x, y1: t.y, life: 6, color: u.faction === 'player' ? '#ffe28a' : '#ff8a7a' });
  }
  if (u.kind === 'colonist') u.skills[w.melee ? 'melee' : 'shooting'] = Math.min(20, u.skills[w.melee ? 'melee' : 'shooting'] + 0.01);
  if (rand() < clamp(chance, 0.05, 0.97)) damage(t, dmg, u);
  else if (!w.melee) G.fx.push({ type: 'text', x: t.x, y: t.y - 0.6, text: '빗나감', life: 25, color: '#ccc' });
  return true;
}
function tryAttackStructure(u, s) {
  if (u.cd > 0) return;
  const w = weaponOf(u);
  u.cd = w.melee ? w.cd : w.cd * 1.3;
  G.fx.push({ type: 'slash', x: s.x + 0.5, y: s.y + 0.5, life: 8 });
  damageStructure(s, w.dmg * (w.melee ? 1.3 : 0.6));
}
function damageStructure(s, amt) {
  s.hp -= amt;
  if (s.hp <= 0) {
    log(`${BUILD[s.type].name}이(가) 파괴되었습니다.`, 'bad');
    removeStructure(s, 0);
  }
}
function damage(t, amt, src) {
  if (t.dead) return;
  if (t.apparel && ITEMS[t.apparel].apparel) amt *= 1 - ITEMS[t.apparel].apparel.armor;
  if (t.trait === 'tough') amt *= 0.65;
  t.hp -= amt;
  G.fx.push({ type: 'text', x: t.x, y: t.y - 0.7, text: '-' + Math.round(amt), life: 30, color: '#ff6b6b' });
  if (src) { t.lastHurtBy = src.id; t.lastHurtT = G.tick; }
  if (t.sleeping && t.kind === 'colonist') { endJob(t); }
  if (t.hp <= 0) return kill(t, src);
  if (t.kind === 'colonist' && t.hp < 15 && !t.downed) {
    t.downed = true; endJob(t); t.drafted = false;
    log(`${t.name}이(가) 쓰러졌습니다! 구조가 필요합니다.`, 'bad');
  }
  if (t.kind === 'raider' && t.hp < 15) return kill(t, src);
}
function kill(t, src) {
  if (t.dead) return;
  t.dead = true; t.hp = 0;
  const x = Math.floor(t.x), y = Math.floor(t.y);
  if (t.kind === 'colonist') {
    endJob(t);
    if (t.weapon) dropItem(x, y, t.weapon, 1);
    if (t.apparel) dropItem(x, y, t.apparel, 1);
    log(`💀 ${t.name}이(가) 사망했습니다.`, 'bad');
    G.graves.push({ name: t.name, day: dayNum() });
    for (const c of colonists()) addThought(c, '동료의 죽음', -0.22, DAY_MIN * 3);
    alertModal('사망', `${t.name}이(가) 사망했습니다. 남은 정착민: ${colonists().length}명`);
  } else if (t.kind === 'raider') {
    if (t.weapon && rand() < 0.5) dropItem(x, y, t.weapon, 1);
    if (t.apparel && rand() < 0.5) dropItem(x, y, t.apparel, 1);
    if (rand() < 0.4) dropItem(x, y, 'steel', randi(5, 15));
    G.stats.kills++;
  } else if (t.kind === 'animal') {
    const y2 = ANIMALS[t.atype].yield;
    for (const k in y2) dropItem(x, y, k, y2[k]);
    if (t.manhunter) G.stats.kills++;
  }
  if (t.inBed) t.inBed = null;
}
function nearestThreat(u, maxD) {
  let best = null, bd = maxD;
  for (const o of G.units) {
    if (o.dead || o.downed || o.faction !== 'enemy' || o.fleeing) continue;
    const d = dist(u.x, u.y, o.x, o.y);
    if (d < bd && (d < 3 || lineOfSight(u.x, u.y, o.x, o.y))) { bd = d; best = o; }
  }
  return best;
}
function nearestHostile(u, maxD, needHit) {
  let best = null, bd = maxD;
  for (const o of G.units) {
    if (o === u || o.dead || o.downed || !hostile(u, o)) continue;
    if (o.kind === 'animal' && !o.manhunter && u.faction === 'player' && !o.huntDes && o.lastHurtBy !== u.id) continue;
    const d = dist(u.x, u.y, o.x, o.y);
    if (d < bd && (!needHit || canHit(u, o))) { bd = d; best = o; }
  }
  return best;
}

// ===== 기분 =====
function addThought(u, text, val, dur) {
  u.thoughts = u.thoughts.filter(t => t.text !== text);
  u.thoughts.push({ text, val, until: G.time + dur });
}
function moodTarget(u) {
  let m = 0.62 + (u.trait === 'optimist' ? 0.12 : 0);
  const reasons = [];
  if (u.food <= 0) { m -= 0.3; reasons.push(['굶주림', -0.3]); } else if (u.food < 0.25) { m -= 0.12; reasons.push(['배고픔', -0.12]); }
  if (u.rest < 0.15) { m -= 0.12; reasons.push(['극도의 피로', -0.12]); } else if (u.rest < 0.3) { m -= 0.05; reasons.push(['피곤함', -0.05]); }
  if (u.hypo > 0.3) { m -= 0.12; reasons.push(['너무 추움', -0.12]); }
  if (u.heatst > 0.3) { m -= 0.12; reasons.push(['너무 더움', -0.12]); }
  if (u.hp < 60) { m -= 0.1; reasons.push(['고통', -0.1]); }
  u.thoughts = u.thoughts.filter(t => t.until > G.time);
  for (const t of u.thoughts) { m += t.val; reasons.push([t.text, t.val]); }
  u.moodReasons = reasons;
  return clamp(m, 0, 1);
}

// ===== 정착민 업데이트 =====
function comfortRange(u) {
  let lo = 4, hi = 33;
  if (u.trait === 'coldres') lo -= 10;
  if (u.apparel) { lo -= ITEMS[u.apparel].apparel.cold; hi += ITEMS[u.apparel].apparel.heat; }
  return [lo, hi];
}
function workSpeed(u, skill) {
  let s = 0.6 + (skill ? u.skills[skill] : 5) * 0.07;
  if (u.trait === 'industrious') s *= 1.25;
  s *= 0.4 + 0.6 * Math.min(1, u.hp / 70);
  if (u.hypo > 0.5 || u.heatst > 0.5) s *= 0.7;
  return s;
}
function gainSkill(u, skill, amt) { if (skill && u.skills[skill] < 20) u.skills[skill] = Math.min(20, u.skills[skill] + amt); }

function updateColonist(u) {
  const dt = MIN_PER_TICK;
  // 욕구
  const foodRate = (u.trait === 'smalleater' ? 0.7 : 1) / 1500;
  u.food = Math.max(0, u.food - foodRate * dt * (u.downed ? 0.5 : 1));
  if (u.sleeping) {
    const q = u.inBed ? 1 : 0.7;
    u.rest = Math.min(1, u.rest + dt / 420 * q);
  } else if (!u.downed) {
    u.rest = Math.max(0, u.rest - dt / ((u.trait === 'nightowl' ? 1.25 : 1) * 1080));
  }
  // 체온
  const t = tempAt(u.x, u.y), [lo, hi] = comfortRange(u);
  u.curTemp = t;
  if (t < lo) u.hypo = Math.min(1.5, u.hypo + (lo - t) * dt / 12000);
  else u.hypo = Math.max(0, u.hypo - dt / 120);
  if (t > hi) u.heatst = Math.min(1.5, u.heatst + (t - hi) * dt / 6000);
  else u.heatst = Math.max(0, u.heatst - dt / 120);
  // 체력
  if (u.hypo >= 1) damageSilent(u, 0.05 * dt * (u.hypo));
  if (u.heatst >= 1) damageSilent(u, 0.05 * dt * (u.heatst));
  if (u.food <= 0) damageSilent(u, 0.012 * dt);
  if (u.downed && !(u.treatedUntil > G.time) && !u.inBed) damageSilent(u, 0.025 * dt);
  if (u.dead) return;
  let regen = 0.012 * dt;
  if (u.sleeping || u.downed) regen *= u.inBed ? 3 : 1.5;
  if (u.treatedUntil > G.time) regen *= 2.5;
  if (u.food > 0 && u.hypo < 1 && u.heatst < 1) u.hp = Math.min(u.maxHp, u.hp + regen);
  if (u.downed && u.hp > 38) { u.downed = false; u.inBed = null; u.rescuedNoBed = false; log(`${u.name}이(가) 의식을 회복했습니다.`, 'good'); }
  // 기분
  if (G.tick % 20 === u.id % 20) u.moodT = moodTarget(u);
  u.mood += ((u.moodT ?? 0.6) - u.mood) * 0.004;
  if (u.mood < 0.12 && !u.downed && G.time > u.breakUntil && rand() < 0.0006) {
    u.breakUntil = G.time + randi(120, 300);
    endJob(u); u.drafted = false;
    log(`${u.name}이(가) 정신적 한계에 도달해 방황합니다.`, 'warn');
  }
  if (u.cd > 0) u.cd--;
  if (u.downed) { u.sleeping = false; return; }
  if (u.carriedBy) return;

  // 맞으면 반격 (비소집 상태)
  if (!u.drafted && u.lastHurtBy && G.tick - u.lastHurtT < 60 && (!u.job || u.job.type !== 'fight')) {
    const a = unitById(u.lastHurtBy);
    if (a && hostile(u, a) && dist(u.x, u.y, a.x, a.y) < 3) { endJob(u); u.job = { type: 'fight', target: a.id, t: 0 }; }
  }

  if (u.drafted) return draftedAI(u);
  // 위협 감지: 무장했으면 맞서 싸우고, 맨손이면 도망
  if (G.tick % 15 === u.id % 15 && G.time >= u.breakUntil && (!u.job || (u.job.type !== 'fight' && u.job.type !== 'flee' && u.job.type !== 'rescue'))) {
    const th = nearestThreat(u, u.weapon ? 13 : 8);
    if (th && !(u.sleeping && dist(u.x, u.y, th.x, th.y) > 7)) {
      endJob(u);
      u.job = u.weapon ? { type: 'fight', target: th.id, t: 0 } : { type: 'flee', from: th.id, t: 0 };
    }
  }
  if (u.rest <= 0 && (!u.job || u.job.type !== 'sleep')) { endJob(u); u.job = { type: 'sleep', bed: null, ground: true }; log(`${u.name}이(가) 탈진해 쓰러져 잠듭니다.`, 'warn'); }
  // 긴급 욕구가 생기면 작업 중단
  if (u.job && G.tick % 30 === u.id % 30 && INTERRUPTIBLE.has(u.job.type) && !(u.job.type === 'craft' && u.job.paid)) {
    if (u.food < 0.2) { const j = findFood(u); if (j) { endJob(u); u.job = j; } }
    else if (u.rest < 0.12) { endJob(u); u.job = findBed(u); }
    else if ((u.hypo > 0.45 || u.heatst > 0.45) && !(u.warmFailUntil > G.tick)) { const j = findComfort(u); if (j) { endJob(u); u.job = j; } else u.warmFailUntil = G.tick + 300; }
  }
  if (!u.job) chooseJob(u);
  if (u.job) {
    const fn = JOBS[u.job.type];
    const r = fn ? fn(u, u.job) : 'done';
    if (r === 'done' || r === 'fail') {
      if (r === 'fail' && u.job && u.job.failKey) G.unreach.set(u.job.failKey, G.tick + 400);
      endJob(u);
    }
  }
}
function damageSilent(u, amt) {
  if (u.dead) return;
  u.hp -= amt;
  if (u.hp <= 0) kill(u, null);
  else if (u.hp < 15 && !u.downed) { u.downed = true; endJob(u); u.drafted = false; log(`${u.name}이(가) 쓰러졌습니다!`, 'bad'); }
}

function draftedAI(u) {
  if (u.job && u.job.type !== 'draftmove') endJob(u);
  const o = u.order;
  let target = null;
  if (o && o.type === 'attack') {
    target = unitById(o.id);
    if (!target || target.downed) { u.order = null; target = null; }
  }
  if (target) {
    if (!tryAttack(u, target)) {
      if (G.tick % 15 === 0 || !u.path) { u.path = null; u.pathGoal = null; }
      travel(u, Math.floor(target.x), Math.floor(target.y), true);
    }
    return;
  }
  if (o && o.type === 'move') {
    const r = travel(u, o.x, o.y, false);
    if (r === 'arrived' || r === 'fail') u.order = null;
    // 이동 중엔 근접만 반격
    const h = nearestHostile(u, 1.6, true);
    if (h) tryAttack(u, h);
    return;
  }
  const h = nearestHostile(u, weaponOf(u).melee ? 6 : weaponOf(u).range, true);
  if (h) tryAttack(u, h);
  else if (weaponOf(u).melee) {
    // 근접 무기: 보이는 적에게 돌격
    const h2 = nearestThreat(u, 14);
    if (h2) {
      if (G.tick % 15 === 0) { u.path = null; u.pathGoal = null; }
      travel(u, Math.floor(h2.x), Math.floor(h2.y), true);
    }
  }
}

// ===== 작업 선택 =====
const INTERRUPTIBLE = new Set(['wander', 'gather', 'build', 'deconstruct', 'farm', 'haul', 'craft', 'hunt', 'equip']);
function nightTime() { const h = (G.time % DAY_MIN) / 60; return h >= 22 || h < 6; }
function chooseJob(u) {
  if (G.time < u.breakUntil) { u.job = { type: 'wander', t: 0 }; return; }
  if (u.food < 0.3) { const j = findFood(u); if (j) { u.job = j; return; } }
  if (u.rest < 0.22 || (nightTime() && u.rest < 0.85)) { u.job = findBed(u); return; }
  if ((u.hypo > 0.25 || u.heatst > 0.25) && !(u.warmFailUntil > G.tick)) {
    const j = findComfort(u); if (j) { u.job = j; return; }
    u.warmFailUntil = G.tick + 300;
  }
  if (G.tick > u.idleCheck) {
    u.idleCheck = G.tick + 150;
    const j = findGear(u); if (j) { u.job = j; return; }
  }
  for (const w of WORKTYPES) {
    if (!u.work[w.id]) continue;
    const j = WORKFINDERS[w.id](u);
    if (j) { u.job = j; return; }
  }
  if (u.food < 0.5) { const j = findFood(u); if (j) { u.job = j; return; } }
  u.job = { type: 'wander', t: 0 };
}

// 가까운 후보 순으로 정렬하여 최대 n개 반환
function nearestCells(u, pred, n = 4) {
  const ux = u.x, uy = u.y, cand = [];
  for (let i = 0; i < G.cells.length; i++) {
    const c = G.cells[i];
    if (!pred(c, i)) continue;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    const ur = G.unreach.get('c' + i);
    if (ur && ur > G.tick) continue;
    cand.push([Math.abs(x + 0.5 - ux) + Math.abs(y + 0.5 - uy), i]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  return cand.slice(0, n).map(c => c[1]);
}
const cx_ = i => i % MAP_W, cy_ = i => (i / MAP_W) | 0;

function findFoodExists() { return G.cells.some(c => c.item && ITEMS[c.item.type].food); }
function findFood(u) {
  const list = nearestCells(u, (c, i) => c.item && ITEMS[c.item.type].food && !isReserved('c' + i, u), 8);
  if (!list.length) return null;
  // 식사 우선
  list.sort((a, b) => (G.cells[a].item.type === 'meal' ? 0 : 1) - (G.cells[b].item.type === 'meal' ? 0 : 1));
  const i = list[0];
  const j = { type: 'eat', cell: i, t: 0, failKey: 'c' + i };
  resv(u, j, 'c' + i);
  return j;
}
function findBed(u) {
  let best = null, bd = 1e9;
  for (const s of G.structures) {
    if (!s.built || !BUILD[s.type].bed) continue;
    if (s.owner && s.owner !== u.id && unitById(s.owner)) continue;
    if (isReserved('s' + s.id, u)) continue;
    const occ = G.units.find(o => o !== u && !o.dead && o.inBed === s.id);
    if (occ) continue;
    const d = dist(u.x, u.y, s.x, s.y) - (s.owner === u.id ? 50 : 0);
    if (d < bd) { bd = d; best = s; }
  }
  const j = { type: 'sleep', bed: best ? best.id : null, ground: !best };
  if (best) { resv(u, j, 's' + best.id); best.owner = u.id; }
  return j;
}
function findComfort(u) {
  const [lo, hi] = comfortRange(u);
  const cold = u.hypo > u.heatst;
  let best = null, bd = 1e9;
  for (const r of G.rooms) {
    if (!r || r.outdoor) continue;
    if (cold ? r.temp < lo + 2 : r.temp > hi - 2) continue;
    // 방의 임의 칸 몇 개를 확인
    for (let k = 0; k < 6; k++) {
      const i = r.cells[Math.floor(rand() * r.cells.length)], c = G.cells[i];
      if (blocksMove(c, false)) continue;
      const d = dist(u.x, u.y, cx_(i), cy_(i));
      if (d < bd) { bd = d; best = i; }
    }
  }
  if (!best && cold) {
    for (const f of G.fires) {
      const d = dist(u.x, u.y, f.x, f.y);
      if (d < bd) { bd = d; best = idx(f.x, f.y); }
    }
    if (best !== null) return { type: 'comfort', cell: best, adj: true, t: 0 };
  }
  if (best === null) return null;
  return { type: 'comfort', cell: best, adj: false, t: 0 };
}
function findGear(u) {
  const curRank = WEAPON_RANK[u.weapon] || 0;
  const wantParka = outdoorTemp() < 8 || (G.weather && G.weather.offset < -5);
  const list = nearestCells(u, (c, i) => {
    if (!c.item || isReserved('c' + i, u)) return false;
    const it = ITEMS[c.item.type];
    if (it.weapon) return (WEAPON_RANK[c.item.type] || 0) > curRank;
    if (it.apparel) {
      if (!u.apparel) return true;
      if (c.item.type === 'parka' && wantParka && u.apparel !== 'parka') return true;
      if (c.item.type === 'armor' && !wantParka && u.apparel !== 'armor') return true;
    }
    return false;
  }, 1);
  if (!list.length) return null;
  const j = { type: 'equip', cell: list[0], failKey: 'c' + list[0] };
  resv(u, j, 'c' + list[0]);
  return j;
}

const WORKFINDERS = {
  doctor(u) {
    for (const p of colonists()) {
      if (p.carriedBy || isReserved('u' + p.id, u)) continue;
      if (p.downed && !p.inBed && p !== u) {
        const bed = G.structures.find(s => s.built && BUILD[s.type].bed && !G.units.find(o => !o.dead && o.inBed === s.id) && !isReserved('s' + s.id, u) && (!s.owner || s.owner === p.id || !unitById(s.owner)));
        if (bed) {
          const j = { type: 'rescue', patient: null, pid: p.id, bed: bed.id, stage: 0 };
          resv(u, j, 'u' + p.id); resv(u, j, 's' + bed.id); return j;
        }
        // 침대가 없으면 따뜻한 실내로 옮김
        if (!isIndoor(p.x, p.y) && !p.rescuedNoBed) {
          const cf = findComfort(Object.assign({}, p, { hypo: 1, heatst: 0 }));
          if (cf && !cf.adj) {
            const j = { type: 'rescue', patient: null, pid: p.id, bed: null, cell: cf.cell, stage: 0 };
            resv(u, j, 'u' + p.id); return j;
          }
        }
      }
      if (p.downed && p.food < 0.35 && p !== u) {
        const fl = nearestCells(u, (c, i) => c.item && ITEMS[c.item.type].food && !isReserved('c' + i, u), 1);
        if (fl.length) {
          const j = { type: 'feed', pid: p.id, cell: fl[0], stage: 0, t: 0 };
          resv(u, j, 'u' + p.id); resv(u, j, 'c' + fl[0]); return j;
        }
      }
      if ((p.downed || p.hp < p.maxHp * 0.7) && !(p.treatedUntil > G.time) && (p !== u || !p.downed)) {
        const j = { type: 'treat', pid: p.id, t: 0 };
        resv(u, j, 'u' + p.id); return j;
      }
    }
    return null;
  },
  cook(u) { return findBillJob(u, 'campfire'); },
  craft(u) { return findBillJob(u, 'workbench'); },
  hunt(u) {
    if (weaponOf(u).melee) return null; // 사냥은 원거리 무기 필요
    let best = null, bd = 1e9;
    for (const a of G.units) {
      if (a.kind !== 'animal' || a.dead || !a.huntDes || isReserved('u' + a.id, u)) continue;
      const d = dist(u.x, u.y, a.x, a.y);
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return null;
    const j = { type: 'hunt', aid: best.id, t: 0 };
    resv(u, j, 'u' + best.id); return j;
  },
  construct(u) {
    // 철거 먼저
    let list = nearestCells(u, (c, i) => c.des === 'deconstruct' && c.st && !isReserved('c' + i, u), 3);
    if (list.length) return mkCellJob(u, 'deconstruct', list[0]);
    let best = null, bd = 1e9;
    for (const s of G.structures) {
      if (s.built || isReserved('c' + idx(s.x, s.y), u)) continue;
      const ur = G.unreach.get('c' + idx(s.x, s.y)); if (ur && ur > G.tick) continue;
      const c = G.cells[idx(s.x, s.y)];
      if (c.res) continue; // 나무 먼저 제거
      if (!s.paid && !canAfford(BUILD[s.type].cost)) continue;
      const d = Math.abs(s.x - u.x) + Math.abs(s.y - u.y);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return null;
    return mkCellJob(u, 'build', idx(best.x, best.y));
  },
  grow(u) {
    if (!cropSeason()) {
      const l = nearestCells(u, (c, i) => c.zone === 2 && c.crop && c.crop.g >= 1 && !isReserved('c' + i, u), 1);
      return l.length ? mkCellJob(u, 'farm', l[0]) : null;
    }
    const l = nearestCells(u, (c, i) => c.zone === 2 && !isReserved('c' + i, u) && !c.st && !c.res &&
      ((c.crop && c.crop.g >= 1) || (!c.crop && c.fert > 0 && !c.item)), 1);
    return l.length ? mkCellJob(u, 'farm', l[0]) : null;
  },
  mine(u) {
    const l = nearestCells(u, (c, i) => c.des === 'mine' && c.res && !isReserved('c' + i, u), 3);
    return l.length ? mkCellJob(u, 'gather', l[0]) : null;
  },
  chop(u) {
    const l = nearestCells(u, (c, i) => (c.des === 'chop' || (c.des === 'harvest' && c.res && c.res.grown)) && c.res && !isReserved('c' + i, u), 3);
    return l.length ? mkCellJob(u, 'gather', l[0]) : null;
  },
  haul(u) {
    if (!G.stockCells.length) return null;
    const l = nearestCells(u, (c, i) => c.item && c.zone !== 1 && !isReserved('c' + i, u), 3);
    for (const i of l) {
      const type = G.cells[i].item.type;
      const dest = findStockDest(u, type, i);
      if (dest === null) continue;
      const j = { type: 'haul', cell: i, dest, stage: 0, failKey: 'c' + i };
      resv(u, j, 'c' + i); resv(u, j, 'd' + dest);
      return j;
    }
    return null;
  },
};
function mkCellJob(u, type, i) {
  const j = { type, cell: i, t: 0, failKey: 'c' + i };
  resv(u, j, 'c' + i);
  return j;
}
function findStockDest(u, type, from) {
  let best = null, bd = 1e9;
  const fx = cx_(from), fy = cy_(from);
  for (const i of G.stockCells) {
    const c = G.cells[i];
    if (isReserved('d' + i, u) || !canHoldItem(c, type)) continue;
    let d = Math.abs(cx_(i) - fx) + Math.abs(cy_(i) - fy);
    if (c.item) d -= 6; // 같은 종류에 쌓기 선호
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function findBillJob(u, station) {
  let best = null, bd = 1e9, bill = null;
  for (const s of G.structures) {
    if (!s.built || BUILD[s.type].station !== station || isReserved('s' + s.id, u)) continue;
    const ur = G.unreach.get('s' + s.id); if (ur && ur > G.tick) continue;
    const b = s.bills.find(b => billActive(b) && canAfford(RECIPES[b.recipe].in));
    if (!b) continue;
    const d = dist(u.x, u.y, s.x, s.y);
    if (d < bd) { bd = d; best = s; bill = b; }
  }
  if (!best) return null;
  const j = { type: 'craft', sid: best.id, bill: bill.id, t: 0, paid: false, failKey: 's' + best.id };
  resv(u, j, 's' + best.id);
  return j;
}
function billActive(b) {
  if (b.paused) return false;
  if (b.mode === 'count') return b.n > 0;
  if (b.mode === 'until') { const out = Object.keys(RECIPES[b.recipe].out)[0]; return stockOf(out) < b.n; }
  return true; // forever
}
function cropSeason() { return outdoorTemp() > 2; }

// ===== 작업 실행 =====
const JOBS = {
  wander(u, j) {
    if (j.tx === undefined) {
      for (let k = 0; k < 10; k++) {
        let bx = u.x, by = u.y;
        // 집 근처로 배회
        if (G.home && dist(u.x, u.y, G.home.x, G.home.y) > 12) { bx = G.home.x; by = G.home.y; }
        const x = Math.floor(bx + randi(-5, 5)), y = Math.floor(by + randi(-5, 5));
        const c = cellAt(x, y);
        if (c && !blocksMove(c, false)) { j.tx = x; j.ty = y; break; }
      }
      if (j.tx === undefined) return 'done';
      j.wait = randi(30, 100);
    }
    const r = travel(u, j.tx, j.ty, false);
    if (r === 'fail') return 'done';
    if (r === 'arrived') { if (--j.wait <= 0) return 'done'; }
    return;
  },
  eat(u, j) {
    const c = G.cells[j.cell];
    if (!c.item || !ITEMS[c.item.type].food) return 'fail';
    const r = travel(u, cx_(j.cell), cy_(j.cell), false);
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    if (++j.t < 40) return;
    const it = ITEMS[c.item.type];
    const want = Math.max(1, Math.ceil((1 - u.food) / it.food));
    const take = c.item.type === 'meal' ? 1 : Math.min(want, c.item.n);
    u.food = Math.min(1, u.food + take * it.food);
    if (c.item.type === 'meal') addThought(u, '맛있는 식사', 0.06, DAY_MIN * 0.5);
    else addThought(u, '날음식을 먹음', -0.05, DAY_MIN * 0.5);
    const nearTable = G.structures.some(s => s.built && BUILD[s.type].table && dist(s.x, s.y, u.x, u.y) < 3);
    if (nearTable) addThought(u, '식탁에서 식사', 0.04, DAY_MIN * 0.5);
    else addThought(u, '식탁 없이 식사', -0.02, DAY_MIN * 0.5);
    c.item.n -= take; if (c.item.n <= 0) c.item = null;
    G.stockDirty = true;
    return 'done';
  },
  sleep(u, j) {
    if (!u.sleeping) {
      if (j.bed) {
        const s = G.structures.find(s => s.id === j.bed);
        if (!s || !s.built) return 'fail';
        const r = travel(u, s.x, s.y, false);
        if (r === 'fail') { j.bed = null; j.ground = true; return; }
        if (r !== 'arrived') return;
        u.inBed = s.id;
      }
      u.sleeping = true;
    }
    // 위협이 오면 기상
    if (G.tick % 30 === 0 && nearestThreat(u, 7)) { u.inBed = null; return 'done'; }
    const day = !nightTime();
    if (u.food < 0.12 && u.rest > 0.3 && findFoodExists()) { u.inBed = null; return 'done'; } // 배고프면 기상
    if (u.rest >= 1 || (day && u.rest > 0.92)) {
      if (j.ground) addThought(u, '맨바닥에서 잠', -0.07, DAY_MIN * 0.6);
      else if (isIndoor(u.x, u.y)) addThought(u, '푹 잠', 0.04, DAY_MIN * 0.6);
      if (!isIndoor(u.x, u.y)) addThought(u, '야외에서 잠', -0.05, DAY_MIN * 0.6);
      u.inBed = null;
      return 'done';
    }
  },
  comfort(u, j) {
    const r = travel(u, cx_(j.cell), cy_(j.cell), j.adj);
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    j.t++;
    if ((u.hypo < 0.05 && u.heatst < 0.05) || j.t > 600) return 'done';
  },
  equip(u, j) {
    const c = G.cells[j.cell];
    if (!c.item) return 'fail';
    const r = travel(u, cx_(j.cell), cy_(j.cell), false);
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    const type = c.item.type, it = ITEMS[type];
    c.item.n--; if (c.item.n <= 0) c.item = null;
    if (it.weapon) { if (u.weapon) dropItem(cx_(j.cell), cy_(j.cell), u.weapon, 1); u.weapon = type; }
    else { if (u.apparel) dropItem(cx_(j.cell), cy_(j.cell), u.apparel, 1); u.apparel = type; }
    G.stockDirty = true;
    log(`${u.name}이(가) ${it.name}을(를) 장착했습니다.`);
    return 'done';
  },
  gather(u, j) {
    const c = G.cells[j.cell];
    if (!c.res || !c.des) return 'fail';
    const r = travel(u, cx_(j.cell), cy_(j.cell), RES[c.res.type].blocks ? true : false);
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    const d = RES[c.res.type], skill = d.job === 'mine' ? 'mining' : 'plants';
    c.res.work = (c.res.work || 0) + workSpeed(u, skill);
    gainSkill(u, skill, 0.002);
    if (G.tick % 12 === 0) G.fx.push({ type: 'spark', x: cx_(j.cell) + 0.5, y: cy_(j.cell) + 0.5, life: 6 });
    if (c.res.work < d.work) return;
    if (c.res.grown !== false) for (const k in d.yield) dropItem(cx_(j.cell), cy_(j.cell), k, Math.round(d.yield[k] * (0.8 + u.skills[skill] * 0.02)));
    if (d.regrow && c.des !== 'chop') { c.res.grown = false; c.res.work = 0; c.res.regrowAt = G.time + d.regrow * DAY_MIN; c.des = null; }
    else { c.res = null; c.des = null; if (d.blocks) G.roomsDirty = true; }
    return 'done';
  },
  build(u, j) {
    const c = G.cells[j.cell], s = c.st;
    if (!s || s.built || c.res) return 'fail';
    const d = BUILD[s.type];
    const r = travel(u, s.x, s.y, d.blocks || d.door || d.turret ? 'strict' : true);
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    if (!s.paid) { if (!payCost(d.cost)) return 'fail'; s.paid = true; }
    // 위에 서있는 유닛 밀어내기
    s.work += workSpeed(u, 'construction');
    gainSkill(u, 'construction', 0.002);
    if (G.tick % 12 === 0) G.fx.push({ type: 'spark', x: s.x + 0.5, y: s.y + 0.5, life: 6 });
    if (s.work >= d.work) {
      if (d.blocks || d.door) for (const o of G.units) if (!o.dead && Math.floor(o.x) === s.x && Math.floor(o.y) === s.y && o !== u) {
        if (d.blocks) { o.x = u.x; o.y = u.y; o.path = null; o.pathGoal = null; }
      }
      completeStructure(s);
      if (d.station === 'campfire' && !s.bills.length) s.bills.push({ id: G.nextId++, recipe: 'meal', mode: 'until', n: 10 });
      return 'done';
    }
  },
  deconstruct(u, j) {
    const c = G.cells[j.cell], s = c.st;
    if (!s || c.des !== 'deconstruct') return 'fail';
    const r = travel(u, s.x, s.y, 'strict');
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    j.t += workSpeed(u, 'construction');
    if (j.t >= BUILD[s.type].work * 0.5) { c.des = null; removeStructure(s, 0.5); return 'done'; }
  },
  farm(u, j) {
    const c = G.cells[j.cell];
    if (c.zone !== 2) return 'fail';
    const r = travel(u, cx_(j.cell), cy_(j.cell), false);
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    j.t += workSpeed(u, 'plants');
    gainSkill(u, 'plants', 0.002);
    if (j.t < 45) return;
    if (c.crop && c.crop.g >= 1) {
      c.crop = null;
      dropItem(cx_(j.cell), cy_(j.cell), 'rice', Math.round(8 + u.skills.plants * 0.3));
    } else if (!c.crop) c.crop = { g: 0 };
    return 'done';
  },
  haul(u, j) {
    if (j.stage === 0) {
      const c = G.cells[j.cell];
      if (!c.item) return 'fail';
      const r = travel(u, cx_(j.cell), cy_(j.cell), false);
      if (r === 'fail') return 'fail';
      if (r !== 'arrived') return;
      const n = Math.min(c.item.n, ITEMS[c.item.type].stack);
      u.carry = { type: c.item.type, n };
      c.item.n -= n; if (c.item.n <= 0) c.item = null;
      j.stage = 1;
      return;
    }
    const d = G.cells[j.dest];
    if (!canHoldItem(d, u.carry.type) || d.zone !== 1) {
      const nd = findStockDest(u, u.carry.type, j.dest);
      if (nd === null) return 'fail';
      j.dest = nd; reserve(u, 'd' + nd);
    }
    const r = travel(u, cx_(j.dest), cy_(j.dest), false);
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    const dc = G.cells[j.dest];
    if (!dc.item) dc.item = { type: u.carry.type, n: 0 };
    const add = Math.min(u.carry.n, ITEMS[u.carry.type].stack - dc.item.n);
    dc.item.n += add; u.carry.n -= add;
    G.stockDirty = true;
    if (u.carry.n <= 0) { u.carry = null; return 'done'; }
    const nd = findStockDest(u, u.carry.type, j.dest);
    if (nd === null) return 'fail';
    j.dest = nd; reserve(u, 'd' + nd);
  },
  craft(u, j) {
    const s = G.structures.find(s => s.id === j.sid);
    if (!s || !s.built) return 'fail';
    const b = s.bills.find(b => b.id === j.bill);
    if (!b) return 'fail';
    const rec = RECIPES[b.recipe];
    const r = travel(u, s.x, s.y, 'strict');
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    if (!j.paid) {
      if (!billActive(b) || !payCost(rec.in)) return 'fail';
      j.paid = true;
    }
    j.t += workSpeed(u, rec.skill);
    gainSkill(u, rec.skill, 0.002);
    if (G.tick % 15 === 0) G.fx.push({ type: 'spark', x: s.x + 0.5, y: s.y + 0.5, life: 6 });
    if (j.t >= rec.work) {
      for (const k in rec.out) dropItem(Math.floor(u.x), Math.floor(u.y), k, rec.out[k]);
      if (b.mode === 'count') { b.n--; if (b.n <= 0) s.bills = s.bills.filter(o => o !== b); }
      j.paid = false;
      return 'done';
    }
  },
  hunt(u, j) {
    const a = unitById(j.aid);
    if (!a || !a.huntDes) return 'done';
    if (tryAttack(u, a)) return;
    if (G.tick % 20 === 0) { u.path = null; u.pathGoal = null; }
    const w = weaponOf(u);
    const r = travel(u, Math.floor(a.x), Math.floor(a.y), true);
    if (r === 'fail') return 'fail';
    if (++j.t > 1500) return 'fail';
    if (!w.melee && dist(u.x, u.y, a.x, a.y) < w.range - 2 && lineOfSight(u.x, u.y, a.x, a.y)) { u.path = null; u.pathGoal = null; }
  },
  treat(u, j) {
    const p = unitById(j.pid);
    if (!p || p.treatedUntil > G.time) return 'done';
    if (p !== u) {
      const r = travel(u, Math.floor(p.x), Math.floor(p.y), true);
      if (r === 'fail') return 'fail';
      if (r !== 'arrived') return;
    }
    if (!j.med) { j.med = takeStock('medicine', 1) ? 1 : -1; }
    j.t += workSpeed(u, 'medicine');
    if (j.t < 80) return;
    gainSkill(u, 'medicine', 0.3);
    const heal = (j.med > 0 ? 22 : 8) + u.skills.medicine;
    p.hp = Math.min(p.maxHp, p.hp + heal);
    p.treatedUntil = G.time + DAY_MIN;
    log(`${u.name}이(가) ${p.name}을(를) 치료했습니다${j.med > 0 ? ' (약품 사용)' : ''}.`, 'good');
    return 'done';
  },
  feed(u, j) {
    const p = unitById(j.pid);
    if (!p || !p.downed) return 'done';
    if (j.stage === 0) {
      const c = G.cells[j.cell];
      if (!c.item || !ITEMS[c.item.type].food) return 'fail';
      const r = travel(u, cx_(j.cell), cy_(j.cell), false);
      if (r === 'fail') return 'fail';
      if (r !== 'arrived') return;
      const it = ITEMS[c.item.type];
      const n = c.item.type === 'meal' ? 1 : Math.min(c.item.n, Math.ceil((1 - p.food) / it.food));
      u.carry = { type: c.item.type, n };
      c.item.n -= n; if (c.item.n <= 0) c.item = null;
      G.stockDirty = true;
      j.stage = 1; return;
    }
    const r = travel(u, Math.floor(p.x), Math.floor(p.y), true);
    if (r === 'fail') return 'fail';
    if (r !== 'arrived') return;
    if (++j.t < 40) return;
    p.food = Math.min(1, p.food + u.carry.n * ITEMS[u.carry.type].food);
    log(`${u.name}이(가) ${p.name}에게 음식을 먹였습니다.`);
    u.carry = null;
    return 'done';
  },
  rescue(u, j) {
    const p = unitById(j.pid);
    const bed = j.bed ? G.structures.find(s => s.id === j.bed) : null;
    if (!p || !p.downed || (j.bed && (!bed || !bed.built))) { if (p) p.carriedBy = null; return 'done'; }
    const tx = bed ? bed.x : cx_(j.cell), ty = bed ? bed.y : cy_(j.cell);
    if (j.stage === 0) {
      const r = travel(u, Math.floor(p.x), Math.floor(p.y), true);
      if (r === 'fail') return 'fail';
      if (r !== 'arrived') return;
      j.stage = 1; j.patient = p.id; p.carriedBy = u.id;
      return;
    }
    p.x = u.x; p.y = u.y - 0.2;
    const r = travel(u, tx, ty, false);
    if (r === 'fail') { p.carriedBy = null; return 'fail'; }
    if (r !== 'arrived') return;
    p.x = tx + 0.5; p.y = ty + 0.5; p.carriedBy = null; j.patient = null;
    if (bed) { p.inBed = bed.id; bed.owner = bed.owner || p.id; } else p.rescuedNoBed = true;
    log(`${u.name}이(가) ${p.name}을(를) ${bed ? '침대로' : '실내로'} 옮겼습니다.`, 'good');
    return 'done';
  },
  flee(u, j) {
    const a = unitById(j.from);
    if (!a || a.downed || ++j.t > 300 || dist(u.x, u.y, a.x, a.y) > 14) return 'done';
    if (!j.to || j.t % 60 === 0) {
      // 위협 반대 방향, 가능하면 실내로
      const ang = Math.atan2(u.y - a.y, u.x - a.x);
      let best = null;
      for (let k = 0; k < 12; k++) {
        const r = 6 + k, an = ang + (rand() - 0.5) * 1.2;
        const x = clamp(Math.floor(u.x + Math.cos(an) * r), 0, MAP_W - 1), y = clamp(Math.floor(u.y + Math.sin(an) * r), 0, MAP_H - 1);
        if (!blocksMove(G.cells[idx(x, y)], false)) { best = { x, y }; break; }
      }
      if (!best) return 'done';
      j.to = best; u.path = null; u.pathGoal = null;
    }
    if (travel(u, j.to.x, j.to.y, false) !== 'moving') j.to = null;
  },
  fight(u, j) {
    const a = unitById(j.target);
    if (!a || a.downed || ++j.t > 600) return 'done';
    if (!tryAttack(u, a)) {
      if (dist(u.x, u.y, a.x, a.y) > 16) return 'done';
      if (G.tick % 15 === 0) { u.path = null; u.pathGoal = null; }
      if (travel(u, Math.floor(a.x), Math.floor(a.y), true) === 'fail') return 'done';
    }
  },
};

// ===== 적 / 동물 AI =====
function updateRaider(u) {
  if (u.cd > 0) u.cd--;
  if (u.fleeing) {
    const ex = u.fleeTo.x, ey = u.fleeTo.y;
    const r = travel(u, ex, ey, false);
    if (r === 'arrived' || r === 'fail' || Math.floor(u.x) <= 0 || Math.floor(u.y) <= 0 || Math.floor(u.x) >= MAP_W - 1 || Math.floor(u.y) >= MAP_H - 1) {
      u.dead = true; u.escaped = true;
    }
    return;
  }
  let t = u.target && unitById(u.target);
  if (!t || t.downed || G.tick >= u.retarget) {
    u.retarget = G.tick + 60;
    t = null; let bd = 1e9;
    for (const o of G.units) {
      if (o.dead || o.downed || !hostile(u, o) || o.kind === 'animal') continue;
      const d = dist(u.x, u.y, o.x, o.y);
      if (d < bd) { bd = d; t = o; }
    }
    u.target = t ? t.id : null;
  }
  // 터렛 우선 공격 (가까우면)
  const tur = G.structures.find(s => s.built && BUILD[s.type].turret && dist(s.x + 0.5, s.y + 0.5, u.x, u.y) < (weaponOf(u).melee ? 1.6 : weaponOf(u).range) && lineOfSight(u.x, u.y, s.x + 0.5, s.y + 0.5));
  if (t && tryAttack(u, t)) return;
  const other = nearestHostile(u, weaponOf(u).melee ? 1.6 : weaponOf(u).range, true);
  if (other && tryAttack(u, other)) return;
  if (tur) { tryAttackStructure(u, tur); return; }
  if (!t) {
    // 서 있는 정착민이 없으면 약탈 후 철수
    const raid = G.raids.find(r => r.id === u.group);
    if (raid && !raid.fleeing) {
      raid.fleeing = true; raid.looted = true;
      const k = pick(['wood', 'steel', 'meal', 'medicine', 'leather', 'stone']);
      const n = Math.floor(stockOf(k) * 0.4);
      if (n > 0) takeStock(k, n);
      log(`약탈자들이 ${n > 0 ? ITEMS[k].name + ' ' + n + '개를 약탈하고 ' : ''}떠납니다.`, 'bad');
      for (const m of G.units) if (m.group === u.group && !m.dead) { m.fleeing = true; m.fleeTo = edgeSpot(); m.path = null; m.pathGoal = null; }
    } else if (!raid) { u.fleeing = true; u.fleeTo = edgeSpot(); }
    return;
  }
  if (G.tick >= u.repath) { u.repath = G.tick + 40; u.path = null; u.pathGoal = null; }
  travel(u, Math.floor(t.x), Math.floor(t.y), true);
}

function updateAnimal(u) {
  if (u.cd > 0) u.cd--;
  const d = ANIMALS[u.atype];
  if (u.manhunter) {
    let t = u.target && unitById(u.target);
    if (!t || t.downed || G.tick % 90 === 0) {
      let bd = 1e9; t = null;
      for (const o of colonists()) { if (o.downed) continue; const dd = dist(u.x, u.y, o.x, o.y); if (dd < bd) { bd = dd; t = o; } }
      u.target = t ? t.id : null;
    }
    if (t) {
      if (tryAttack(u, t)) return;
      if (G.tick % 30 === 0) { u.path = null; u.pathGoal = null; }
      if (travel(u, Math.floor(t.x), Math.floor(t.y), true) !== 'fail') return;
    }
  }
  // 반격 / 도주
  const recentHurt = u.lastHurtBy && G.tick - u.lastHurtT < (d.passive ? 160 : 400);
  if (recentHurt) {
    const a = unitById(u.lastHurtBy);
    if (a && a.downed && !d.passive) u.lastHurtBy = null;
    else if (a) {
      if (d.passive) {
        if (!u.fleeT || G.tick > u.fleeT) {
          u.fleeT = G.tick + 80;
          const ang = Math.atan2(u.y - a.y, u.x - a.x);
          const fx = clamp(Math.floor(u.x + Math.cos(ang) * 8), 1, MAP_W - 2), fy = clamp(Math.floor(u.y + Math.sin(ang) * 8), 1, MAP_H - 2);
          u.path = null; u.pathGoal = null; u.flee = { x: fx, y: fy };
        }
        if (u.flee) travel(u, u.flee.x, u.flee.y, false);
        return;
      } else {
        if (tryAttack(u, a)) return;
        if (G.tick % 20 === 0) { u.path = null; u.pathGoal = null; }
        travel(u, Math.floor(a.x), Math.floor(a.y), true);
        return;
      }
    }
  }
  // 배회
  if (u.wait > 0) { u.wait--; return; }
  if (!u.wtx) {
    const x = clamp(Math.floor(u.x + randi(-6, 6)), 0, MAP_W - 1), y = clamp(Math.floor(u.y + randi(-6, 6)), 0, MAP_H - 1);
    if (blocksMove(G.cells[idx(x, y)], false)) { u.wait = 20; return; }
    u.wtx = { x, y };
  }
  const r = travel(u, u.wtx.x, u.wtx.y, false);
  if (r !== 'moving') { u.wtx = null; u.wait = randi(60, 240); }
}

function updateTurret(s) {
  if (s.cd > 0) { s.cd--; return; }
  const w = WEAPONS.turret;
  let best = null, bd = w.range;
  for (const o of G.units) {
    if (o.dead || o.downed || o.faction !== 'enemy') continue;
    const d = dist(s.x + 0.5, s.y + 0.5, o.x, o.y);
    if (d < bd && lineOfSight(s.x + 0.5, s.y + 0.5, o.x, o.y)) { bd = d; best = o; }
  }
  if (!best) return;
  s.cd = w.cd;
  G.fx.push({ type: 'shot', x0: s.x + 0.5, y0: s.y + 0.5, x1: best.x, y1: best.y, life: 5, color: '#9be7ff' });
  let ch = w.acc * (1 - bd / w.range * 0.3);
  if (hasCover(best)) ch *= 0.5;
  if (rand() < ch) damage(best, w.dmg * (0.8 + rand() * 0.4), null);
}
