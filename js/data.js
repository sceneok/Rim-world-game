'use strict';
// ===== 기본 상수 =====
const TILE = 32;
const MAP_W = 90, MAP_H = 70;
const TICKS_PER_SEC = 20;
const MIN_PER_TICK = 0.2;         // 1배속에서 틱당 게임 분 (하루 = 6분)
const DAY_MIN = 1440;
const SEASON_DAYS = 6;
const MAX_ROOM = 400;

const SEASONS = [
  { name: '봄', temp: 12 },
  { name: '여름', temp: 26 },
  { name: '가을', temp: 6 },
  { name: '겨울', temp: -16 },
];

// ===== 지형 =====
const T = { GRASS: 0, DIRT: 1, SAND: 2, WATER: 3, STONE: 4, MARSH: 5 };
const TERRAIN = [
  { name: '풀밭', color: '#4f6b34', pass: true, cost: 1, fertile: 1.0 },
  { name: '흙', color: '#6b5636', pass: true, cost: 1, fertile: 0.8 },
  { name: '모래', color: '#b8a36a', pass: true, cost: 1.4, fertile: 0 },
  { name: '물', color: '#2d5b86', pass: false, cost: 99, fertile: 0 },
  { name: '암반', color: '#5c5a57', pass: true, cost: 1, fertile: 0 },
  { name: '습지', color: '#3d5a46', pass: true, cost: 2, fertile: 0.5 },
];

// ===== 아이템 =====
const ITEMS = {
  wood:     { name: '목재', icon: '🪵', stack: 75 },
  stone:    { name: '석재', icon: '🧱', stack: 75 },
  steel:    { name: '강철', icon: '🔩', stack: 75 },
  berries:  { name: '산딸기', icon: '🍓', stack: 75, food: 0.05, raw: true },
  meat:     { name: '고기', icon: '🥩', stack: 75, food: 0.05, raw: true },
  rice:     { name: '쌀', icon: '🌾', stack: 75, food: 0.05, raw: true },
  meal:     { name: '간단한 식사', icon: '🍲', stack: 20, food: 0.9 },
  leather:  { name: '가죽', icon: '🟫', stack: 75 },
  herb:     { name: '약초', icon: '🌿', stack: 50 },
  medicine: { name: '약품', icon: '💊', stack: 25 },
  club:     { name: '몽둥이', icon: '🏏', stack: 1, weapon: 'club' },
  spear:    { name: '창', icon: '🔱', stack: 1, weapon: 'spear' },
  bow:      { name: '활', icon: '🏹', stack: 1, weapon: 'bow' },
  rifle:    { name: '소총', icon: '🔫', stack: 1, weapon: 'rifle' },
  parka:    { name: '파카', icon: '🧥', stack: 1, apparel: { cold: 28, heat: -4, armor: 0.1 } },
  armor:    { name: '가죽 갑옷', icon: '🦺', stack: 1, apparel: { cold: 10, heat: -2, armor: 0.3 } },
};
const RAW_FOODS = ['berries', 'meat', 'rice'];
const RES_DISPLAY = ['wood', 'stone', 'steel', 'meal', 'raw', 'leather', 'herb', 'medicine'];

// ===== 무기 (cd/틱) =====
const WEAPONS = {
  fists:  { name: '맨손', melee: true, dmg: 5, cd: 24 },
  club:   { name: '몽둥이', melee: true, dmg: 10, cd: 28 },
  spear:  { name: '창', melee: true, dmg: 15, cd: 32 },
  bow:    { name: '활', melee: false, dmg: 11, cd: 46, range: 9, acc: 0.62 },
  rifle:  { name: '소총', melee: false, dmg: 16, cd: 40, range: 13, acc: 0.72 },
  bite:   { name: '이빨', melee: true, dmg: 9, cd: 26 },
  turret: { name: '터렛', melee: false, dmg: 11, cd: 30, range: 11, acc: 0.7 },
};
const WEAPON_RANK = { club: 1, spear: 2, bow: 3, rifle: 4 };

// ===== 자연 자원 (맵 오브젝트) =====
const RES = {
  tree:  { name: '나무', icon: '🌲', job: 'chop', work: 110, yield: { wood: 25 }, blocks: false },
  pine:  { name: '소나무', icon: '🌳', job: 'chop', work: 130, yield: { wood: 30 }, blocks: false },
  bush:  { name: '산딸기 덤불', icon: '🍓', job: 'harvest', work: 50, yield: { berries: 12 }, blocks: false, regrow: 3 },
  herb:  { name: '야생 약초', icon: '🌿', job: 'harvest', work: 50, yield: { herb: 5 }, blocks: false, regrow: 4 },
  rock:  { name: '암석', icon: null, job: 'mine', work: 180, yield: { stone: 18 }, blocks: true },
  ore:   { name: '강철 광맥', icon: null, job: 'mine', work: 240, yield: { steel: 25 }, blocks: true },
};

// ===== 건축물 =====
const BUILD = {
  wall_wood:  { name: '나무 벽', cat: 'struct', cost: { wood: 5 }, work: 60, hp: 160, wall: true, blocks: true, desc: '기본 벽. 방을 만들어 실내 온도를 유지합니다.' },
  wall_stone: { name: '석재 벽', cat: 'struct', cost: { stone: 5 }, work: 110, hp: 380, wall: true, blocks: true, desc: '튼튼한 벽.' },
  door:       { name: '문', cat: 'struct', cost: { wood: 15 }, work: 80, hp: 180, door: true, desc: '정착민만 통과. 적은 부수려 합니다.' },
  sandbag:    { name: '모래주머니', cat: 'defense', cost: { stone: 4 }, work: 40, hp: 140, cover: true, desc: '인접한 아군의 피격률을 크게 낮춥니다.' },
  turret:     { name: '방어 터렛', cat: 'defense', cost: { steel: 60, wood: 20 }, work: 260, hp: 220, blocks: true, turret: true, desc: '사거리 11. 적을 자동 사격.' },
  spikes:     { name: '가시 함정', cat: 'defense', cost: { wood: 20 }, work: 70, hp: 60, trap: true, desc: '밟은 적에게 큰 피해(1회).' },
  bed:        { name: '침대', cat: 'furn', cost: { wood: 30 }, work: 120, hp: 90, bed: true, desc: '숙면. 회복 속도 상승.' },
  table:      { name: '식탁', cat: 'furn', cost: { wood: 25 }, work: 80, hp: 90, table: true, desc: '근처에서 식사하면 기분이 좋아집니다.' },
  campfire:   { name: '모닥불', cat: 'prod', cost: { wood: 20 }, work: 60, hp: 60, station: 'campfire', heat: 8, desc: '요리 + 주변 난방.' },
  workbench:  { name: '작업대', cat: 'prod', cost: { wood: 50 }, work: 150, hp: 120, station: 'workbench', desc: '무기/의복/약품 제작.' },
  heater:     { name: '난방기', cat: 'temp', cost: { steel: 30, stone: 10 }, work: 150, hp: 100, heater: true, desc: '방 온도를 22°C까지 올립니다.' },
  cooler:     { name: '냉각기', cat: 'temp', cost: { steel: 35, stone: 10 }, work: 150, hp: 100, cooler: true, desc: '방 온도를 18°C까지 내립니다.' },
};
const BUILD_CATS = [
  { id: 'orders', name: '명령' },
  { id: 'zones', name: '구역' },
  { id: 'struct', name: '구조물' },
  { id: 'furn', name: '가구' },
  { id: 'prod', name: '생산' },
  { id: 'temp', name: '온도' },
  { id: 'defense', name: '방어' },
];
const ORDERS = [
  { id: 'chop', name: '벌목', desc: '드래그로 나무를 벌목 지정' },
  { id: 'mine', name: '채굴', desc: '드래그로 암석/광맥 채굴 지정' },
  { id: 'harvest', name: '채집', desc: '덤불/약초 채집 지정' },
  { id: 'hunt', name: '사냥', desc: '동물 사냥 지정 (원거리 무기를 가진 정착민만 사냥)' },
  { id: 'deconstruct', name: '철거', desc: '건물 철거 (재료 일부 회수)' },
  { id: 'cancel', name: '취소', desc: '지정/청사진 취소' },
];
const ZONES = [
  { id: 'stockpile', name: '비축 구역', desc: '자원이 이곳에 운반되어 보관됩니다.' },
  { id: 'farm', name: '재배 구역', desc: '쌀을 재배합니다. (비옥한 땅, 겨울엔 성장 정지)' },
  { id: 'clearzone', name: '구역 삭제', desc: '구역 지정 해제' },
];

// ===== 제작 =====
const RECIPES = {
  meal:     { name: '간단한 식사', station: 'campfire', in: { raw: 10 }, out: { meal: 1 }, work: 90, skill: 'cooking' },
  meal4:    { name: '식사 x4 (대량)', station: 'campfire', in: { raw: 40 }, out: { meal: 4 }, work: 300, skill: 'cooking' },
  club:     { name: '몽둥이', station: 'workbench', in: { wood: 25 }, out: { club: 1 }, work: 150, skill: 'crafting' },
  spear:    { name: '창', station: 'workbench', in: { wood: 20, steel: 20 }, out: { spear: 1 }, work: 260, skill: 'crafting' },
  bow:      { name: '활', station: 'workbench', in: { wood: 45 }, out: { bow: 1 }, work: 260, skill: 'crafting' },
  parka:    { name: '파카', station: 'workbench', in: { leather: 40 }, out: { parka: 1 }, work: 300, skill: 'crafting' },
  armor:    { name: '가죽 갑옷', station: 'workbench', in: { leather: 50, steel: 10 }, out: { armor: 1 }, work: 340, skill: 'crafting' },
  medicine: { name: '약품', station: 'workbench', in: { herb: 6 }, out: { medicine: 1 }, work: 120, skill: 'medicine' },
};

// ===== 정착민 =====
const SKILLS = {
  shooting: '사격', melee: '근접', construction: '건설', mining: '채굴',
  plants: '식물', cooking: '요리', crafting: '제작', medicine: '의료',
};
const WORKTYPES = [
  { id: 'doctor', name: '의료', skill: 'medicine' },
  { id: 'cook', name: '요리', skill: 'cooking' },
  { id: 'hunt', name: '사냥', skill: 'shooting' },
  { id: 'construct', name: '건설', skill: 'construction' },
  { id: 'grow', name: '재배', skill: 'plants' },
  { id: 'mine', name: '채굴', skill: 'mining' },
  { id: 'chop', name: '벌목/채집', skill: 'plants' },
  { id: 'craft', name: '제작', skill: 'crafting' },
  { id: 'haul', name: '운반', skill: null },
];
const TRAITS = [
  { id: 'industrious', name: '근면함', desc: '작업 속도 +25%' },
  { id: 'tough', name: '강인함', desc: '받는 피해 -35%' },
  { id: 'coldres', name: '추위에 강함', desc: '견딜 수 있는 최저 온도 -10°C' },
  { id: 'smalleater', name: '소식가', desc: '허기 감소 -30%' },
  { id: 'sharpshooter', name: '명사수', desc: '명중률 +15%' },
  { id: 'nightowl', name: '올빼미', desc: '수면 필요 -25%' },
  { id: 'optimist', name: '낙천가', desc: '기분 +12%' },
  { id: 'fast', name: '날렵함', desc: '이동 속도 +20%' },
];
const NAMES = ['민준', '서연', '도윤', '하은', '지호', '수아', '준우', '지유', '현우', '채원', '태민', '유나',
  '건우', '소율', '시우', '예린', '우진', '다인', '은호', '세아', '재현', '나연', '동현', '가윤', '진혁', '보라'];
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권'];
const RAIDER_NAMES = ['약탈자', '해적', '도적', '무법자', '추방자', '광신도'];
const COLONIST_COLORS = ['#5aa9e6', '#7fc8a9', '#f2c14e', '#c38bd9', '#f78154', '#4ecdc4', '#a3d977', '#e07a9a', '#9db4ff'];

const ANIMALS = {
  deer:   { name: '사슴', icon: '🦌', hp: 50, speed: 0.13, yield: { meat: 40, leather: 20 }, weapon: 'bite', passive: true },
  rabbit: { name: '토끼', icon: '🐇', hp: 15, speed: 0.12, yield: { meat: 10, leather: 5 }, weapon: 'bite', passive: true },
  boar:   { name: '멧돼지', icon: '🐗', hp: 70, speed: 0.13, yield: { meat: 50, leather: 25 }, weapon: 'bite', passive: false },
  wolf:   { name: '늑대', icon: '🐺', hp: 55, speed: 0.17, yield: { meat: 30, leather: 20 }, weapon: 'bite', passive: false },
  bear:   { name: '곰', icon: '🐻', hp: 140, speed: 0.12, yield: { meat: 80, leather: 45 }, weapon: 'bite', passive: false, dmgMul: 1.8 },
};
