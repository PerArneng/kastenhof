// Road surfaces, Swedish road markings (white), bridges/embankments, the
// roundabout, yield lines (hajtänder), signs, street lights and the P-lot.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { Polyline, smoothstep } from '../network/geometry.js';
import { toM } from '../network/build.js';
import { LABELS } from '../network/roads.js';

const Y = { shoulder: 0.03, patch: 0.045, lane: 0.05, conn: 0.052, mark: 0.075, yieldm: 0.08 };

export function bridgeHeight(net, group, x, z) {
  const bumps = net.bumps[group];
  if (!bumps) return 0;
  const { height: H, halfLength: HL } = CONFIG.bridge;
  let h = 0;
  for (const b of bumps) {
    const t = Math.abs((x - b.p[0]) * b.u[0] + (z - b.p[1]) * b.u[1]);
    if (t < HL) h = Math.max(h, H * (0.5 + 0.5 * Math.cos(Math.PI * t / HL)));
  }
  return h;
}

// Strip along a polyline: offsets (left/right, metres, + = right) may be functions of i.
function strip(pts, hs, offA, offB, y, out) {
  const n = pts.length;
  if (n < 2) return;
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    const nx = -tz, nz = tx;
    const oa = typeof offA === 'function' ? offA(i) : offA, ob = typeof offB === 'function' ? offB(i) : offB;
    const h = (hs ? hs[i] : 0) + y;
    pos.push(pts[i][0] + nx * oa, h, pts[i][1] + nz * oa, pts[i][0] + nx * ob, h, pts[i][1] + nz * ob);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure faces point up
  const nrm = g.attributes.normal;
  if (nrm.count && nrm.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  out.push(g);
}

// Dashed or solid line along a Polyline-like path (with heights per s).
function lineMarks(pl, hAt, offset, width, dash, gap, out, s0 = 0, s1 = pl.len) {
  const step = 1;
  if (!dash) {
    const pts = [], hs = [];
    for (let s = s0; s <= s1 + 1e-6; s += step) { pts.push(pl.point(Math.min(s, s1))); hs.push(hAt(s)); }
    strip(pts, hs, offset - width / 2, offset + width / 2, Y.mark, out);
    return;
  }
  for (let s = s0 + gap * 0.5; s < s1; s += dash + gap) {
    const e = Math.min(s1, s + dash), pts = [], hs = [];
    for (let t = s; t <= e + 1e-6; t += Math.min(step, (e - s) / 2 || 1)) { pts.push(pl.point(Math.min(t, e))); hs.push(hAt(t)); }
    if (pts.length >= 2) strip(pts, hs, offset - width / 2, offset + width / 2, Y.mark, out);
  }
}

const hOfPath = (p) => (s) => { const f = Math.min(p.n - 1, Math.max(0, s / p.ds)); const i = Math.floor(f); return p.h[i] + (p.h[Math.min(p.n - 1, i + 1)] - p.h[i]) * (f - i); };

export function buildRoads(scene, net) {
  const asphalt = [], shoulder = [], marks = [], patch = [], concrete = [], embank = [], apron = [], island = [], splitters = [];
  const paths = net.paths;

  // ---- lane surfaces
  for (const p of paths) {
    if (p.kind === 'ring') continue;
    const pts = p.points();
    const w = p.width / 2 + (p.kind === 'conn' ? 0.15 : 0.08);
    strip(pts, p.h, -w, w, p.kind === 'conn' ? Y.conn : Y.lane, asphalt);
  }

  // ---- carriageways: shoulders, markings, embankments, bridges
  const dag = net.rawRoads.DAG;
  for (const C of Object.values(net.carriageways)) {
    const W = C.laneW, L = C.lanes;
    for (const seg of C.segs) {
      const cl = new Polyline(C.center.sliceOffset(seg.s0, seg.s1, 0), 1);
      const hAt = (s) => { const [x, z] = cl.point(s); return bridgeHeight(net, C.id, x, z); };
      const pts = cl.points(), hs = pts.map(([x, z]) => bridgeHeight(net, C.id, x, z));
      const right = L / 2 * W + (seg.accel ? W : 0) + 1.6, left = -L / 2 * W - 0.9;
      strip(pts, hs, left, right, Y.shoulder, shoulder);
      // lane dividers: körfältslinje 3 m / 9 m
      for (let i = 1; i < L; i++) lineMarks(cl, hAt, (L / 2 - i) * W, 0.15, 3, 9, marks);
      // edge lines (kantlinje), solid on the motorway
      lineMarks(cl, hAt, left + 0.75, 0.2, 0, 0, marks);
      if (!seg.accel) lineMarks(cl, hAt, L / 2 * W + 0.15, 0.3, 0, 0, marks);
      else {
        const A = seg.accel; const ha = hOfPath(A);
        lineMarks(A, ha, -W / 2, 0.3, 3, 3, marks, 0, A.len - CONFIG.taperLength);
        lineMarks(A, ha, W / 2 + 0.1, 0.3, 0, 0, marks, 0, A.len - CONFIG.taperLength);
      }
      // embankment + bridge
      addEmbankment(pts, hs, left - 0.3, right + 0.3, dag, embank, concrete);
    }
  }
  // ramps: edge lines + embankment where elevated
  for (const p of paths) {
    if (p.kind !== 'ramp') continue;
    const h = hOfPath(p);
    lineMarks(p, h, -p.width / 2 + 0.25, 0.2, 0, 0, marks, 20, p.len - 4);
    lineMarks(p, h, p.width / 2 - 0.25, 0.2, 0, 0, marks, 20, p.len - 4);
    strip(p.points(), p.h, -p.width / 2 - 0.9, p.width / 2 + 0.9, Y.shoulder, shoulder);
    addEmbankment(p.points(), Array.from(p.h), -p.width / 2 - 1.1, p.width / 2 + 1.1, dag, embank, concrete);
  }

  // ---- two-way roads: centre line (mittlinje 3+9), thin solid edge lines (kantlinje)
  for (const pc of net.pieces) {
    const cl = new Polyline(pc.center, 1);
    const W = pc.width / 2, fl = pc.flare || (() => 0);
    const h0 = () => 0;
    const pts = cl.points();
    strip(pts, null, (i) => -W - 0.7 - fl(i * cl.ds), (i) => W + 0.7 + fl(i * cl.ds), Y.shoulder, shoulder);
    if (pc.kind === 'main') {
      // centre line only where the two directions run side by side
      let s0 = 0, s1 = cl.len;
      while (s0 < s1 && fl(s0) > 0.15) s0 += 1;
      while (s1 > s0 && fl(s1) > 0.15) s1 -= 1;
      if (s1 - s0 > 4) lineMarks(cl, h0, 0, 0.12, 3, 9, marks, s0, s1);
      for (const side of [-1, 1]) {
        const edge = new Polyline(cl.sliceOffset(0, cl.len, (s) => side * (W - 0.2 + fl(s))), 1);
        lineMarks(edge, h0, 0, 0.1, 0, 0, marks);
      }
    }
  }

  // ---- junction patches
  for (const J of Object.values(net.junctions)) {
    for (const A of J.arms || []) {
      // run each arm a little past the centre so opposite arms overlap
      const [p, c] = A.pts, d = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1, u = [(c[0] - p[0]) / d, (c[1] - p[1]) / d], ext = A.width / 2;
      strip([[p[0] - u[0] * 0.5, p[1] - u[1] * 0.5], [c[0] + u[0] * ext, c[1] + u[1] * ext]], null, -A.width / 2, A.width / 2, Y.patch, patch);
    }
    for (const T of J.through || []) lineMarks(new Polyline(T, 1), () => 0, 0, 0.12, 3, 9, marks);
    if (J.type === 'roundabout') {
      const R = J.R;
      const ring = new THREE.RingGeometry(R - 3.0, R + 3.6, 72, 1); ring.rotateX(-Math.PI / 2); ring.translate(J.c[0], Y.lane, J.c[1]); asphalt.push(ring);
      const ap = new THREE.RingGeometry(R - 4.6, R - 3.0, 72, 1); ap.rotateX(-Math.PI / 2); ap.translate(J.c[0], 0.11, J.c[1]); apron.push(ap);
      const curb = new THREE.CylinderGeometry(R - 4.6, R - 4.6, 0.32, 72, 1, true); curb.translate(J.c[0], 0.16, J.c[1]); concrete.push(curb);
      const isl = new THREE.CircleGeometry(R - 4.6, 72); isl.rotateX(-Math.PI / 2); isl.translate(J.c[0], 0.32, J.c[1]); island.push(isl);
      const mound = new THREE.SphereGeometry(R - 6, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2); mound.scale(1, 0.12, 1); mound.translate(J.c[0], 0.3, J.c[1]); island.push(mound);
      // ring edge lines
      const outer = new THREE.RingGeometry(R + 3.3, R + 3.45, 96, 1); outer.rotateX(-Math.PI / 2); outer.translate(J.c[0], Y.mark, J.c[1]); marks.push(outer);
      // raised splitter islands between the entry and exit lane of each leg
      const conns = J.connectors.map((id) => paths[id]);
      // pair each entry with the exit whose outer end is closest (the same road,
      // or the neighbouring ramp where an off- and on-ramp meet the ring side by side)
      for (const inC of conns.filter((c) => c.entry)) {
        const a = inC.point(0);
        let outC = null, bd = 16;
        for (const c of conns) {
          if (!c.exitConn) continue;
          const b = c.point(c.len), d = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (d < bd) { bd = d; outC = c; }
        }
        if (outC) splitterIsland(J, inC, outC, paths, splitters);
      }
    }
  }

  // ---- yield lines: hajtänder (row of triangles pointing at the yielding driver)
  for (const ym of net.yieldMarks) {
    const p = paths[ym.lane];
    const s = ym.s ?? p.len - 0.6;
    const [x, z] = p.point(s), [tx, tz] = p.tangent(s), nx = -tz, nz = tx;
    const w = p.width - 0.3, n = Math.max(3, Math.floor(w / 0.75));
    const pos = [];
    for (let k = 0; k < n; k++) {
      const o = -w / 2 + (k + 0.5) * (w / n), hb = 0.28;
      const bx = x + nx * o, bz = z + nz * o;
      // base across the road at the line, apex towards the approaching car
      pos.push(bx + nx * hb, Y.yieldm, bz + nz * hb, bx - nx * hb, Y.yieldm, bz - nz * hb, bx - tx * 0.6, Y.yieldm, bz - tz * 0.6);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
    marks.push(g);
  }

  // ---- parking lot (Pendelparkering)
  const lot = new THREE.Group();
  for (const pk of net.parking) {
    const g = new THREE.PlaneGeometry(pk.w, pk.h); g.rotateX(-Math.PI / 2); g.rotateY(-pk.angle); g.translate(pk.c[0], Y.patch, pk.c[1]); asphalt.push(g);
    const bays = Math.floor(pk.w / 2.7);
    for (const side of [-1, 1]) for (let i = 0; i <= bays; i++) {
      const bx = -pk.w / 2 + i * 2.7, len = 5;
      const m = new THREE.PlaneGeometry(0.12, len); m.rotateX(-Math.PI / 2); m.translate(bx, Y.mark, side * (pk.h / 2 - len / 2 - 0.4)); m.rotateY(-pk.angle); m.translate(pk.c[0], 0, pk.c[1]); marks.push(m);
    }
    lot.userData.lot = pk;
  }

  const mats = {
    asphalt: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.92, metalness: 0 }),
    shoulder: new THREE.MeshStandardMaterial({ color: 0x55585d, roughness: 0.95 }),
    patch: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.92 }),
    marks: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xa9a7a1, roughness: 0.85, side: THREE.DoubleSide }),
    embank: new THREE.MeshStandardMaterial({ color: 0x5d7d43, roughness: 1, side: THREE.DoubleSide }),
    apron: new THREE.MeshStandardMaterial({ color: 0x9c958a, roughness: 0.95 }),
    island: new THREE.MeshStandardMaterial({ color: 0x6d9a4c, roughness: 1 }),
    splitter: new THREE.MeshStandardMaterial({ color: 0xe4e1d8, roughness: 0.8 }),
  };
  const group = new THREE.Group();
  const add = (list, mat, { shadow = true } = {}) => {
    if (!list.length) return;
    const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => { x.deleteAttribute('uv'); return x; }));
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = shadow && (mat === mats.concrete || mat === mats.embank); group.add(m);
  };
  add(shoulder, mats.shoulder); add(asphalt, mats.asphalt); add(patch, mats.patch); add(marks, mats.marks);
  add(concrete, mats.concrete); add(embank, mats.embank); add(apron, mats.apron); add(island, mats.island); add(splitters, mats.splitter);
  scene.add(group);
  const furniture = buildFurniture(net);
  scene.add(furniture);
  return { group, mats, furniture };
}

// Splitter island between a roundabout entry and exit: bounded by the inner
// edges of the approaching/leaving lanes (and their ring connectors) and the
// outer edge of the ring.
function splitterIsland(J, inC, outC, paths, out) {
  const rMin = J.R + 3.9, back = CONFIG.roundaboutFlare.length + 6;
  const sample = (p, s0, s1, acc) => { for (let s = s0; s <= s1; s += 1) { const [x, z] = p.point(s), [nx, nz] = p.normal(s); acc.push([x, z, nx, nz, p.width]); } return acc; };
  const inL = paths[inC.inLane], outL = paths[outC.outLane];
  const A = sample(inC, 0, inC.len, sample(inL, Math.max(0, inL.len - back), inL.len, []));
  const B = sample(outL, 0, Math.min(outL.len, back), sample(outC, 0, outC.len, [])).reverse();
  const nearestOf = (P, x, z) => { let b = P[0], bd = Infinity; for (const q of P) { const d = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (d < bd) { bd = d; b = q; } } return b; };
  const edge = (P, other) => {
    const e = P.map(([x, z, nx, nz, w]) => {
      const om = nearestOf(other, x, z); // inner edge faces the other lane
      const sg = nx * (om[0] - x) + nz * (om[1] - z) > 0 ? 1 : -1, o = w / 2 + 0.35;
      return [x + nx * sg * o, z + nz * sg * o];
    });
    const pl = new Polyline(e, 0.5), N = 48, r = [];
    for (let k = 0; k <= N; k++) r.push(pl.point(pl.len * k / N));
    return r; // from the leg towards the ring
  };
  const EA = edge(A, B), EB = edge(B, A);
  const L = [], R = [];
  for (let k = EA.length - 1; k >= 0; k--) { // walk outwards from the ring until the lanes meet
    const a = EA[k], b = EB[k];
    if (Math.hypot(a[0] - J.c[0], a[1] - J.c[1]) < rMin || Math.hypot(b[0] - J.c[0], b[1] - J.c[1]) < rMin) continue;
    const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (gap < 0.5 || gap > 11) break; // lanes meet, or two separate ramps part ways (grass beyond)
    L.unshift(new THREE.Vector2(a[0], a[1])); R.unshift(new THREE.Vector2(b[0], b[1]));
  }
  if (L.length < 3) return;
  const shape = new THREE.Shape(L.concat(R.reverse()));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.2, bevelSegments: 1 });
  g.rotateX(Math.PI / 2); g.translate(0, 0.2, 0); // shape y → world z, extruded downwards from the top
  out.push(g);
}

// Grass embankment sloping down from elevated road edges; vertical concrete
// abutments + open span where Dageborgsleden passes underneath.
function addEmbankment(pts, hs, left, right, dag, embank, concrete) {
  const n = pts.length;
  let open = null;
  for (const side of [left, right]) {
    const sgn = Math.sign(side);
    const posE = [], posC = [];
    for (let i = 0; i < n - 1; i++) {
      const h0 = hs[i], h1 = hs[i + 1];
      if (h0 < 0.15 && h1 < 0.15) continue;
      const mk = (k) => {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
        return [-tz, tx];
      };
      const [nx0, nz0] = mk(i), [nx1, nz1] = mk(i + 1);
      const top0 = [pts[i][0] + nx0 * side, h0 + 0.03, pts[i][1] + nz0 * side];
      const top1 = [pts[i + 1][0] + nx1 * side, h1 + 0.03, pts[i + 1][1] + nz1 * side];
      const dDag = dag.nearest(pts[i][0], pts[i][1]).d;
      if (dDag < 11) {
        // bridge span: deck edge (fascia) + guard rail line
        const b0 = [top0[0], top0[1] - 1.3, top0[2]], b1 = [top1[0], top1[1] - 1.3, top1[2]];
        posC.push(...top0, ...b0, ...top1, ...top1, ...b0, ...b1);
        if (dDag > 8.5) { // abutment wall down to ground
          posC.push(b0[0], b0[1], b0[2], b0[0], 0, b0[2], b1[0], b1[1], b1[2], b1[0], b1[1], b1[2], b0[0], 0, b0[2], b1[0], 0, b1[2]);
        }
        open = true;
        continue;
      }
      const run0 = h0 * 1.8 * sgn, run1 = h1 * 1.8 * sgn;
      const bot0 = [top0[0] + nx0 * run0, 0, top0[2] + nz0 * run0], bot1 = [top1[0] + nx1 * run1, 0, top1[2] + nz1 * run1];
      posE.push(...top0, ...bot0, ...top1, ...top1, ...bot0, ...bot1);
    }
    for (const [list, arr] of [[embank, posE], [concrete, posC]]) {
      const flat = arr.filter((v) => typeof v === 'number');
      if (flat.length < 9) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3)); g.computeVertexNormals(); list.push(g);
    }
  }
  // deck underside across the span
  void open;
  const under = [];
  for (let i = 0; i < n - 1; i++) {
    if (hs[i] < 0.15) continue;
    if (dag.nearest(pts[i][0], pts[i][1]).d >= 11) continue;
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    const nx = -tz, nz = tx, p0 = pts[i], p1 = pts[i + 1], y0 = hs[i] - 1.3, y1 = hs[i + 1] - 1.3;
    under.push(p0[0] + nx * left, y0, p0[1] + nz * left, p0[0] + nx * right, y0, p0[1] + nz * right, p1[0] + nx * left, y1, p1[1] + nz * left,
      p1[0] + nx * left, y1, p1[1] + nz * left, p0[0] + nx * right, y0, p0[1] + nz * right, p1[0] + nx * right, y1, p1[1] + nz * right);
  }
  if (under.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(under, 3)); g.computeVertexNormals(); concrete.push(g); }
}

// Signs, street lights, bus shelters.
function buildFurniture(net) {
  const group = new THREE.Group();
  const paths = net.paths;
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6); poleGeo.translate(0, 1.1, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d9196, metalness: 0.6, roughness: 0.4 });
  const signs = [];
  // B1 väjningsplikt: inverted triangle, red border, yellow field (Swedish style)
  const b1Tex = canvasTex(128, (ctx) => {
    ctx.beginPath(); ctx.moveTo(8, 14); ctx.lineTo(120, 14); ctx.lineTo(64, 118); ctx.closePath(); ctx.fillStyle = '#d0202a'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(26, 24); ctx.lineTo(102, 24); ctx.lineTo(64, 96); ctx.closePath(); ctx.fillStyle = '#f7d117'; ctx.fill();
  });
  const d3Tex = canvasTex(128, (ctx) => { // D3 cirkulationsplats
    ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fillStyle = '#1d5fb0'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 9;
    for (let k = 0; k < 3; k++) { const a = k * 2.09; ctx.beginPath(); ctx.arc(64, 64, 30, a + 0.35, a + 1.75); ctx.stroke();
      const ex = 64 + Math.cos(a + 0.35) * 30, ey = 64 + Math.sin(a + 0.35) * 30; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.cos(a + 0.35 - 1.2) * 14, ey + Math.sin(a + 0.35 - 1.2) * 14); ctx.lineTo(ex + Math.cos(a + 0.35 + 0.9) * 14, ey + Math.sin(a + 0.35 + 0.9) * 14); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); }
  });
  const b1Mat = new THREE.MeshStandardMaterial({ map: b1Tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 });
  const d3Mat = new THREE.MeshStandardMaterial({ map: d3Tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 });
  const plate = new THREE.PlaneGeometry(1.0, 1.0);
  for (const ym of net.yieldMarks) {
    const p = paths[ym.lane];
    const s = ym.s ?? p.len - 0.6;
    const [x, z] = p.point(s), [tx, tz] = p.tangent(s), nx = -tz, nz = tx;
    const o = p.width / 2 + 1.4;
    const px = x + nx * o, pz = z + nz * o;
    const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(px, 0, pz); pole.castShadow = true; group.add(pole);
    const face = Math.atan2(-tx, -tz);
    const sgn = new THREE.Mesh(plate, b1Mat); sgn.position.set(px, 2.0, pz); sgn.rotation.y = face; sgn.castShadow = true; group.add(sgn);
    if (ym.rule === 'roundabout') { const d = new THREE.Mesh(plate, d3Mat); d.scale.setScalar(0.75); d.position.set(px, 2.8, pz); d.rotation.y = face; group.add(d); }
    signs.push(sgn);
  }

  // Street lights around junctions and the roundabout
  const lampPos = [];
  for (const J of Object.values(net.junctions)) {
    if (J.type === 'roundabout') for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + 0.3; lampPos.push([J.c[0] + Math.cos(a) * (J.R + 7), J.c[1] + Math.sin(a) * (J.R + 7)]); }
    else if (J.id !== 'J_JL') lampPos.push([J.c[0] + 9, J.c[1] - 9]);
  }
  for (const p of paths) if (p.kind === 'ramp' && !p.motorway) for (let s = 30; s < p.len - 20; s += 45) { const [x, z] = p.point(s), [nx, nz] = p.normal(s); lampPos.push([x + nx * 4.5, z + nz * 4.5]); }
  const post = new THREE.CylinderGeometry(0.09, 0.13, 9, 6); post.translate(0, 4.5, 0);
  const head = new THREE.BoxGeometry(0.9, 0.2, 0.35); head.translate(0, 9, 0);
  const postM = new THREE.InstancedMesh(post, poleMat, lampPos.length);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false });
  const headM = new THREE.InstancedMesh(head, bulbMat, lampPos.length);
  const m = new THREE.Matrix4();
  lampPos.forEach(([x, z], i) => { m.makeTranslation(x, 0, z); postM.setMatrixAt(i, m); headM.setMatrixAt(i, m); });
  postM.castShadow = true;
  group.add(postM, headM);
  // light pools on the ground (night only)
  const poolTex = radialTex();
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffc98a, opacity: 0 });
  const poolGeo = new THREE.PlaneGeometry(15, 15); poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lampPos.length);
  lampPos.forEach(([x, z], i) => { m.makeTranslation(x, 0.12, z); pools.setMatrixAt(i, m); });
  pools.renderOrder = 2;
  group.add(pools);

  // Bus shelters
  const shelter = new THREE.Group();
  const roofG = new THREE.BoxGeometry(3.2, 0.12, 1.5); roofG.translate(0, 2.4, 0);
  const backG = new THREE.BoxGeometry(3.2, 2.2, 0.06); backG.translate(0, 1.2, -0.7);
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, transparent: true, opacity: 0.45, roughness: 0.1 });
  for (const b of LABELS.busStops) {
    const [x, z] = toM(b);
    const r = new THREE.Mesh(roofG, poleMat), bk = new THREE.Mesh(backG, glass);
    const g = new THREE.Group(); g.add(r, bk); g.position.set(x, 0, z); g.rotation.y = 0.5; r.castShadow = true; shelter.add(g);
  }
  group.add(shelter);

  group.userData.setNight = (k) => {
    bulbMat.color.setRGB(0.15 + 6 * k, 0.15 + 4.6 * k, 0.15 + 2.6 * k);
    poolMat.opacity = 0.38 * k;
  };
  return group;
}

export function canvasTex(N, draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d'); draw(ctx);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export function radialTex() {
  return canvasTex(128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  });
}
void smoothstep;
