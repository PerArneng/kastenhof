// Auto mode: an ambient "traffic chopper" that flies a closed loop around the
// interchange, framing one interesting spot after another.
//
// Each shot is an orbit pose: where the camera looks (target), how far away
// it is, how steeply it looks down (polar, 0 = straight down) and from which
// compass direction (az, 0 = from the south, π/2 = from the east). The poses
// are interpolated as orbit parameters, never as raw positions, so the
// camera always circles and looks down and never cuts through the ground.
// The bearing keeps increasing over the loop and adds up to one full turn.
import * as THREE from 'three';

export const SHOTS = [
  { name: 'Kastenhofsmotet', t: [0, 0], d: 1150, polar: 0.82, az: -0.45 },
  { name: 'Cirkulationsplatsen', t: [150, 10], d: 330, polar: 0.92, az: 0.35 },
  { name: 'Hedeforsvägen', t: [240, -20], d: 520, polar: 0.88, az: 1.25 },
  { name: 'E20 mot Alingsås', t: [150, -160], d: 600, polar: 0.95, az: 2.2 },
  { name: 'Dageborgsleden', t: [-80, -85], d: 380, polar: 0.9, az: 3.1 },
  { name: 'Bron under E20', t: [-20, 50], d: 300, polar: 0.98, az: 3.9 },
  { name: 'Södra Långvägen', t: [-130, 140], d: 520, polar: 0.85, az: 4.75 },
  { name: 'E20 från Göteborg', t: [-300, 150], d: 700, polar: 0.9, az: 5.4 },
];

const SPEED = 9;          // m/s of "visual travel" at 1× (camera + target motion)
const TARGET_W = 1.5;     // target motion counts more than camera motion
const REJOIN = 6;         // s to ease back onto the path
const SAMPLES = 240;      // arc-length samples per shot

const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
const smooth = (k) => k * k * (3 - 2 * k);

// Orbit pose at loop parameter u ∈ [0, n): closed Catmull-Rom per parameter.
export function poseAt(u, out = {}) {
  const n = SHOTS.length, i = Math.floor(u), f = u - i;
  const k = (j) => {
    const s = SHOTS[((j % n) + n) % n];
    return { ...s, az: s.az + 2 * Math.PI * Math.floor(j / n) }; // unwrap the bearing
  };
  const [a, b, c, d] = [k(i - 1), k(i), k(i + 1), k(i + 2)];
  const g = (fn) => cr(fn(a), fn(b), fn(c), fn(d), f);
  out.tx = g((s) => s.t[0]); out.tz = g((s) => s.t[1]);
  out.ld = g((s) => Math.log(s.d));
  out.polar = THREE.MathUtils.clamp(g((s) => s.polar), 0.45, 1.25);
  out.az = g((s) => s.az);
  return out;
}

export function poseToCamera(p, pos, target) {
  const d = Math.exp(p.ld);
  target.set(p.tx, 0, p.tz);
  pos.set(p.tx + d * Math.sin(p.polar) * Math.sin(p.az), d * Math.cos(p.polar), p.tz + d * Math.sin(p.polar) * Math.cos(p.az));
}

export function createAutoCam(view) {
  const { camera, controls } = view;
  const n = SHOTS.length;

  // Arc-length table over the loop, so the camera moves at a steady speed.
  const N = n * SAMPLES;
  const cum = new Float64Array(N + 1), P = new THREE.Vector3(), T = new THREE.Vector3(), P0 = new THREE.Vector3(), T0 = new THREE.Vector3();
  const pose = {};
  poseToCamera(poseAt(0, pose), P0, T0);
  for (let i = 1; i <= N; i++) {
    poseToCamera(poseAt((i / N) * n, pose), P, T);
    cum[i] = cum[i - 1] + P.distanceTo(P0) + TARGET_W * T.distanceTo(T0);
    P0.copy(P); T0.copy(T);
  }
  const L = cum[N];
  const uAt = (s) => {
    s = ((s % L) + L) % L;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    return ((lo + (s - cum[lo]) / (cum[hi] - cum[lo] || 1)) / N) * n;
  };

  let enabled = false, speed = 1, s = 0, rejoinT = 0;
  const from = {};
  const cur = {}, tgt = new THREE.Vector3(), pos = new THREE.Vector3();

  // The current camera as an orbit pose.
  function currentPose(out) {
    const t = controls.target, o = camera.position.clone().sub(t), d = Math.max(1, o.length());
    out.tx = t.x; out.tz = t.z; out.ld = Math.log(d);
    out.polar = Math.acos(THREE.MathUtils.clamp(o.y / d, -1, 1));
    out.az = Math.atan2(o.x, o.z);
    return out;
  }

  function enable() {
    // Rejoin at the closest point of the loop and ease in from where we are.
    currentPose(from);
    let best = Infinity, bi = 0;
    for (let i = 0; i < N; i += 4) {
      poseToCamera(poseAt((i / N) * n, pose), P, T);
      const dd = P.distanceTo(camera.position) + TARGET_W * T.distanceTo(controls.target);
      if (dd < best) { best = dd; bi = i; }
    }
    s = cum[bi];
    rejoinT = 0;
    enabled = true;
  }

  return {
    get enabled() { return enabled; },
    get speed() { return speed; },
    loopSeconds: () => L / SPEED,
    setSpeed(k) { speed = k; },
    setEnabled(on) { if (on && !enabled) enable(); else if (!on) enabled = false; },
    update(dt) {
      if (!enabled) return;
      s += SPEED * speed * dt;
      poseAt(uAt(s), cur);
      if (rejoinT < REJOIN) {
        rejoinT += dt;
        const w = smooth(Math.min(1, rejoinT / REJOIN));
        // Turn the short way round to the path's bearing.
        const az0 = from.az + 2 * Math.PI * Math.round((cur.az - from.az) / (2 * Math.PI));
        for (const k of ['tx', 'tz', 'ld', 'polar']) cur[k] = from[k] + (cur[k] - from[k]) * w;
        cur.az = az0 + (cur.az - az0) * w;
      }
      poseToCamera(cur, pos, tgt);
      camera.position.copy(pos);
      controls.target.copy(tgt);
      controls.update();
    },
    // For the path preview: camera positions and look-at points around the loop.
    samples(count = 600) {
      const out = [];
      for (let i = 0; i <= count; i++) {
        const p = new THREE.Vector3(), t = new THREE.Vector3();
        poseToCamera(poseAt(uAt((i / count) * L), pose), p, t);
        out.push({ p, t });
      }
      return out;
    },
    shots() {
      return SHOTS.map((sh, i) => { const p = new THREE.Vector3(), t = new THREE.Vector3(); poseToCamera(poseAt(i, pose), p, t); return { name: sh.name, p, t }; });
    },
  };
}
