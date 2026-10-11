// Route highlight: a thin line of translucent arrows floating above the road
// along a route's main (noise-free) path, drifting in the direction of travel.
import * as THREE from 'three';

const LIFT = 2.5;      // m above the road surface
const ARROW = 4.5;     // m, chevron width at scale 1
const PX = 22;         // target on-screen arrow width (pixels)
const GAP = 3;         // arrow spacing in arrow widths
const FLOW = 2;        // arrow widths per second of drift
const COLOR = 0xffd34d;

// Points [x, y, z] along the fastest path from the route's entry to its exit.
export function routePolyline(net, router, route) {
  const entry = net.entries[route.from];
  if (!entry) return null;
  let ids = null;
  for (const lane of entry.lanes) if ((ids = router.route(lane, route.to, 0))) break;
  if (!ids) return null;
  const pts = [];
  // A lane change is a hop to a parallel path (p.left / p.right): cross over
  // halfway along instead of driving the whole lane and doubling back.
  const lateral = (a, b) => a !== undefined && b !== undefined && (net.paths[a].left === b || net.paths[a].right === b);
  ids.forEach((id, k) => {
    const p = net.paths[id];
    const half = Math.floor(p.n / 2);
    // Pick up the new lane just ahead of where the old one was left (lanes
    // aren't sampled in step), so the diagonal never points backwards.
    const last = pts[pts.length - 1];
    const i0 = lateral(ids[k - 1], id) ? Math.min(p.n - 1, Math.ceil((p.nearest(last[0], last[2]).s + 8) / p.ds)) : 0;
    const i1 = lateral(id, ids[k + 1]) ? half : p.n - 1;
    for (let i = i0; i <= i1; i++) {
      const q = [p.x[i], p.h[i] + LIFT, p.z[i]];
      const prev = pts[pts.length - 1];
      if (!prev || Math.hypot(q[0] - prev[0], q[2] - prev[2]) > 0.5) pts.push(q);
    }
  });
  return pts.length > 1 ? pts : null;
}

// Arc-length table so points and headings can be looked up by distance.
function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const len = cum[cum.length - 1];
  let j = 0;
  // Sequential lookups (increasing s) reuse j; reset when s goes back.
  function at(s, out) {
    if (s < cum[j]) j = 0;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const a = pts[j], b = pts[j + 1], t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t; out.z = a[2] + (b[2] - a[2]) * t;
    out.yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
    return out;
  }
  return { len, at };
}

function chevronGeometry() {
  // Points along +x, 4.5 m wide, lying flat (shape xy → world xz).
  const s = new THREE.Shape();
  s.moveTo(1.6, 0); s.lineTo(-1.2, 2.25); s.lineTo(-1.2, 1.25); s.lineTo(0.2, 0);
  s.lineTo(-1.2, -1.25); s.lineTo(-1.2, -2.25); s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

// `getNet` / `getRouter` return the live network and router (the layout can change).
export function createRouteOverlay(scene, getNet, getRouter, view) {
  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 12;
  scene.add(group);
  const mat = (opacity) => ({ color: COLOR, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
  const lineMat = new THREE.LineBasicMaterial(mat(0.45));
  const arrowMat = new THREE.MeshBasicMaterial({ ...mat(0.7), side: THREE.DoubleSide });
  const endMat = new THREE.MeshBasicMaterial({ ...mat(0.55), side: THREE.DoubleSide });
  const startGeo = new THREE.CircleGeometry(2.6, 24).rotateX(-Math.PI / 2);
  const endGeo = new THREE.RingGeometry(2.4, 3.6, 32).rotateX(-Math.PI / 2);
  const arrowGeo = chevronGeometry();

  const cache = new Map();
  let cur = [], shown = null;

  function build(route) {
    const pts = routePolyline(getNet(), getRouter(), route);
    if (!pts) return null;
    const m = measure(pts);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))), lineMat);
    const max = Math.max(1, Math.floor(m.len / (ARROW * GAP)));
    const arrows = new THREE.InstancedMesh(arrowGeo, arrowMat, max);
    arrows.frustumCulled = false;
    const start = new THREE.Mesh(startGeo, endMat); start.position.set(...pts[0]);
    const end = new THREE.Mesh(endGeo, endMat); end.position.set(...pts[pts.length - 1]);
    const g = new THREE.Group();
    for (const o of [line, arrows, start, end]) { o.renderOrder = 12; g.add(o); }
    return { g, m, arrows, max, start, end };
  }

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const pt = {};

  return {
    // Forget cached paths after the road layout changes, and redraw what was shown.
    reset() {
      const again = shown;
      this.show(null);
      for (const c of cache.values()) if (c) { c.g.children[0].geometry.dispose(); c.arrows.dispose(); }
      cache.clear();
      this.show(again);
    },
    // Show one route, a list of routes (e.g. all of them), or nothing (null).
    show(routes) {
      shown = routes;
      for (const c of cur) group.remove(c.g);
      cur = [];
      for (const route of routes ? [].concat(routes) : []) {
        if (!cache.has(route.id)) cache.set(route.id, build(route));
        const c = cache.get(route.id);
        if (c) { group.add(c.g); cur.push(c); }
      }
      group.visible = cur.length > 0;
    },
    update(t) {
      if (!cur.length) return;
      // Keep arrows a steady size on screen: metres per pixel at the orbit target.
      const { camera, controls } = view;
      const mpp = (camera.position.distanceTo(controls.target) * 2 * Math.tan((camera.fov * Math.PI) / 360)) / window.innerHeight;
      const size = Math.min(12, Math.max(1, (mpp * PX) / ARROW));
      const spacing = ARROW * GAP * size;
      for (const c of cur) drawArrows(c, t, size, spacing);
    },
  };

  function drawArrows({ m, arrows, max, start, end }, t, size, spacing) {
    start.scale.setScalar(size); end.scale.setScalar(size);
    const phase = (t * FLOW * ARROW * size) % spacing;
    const count = Math.min(max, Math.ceil((m.len - phase) / spacing));
    arrows.count = count;
    for (let i = 0; i < count; i++) {
      const s = Math.min(m.len, phase + i * spacing);
      m.at(s, pt);
      P.set(pt.x, pt.y, pt.z);
      Q.setFromAxisAngle(up, pt.yaw);
      // Fade in at the start and out at the end of the route.
      const k = Math.min(1, s / spacing, (m.len - s) / spacing);
      S.setScalar(size * Math.max(0.05, k));
      arrows.setMatrixAt(i, M.compose(P, Q, S));
    }
    arrows.instanceMatrix.needsUpdate = true;
  }
}
