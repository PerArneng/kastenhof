// Route choice: Dijkstra over lane paths with per-driver perception noise, so
// drivers spread over the plausible alternatives instead of all taking one.
import { CONFIG } from '../config.js';
import { hash2, gaussFrom } from './rng.js';

export class Router {
  constructor(net) {
    this.net = net;
    this.reach = {}; // entryId -> Set(exitId)
    for (const e of Object.values(net.entries)) {
      const set = new Set();
      for (const lane of e.lanes) for (const x of Object.keys(net.exits)) if (this.route(lane, x, 0)) set.add(x);
      this.reach[e.id] = set;
    }
  }

  linkTime(p, seed) {
    const base = p.len / Math.max(3, p.speed);
    let f = 1;
    if (seed) {
      const key = p.roadId ? hashStr(p.roadId) : p.id;
      const g = gaussFrom(hash2(seed, key) || 1e-6, hash2(seed + 7, key + 13));
      f = Math.exp(CONFIG.routing.noise * g);
    }
    return base * f;
  }

  // Returns an array of path ids from `start` to any path that exits at `dest`.
  route(start, dest, seed) {
    const P = this.net.paths;
    const n = P.length;
    const cost = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    cost[start] = 0;
    const pen = CONFIG.routing.penalty;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && cost[i] < best) { best = cost[i]; u = i; }
      if (u < 0) return null;
      done[u] = 1;
      const pu = P[u];
      if (pu.isExit === dest) {
        const out = [];
        for (let k = u; k >= 0; k = prev[k]) out.push(k);
        return out.reverse();
      }
      const relax = (v, c) => { if (c < cost[v]) { cost[v] = c; prev[v] = u; } };
      for (const v of pu.next) {
        const q = P[v];
        let c = best + this.linkTime(q, seed);
        if (q.roadId && pen[q.roadId] && pu.roadId !== q.roadId) c += pen[q.roadId];
        relax(v, c);
      }
      const lcCost = CONFIG.routing.laneChangeCost;
      if (pu.left >= 0 && !P[pu.left].noEnter) relax(pu.left, best + lcCost);
      if (pu.right >= 0 && !P[pu.right].noEnter) relax(pu.right, best + lcCost);
    }
  }
}

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
