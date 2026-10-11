// Lane changing on the motorway (MOBIL-style incentive + safety criterion).
// Swedish rules applied: keep to the right lane (håll till höger), overtake on
// the left only, merge from acceleration lanes by finding a safe gap, and
// signal before changing lane.
import { CONFIG } from '../config.js';
import { idm } from './idm.js';

export function laneNeighbours(world, P, s, T) {
  const sT = (s / P.len) * T.len;
  const paths = world.net.paths;
  let leader = null, gL = Infinity, follower = null, gF = Infinity;
  for (const w of T.vehicles) {
    if (w.s >= sT) { const g = w.s - w.len - sT; if (g < gL) { gL = g; leader = w; } }
    else { const g = sT - w.s; if (g < gF) { gF = g; follower = w; } }
  }
  // Past the end of the lane, a leader can be on any successor (e.g. an off-ramp).
  if (!leader) {
    for (const nid of T.next) {
      const N = paths[nid];
      for (const w of N.vehicles) { const g = T.len - sT + w.s - w.len; if (g < gL) { gL = g; leader = w; } }
    }
  }
  if (!follower) {
    for (const pid of T.prev) {
      const Q = paths[pid];
      for (const w of Q.vehicles) { const g = sT + Q.len - w.s; if (g < gF) { gF = g; follower = w; } }
    }
  }
  return { sT, leader, gL, follower, gF };
}

function accOn(v, v0, nb, vehLen) {
  const gL = nb.leader ? nb.gL : Infinity;
  const me = idm(v.v, v0, gL, nb.leader ? v.v - nb.leader.v : 0, v);
  let fOld = 0, fNew = 0;
  if (nb.follower) {
    const f = nb.follower;
    const gF = nb.gF - vehLen;
    fNew = idm(f.v, f.v0, gF, f.v - v.v, f);
    fOld = idm(f.v, f.v0, nb.gL < Infinity ? nb.gL + gF + vehLen : Infinity, f.v - (nb.leader ? nb.leader.v : f.v), f);
  }
  return { me, fNew, fOld, gFront: gL, gBack: nb.follower ? nb.gF - vehLen : Infinity };
}

export function isSafe(v, nb, a, urgent) {
  const bSafe = CONFIG.lc.bSafe + (urgent ? 1.5 : 0);
  if (a.gFront < Math.max(1.5, v.v * (urgent ? 0.25 : 0.5))) return false;
  if (a.gBack < Math.max(1.5, (nb.follower ? nb.follower.v : 0) * (urgent ? 0.25 : 0.45))) return false;
  if (a.me < -bSafe) return false;
  if (nb.follower && a.fNew < -bSafe) {
    // Urgent merges: accept if the follower can avoid us with firm-but-normal braking.
    if (!urgent) return false;
    const dv = nb.follower.v - v.v;
    const room = a.gBack - 2;
    if (room <= 0 || (dv > 0 && (dv * dv) / (2 * room) > 3.2)) return false;
  }
  return true;
}

// Decide (and possibly execute) a lane change for vehicle v. Returns target path or null.
export function considerLaneChange(world, v, dt) {
  const P = v.path;
  if (P.kind !== 'lane' && P.kind !== 'accel') return null;
  if (!P.motorway) return null;
  v.lcCool -= dt;
  const paths = world.net.paths;
  const next = v.route[v.ri + 1];
  let target = null, mandatory = false;
  if (next !== undefined && (next === P.left || next === P.right)) { target = next; mandatory = true; }

  const remaining = P.len - v.s;
  if (!mandatory) {
    if (v.lcCool > 0 || v.v < 8 || remaining < 25 || v.s < 10) { v.lcSignal = null; return null; }
    if (v.exitSoon) { v.lcSignal = null; return null; }
    // discretionary: overtake left, return right
    const cand = [];
    if (P.left >= 0 && !paths[P.left].noEnter) cand.push([P.left, 'left']);
    if (P.right >= 0 && !paths[P.right].noEnter) cand.push([P.right, 'right']);
    const cur = v.accFree;
    for (const [tid, side] of cand) {
      const T = paths[tid];
      const nb = laneNeighbours(world, P, v.s, T);
      const a = accOn(v, v.v0, nb, v.len);
      if (!isSafe(v, nb, a, false)) continue;
      const pol = CONFIG.lc.politeness * (a.fNew - a.fOld);
      const bias = side === 'right' ? CONFIG.lc.keepRightBias : -CONFIG.lc.keepRightBias;
      const thr = CONFIG.lc.threshold + (v.type === 'truck' ? 0.4 : 0);
      if (a.me - cur + pol + bias > thr) { target = tid; break; }
    }
    if (target === null) { v.lcSignal = null; return null; }
  }

  // Signal before changing lane (blinkers on for ~1 s).
  const T = paths[target];
  const side = target === P.left ? -1 : 1;
  if (!v.lcSignal || v.lcSignal.target !== target) { v.lcSignal = { target, t: 0 }; }
  v.lcSignal.t += dt;
  v.ind = side;
  const urgent = mandatory && (P.endsLane || remaining < 120);
  if (v.lcSignal.t < (urgent && remaining < 40 ? 0.3 : CONFIG.lc.signalTime)) return null;

  const nb = laneNeighbours(world, P, v.s, T);
  const a = accOn(v, v.v0, nb, v.len);
  if (!isSafe(v, nb, a, urgent)) return null;
  return { target: T, sT: nb.sT, mandatory };
}
