// Intelligent Driver Model (Treiber et al.) plus small kinematic helpers.

export function idm(v, v0, gap, dv, P) {
  const free = v0 > 0.05 ? 1 - Math.pow(v / v0, 4) : -2;
  if (!(gap < Infinity)) return P.a * free;
  const sStar = P.s0 + Math.max(0, v * P.T + (v * dv) / (2 * Math.sqrt(P.a * P.b)));
  return P.a * (free - (sStar / Math.max(gap, 0.05)) ** 2);
}

// Time to cover distance d starting at speed v0, accelerating at a up to vmax.
export function travelTime(d, v0, a, vmax) {
  if (d <= 0) return 0;
  v0 = Math.max(0, Math.min(v0, vmax));
  if (a <= 0) return v0 > 0.05 ? d / v0 : Infinity;
  const t1 = (vmax - v0) / a;
  const d1 = (v0 + vmax) * 0.5 * t1;
  if (d <= d1) return (-v0 + Math.sqrt(v0 * v0 + 2 * a * d)) / a;
  return t1 + (d - d1) / vmax;
}
