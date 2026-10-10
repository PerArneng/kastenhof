// Polyline helpers shared by the network builder and the renderer.
// Points are [x, z] in metres; z grows "down" the map (south), matching image space.

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const angleOf = (x, z) => Math.atan2(z, x);
export const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };

function dedupe(pts, eps = 0.05) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) if (dist(pts[i], out[out.length - 1]) > eps) out.push(pts[i]);
  return out;
}

// Centripetal Catmull–Rom through the control points.
export function catmullRom(points, step = 1.5) {
  const p = dedupe(points);
  if (p.length < 3) return p.slice();
  const n = p.length;
  const ext = [
    [2 * p[0][0] - p[1][0], 2 * p[0][1] - p[1][1]],
    ...p,
    [2 * p[n - 1][0] - p[n - 2][0], 2 * p[n - 1][1] - p[n - 2][1]],
  ];
  const out = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const P0 = ext[i - 1], P1 = ext[i], P2 = ext[i + 1], P3 = ext[i + 2];
    const t0 = 0;
    const t1 = t0 + Math.pow(dist(P0, P1), 0.5) || t0 + 1e-3;
    const t2 = t1 + Math.pow(dist(P1, P2), 0.5) || t1 + 1e-3;
    const t3 = t2 + Math.pow(dist(P2, P3), 0.5) || t2 + 1e-3;
    const segs = Math.max(2, Math.ceil(dist(P1, P2) / step));
    for (let k = 0; k < segs; k++) {
      const t = t1 + (t2 - t1) * (k / segs);
      const A1 = mix(P0, P1, (t - t0) / (t1 - t0));
      const A2 = mix(P1, P2, (t - t1) / (t2 - t1));
      const A3 = mix(P2, P3, (t - t2) / (t3 - t2));
      const B1 = mix(A1, A2, (t - t0) / (t2 - t0));
      const B2 = mix(A2, A3, (t - t1) / (t3 - t1));
      out.push(mix(B1, B2, (t - t1) / (t2 - t1)));
    }
  }
  out.push(p[n - 1]);
  return out;
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function cubicBezier(p0, p1, p2, p3, step = 0.8) {
  const approx = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(4, Math.ceil(approx / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

// Uniformly re-sampled polyline with O(1) lookup by arc length.
export class Polyline {
  constructor(points, ds = 1) {
    const p = dedupe(points);
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + dist(p[i - 1], p[i]));
    const len = cum[cum.length - 1];
    const n = Math.max(2, Math.round(len / ds) + 1);
    this.len = len;
    this.n = n;
    this.ds = len / (n - 1);
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = i * this.ds;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const segLen = cum[j + 1] - cum[j] || 1;
      const t = clamp((s - cum[j]) / segLen, 0, 1);
      this.x[i] = lerp(p[j][0], p[j + 1][0], t);
      this.z[i] = lerp(p[j][1], p[j + 1][1], t);
    }
  }
  index(s) { return clamp(s / this.ds, 0, this.n - 1); }
  point(s) {
    const f = this.index(s), i = Math.min(this.n - 2, Math.floor(f)), t = f - i;
    return [lerp(this.x[i], this.x[i + 1], t), lerp(this.z[i], this.z[i + 1], t)];
  }
  tangent(s) {
    const f = this.index(s);
    const i = Math.min(this.n - 2, Math.max(0, Math.floor(f)));
    const dx = this.x[i + 1] - this.x[i], dz = this.z[i + 1] - this.z[i];
    const L = Math.hypot(dx, dz) || 1;
    return [dx / L, dz / L];
  }
  // Right-hand normal of the travel direction (z points south, so this is +90°).
  normal(s) { const [tx, tz] = this.tangent(s); return [-tz, tx]; }
  points() { const o = []; for (let i = 0; i < this.n; i++) o.push([this.x[i], this.z[i]]); return o; }
  nearest(x, z, s0 = 0, s1 = this.len) {
    let best = Infinity, bi = 0;
    const i0 = Math.floor(this.index(s0)), i1 = Math.ceil(this.index(s1));
    for (let i = i0; i <= i1; i++) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    // refine on neighbouring segments
    let bs = bi * this.ds, bd = Math.sqrt(best);
    for (const k of [bi - 1, bi]) {
      if (k < 0 || k >= this.n - 1) continue;
      const ax = this.x[k], az = this.z[k], bx = this.x[k + 1], bz = this.z[k + 1];
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
      const d = Math.hypot(ax + vx * t - x, az + vz * t - z);
      if (d < bd) { bd = d; bs = (k + t) * this.ds; }
    }
    const [nx, nz] = this.normal(bs);
    const [px, pz] = this.point(bs);
    return { s: bs, d: bd, side: Math.sign((x - px) * nx + (z - pz) * nz) };
  }
  // Points between s0..s1, offset to the right by off(s) (number or function).
  sliceOffset(s0, s1, off = 0, step = 1) {
    const out = [];
    const n = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
    for (let i = 0; i < n; i++) {
      const s = s0 + (s1 - s0) * (i / (n - 1));
      const [x, z] = this.point(s);
      const [nx, nz] = this.normal(s);
      const o = typeof off === 'function' ? off(s) : off;
      out.push([x + nx * o, z + nz * o]);
    }
    return out;
  }
}

// First intersection between two polylines (arrays of [x,z]); returns arc-lengths.
export function intersectPolylines(a, b) {
  let sa = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const la = dist(a[i], a[i + 1]);
    let sb = 0;
    for (let j = 0; j < b.length - 1; j++) {
      const lb = dist(b[j], b[j + 1]);
      const r = segIntersect(a[i], a[i + 1], b[j], b[j + 1]);
      if (r) return { sa: sa + r[0] * la, sb: sb + r[1] * lb, p: [lerp(a[i][0], a[i + 1][0], r[0]), lerp(a[i][1], a[i + 1][1], r[0])] };
      sb += lb;
    }
    sa += la;
  }
  return null;
}

function segIntersect(p, p2, q, q2) {
  const rx = p2[0] - p[0], rz = p2[1] - p[1];
  const sx = q2[0] - q[0], sz = q2[1] - q[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = q[0] - p[0], qpz = q[1] - p[1];
  const t = (qpx * sz - qpz * sx) / den;
  const u = (qpx * rz - qpz * rx) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [t, u];
  return null;
}

export function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
