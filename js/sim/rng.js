// Small seeded RNG so runs (and the headless self-test) are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function gaussFrom(u1, u2) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, u1))) * Math.cos(2 * Math.PI * u2);
}

export function pickWeighted(rand, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rand() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries.length ? entries[entries.length - 1][0] : null;
}
