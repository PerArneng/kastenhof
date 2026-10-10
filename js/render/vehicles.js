// Instanced vehicle rendering: cars and trucks with brake lights, blinking
// indicators and headlights (with light pools on the road at night).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { radialTex } from './roads.js';

const MAX = 1000;
const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
const rbox = (w, h, d, r, x, y, z) => { const g = new RoundedBoxGeometry(w, h, d, 2, r); g.translate(x, y, z); return g; };
const strip = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; };
const merge = (list) => mergeGeometries(list.map(strip));

// Unit car: length 4.5 along +x, width 1.8, origin at centre on the ground.
function carGeometries() {
  const body = merge([rbox(4.5, 0.72, 1.8, 0.22, 0, 0.62, 0), rbox(2.35, 0.1, 1.5, 0.05, -0.25, 1.53, 0)]);
  const glass = merge([rbox(2.4, 0.58, 1.56, 0.18, -0.25, 1.22, 0)]);
  const wheels = [];
  for (const [x, z] of [[1.4, 0.82], [1.4, -0.82], [-1.4, 0.82], [-1.4, -0.82]]) { const w = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12); w.rotateX(Math.PI / 2); w.translate(x, 0.34, z); wheels.push(w); }
  return { body, glass, wheels: merge(wheels) };
}
function truckGeometries() {
  // unit truck length 15 (cab 2.4 + trailer), width 2.5
  const cab = merge([rbox(2.4, 2.6, 2.45, 0.25, 6.2, 1.85, 0), box(2.5, 0.5, 2.5, 6.1, 0.6, 0)]);
  const glass = merge([box(0.08, 1.0, 2.2, 7.42, 2.3, 0)]);
  const trailer = merge([rbox(12.1, 3.0, 2.55, 0.08, -1.25, 2.2, 0), box(12.1, 0.3, 2.3, -1.25, 0.6, 0)]);
  const wheels = [];
  for (const x of [6.4, 4.8, -4.5, -5.8, -7.0]) for (const z of [1.05, -1.05]) { const w = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12); w.rotateX(Math.PI / 2); w.translate(x, 0.5, z); wheels.push(w); }
  return { cab, glass, trailer, wheels: merge(wheels) };
}
// Light clusters in the same unit space (car); trucks scale them.
function lightGeometries() {
  const rear = merge([box(0.06, 0.16, 0.42, -2.26, 0.86, 0.6), box(0.06, 0.16, 0.42, -2.26, 0.86, -0.6)]);
  const front = merge([box(0.06, 0.14, 0.38, 2.26, 0.78, 0.6), box(0.06, 0.14, 0.38, 2.26, 0.78, -0.6)]);
  const indL = merge([box(0.08, 0.1, 0.14, 2.25, 0.78, -0.86), box(0.08, 0.1, 0.14, -2.25, 0.86, -0.86)]);
  const indR = merge([box(0.08, 0.1, 0.14, 2.25, 0.78, 0.86), box(0.08, 0.1, 0.14, -2.25, 0.86, 0.86)]);
  return { rear, front, indL, indR };
}

export function createVehicleRenderer(scene, net) {
  const paths = net.paths;
  const group = new THREE.Group();
  scene.add(group);
  const paint = new THREE.MeshPhysicalMaterial({ roughness: 0.34, metalness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.22 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0f161c, roughness: 0.16, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.2 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const trailerMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
  const light = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

  const cg = carGeometries(), tg = truckGeometries(), lg = lightGeometries();
  const mk = (geo, mat, shadow = true) => { const m = new THREE.InstancedMesh(geo, mat, MAX); m.count = 0; m.castShadow = shadow; m.receiveShadow = shadow; m.frustumCulled = false; group.add(m); return m; };
  const I = {
    body: mk(cg.body, paint), glass: mk(cg.glass, glassMat), wheels: mk(cg.wheels, tyre, false),
    cab: mk(tg.cab, paint), tglass: mk(tg.glass, glassMat, false), trailer: mk(tg.trailer, trailerMat), twheels: mk(tg.wheels, tyre, false),
    rear: mk(lg.rear, light(), false), front: mk(lg.front, light(), false), indL: mk(lg.indL, light(), false), indR: mk(lg.indR, light(), false),
  };
  for (const k of ['body', 'cab', 'trailer', 'rear', 'front', 'indL', 'indR']) I[k].setColorAt(0, new THREE.Color());
  // headlight pools
  const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2); poolGeo.translate(0.5, 0, 0);
  const poolMat = new THREE.MeshBasicMaterial({ map: radialTex(), color: 0xfff1d6, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pools = mk(poolGeo, poolMat, false); pools.renderOrder = 3;
  // debug state markers
  const mGeo = new THREE.CylinderGeometry(1.1, 1.1, 0.2, 16);
  const markers = mk(mGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), false);
  markers.setColorAt(0, new THREE.Color());
  markers.visible = false;

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), E = new THREE.Euler(0, 0, 0, 'YXZ');
  const col = new THREE.Color(), colorCache = new Map();
  const cc = (hex) => { let c = colorCache.get(hex); if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); } return c; };
  const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  let night = 0;

  function pointOn(v, s, out) {
    let p = v.path;
    if (s < 0) {
      const prevId = v.route[v.ri - 1];
      const q = prevId !== undefined ? paths[prevId] : null;
      if (q && q.next.includes(p.id)) { s += q.len; p = q; } else s = 0;
      if (s < 0) s = 0;
    }
    const f = Math.min(p.n - 1, Math.max(0, s / p.ds)), i = Math.min(p.n - 2, Math.floor(f)), t = f - i;
    out[0] = p.x[i] + (p.x[i + 1] - p.x[i]) * t;
    out[2] = p.z[i] + (p.z[i + 1] - p.z[i]) * t;
    out[1] = p.h[i] + (p.h[i + 1] - p.h[i]) * t;
    return out;
  }
  const fr = [0, 0, 0], rr = [0, 0, 0];
  function computePose(v) {
    pointOn(v, v.s - 0.3, fr);
    pointOn(v, v.s - v.len + 0.3, rr);
    let dx = fr[0] - rr[0], dz = fr[2] - rr[2];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx;
    pose.x = (fr[0] + rr[0]) / 2 + nx * v.lat;
    pose.z = (fr[2] + rr[2]) / 2 + nz * v.lat;
    pose.y = (fr[1] + rr[1]) / 2;
    pose.yaw = Math.atan2(-dz, dx);
    // drift angle during a lane change
    if (v.lat0) { const rate = (v.lat - (v._latPrev ?? v.lat)); pose.yaw += Math.atan2(rate * 30, Math.max(3, v.v)) * 0.6; }
    v._latPrev = v.lat;
    pose.pitch = Math.atan2(fr[1] - rr[1], L);
  }

  function setInst(mesh, i, sx = 1, sy = 1, sz = 1) {
    E.set(0, pose.yaw, pose.pitch, 'YXZ');
    Q.setFromEuler(E);
    P.set(pose.x, pose.y + 0.05, pose.z);
    Sc.set(sx, sy, sz);
    M.compose(P, Q, Sc);
    mesh.setMatrixAt(i, M);
  }

  function update(world, time, debug) {
    let ci = 0, ti = 0, li = 0;
    const blinkOn = (time % 0.75) < 0.42;
    for (const v of world.vehicles) {
      computePose(v);
      if (v.type === 'truck') {
        const sx = v.len / 15;
        setInst(I.cab, ti, sx, 1, 1); setInst(I.tglass, ti, sx, 1, 1); setInst(I.trailer, ti, sx, 1, 1); setInst(I.twheels, ti, sx, 1, 1);
        I.cab.setColorAt(ti, cc(v.cabColor)); I.trailer.setColorAt(ti, cc(v.color));
        ti++;
      } else {
        const sx = v.len / 4.5;
        setInst(I.body, ci, sx, 1, 1); setInst(I.glass, ci, sx, 1, 1); setInst(I.wheels, ci, sx, 1, 1);
        I.body.setColorAt(ci, cc(v.color));
        ci++;
      }
      // lights (shared, scaled for trucks)
      const lx = v.len / 4.5, ly = v.type === 'truck' ? 1.25 : 1, lz = v.width / 1.8;
      setInst(I.rear, li, lx, ly, lz); setInst(I.front, li, lx, ly, lz); setInst(I.indL, li, lx, ly, lz); setInst(I.indR, li, lx, ly, lz);
      const brake = v.brake;
      const tail = night > 0.3 ? 1.2 : 0.35;
      if (brake) col.setRGB(5.5, 0.15, 0.1); else col.setRGB(tail, 0.03, 0.03);
      I.rear.setColorAt(li, col);
      if (night > 0.3) col.setRGB(6, 5.6, 4.6); else col.setRGB(0.85, 0.87, 0.9);
      I.front.setColorAt(li, col);
      const on = (side) => v.ind === side && blinkOn;
      col.setRGB(on(-1) ? 5 : 0.35, on(-1) ? 2.2 : 0.16, on(-1) ? 0.05 : 0.02); I.indL.setColorAt(li, col);
      col.setRGB(on(1) ? 5 : 0.35, on(1) ? 2.2 : 0.16, on(1) ? 0.05 : 0.02); I.indR.setColorAt(li, col);
      if (night > 0.01) {
        const len = 9 + Math.min(9, v.v * 0.4);
        E.set(0, pose.yaw, 0); Q.setFromEuler(E);
        P.set(pose.x + Math.cos(pose.yaw) * (v.len * 0.5 - 0.5), pose.y + 0.14, pose.z - Math.sin(pose.yaw) * (v.len * 0.5 - 0.5));
        Sc.set(len, 1, 3.2 + v.width); M.compose(P, Q, Sc); pools.setMatrixAt(li, M);
      }
      if (debug) {
        P.set(pose.x, pose.y + 4.2, pose.z); Q.identity(); Sc.set(1, 1, 1); M.compose(P, Q, Sc); markers.setMatrixAt(li, M);
        markers.setColorAt(li, v.yielding ? cc('#eb5757') : v.commit != null ? cc('#6fcf97') : v.path.kind === 'accel' ? cc('#f2c94c') : cc('#d9e2ec'));
      }
      li++;
    }
    for (const k of ['body', 'glass', 'wheels']) I[k].count = ci;
    for (const k of ['cab', 'tglass', 'trailer', 'twheels']) I[k].count = ti;
    for (const k of ['rear', 'front', 'indL', 'indR']) I[k].count = li;
    pools.count = night > 0.01 ? li : 0;
    markers.count = debug ? li : 0;
    markers.visible = !!debug;
    for (const m of Object.values(I)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    pools.instanceMatrix.needsUpdate = true;
    markers.instanceMatrix.needsUpdate = true; if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
  }

  // Parked cars in the commuter lot
  const parkedGroup = new THREE.Group();
  for (const pk of net.parking) {
    const n = Math.floor(pk.w / 2.7);
    const parked = new THREE.InstancedMesh(cg.body, paint, n * 2), pg = new THREE.InstancedMesh(cg.glass, glassMat, n * 2);
    let k = 0;
    const palette = ['#f4f5f2', '#c9ccd1', '#2a2d31', '#2e4a7a', '#8f949b', '#8c1c1c', '#121315'];
    for (const side of [-1, 1]) for (let i = 0; i < n; i++) {
      if ((i * 7 + (side > 0 ? 3 : 0)) % 5 === 0) continue;
      const lx = -pk.w / 2 + (i + 0.5) * 2.7, lz = side * (pk.h / 2 - 2.9);
      const pos = new THREE.Vector3(lx, 0.05, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), -pk.angle).add(new THREE.Vector3(pk.c[0], 0, pk.c[1]));
      Q.setFromEuler(new THREE.Euler(0, Math.PI / 2 - pk.angle + (side > 0 ? Math.PI : 0) + ((i * 13) % 5 - 2) * 0.02, 0));
      M.compose(pos, Q, new THREE.Vector3(1, 1, 1));
      parked.setMatrixAt(k, M); pg.setMatrixAt(k, M); parked.setColorAt(k, cc(palette[(i * 3 + side + 7) % palette.length])); k++;
    }
    parked.count = pg.count = k;
    parked.castShadow = pg.castShadow = true;
    parkedGroup.add(parked, pg);
  }
  group.add(parkedGroup);

  return {
    update,
    setNight(k) { night = k; poolMat.opacity = 0.32 * k; },
    group,
    poseOf(v) { computePose(v); return { ...pose }; },
  };
}
