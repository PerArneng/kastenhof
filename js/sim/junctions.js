// Junction behaviour under Swedish rules:
//  • väjningsplikt (B1) on minor legs and roundabout entries
//  • högerregeln at unsigned junctions, utfartsregeln when leaving a parking area
//  • left-turners yield to oncoming traffic
//  • don't enter a junction you can't leave (no blocking the box)
// Each yielding driver judges arrival times of conflicting traffic against a
// personal critical gap before committing to the manoeuvre.
import { CONFIG } from '../config.js';
import { travelTime } from './idm.js';

const ACC_EST = 1.2;    // assumed acceleration of other drivers when predicting
const HORIZON = 170;    // how far upstream drivers look for conflicting traffic

export function willEnter(w, pathId, steps = 4) {
  for (let k = 1; k <= steps; k++) if (w.route[w.ri + k] === pathId) return true;
  return false;
}

// All vehicles that will pass point `os` on path `O`, with their distance to it.
export function approachers(world, O, os, out = []) {
  const P = world.net.paths;
  for (const w of O.vehicles) {
    const d = os - w.s;
    if (d < -(w.len + 2.5)) continue;
    out.push({ w, d });
  }
  const seen = new Set([O.id]);
  const back = (pid, base) => {
    if (base > HORIZON) return;
    for (const pr of P[pid].prev) {
      if (seen.has(pr)) continue;
      seen.add(pr);
      const Q = P[pr];
      for (const w of Q.vehicles) if (willEnter(w, O.id)) out.push({ w, d: Q.len - w.s + base });
      back(pr, base + Q.len);
    }
  };
  back(O.id, os);
  return out;
}

const arrival = (w, d) => (d <= 0 ? 0 : travelTime(d, w.v, w.v > 4 ? 0.3 : ACC_EST, Math.max(w.v, w.path.speed * w.v0f)));

// Can vehicle `v`, whose front is `dStart` metres before the start of
// connector `conn`, safely perform the movement now?
export function gapCheck(world, v, conn, dStart) {
  const P = world.net.paths;
  const gaps = CONFIG.gaps;
  const crit = (gaps[conn.gapType] || gaps.priority) * v.gapf;
  let blockers = 0, movingBlockers = 0, priorityBlockers = 0, inside = false;
  for (const c of conn.conflicts) {
    if (!c.iYield) continue;
    const O = P[c.other];
    const dMe = dStart + c.s;
    const extra = c.kind === 'cross' ? 3.5 : 1.0;
    const myClear = travelTime(dMe + v.len + extra, v.v, v.a * 0.85, Math.max(conn.speed, 4));
    const need = Math.max(crit, myClear + gaps.margin);
    const list = approachers(world, O, c.os);
    for (const { w, d } of list) {
      if (w === v) continue;
      if (d <= 0) { inside = true; blockers++; continue; }
      if (arrival(w, d) < need) { blockers++; if (w.v > 0.5) movingBlockers++; if (!w.yielding) priorityBlockers++; }
    }
  }
  // Anyone already committed to a crossing/merging movement blocks us.
  for (const c of conn.conflicts) {
    const O = P[c.other];
    for (const w of O.committed) {
      if (w === v) continue;
      const dW = distToPoint(world, w, O, c.os);
      if (dW > -(w.len + 1.5)) { blockers++; inside = inside || dW < 0; if (w.v > 0.5) movingBlockers++; }
    }
  }
  // Exit space: never stop inside the junction.
  const out = P[conn.outLane];
  if (out) {
    let first = null;
    for (const w of out.vehicles) if (!first || w.s < first.s) first = w;
    if (first && first !== v && first.s - first.len < v.len + 2.5 && first.v < 4) { blockers++; movingBlockers++; }
  }
  return { safe: blockers === 0, blockers, movingBlockers, priorityBlockers, inside };
}

export function distToPoint(world, w, O, os) {
  if (w.path === O) return os - w.s;
  const inl = world.net.paths[O.inLane];
  if (w.path === inl) return inl.len - w.s + os;
  return os + 30; // further upstream – treat as not imminent
}

// Called for every upcoming connector on the driver's path. Returns the
// distance to a virtual stop obstacle, or Infinity.
export function junctionControl(world, v, conn, dStart) {
  // Priority side: stop for committed yielders that are crossing our path.
  let stop = Infinity;
  if (v.commit !== conn.id || dStart > 0) {
    for (const c of conn.conflicts) {
      if (c.iYield || c.kind !== 'cross') continue;
      const dC = dStart + c.s;
      if (dC < 1 || dC > 45) continue;
      const O = world.net.paths[c.other];
      for (const w of O.committed) {
        const dW = distToPoint(world, w, O, c.os);
        if (dW > -(w.len + 1) && dW < 22) {
          const dStop = dC - 3.5;
          if (dStop > (v.v * v.v) / 12) stop = Math.min(stop, dStop);
        }
      }
    }
  }
  if (conn.stopLine === null || v.commit === conn.id) return stop;

  const dStop = dStart + conn.stopLine;
  const decision = Math.max(28, (v.v * v.v) / 4 + 14);
  if (dStop > decision) return stop;
  const r = gapCheck(world, v, conn, dStart);
  let go = r.safe;
  // Deadlock breaker (e.g. three cars at a högerregeln junction): if everyone
  // involved is standing still, the one that has waited longest goes.
  if (!go && !r.inside && r.movingBlockers === 0 && r.priorityBlockers === 0 && v.waitT > 6 + (v.id % 5) * 0.4) go = true;
  const brakeDist = (v.v * v.v) / (2 * 2.6);
  if (go) {
    if (dStop < Math.max(3.5, brakeDist + 3)) commit(world, v, conn);
    v.yielding = false;
    return stop;
  }
  if (dStop < (v.v * v.v) / (2 * 7.5)) { commit(world, v, conn); return stop; } // can't stop any more
  v.yielding = true;
  return Math.min(stop, Math.max(0, dStop));
}

export function commit(world, v, conn) {
  if (v.commit === conn.id) return;
  uncommit(world, v);
  v.commit = conn.id;
  conn.committed.add(v);
}

export function uncommit(world, v) {
  if (v.commit == null) return;
  const p = world.net.paths[v.commit];
  if (p) p.committed.delete(v);
  v.commit = null;
}
