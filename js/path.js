'use strict';
// ===== A* 길찾기 =====
const PF = (() => {
  const N = MAP_W * MAP_H;
  const g = new Float32Array(N), from = new Int32Array(N), seen = new Uint32Array(N), closed = new Uint32Array(N);
  let gen = 0;
  const heap = [];
  function push(i, f) {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  }
  function pop() {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let k = 0;
      while (true) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  }
  function stepCost(c, enemy) {
    if (!TERRAIN[c.t].pass) return -1;
    if (c.res && RES[c.res.type].blocks) return -1;
    let cost = TERRAIN[c.t].cost;
    if (c.res && !RES[c.res.type].blocks) cost += 0.4;
    if (c.st && c.st.built) {
      const d = BUILD[c.st.type];
      if (enemy) {
        if (d.blocks || d.door) cost += 25; // 부수고 지나감
      } else if (d.blocks) return -1;
      if (d.cover) cost += 0.8;
    }
    return cost;
  }
  // goal: {x,y} 정확히, adj=true면 인접 칸 도착도 허용
  function find(sx, sy, tx, ty, opts = {}) {
    const enemy = !!opts.enemy, adj = !!opts.adj, maxN = opts.max || 7000;
    sx |= 0; sy |= 0; tx |= 0; ty |= 0;
    if (!inb(tx, ty)) return null;
    if (sx === tx && sy === ty) return [];
    if (adj && Math.abs(sx - tx) <= 1 && Math.abs(sy - ty) <= 1) return [];
    gen++; heap.length = 0;
    const s = idx(sx, sy), t = idx(tx, ty);
    g[s] = 0; seen[s] = gen; from[s] = -1;
    push(s, 0);
    let count = 0;
    const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return (dx + dy) + (1.414 - 2) * Math.min(dx, dy); };
    while (heap.length) {
      const [, cur] = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
      if (cur === t || (adj && Math.abs(cx - tx) <= 1 && Math.abs(cy - ty) <= 1)) {
        const path = []; let k = cur;
        while (k !== s) { path.push(k); k = from[k]; }
        return path.reverse();
      }
      if (++count > maxN) return null;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!inb(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (closed[ni] === gen) continue;
        const nc = G.cells[ni];
        let c = stepCost(nc, enemy);
        if (c < 0) {
          if (ni === t && adj) continue;
          continue;
        }
        if (dx && dy) {
          // 모서리 끼기 금지
          if (stepCost(G.cells[idx(cx + dx, cy)], enemy) < 0 || stepCost(G.cells[idx(cx, cy + dy)], enemy) < 0) continue;
          if (enemy && ((G.cells[idx(cx + dx, cy)].st && G.cells[idx(cx + dx, cy)].st.built && BUILD[G.cells[idx(cx + dx, cy)].st.type].blocks) ||
            (G.cells[idx(cx, cy + dy)].st && G.cells[idx(cx, cy + dy)].st.built && BUILD[G.cells[idx(cx, cy + dy)].st.type].blocks))) continue;
          c *= 1.414;
        }
        const ng = g[cur] + c;
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen; g[ni] = ng; from[ni] = cur;
          push(ni, ng + h(nx, ny));
        }
      }
    }
    return null;
  }
  return { find };
})();
