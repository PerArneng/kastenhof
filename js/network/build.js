// Turns the declarative network (roads.js) into a directed lane graph:
// lane paths, junction connectors, roundabout ring segments, conflict points,
// stop lines, elevation profiles and curve speed limits.
import { CONFIG, kmh } from '../config.js';
import { NETWORK } from './roads.js';
import {
  Polyline, catmullRom, cubicBezier, intersectPolylines, dist, smoothstep,
  wrapAngle, angleOf,
} from './geometry.js';

const S = CONFIG.scale;
const rank = { major: 2, minor: 1, exit: 0, equal: 1 };
export const toM = ([px, py]) => [(px - CONFIG.mapW / 2) * S, (py - CONFIG.mapH / 2) * S];
export const MAP_HALF = [CONFIG.mapW * S / 2, CONFIG.mapH * S / 2];

// Laplacian smoothing of traced control points (removes snapping jitter that
// would otherwise show up as phantom curves and slow drivers down).
export function smoothCtrl(pts, iters = 4, keepEnds = 1) {
  let p = pts.map((q) => q.slice());
  for (let it = 0; it < iters; it++) {
    const o = p.map((q) => q.slice());
    for (let i = keepEnds; i < p.length - keepEnds; i++) {
      o[i][0] = 0.25 * p[i - 1][0] + 0.5 * p[i][0] + 0.25 * p[i + 1][0];
      o[i][1] = 0.25 * p[i - 1][1] + 0.5 * p[i][1] + 0.25 * p[i + 1][1];
    }
    p = o;
  }
  return p;
}

const insideMap = ([x, z], pad = 0) => Math.abs(x) <= MAP_HALF[0] - pad && Math.abs(z) <= MAP_HALF[1] - pad;

export function buildNetwork(def = NETWORK) {
  const net = {
    paths: [], junctions: {}, entries: {}, exits: {}, carriageways: {},
    rawRoads: {}, pieces: [], ramps: {}, bumps: {}, parking: [], yieldMarks: [],
  };

  const addPath = (pts, props) => {
    const p = new Polyline(pts, 1);
    Object.assign(p, {
      id: net.paths.length, next: [], prev: [], left: -1, right: -1, conflicts: [],
      vehicles: [], kind: 'lane', speed: kmh(50), width: 3.25, stopLine: null,
      group: null, isExit: null, endsLane: false, noEnter: false, motorway: false,
    }, props);
    net.paths.push(p);
    return p;
  };
  const link = (a, b) => { if (!a.next.includes(b.id)) { a.next.push(b.id); b.prev.push(a.id); } };

  const ext = CONFIG.extendBeyondEdge;
  const extend = (ctrl, atStart, atEnd, len = ext) => {
    const out = ctrl.slice();
    const push = (a, b, front) => {
      const dx = a[0] - b[0], dz = a[1] - b[1], L = Math.hypot(dx, dz) || 1;
      const p1 = [a[0] + dx / L * len * 0.5, a[1] + dz / L * len * 0.5];
      const p2 = [a[0] + dx / L * len, a[1] + dz / L * len];
      if (front) out.unshift(p2, p1); else out.push(p1, p2);
    };
    if (atStart) push(ctrl[0], ctrl[Math.min(2, ctrl.length - 1)], true);
    if (atEnd) push(ctrl[ctrl.length - 1], ctrl[Math.max(0, ctrl.length - 3)], false);
    return out;
  };

  // ---------------------------------------------------------------- junctions
  for (const j of def.junctions) {
    net.junctions[j.id] = {
      id: j.id, type: j.type, c: toM(j.center), legs: [], connectors: [], ring: [],
      minor: j.minor || [], exitLegs: j.exit || [], ban: j.ban || [],
      R: (j.radius || 0) * S, trim: j.type === 'roundabout' ? j.legTrim * S : j.trim,
    };
  }
  // Raw centrelines for two-way roads; snap junction centres onto through roads.
  for (const r of def.roads) {
    let ctrl = smoothCtrl(r.pts.map(toM), 4);
    ctrl = extend(ctrl, !!r.start.boundary, !!r.end.boundary);
    net.rawRoads[r.id] = new Polyline(catmullRom(ctrl), 1);
  }
  for (const r of def.roads) {
    for (const jid of r.via || []) {
      const J = net.junctions[jid], raw = net.rawRoads[r.id];
      const q = raw.nearest(J.c[0], J.c[1]);
      J.c = raw.point(q.s);
    }
  }

  // ------------------------------------------------------------- carriageways
  for (const cw of def.carriageways) {
    const ctrl = extend(smoothCtrl(cw.pts.map(toM), 10), true, true, ext * 1.8);
    const center = new Polyline(catmullRom(ctrl), 1);
    net.carriageways[cw.id] = {
      id: cw.id, def: cw, center, laneW: CONFIG.lane.motorway, lanes: cw.lanes,
      stations: [0, center.len], diverges: [], merges: [], segs: [],
    };
  }
  // Ramp attachment stations.
  const rampCtrl = {};
  for (const r of def.ramps) {
    const pts = smoothCtrl(r.pts.map(toM), 5);
    rampCtrl[r.id] = pts;
    if (r.from.carriageway) {
      const C = net.carriageways[r.from.carriageway];
      const q = C.center.nearest(pts[0][0], pts[0][1]);
      const sd = q.s - 35;
      C.diverges.push({ ramp: r.id, s: sd });
      C.stations.push(sd);
    }
    if (r.to.carriageway) {
      const C = net.carriageways[r.to.carriageway];
      let k = pts.length - 1;
      while (k > 0 && C.center.nearest(pts[k][0], pts[k][1]).d < 7.5) k--;
      const qa = C.center.nearest(pts[Math.min(pts.length - 1, k + 1)][0], pts[Math.min(pts.length - 1, k + 1)][1]);
      const sa = qa.s + 4;
      C.merges.push({ ramp: r.id, s: sa, e: sa + CONFIG.accelLaneLength, farIdx: k });
      C.stations.push(sa, sa + CONFIG.accelLaneLength);
    }
  }
  // Bridges: where a carriageway crosses Dageborgsleden.
  const bumpFor = (group, pl, roadId) => {
    const hit = intersectPolylines(pl.points(), net.rawRoads[roadId].points());
    if (!hit) return;
    const u = pl.tangent(hit.sa);
    (net.bumps[group] ||= []).push({ p: hit.p, u, s: hit.sa });
  };
  for (const C of Object.values(net.carriageways)) if (C.def.bridgeOver) bumpFor(C.id, C.center, C.def.bridgeOver);

  for (const C of Object.values(net.carriageways)) {
    const st = [...new Set(C.stations.map((s) => Math.round(s * 10) / 10))].sort((a, b) => a - b);
    const W = C.laneW, L = C.lanes;
    const off = (i) => (L / 2 - i - 0.5) * W;
    const speed = kmh(CONFIG.speed[C.id] || 110);
    let prevLanes = null;
    for (let k = 0; k < st.length - 1; k++) {
      const s0 = st[k], s1 = st[k + 1];
      const lanes = [];
      for (let i = 0; i < L; i++) {
        lanes.push(addPath(C.center.sliceOffset(s0, s1, off(i)), {
          kind: 'lane', speed, width: W, group: C.id, motorway: true, roadId: C.id, name: 'E20',
          cw: C.id, seg: k, laneIdx: i, s0, s1,
        }));
      }
      for (let i = 0; i < L; i++) {
        if (i + 1 < L) { lanes[i].left = lanes[i + 1].id; lanes[i + 1].right = lanes[i].id; }
        if (prevLanes) link(prevLanes[i], lanes[i]);
      }
      const m = C.merges.find((mm) => Math.abs(mm.s - s0) < 0.2);
      if (m) {
        const base = off(0), TL = CONFIG.taperLength;
        const acc = addPath(C.center.sliceOffset(s0, s1, (s) => base + W * (1 - smoothstep((s - (s1 - TL)) / TL))), {
          kind: 'accel', speed, width: W, group: C.id, motorway: true, roadId: C.id, name: 'E20',
          cw: C.id, seg: k, laneIdx: -1, s0, s1, endsLane: true, noEnter: true, ramp: m.ramp,
        });
        acc.left = lanes[0].id;
        m.accel = acc;
      }
      C.segs.push({ s0, s1, lanes, accel: m ? m.accel : null });
      prevLanes = lanes;
    }
    // Entry / exit bookkeeping
    const first = C.segs[0], last = C.segs[C.segs.length - 1];
    net.entries[C.def.entry.id] = { id: C.def.entry.id, label: C.def.entry.label, lanes: first.lanes.map((p) => p.id), motorway: true };
    for (const p of last.lanes) p.isExit = C.def.exit.id;
    net.exits[C.def.exit.id] = { id: C.def.exit.id, label: C.def.exit.label };
  }

  const segEndingAt = (C, s) => C.segs.find((g) => Math.abs(g.s1 - s) < 0.2);

  // ------------------------------------------------------------- legs helper
  const addLeg = (jid, leg) => { net.junctions[jid].legs.push(leg); };
  const trimS = (pl, c, r, fromStart) => {
    if (fromStart) { for (let s = 0; s < pl.len; s += 0.25) if (dist(pl.point(s), c) >= r) return s; return 0; }
    for (let s = pl.len; s > 0; s -= 0.25) if (dist(pl.point(s), c) >= r) return s;
    return pl.len;
  };

  // ------------------------------------------------------------------- ramps
  for (const r of def.ramps) {
    const pts = rampCtrl[r.id];
    const W = CONFIG.lane.ramp;
    const TL = CONFIG.taperLength;
    let body = pts.map((p, i) => ({ p, i }));
    const head = [], tail = [];
    let startNode = null, endAccel = null;
    if (r.from.carriageway) {
      const C = net.carriageways[r.from.carriageway];
      const d = C.diverges.find((x) => x.ramp === r.id);
      const base = (C.lanes / 2 - 0.5) * C.laneW;
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const s = d.s + TL * t;
        const [x, z] = C.center.point(s); const [nx, nz] = C.center.normal(s);
        const o = base + C.laneW * 1.15 * smoothstep(t);
        head.push([x + nx * o, z + nz * o]);
      }
      body = body.filter(({ p }) => { const q = C.center.nearest(p[0], p[1]); return q.s > d.s + TL + 50 && q.d > 7; });
      startNode = segEndingAt(C, d.s).lanes[0];
    }
    if (r.to.carriageway) {
      const C = net.carriageways[r.to.carriageway];
      const m = C.merges.find((x) => x.ramp === r.id);
      body = body.filter(({ p, i }) => i <= m.farIdx && C.center.nearest(p[0], p[1]).s < m.s - 24);
      const base = (C.lanes / 2 - 0.5) * C.laneW + C.laneW;
      const pre = C.center.point(m.s - 14), npre = C.center.normal(m.s - 14);
      tail.push([pre[0] + npre[0] * (base + 0.8), pre[1] + npre[1] * (base + 0.8)]);
      tail.push([m.accel.x[0], m.accel.z[0]]);
      endAccel = m.accel;
    }
    const ctrl = [...head, ...body.map((b) => b.p), ...tail];
    let pl = new Polyline(catmullRom(ctrl), 1);
    let a = 0, b = pl.len;
    if (r.from.junction) { const J = net.junctions[r.from.junction]; a = trimS(pl, J.c, J.trim, true); }
    if (r.to.junction) { const J = net.junctions[r.to.junction]; b = trimS(pl, J.c, J.trim, false); }
    const path = addPath(pl.sliceOffset(a, b, 0), {
      kind: 'ramp', speed: kmh(CONFIG.speed[r.id] || 70), width: W, group: r.group, roadId: r.id, name: r.name, slip: !!r.slip,
    });
    net.ramps[r.id] = path;
    if (startNode) link(startNode, path);
    if (endAccel) link(path, endAccel);
    if (r.to.junction) addLeg(r.to.junction, { road: r.id, inLane: path, outLane: null, kind: 'ramp' });
    if (r.from.junction) addLeg(r.from.junction, { road: r.id, inLane: null, outLane: path, kind: 'ramp' });
    if (r.bridgeOver) bumpFor(r.group, path, r.bridgeOver);
  }

  // --------------------------------------------------------- two-way roads
  for (const r of def.roads) {
    const raw = net.rawRoads[r.id];
    const W = CONFIG.lane[r.kind] || 3.25;
    const speed = kmh(CONFIG.speed[r.id] || 50);
    const cuts = [{ s: 0, end: r.start }];
    for (const jid of r.via || []) cuts.push({ s: raw.nearest(...net.junctions[jid].c).s, end: { junction: jid } });
    cuts.push({ s: raw.len, end: r.end });
    cuts.sort((x, y) => x.s - y.s);
    for (let k = 0; k < cuts.length - 1; k++) {
      const A = cuts[k], B = cuts[k + 1];
      let a = A.s, b = B.s;
      if (A.end.junction) { const J = net.junctions[A.end.junction]; a = Math.max(a, trimSRange(raw, J.c, J.trim, a, b, true)); }
      if (B.end.junction) { const J = net.junctions[B.end.junction]; b = Math.min(b, trimSRange(raw, J.c, J.trim, a, b, false)); }
      if (b - a < 2) continue;
      // Approaching a roundabout the two directions fan apart around a splitter island.
      const FL = CONFIG.roundaboutFlare;
      const isRB = (e) => e.junction && net.junctions[e.junction].type === 'roundabout';
      const fA = isRB(A.end), fB = isRB(B.end);
      const flare = (s) => FL.width * Math.max(fA ? smoothstep(1 - (s - a) / FL.length) : 0, fB ? smoothstep(1 - (b - s) / FL.length) : 0);
      const fwd = addPath(raw.sliceOffset(a, b, (s) => W / 2 + flare(s)), { kind: 'lane', speed, width: W, roadId: r.id, name: r.name, roadKind: r.kind });
      const bwd = addPath(raw.sliceOffset(a, b, (s) => -W / 2 - flare(s)).reverse(), { kind: 'lane', speed, width: W, roadId: r.id, name: r.name, roadKind: r.kind });
      fwd.twin = bwd.id; bwd.twin = fwd.id;
      net.pieces.push({
        road: r.id, name: r.name, kind: r.kind, center: raw.sliceOffset(a, b, 0), width: W * 2, fwd: fwd.id, bwd: bwd.id,
        flare: (t) => flare(a + t), // extra half-width at arc length t along `center`
      });
      const ends = [[A.end, fwd, bwd], [B.end, bwd, fwd]]; // [endpoint, lane leaving it, lane arriving at it]
      for (const [e, outLane, inLane] of ends) {
        if (e.junction) addLeg(e.junction, { road: r.id, inLane, outLane, kind: r.kind });
        const tag = e.boundary || e.parking;
        if (tag) {
          const ent = (net.entries[tag.id] ||= { id: tag.id, label: tag.label, lanes: [], parking: !!e.parking });
          ent.lanes.push(outLane.id);
          inLane.isExit = tag.id;
          net.exits[tag.id] = { id: tag.id, label: tag.label };
        }
      }
    }
  }
  function trimSRange(pl, c, r, a, b, fromStart) {
    if (fromStart) { for (let s = a; s < b; s += 0.25) if (dist(pl.point(s), c) >= r) return s; return a; }
    for (let s = b; s > a; s -= 0.25) if (dist(pl.point(s), c) >= r) return s;
    return b;
  }

  // ------------------------------------------------------ junction internals
  for (const J of Object.values(net.junctions)) {
    if (J.type === 'roundabout') buildRoundabout(J); else buildIntersection(J);
  }

  function legRole(J, leg) {
    if (J.type === 'right') return 'equal';
    if (J.exitLegs.includes(leg.road)) return 'exit';
    if (J.minor.includes(leg.road)) return 'minor';
    return 'major';
  }

  function buildIntersection(J) {
    for (const A of J.legs) A.role = legRole(J, A);
    for (const A of J.legs) {
      if (!A.inLane) continue;
      for (const B of J.legs) {
        if (B === A || !B.outLane) continue;
        const inL = A.inLane, outL = B.outLane;
        const p0 = [inL.x[inL.n - 1], inL.z[inL.n - 1]], t0 = inL.tangent(inL.len);
        const p3 = [outL.x[0], outL.z[0]], t3 = outL.tangent(0);
        const k = dist(p0, p3) * 0.42;
        const pts = cubicBezier(p0, [p0[0] + t0[0] * k, p0[1] + t0[1] * k], [p3[0] - t3[0] * k, p3[1] - t3[1] * k], p3);
        const turnA = wrapAngle(angleOf(t3[0], t3[1]) - angleOf(t0[0], t0[1]));
        const turn = turnA > 0.55 ? 'right' : turnA < -0.55 ? 'left' : 'straight';
        if (Math.abs(turnA) > 2.5 || (J.ban || []).includes(`${A.road}:${turn}`)) continue; // U-turn / banned
        const conn = addPath(pts, {
          kind: 'conn', junction: J.id, speed: Math.min(inL.speed, outL.speed, kmh(CONFIG.speed.connector)),
          width: Math.max(inL.width, outL.width), fromRoad: A.road, toRoad: B.road, fromRole: A.role,
          turn, name: B.road,
          inLane: inL.id, outLane: outL.id, approach: angleOf(t0[0], t0[1]),
          legDir: angleOf(-t0[0], -t0[1]),
        });
        link(inL, conn); link(conn, outL);
        J.connectors.push(conn.id);
      }
    }
    // Pairwise conflicts
    const C = J.connectors.map((id) => net.paths[id]);
    for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) {
      const a = C[i], b = C[j];
      if (a.inLane === b.inLane) continue;
      let kind, sa, sb;
      if (a.outLane === b.outLane) { kind = 'merge'; sa = a.len; sb = b.len; }
      else {
        const hit = intersectPolylines(a.points(), b.points());
        if (!hit) continue;
        kind = 'cross'; sa = hit.sa; sb = hit.sb;
      }
      let ya = yields(J, a, b), yb = yields(J, b, a);
      if (ya === yb) { ya = side(a, b) === 'right'; yb = !ya; }
      a.conflicts.push({ kind, s: sa, other: b.id, os: sb, iYield: ya, jid: J.id, rule: ruleName(J, a) });
      b.conflicts.push({ kind, s: sb, other: a.id, os: sa, iYield: yb, jid: J.id, rule: ruleName(J, b) });
    }
    for (const c of C) {
      c.conflicts.sort((x, y) => x.s - y.s);
      const yc = c.conflicts.filter((x) => x.iYield);
      if (!yc.length) continue;
      if (c.fromRole === 'major') c.stopLine = Math.max(0, yc[0].s - 3.2);
      else {
        c.stopLine = 0;
        if (!net.yieldMarks.some((m) => m.lane === c.inLane)) net.yieldMarks.push({ lane: c.inLane, rule: ruleName(J, c), junction: J.id });
      }
      c.gapType = ruleName(J, c);
    }
  }

  function ruleName(J, c) {
    if (J.type === 'roundabout') return 'roundabout';
    if (J.type === 'right') return 'right';
    if (c.fromRole === 'exit') return 'exit';
    return 'priority';
  }

  function side(a, b) {
    const ang = wrapAngle(b.legDir - a.approach);
    if (Math.abs(ang) < 0.8) return 'oncoming';
    return ang > 0 ? 'right' : 'left';
  }

  function yields(J, a, b) {
    const ra = rank[a.fromRole], rb = rank[b.fromRole];
    if (J.type === 'priority' && ra !== rb) return ra < rb;
    const rel = side(a, b);
    if (rel === 'oncoming') {
      if (a.turn === 'left' && b.turn !== 'left') return true;
      if (b.turn === 'left' && a.turn !== 'left') return false;
      return a.id > b.id;
    }
    return rel === 'right';
  }

  function buildRoundabout(J) {
    const { c, R } = J;
    const shift = 0.4;
    const ringPt = (th) => [c[0] + R * Math.cos(th), c[1] + R * Math.sin(th)];
    const ringTan = (th) => [Math.sin(th), -Math.cos(th)]; // counter-clockwise on the map
    const at = [];
    for (const leg of J.legs) {
      leg.role = 'minor';
      if (leg.inLane) { const p = leg.inLane; at.push({ type: 'in', leg, th: wrapAngle(angleOf(p.x[p.n - 1] - c[0], p.z[p.n - 1] - c[1]) - shift) }); }
      if (leg.outLane) { const p = leg.outLane; at.push({ type: 'out', leg, th: wrapAngle(angleOf(p.x[0] - c[0], p.z[0] - c[1]) + shift) }); }
    }
    at.sort((a, b) => b.th - a.th);
    const segs = [];
    for (let k = 0; k < at.length; k++) {
      const a = at[k], b = at[(k + 1) % at.length];
      let tb = b.th; if (tb >= a.th) tb -= 2 * Math.PI;
      const n = Math.max(2, Math.ceil((a.th - tb) * R / 0.7));
      const pts = [];
      for (let i = 0; i <= n; i++) pts.push(ringPt(a.th + (tb - a.th) * (i / n)));
      segs.push(addPath(pts, { kind: 'ring', junction: J.id, speed: kmh(CONFIG.speed.ring), width: CONFIG.lane.ring, name: 'Cirkulationsplats' }));
    }
    for (let k = 0; k < segs.length; k++) link(segs[k], segs[(k + 1) % segs.length]);
    J.ring = segs.map((s) => s.id);
    at.forEach((a, k) => {
      const segOut = segs[k], segIn = segs[(k - 1 + segs.length) % segs.length];
      if (a.type === 'in') {
        const L = a.leg.inLane;
        const p0 = [L.x[L.n - 1], L.z[L.n - 1]], t0 = L.tangent(L.len);
        const p3 = ringPt(a.th), t3 = ringTan(a.th);
        // short lead-in so entry and exit fan apart early, leaving room for the splitter island
        const k1 = dist(p0, p3) * 0.3, k2 = dist(p0, p3) * 0.5;
        const conn = addPath(cubicBezier(p0, [p0[0] + t0[0] * k1, p0[1] + t0[1] * k1], [p3[0] - t3[0] * k2, p3[1] - t3[1] * k2], p3), {
          kind: 'conn', junction: J.id, speed: kmh(35), width: L.width + 0.6, fromRoad: a.leg.road, fromRole: 'minor', turn: 'right',
          inLane: L.id, outLane: segOut.id, entry: true, gapType: 'roundabout', name: a.leg.road,
        });
        link(L, conn); link(conn, segOut);
        conn.conflicts.push({ kind: 'merge', s: conn.len, other: segIn.id, os: segIn.len, iYield: true, jid: J.id, rule: 'roundabout' });
        segIn.conflicts.push({ kind: 'merge', s: segIn.len, other: conn.id, os: conn.len, iYield: false, jid: J.id, rule: 'roundabout' });
        conn.stopLine = Math.max(0, conn.len - 3.5);
        net.yieldMarks.push({ lane: conn.id, s: conn.stopLine, rule: 'roundabout', junction: J.id });
        J.connectors.push(conn.id);
      } else {
        const L = a.leg.outLane;
        const p0 = ringPt(a.th), t0 = ringTan(a.th);
        const p3 = [L.x[0], L.z[0]], t3 = L.tangent(0);
        const k1 = dist(p0, p3) * 0.3, k2 = dist(p0, p3) * 0.5;
        const conn = addPath(cubicBezier(p0, [p0[0] + t0[0] * k2, p0[1] + t0[1] * k2], [p3[0] - t3[0] * k1, p3[1] - t3[1] * k1], p3), {
          kind: 'conn', junction: J.id, speed: kmh(35), width: L.width + 0.6, toRoad: a.leg.road, turn: 'right',
          inLane: segIn.id, outLane: L.id, exitConn: true, name: a.leg.road,
        });
        link(segIn, conn); link(conn, L);
        J.connectors.push(conn.id);
      }
    });
  }

  // ------------------------------------------------------- parking areas
  for (const pk of def.parking) net.parking.push({ id: pk.id, c: toM(pk.center), w: pk.size[0] * S, h: pk.size[1] * S, angle: pk.angle });

  // ------------------------------------------------------ per-path profiles
  const { height: H, halfLength: HL } = CONFIG.bridge;
  for (const p of net.paths) {
    p.h = new Float32Array(p.n);
    const bumps = p.group ? net.bumps[p.group] : null;
    if (bumps) {
      for (let i = 0; i < p.n; i++) {
        let h = 0;
        for (const b of bumps) {
          const t = Math.abs((p.x[i] - b.p[0]) * b.u[0] + (p.z[i] - b.p[1]) * b.u[1]);
          if (t < HL) h = Math.max(h, H * (0.5 + 0.5 * Math.cos(Math.PI * t / HL)));
        }
        p.h[i] = h;
      }
    }
    p.vcurve = new Float32Array(p.n);
    const k = p.kind === 'conn' || p.kind === 'ring' ? 3 : p.motorway ? 18 : 9;
    for (let i = 0; i < p.n; i++) {
      const a = Math.max(0, i - k), b = Math.min(p.n - 1, i + k);
      let v = 60;
      if (b - a >= 2) {
        const ax = p.x[a], az = p.z[a], bx = p.x[i], bz = p.z[i], cx = p.x[b], cz = p.z[b];
        const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
        if (area2 > 1e-6) {
          const R = (Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az)) / (2 * area2);
          v = Math.sqrt(CONFIG.lateralAccel * R);
        }
      }
      p.vcurve[i] = Math.max(3.2, Math.min(60, v));
    }
  }

  // ----------------------------------------------- entry anchors for the UI
  for (const e of Object.values(net.entries)) {
    const p = net.paths[e.lanes[0]];
    let s = 0;
    if (!e.parking) { while (s < p.len && !insideMap(p.point(s), 2)) s += 1; s = Math.min(p.len, s + 12); }
    e.anchor = p.point(s);
    e.dir = p.tangent(s);
  }

  // Junction surface (for rendering): one asphalt arm per leg, from the leg's
  // end to the centre, so a crossing reads as crossing roads rather than a
  // blob. Major roads passing through also keep their centre line.
  for (const J of Object.values(net.junctions)) {
    if (J.type === 'roundabout') continue;
    J.arms = [];
    for (const leg of J.legs) {
      const ends = [];
      if (leg.inLane) ends.push(leg.inLane.point(leg.inLane.len));
      if (leg.outLane) ends.push(leg.outLane.point(0));
      const p = [ends.reduce((a, q) => a + q[0], 0) / ends.length, ends.reduce((a, q) => a + q[1], 0) / ends.length];
      const width = (leg.inLane || leg.outLane).width * (leg.inLane && leg.outLane ? 2 : 1) + 1.2;
      J.arms.push({ pts: [p, J.c], width });
    }
    J.through = [];
    for (const r of def.roads) {
      if (!(r.via || []).includes(J.id) || J.minor.includes(r.id) || J.type === 'right') continue;
      const raw = net.rawRoads[r.id], s = raw.nearest(...J.c).s;
      J.through.push(raw.sliceOffset(Math.max(0, s - J.trim - 0.5), Math.min(raw.len, s + J.trim + 0.5), 0));
    }
  }

  return net;
}
