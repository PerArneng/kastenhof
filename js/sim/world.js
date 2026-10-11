// The traffic world: vehicles, spawning, car-following, junctions, lane changes.
// Pure JS (no rendering) so it can run headless in test/selftest.mjs.
import { CONFIG } from '../config.js';
import { idm } from './idm.js';
import { Router } from './routing.js';
import { mulberry32, pickWeighted } from './rng.js';
import { junctionControl, commit, uncommit } from './junctions.js';
import { considerLaneChange } from './lanechange.js';
import { smoothstep } from '../network/geometry.js';
import { TOGGLE_JUNCTION } from '../network/roads.js';

// Realistic Swedish fleet colours (lots of white, grey, black, some blue/red).
export const CAR_COLORS = [
  ['#f4f5f2', 22], ['#c9ccd1', 14], ['#8f949b', 10], ['#2a2d31', 14], ['#121315', 8],
  ['#2e4a7a', 8], ['#6e8db5', 4], ['#8c1c1c', 6], ['#b5651d', 2], ['#1f4d3a', 3],
  ['#d8c7a0', 2], ['#5a3b2e', 2], ['#9fb3c8', 3], ['#c8102e', 2],
];
export const TRAILER_COLORS = [['#f2f2f0', 40], ['#d9dde2', 15], ['#1d3f6e', 12], ['#7a1f1f', 8], ['#27593e', 8], ['#e3b23c', 5], ['#3b3f45', 12]];

export class World {
  constructor(net, { seed = 1, layout = 'cross' } = {}) {
    this.net = net;
    this.layout = layout;
    this.rand = mulberry32(seed);
    this.router = new Router(net);
    this.t = 0;
    this.vehicles = [];
    this.nextId = 1;
    // trips: { t, travel, stop, layout } per exited car; switches: layout changes over time.
    this.stats = { spawned: 0, exited: 0, dropped: 0, exitTimes: [], travel: [], trips: [], switches: [{ t: 0, layout }] };
    initPaths(net);
    this.routes = CONFIG.routes.map((r) => ({
      ...r, entry: net.entries[r.from], queue: 0, nextT: 0, spawned: 0,
    })).filter((r) => {
      const ok = r.entry && this.router.reach[r.from]?.has(r.to);
      if (!ok) console.warn(`route ${r.id}: no path from ${r.from} to ${r.to}`);
      return ok;
    });
    for (const r of this.routes) r.nextT = this.t + this.expSample(r.rate);
    this.listeners = new Set();
  }

  expSample(rate) {
    if (rate <= 0) return Infinity;
    return -Math.log(1 - this.rand()) / (rate / 60);
  }

  // Swap the road network under live traffic (e.g. crossing ↔ roundabout).
  // Each car is moved to the closest matching lane of the new network, heading
  // the same way, and re-routed from there. Cars that have nowhere sensible to
  // go (or would end up on top of another car) are taken off the map.
  setNetwork(net, layout) {
    initPaths(net);
    this.net = net;
    this.layout = layout;
    this.router = new Router(net);
    for (const r of this.routes) r.entry = net.entries[r.from];
    this.stats.switches.push({ t: this.t, layout });
    const kept = [];
    for (const v of this.vehicles) {
      const P = v.path, s = Math.min(v.s, P.len);
      const [x, z] = P.point(s), [tx, tz] = P.tangent(s);
      // Same lane first; near the changed junction the old lane may be gone, so look further.
      let best = null, bs = 0, bd = 0;
      for (const maxD of [3.5, 20]) {
        bd = maxD;
        for (const q of net.paths) {
          const n = q.nearest(x, z);
          if (n.d >= bd) continue;
          const [qx, qz] = q.tangent(n.s);
          if (qx * tx + qz * tz < 0.5) continue;
          best = q; bs = n.s; bd = n.d;
        }
        if (best) break;
      }
      const route = best && this.router.route(best.id, v.dest, v.seed);
      if (!route) { this.stats.dropped++; continue; }
      Object.assign(v, { path: best, s: Math.max(bs, Math.min(v.len, best.len)), route, ri: 0, commit: null, lat: 0, lat0: 0, latT: 0, lcSignal: null });
      v.v = Math.min(v.v, best.speed);
      best.vehicles.push(v);
      kept.push(v);
    }
    // Keep the front car on each path and drop anyone squeezed on top of it.
    const rm = new Set();
    for (const p of net.paths) {
      p.vehicles.sort((a, b) => b.s - a.s);
      let lead = null;
      p.vehicles = p.vehicles.filter((v) => {
        if (lead && v.s > lead.s - lead.len - 0.5) { rm.add(v); return false; }
        lead = v;
        return true;
      }).reverse();
    }
    this.stats.dropped += rm.size;
    this.vehicles = kept.filter((v) => !rm.has(v));
    for (const v of this.vehicles) {
      if (v.path.kind === 'conn') commit(this, v, v.path);
      this.updateExitSoon(v);
    }
  }

  // Mean travel time and time spent stopped for cars that left in the last
  // `window` s. With `via`, only cars that drove through the junction under test.
  recentAvg(window = 120, via = true, t1 = this.t) {
    const t0 = t1 - window;
    let n = 0, travel = 0, stop = 0;
    for (let i = this.stats.trips.length - 1; i >= 0; i--) {
      const tr = this.stats.trips[i];
      if (tr.t > t1) continue;
      if (tr.t < t0) break;
      if (via && !tr.via) continue;
      n++; travel += tr.travel; stop += tr.stop;
    }
    return n ? { n, travel: travel / n, stop: stop / n } : { n: 0, travel: NaN, stop: NaN };
  }

  setRate(id, rate) {
    const r = this.routes.find((x) => x.id === id);
    if (!r) return;
    r.rate = Math.max(0, Math.round(rate * 2) / 2);
    r.nextT = this.t + this.expSample(r.rate);
  }

  // ------------------------------------------------------------------ step
  step(dt = CONFIG.sim.dt) {
    this.t += dt;
    const paths = this.net.paths;
    for (const p of paths) {
      if (p.vehicles.length > 1) p.vehicles.sort((a, b) => a.s - b.s);
      for (let i = 0; i < p.vehicles.length; i++) p.vehicles[i].idx = i;
    }
    for (const v of this.vehicles) this.computeAcc(v);
    for (const v of this.vehicles) {
      const lc = considerLaneChange(this, v, dt);
      if (lc) this.applyLaneChange(v, lc);
    }
    const removed = [];
    for (const v of this.vehicles) if (!this.advance(v, dt)) removed.push(v);
    if (removed.length) {
      const rm = new Set(removed);
      this.vehicles = this.vehicles.filter((v) => !rm.has(v));
    }
    this.spawn();
  }

  // ------------------------------------------------------- driver decision
  lookahead(v, H) {
    const paths = this.net.paths;
    const seq = [{ p: v.path, d0: -v.s }];
    let k = v.ri, cur = v.path, d = cur.len - v.s;
    v.deadEnd = Infinity;
    while (d < H) {
      let nid = v.route[k + 1], nk = k + 1;
      if (nid === undefined) { if (cur.isExit == null) v.deadEnd = d; break; }
      if (!cur.next.includes(nid)) {
        if (nid === cur.left || nid === cur.right) {
          if (cur.endsLane || cur.next.length === 0) v.deadEnd = d;
          nid = v.route[k + 2]; nk = k + 2;
          if (nid === undefined) break;
        } else break;
      }
      const q = paths[nid];
      seq.push({ p: q, d0: d });
      d += q.len; cur = q; k = nk;
    }
    return seq;
  }

  computeAcc(v) {
    const paths = this.net.paths;
    const P = v.path;
    const bA = CONFIG.anticipationDecel;
    let v0 = Math.min(P.speed * v.v0f, v.vmax);
    const H = Math.min(280, Math.max(90, (v.v * v.v) / (2 * 1.1) + 60));
    const seq = this.lookahead(v, H);
    v.ind = 0;
    v.yielding = false;

    // Speed: limits ahead + curvature (decelerate in time for bends and roundabouts).
    for (const { p: q, d0 } of seq) {
      if (q !== P && d0 > 0) {
        const lim = Math.min(q.speed * v.v0f, v.vmax);
        v0 = Math.min(v0, Math.sqrt(lim * lim + 2 * bA * d0));
      }
      const sStart = q === P ? v.s : 0;
      for (let s = sStart; s < q.len; s += 3) {
        const d = d0 + s;
        if (d > H) break;
        const vc = q.vcurve[Math.min(q.n - 1, Math.round(s / q.ds))] * v.curveF;
        const allowed = Math.sqrt(vc * vc + 2 * bA * Math.max(0, d - 3));
        if (allowed < v0) v0 = allowed;
      }
    }

    // No undertaking on the motorway: don't pass slower cars in the lane to the left.
    if (P.motorway && P.left >= 0) {
      const L = paths[P.left];
      const sL = (v.s / P.len) * L.len;
      for (const w of L.vehicles) {
        const ds = w.s - sL;
        if (ds > 0 && ds < 60 && w.v < v.v && w.v > 9) v0 = Math.min(v0, w.v + 0.4);
      }
    }
    v0 = Math.max(v0, 0.1);
    v.v0 = v0;

    // Leader
    let gap = Infinity, vl = 0;
    const own = P.vehicles[v.idx + 1];
    if (own) { gap = own.s - own.len - v.s; vl = own.v; }
    else {
      for (let i = 1; i < seq.length; i++) {
        const q = seq[i].p;
        if (q.vehicles.length) {
          let w = q.vehicles[0];
          for (const x of q.vehicles) if (x.s < w.s) w = x;
          gap = seq[i].d0 + w.s - w.len; vl = w.v; break;
        }
      }
    }
    let acc = idm(v.v, v0, gap, v.v - vl, v);
    v.accFree = acc;
    const obstacle = (g, speed) => { const a = idm(v.v, v0, g, v.v - speed, v); if (a < acc) acc = a; };

    // Junctions, merges and conflicts ahead
    for (let i = 0; i < seq.length; i++) {
      const { p: q, d0 } = seq[i];
      if (d0 > 120) break;
      if (q.kind === 'conn' && q.conflicts.length) {
        const st = junctionControl(this, v, q, d0);
        if (st < Infinity) obstacle(st + v.s0 - 0.6, 0);
      }
      const dEnd = d0 + q.len;
      if (i + 1 < seq.length && dEnd < 70 && dEnd > -0.5) {
        const nq = seq[i + 1].p;
        if (nq.prev.length > 1) {
          for (const oid of nq.prev) {
            if (oid === q.id) continue;
            const O = paths[oid];
            const conf = q.conflicts.find((c) => c.other === oid && c.kind === 'merge');
            // Asymmetric tie band so exactly one of two converging cars gives way.
            const band = conf ? (conf.iYield ? 2.5 : -2.5) : -0.3;
            for (const w of O.vehicles) {
              const dW = O.len - w.s;
              if (dW >= dEnd + band) continue;
              const relevant = !conf || conf.iYield || w.commit === oid;
              if (relevant) obstacle(dEnd - dW - w.len, w.v);
            }
          }
        }
      }
    }
    // End of lane (e.g. acceleration lane): only start braking for it when it's close.
    if (v.deadEnd < Infinity && v.deadEnd < (v.v * v.v) / (2 * 2.2) + 30) obstacle(v.deadEnd + v.s0 - 1.0, 0);

    // Motorway courtesy: let merging traffic in from the acceleration lane.
    if (P.accelNb >= 0) {
      const A = paths[P.accelNb];
      const sA = (v.s / P.len) * A.len;
      for (const w of A.vehicles) {
        const ds = w.s - sA;
        if (w.ind === -1 && ds > 1 && ds < 45) {
          // Kugghjulsprincipen (zipper merge): when the merging car is running out
          // of acceleration lane, the car behind on the main lane lets it in.
          const zipper = w.s > A.len - 70 && w.v < v.v + 1;
          const a = idm(v.v, v0, ds - w.len + 2, v.v - w.v, v);
          if ((a > -1.6 || (zipper && a > -4.5)) && a < acc) acc = a;
        }
      }
    }

    // Indicators (Swedish law: signal when turning, changing lane and leaving a roundabout).
    for (const { p: q, d0 } of seq) {
      if (d0 > 160) break;
      if (q.kind === 'ramp' && q !== P && P.motorway && d0 < 160 && q.prev.includes(P.id)) { v.ind = 1; break; }
      if (q.kind !== 'conn' || d0 > 35) continue;
      if (q.exitConn) { if (d0 < 22 && P.kind === 'ring') v.ind = 1; break; }
      if (q.entry) break;
      if (q.turn === 'left') v.ind = -1; else if (q.turn === 'right') v.ind = 1;
      break;
    }
    if (P.kind === 'conn' && P.exitConn) v.ind = 1;
    if (P.kind === 'accel') v.ind = -1;

    v.acc = Math.max(-9, Math.min(v.a, acc));
    v.brake = v.acc < -0.7 || v.v < 0.4;
  }

  applyLaneChange(v, { target, sT, mandatory }) {
    const P = v.path;
    const [ox, oz] = P.point(v.s);
    const [nx, nz] = target.point(sT);
    const [qx, qz] = target.normal(sT);
    const lat = (ox - nx) * qx + (oz - nz) * qz + v.lat;
    if (!mandatory) {
      const r = this.router.route(target.id, v.dest, v.seed);
      if (!r) return;
      v.route = r; v.ri = 0;
    } else v.ri += 1;
    removeFrom(P.vehicles, v);
    insertSorted(target.vehicles, v, sT);
    v.path = target;
    v.s = sT;
    v.lat0 = lat; v.latT = 0; v.lat = lat;
    v.lcCool = mandatory ? 2 : 7 + this.rand() * 6;
    v.lcSignal = null;
    v.lcCount++;
    this.updateExitSoon(v);
  }

  // ---------------------------------------------------------- integration
  advance(v, dt) {
    const paths = this.net.paths;
    v.v = Math.max(0, v.v + v.acc * dt);
    v.s += v.v * dt;
    v.age += dt;
    if (v.v < 0.15) v.waitT += dt; else v.waitT = 0;
    if (v.v < 0.5) v.stopT += dt;
    if (v.lat0) {
      v.latT += dt;
      const dur = CONFIG.lc.duration;
      v.lat = v.lat0 * (1 - smoothstep(v.latT / dur));
      if (v.latT >= dur) { v.lat0 = 0; v.lat = 0; }
    }
    while (v.s > v.path.len) {
      const P = v.path;
      if (P.isExit != null && (P.isExit === v.dest || v.ri >= v.route.length - 1)) {
        this.removeVehicle(v);
        return false;
      }
      let nid = v.route[v.ri + 1];
      if (nid === undefined || !P.next.includes(nid)) {
        nid = this.reroute(v, P);
        if (nid < 0) { v.s = P.len; v.v = 0; break; }
      } else v.ri += 1;
      if (P.kind === 'conn') uncommit(this, v);
      removeFrom(P.vehicles, v);
      v.s -= P.len;
      v.path = paths[nid];
      v.path.vehicles.push(v);
      if (v.path.junction === TOGGLE_JUNCTION) v.via = true;
      if (v.path.kind === 'conn') commit(this, v, v.path);
      this.updateExitSoon(v);
    }
    return true;
  }

  reroute(v, P) {
    let best = null;
    for (const cand of P.next) {
      let r = this.router.route(cand, v.dest, v.seed);
      if (!r) continue;
      if (!best || r.length < best.length) best = r;
    }
    if (!best) {
      // Missed the exit – carry on to the nearest reachable destination.
      for (const cand of P.next) for (const x of Object.keys(this.net.exits)) {
        const r = this.router.route(cand, x, 0);
        if (r && (!best || r.length < best.length)) { best = r; v.dest = x; }
      }
    }
    if (!best) return -1;
    v.route = [P.id, ...best];
    v.ri = 1;
    return best[0];
  }

  updateExitSoon(v) {
    const paths = this.net.paths;
    v.exitSoon = false;
    for (let k = v.ri + 1; k < Math.min(v.route.length, v.ri + 3); k++) {
      const q = paths[v.route[k]];
      if (q.kind === 'ramp' && q.prev.length && paths[q.prev[0]].motorway) { v.exitSoon = true; break; }
    }
  }

  removeVehicle(v) {
    uncommit(this, v);
    removeFrom(v.path.vehicles, v);
    this.stats.exited++;
    this.stats.exitTimes.push(this.t);
    this.stats.travel.push(v.age);
    if (this.stats.travel.length > 400) this.stats.travel.shift();
    const trips = this.stats.trips;
    trips.push({ t: this.t, travel: v.age, stop: v.stopT, layout: this.layout, via: v.via });
    while (trips.length && trips[0].t < this.t - 1800) trips.shift();
  }

  throughputPerMin() {
    const t0 = this.t - 60;
    const xs = this.stats.exitTimes;
    while (xs.length && xs[0] < t0) xs.shift();
    return xs.length * (60 / Math.min(60, Math.max(1, this.t)));
  }

  // --------------------------------------------------------------- spawning
  spawn() {
    for (const rt of this.routes) {
      while (this.t >= rt.nextT) {
        rt.queue = Math.min(CONFIG.sim.maxQueue, rt.queue + 1);
        rt.nextT += this.expSample(rt.rate);
      }
      if (rt.queue > 0 && this.vehicles.length < CONFIG.sim.maxVehicles) {
        if (this.trySpawn(rt)) { rt.queue--; rt.spawned++; }
      }
    }
  }

  trySpawn(rt) {
    const paths = this.net.paths;
    const e = rt.entry, dest = rt.to;
    const lanes = e.lanes.slice();
    if (lanes.length > 1 && this.rand() > 0.6) lanes.reverse();
    const motorway = !!e.motorway;
    const truck = this.rand() < (motorway ? (dest === e.id ? CONFIG.truckShare.motorway : 0.03) : CONFIG.truckShare.other) && !e.parking;
    const P = CONFIG.idm[truck ? 'truck' : 'car'];
    const r = this.rand;
    const len = P.len[0] + (P.len[1] - P.len[0]) * r();
    for (const laneId of lanes) {
      const L = paths[laneId];
      let first = null;
      for (const w of L.vehicles) if (!first || w.s < first.s) first = w;
      const sSpawn = len + 0.3;
      const v0f = truck ? 1 : 0.9 + r() * 0.22;
      const vDes = Math.min(L.speed * v0f, truck ? P.vmax / 3.6 : 99);
      let vs = e.parking ? 0 : vDes * 0.95;
      if (first) {
        const gap = first.s - first.len - sSpawn;
        if (gap < P.s0 + (e.parking ? 5 : 2)) continue;
        if (!e.parking) {
          vs = Math.min(vs, first.v + Math.sqrt(2 * 1.5 * Math.max(0, gap - 8)));
          const need = P.s0 + vs * P.T;
          if (gap < need) vs = Math.max(0, (gap - P.s0) / P.T);
        }
      }
      const seed = (this.nextId * 2654435761) >>> 0 || 1;
      const route = this.router.route(laneId, dest, seed);
      if (!route) continue;
      const v = {
        id: this.nextId++, type: truck ? 'truck' : 'car', len, width: P.width,
        a: P.a * (0.85 + r() * 0.3), b: P.b * (0.9 + r() * 0.2), T: P.T * (0.85 + r() * 0.35), s0: P.s0,
        v0f, vmax: truck ? P.vmax / 3.6 : 99, curveF: 0.92 + r() * 0.16, gapf: 0.85 + r() * 0.3,
        path: L, s: sSpawn, v: vs, acc: 0, accFree: 0, v0: vDes, route, ri: 0, dest, seed,
        color: pickWeighted(r, truck ? TRAILER_COLORS : CAR_COLORS), cabColor: pickWeighted(r, CAR_COLORS),
        commit: null, waitT: 0, stopT: 0, via: false, age: 0, lat: 0, lat0: 0, latT: 0, lcCool: 3, lcSignal: null, lcCount: 0,
        ind: 0, brake: false, yielding: false, exitSoon: false, origin: e.id, routeId: rt.id, idx: 0,
      };
      L.vehicles.push(v);
      this.vehicles.push(v);
      this.updateExitSoon(v);
      this.stats.spawned++;
      return true;
    }
    return false;
  }
}

function initPaths(net) {
  for (const p of net.paths) { p.vehicles = []; p.committed = new Set(); p.accelNb = -1; }
  for (const p of net.paths) if (p.kind === 'accel') net.paths[p.left].accelNb = p.id;
}
function removeFrom(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); }
function insertSorted(arr, v, s) {
  let i = 0;
  while (i < arr.length && arr[i].s < s) i++;
  arr.splice(i, 0, v);
  for (let k = 0; k < arr.length; k++) arr[k].idx = k;
}
