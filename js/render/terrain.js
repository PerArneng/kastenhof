// Ground, river, forests, houses – derived from the reference map so the
// landscape follows the real land use (green, residential, water, minor roads).
import * as THREE from 'three';
import * as d3 from 'd3';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { MAP_HALF, toM } from '../network/build.js';
import { LABELS } from '../network/roads.js';

const GW = 1000, GH = 620; // classification grid: 1 cell ≈ 1 m
const C = { GREEN: 0, URBAN: 1, WATER: 2, ROAD: 3, MOTOR: 4 };

// ---------- noise
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); }
const forestness = (x, z) => fbm(x / 140 + 11.3, z / 140 - 4.1, 4);

function classify(img) {
  const cv = document.createElement('canvas'); cv.width = GW; cv.height = GH;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, GW, GH);
  const d = ctx.getImageData(0, 0, GW, GH).data;
  const cls = new Uint8Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    let c = C.GREEN;
    if (b < 205 && r < 180 && g < 190) c = C.MOTOR;
    else if (r < 190 && b > 215 && g > 195) c = C.WATER;
    else if (r > 238 && g > 236 && b > 236) c = C.URBAN;
    else if (r > 200 && r < 234 && g > 210 && g < 236 && b > 216 && b < 240 && Math.abs(g - r) < 14) c = C.ROAD;
    cls[i] = c;
  }
  // close small holes (labels/icons) inside water and urban areas
  const out = cls.slice();
  for (let y = 2; y < GH - 2; y++) for (let x = 2; x < GW - 2; x++) {
    const i = y * GW + x;
    if (cls[i] !== C.GREEN) continue;
    let w = 0, u = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const c = cls[i + dy * GW + dx]; if (c === C.WATER) w++; else if (c === C.URBAN) u++; }
    if (w >= 14) out[i] = C.WATER; else if (u >= 16) out[i] = C.URBAN;
  }
  // drop small water blobs (map icons such as the blue P marker)
  const seen = new Uint8Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) {
    if (out[i] !== C.WATER || seen[i]) continue;
    const stack = [i], comp = []; seen[i] = 1;
    while (stack.length) {
      const k = stack.pop(); comp.push(k);
      const x = k % GW, y = (k / GW) | 0;
      for (const n of [x > 0 ? k - 1 : -1, x < GW - 1 ? k + 1 : -1, y > 0 ? k - GW : -1, y < GH - 1 ? k + GW : -1]) {
        if (n >= 0 && !seen[n] && out[n] === C.WATER) { seen[n] = 1; stack.push(n); }
      }
    }
    if (comp.length < 600) for (const k of comp) out[k] = C.GREEN;
  }
  return out;
}

export function buildTerrain(scene, net, refImage) {
  const S = CONFIG.scale;
  const cls = classify(refImage);
  const at = (x, z) => { // world metres → class
    const gx = Math.floor((x / (MAP_HALF[0] * 2) + 0.5) * GW), gz = Math.floor((z / (MAP_HALF[1] * 2) + 0.5) * GH);
    if (gx < 0 || gz < 0 || gx >= GW || gz >= GH) return -1;
    return cls[gz * GW + gx];
  };

  // Spatial hash of drivable network for keep-out
  const cell = 8, grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const p of net.paths) for (let i = 0; i < p.n; i += 2) {
    const k = key(p.x[i], p.z[i]); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(p.x[i], p.z[i], p.width);
  }
  const nearRoad = (x, z, pad) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const a = grid.get(`${cx + dx},${cz + dz}`); if (!a) continue;
      for (let i = 0; i < a.length; i += 3) { const r = a[i + 2] / 2 + pad; if ((a[i] - x) ** 2 + (a[i + 1] - z) ** 2 < r * r) return true; }
    }
    return false;
  };
  const nearClass = (x, z, c, r) => { for (let dx = -r; dx <= r; dx += 2) for (let dz = -r; dz <= r; dz += 2) if (at(x + dx, z + dz) === c) return true; return false; };

  // ---------- ground texture
  const TW = 2048, TH = Math.round(2048 * GH / GW);
  const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TW, TH);
  const hex = (h) => { const c = d3.rgb(h); return [c.r, c.g, c.b]; };
  const meadow = hex('#7fa860'), field = hex('#a7b86a'), forestFloor = hex('#4f7442'),
    lawn = hex('#9db57e'), yard = hex('#c9c6b8'), riverbed = hex('#3d6a62'), gravel = hex('#8b8d88');
  const mixc = (a, b, t, o) => { t = t < 0 ? 0 : t > 1 ? 1 : t; o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
  const tmpA = [0, 0, 0], tmpB = [0, 0, 0], tmpG = [0, 0, 0], tmpH = [0, 0, 0];
  const greenAt = (wx, wz, f, out) => {
    const base = mixc(meadow, field, (vnoise(wx / 70 - 3, wz / 70 + 9) - 0.45) * 2.6, tmpH);
    return mixc(base, forestFloor, (f - 0.48) * 6, out);
  };
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const wx = (x / TW - 0.5) * MAP_HALF[0] * 2, wz = (y / TH - 0.5) * MAP_HALF[1] * 2;
    const gx = Math.min(GW - 1, Math.floor(x / TW * GW)), gz = Math.min(GH - 1, Math.floor(y / TH * GH));
    const c = cls[gz * GW + gx];
    const n = vnoise(wx / 9, wz / 9) * 0.5 + vnoise(wx / 31, wz / 31) * 0.5, fine = hash(x, y) * 0.06 - 0.03;
    let col;
    if (c === C.WATER) col = riverbed;
    else if (c === C.URBAN) col = mixc(lawn, yard, 0.25 + 0.5 * n, tmpA);
    else {
      const f = (x & 1) === 0 ? forestness(wx, wz) : tmpB.f;
      tmpB.f = f;
      col = greenAt(wx, wz, f, tmpB);
      if (c === C.ROAD && !nearRoad(wx, wz, 7)) col = gravel;
    }
    const k = 0.9 + n * 0.2 + fine;
    // feather the outer border into the surrounding ground colour
    const edge = Math.min(x, y, TW - 1 - x, TH - 1 - y) / 60;
    const e = Math.min(1, edge);
    const i = (y * TW + x) * 4;
    if (e < 1) { const g = greenAt(wx, wz, forestness(wx, wz), tmpG); col = mixc(g, col, e, tmpA); }
    img.data[i] = col[0] * k;
    img.data[i + 1] = col[1] * k;
    img.data[i + 2] = col[2] * k;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Hide the map's own drawing of drivable roads under a verge (the 3D roads sit on top).
  const tx = (x) => (x / (MAP_HALF[0] * 2) + 0.5) * TW, tz = (z) => (z / (MAP_HALF[1] * 2) + 0.5) * TH;
  const line = d3.line().x((p) => tx(p[0])).y((p) => tz(p[1])).curve(d3.curveCatmullRom).context(ctx);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of net.paths) {
    if (p.kind === 'ring') continue;
    const pts = p.points().filter((_, i) => i % 3 === 0);
    ctx.beginPath(); line(pts); ctx.strokeStyle = 'rgba(120,140,96,0.95)'; ctx.lineWidth = (p.width + 9) * TW / (MAP_HALF[0] * 2); ctx.stroke();
  }
  for (const p of net.paths) {
    if (p.kind === 'ring') continue;
    const pts = p.points().filter((_, i) => i % 3 === 0);
    ctx.beginPath(); line(pts); ctx.strokeStyle = 'rgba(132,128,112,0.9)'; ctx.lineWidth = (p.width + 2.5) * TW / (MAP_HALF[0] * 2); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const refTex = new THREE.Texture(refImage); refTex.colorSpace = THREE.SRGBColorSpace; refTex.needsUpdate = true;

  const groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF[0] * 2, MAP_HALF[1] * 2), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // surrounding land: same palette, lower resolution, so the map edge disappears
  const OW = 1024, OSZ = 4400;
  const sv = document.createElement('canvas'); sv.width = sv.height = OW;
  const sctx = sv.getContext('2d'); const sd = sctx.createImageData(OW, OW);
  for (let y = 0; y < OW; y++) for (let x = 0; x < OW; x++) {
    const wx = (x / OW - 0.5) * OSZ, wz = (y / OW - 0.5) * OSZ;
    const g = greenAt(wx, wz, forestness(wx, wz), tmpG);
    const n = 0.92 + vnoise(wx / 9, wz / 9) * 0.14, i = (y * OW + x) * 4;
    sd.data[i] = g[0] * n; sd.data[i + 1] = g[1] * n; sd.data[i + 2] = g[2] * n; sd.data[i + 3] = 255;
  }
  sctx.putImageData(sd, 0, 0);
  const stex = new THREE.CanvasTexture(sv); stex.colorSpace = THREE.SRGBColorSpace; stex.anisotropy = 4;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(OSZ, OSZ), new THREE.MeshStandardMaterial({ map: stex, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.08; outer.receiveShadow = true;
  scene.add(outer);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({ color: 0x5a7d45, roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.3; scene.add(far);

  // ---------- water (Säveån)
  const wc = document.createElement('canvas'); wc.width = GW; wc.height = GH;
  const wctx = wc.getContext('2d'); const wd = wctx.createImageData(GW, GH);
  for (let i = 0; i < GW * GH; i++) { const v = cls[i] === C.WATER ? 255 : 0; wd.data[i * 4] = wd.data[i * 4 + 1] = wd.data[i * 4 + 2] = v; wd.data[i * 4 + 3] = 255; }
  wctx.putImageData(wd, 0, 0);
  const wc2 = document.createElement('canvas'); wc2.width = GW; wc2.height = GH;
  const w2 = wc2.getContext('2d'); w2.filter = 'blur(1.5px)'; w2.drawImage(wc, 0, 0);
  const alpha = new THREE.CanvasTexture(wc2);
  const normal = makeWaterNormal();
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2b6a86, roughness: 0.14, metalness: 0.1, transparent: true, alphaMap: alpha, normalMap: normal,
    normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 1.2,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF[0] * 2, MAP_HALF[1] * 2), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = 0.06; water.receiveShadow = true;
  scene.add(water);

  // ---------- trees
  const rand = d3.randomLcg(7);
  const spruce = [], birch = [];
  const tries = 26000;
  for (let i = 0; i < tries; i++) {
    const x = (rand() - 0.5) * 2200, z = (rand() - 0.5) * 1600;
    const inside = Math.abs(x) < MAP_HALF[0] && Math.abs(z) < MAP_HALF[1];
    const f = forestness(x, z);
    let p = f > 0.52 ? 0.85 : f > 0.46 ? 0.25 : 0.025;
    if (inside) {
      const c = at(x, z);
      if (c !== C.GREEN) continue;
      if (nearClass(x, z, C.ROAD, 5) || nearClass(x, z, C.WATER, 3) || nearClass(x, z, C.URBAN, 2)) continue;
    } else p *= 1.1;
    if (rand() > p) continue;
    if (nearRoad(x, z, 6)) continue;
    const big = 0.75 + rand() * 0.6;
    (rand() < 0.62 ? spruce : birch).push([x, z, big, rand() * Math.PI * 2]);
  }
  // waterside birches & alders
  for (let i = 0; i < 3000; i++) {
    const x = (rand() - 0.5) * MAP_HALF[0] * 2, z = (rand() - 0.5) * MAP_HALF[1] * 2;
    if (at(x, z) !== C.GREEN || !nearClass(x, z, C.WATER, 6) || nearRoad(x, z, 6)) continue;
    birch.push([x, z, 0.7 + rand() * 0.5, rand() * 6.28]);
  }
  scene.add(makeTrees(spruce, 'spruce'));
  scene.add(makeTrees(birch, 'birch'));

  // ---------- houses in residential areas
  const houses = [];
  for (let gx = -MAP_HALF[0]; gx < MAP_HALF[0]; gx += 17) for (let gz = -MAP_HALF[1]; gz < MAP_HALF[1]; gz += 17) {
    const x = gx + (rand() - 0.5) * 7, z = gz + (rand() - 0.5) * 7;
    if (at(x, z) !== C.URBAN) continue;
    if (nearClass(x, z, C.ROAD, 4) || nearClass(x, z, C.GREEN, 4) || nearRoad(x, z, 9)) continue;
    if (fbm(x / 40, z / 40, 2) < 0.38) continue;
    houses.push([x, z, rand()]);
  }
  // Kastenhof Herrgård – the manor house
  const manor = toM([262, 575]);
  scene.add(makeHouses(houses, manor));

  return {
    ground, groundMat, mapTex: tex, refTex, water, waterNormal: normal,
    update(t) { normal.offset.set((t * 0.012) % 1, (t * 0.007) % 1); },
    setReference(on) { groundMat.map = on ? refTex : tex; groundMat.needsUpdate = true; water.visible = !on; },
  };
}

function makeWaterNormal() {
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d'); const d = ctx.createImageData(N, N);
  const h = (x, y) => fbm(x / 18, y / 18, 3) * 0.6 + fbm(x / 6 + 30, y / 9, 2) * 0.4;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h((x + 1) % N, y) - h((x - 1 + N) % N, y), dy = h(x, (y + 1) % N) - h(x, (y - 1 + N) % N);
    const nx = -dx * 3, ny = -dy * 3, nz = 1, L = Math.hypot(nx, ny, nz), i = (y * N + x) * 4;
    d.data[i] = (nx / L * 0.5 + 0.5) * 255; d.data[i + 1] = (ny / L * 0.5 + 0.5) * 255; d.data[i + 2] = (nz / L * 0.5 + 0.5) * 255; d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 25);
  return t;
}

function makeTrees(list, kind) {
  const group = new THREE.Group();
  let crown, trunk, palette;
  if (kind === 'spruce') {
    const parts = [];
    for (let k = 0; k < 3; k++) { const g = new THREE.ConeGeometry(3.4 - k * 0.9, 5.5 - k * 0.8, 7); g.translate(0, 4 + k * 3.2, 0); parts.push(g); }
    crown = mergeGeometries(parts);
    trunk = new THREE.CylinderGeometry(0.25, 0.35, 3, 5); trunk.translate(0, 1.5, 0);
    palette = ['#2f5233', '#29482c', '#355c37', '#24402a', '#3a6340'];
  } else {
    crown = new THREE.IcosahedronGeometry(3.2, 1); crown.scale(1, 1.35, 1); crown.translate(0, 7.2, 0);
    trunk = new THREE.CylinderGeometry(0.2, 0.3, 5, 5); trunk.translate(0, 2.5, 0);
    palette = ['#6f9a45', '#7fa84c', '#5e8a3e', '#8aa955', '#6a8f3c'];
  }
  const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: kind === 'birch' ? 0xe9e4da : 0x4a3a2a, roughness: 1 });
  const cm = new THREE.InstancedMesh(crown, crownMat, list.length);
  const tm = new THREE.InstancedMesh(trunk, trunkMat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  list.forEach(([x, z, sc, rot], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    s.set(sc, sc * (0.9 + (i % 7) * 0.04), sc); p.set(x, 0, z);
    m.compose(p, q, s); cm.setMatrixAt(i, m); tm.setMatrixAt(i, m);
    col.set(palette[i % palette.length]).offsetHSL(0, 0, ((i * 37) % 11) / 110 - 0.05); cm.setColorAt(i, col);
  });
  for (const mesh of [cm, tm]) { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
  return group;
}

function makeHouses(list, manor) {
  const group = new THREE.Group();
  const body = new THREE.BoxGeometry(9, 4.2, 6.5); body.translate(0, 2.1, 0);
  const roof = new THREE.CylinderGeometry(0.01, 4.9, 2.6, 4, 1); // pyramid-ish base
  roof.rotateY(Math.PI / 4); roof.scale(1.32, 1, 0.98); roof.translate(0, 5.5, 0);
  const prism = new THREE.BufferGeometry();
  { // gable roof as a triangular prism
    const w = 4.9, l = 5.4, h = 2.6, y = 4.2;
    const v = [-l, y, -w, l, y, -w, 0, 0, 0]; void v;
    const pts = [[-l, y, -w], [l, y, -w], [l, y + h, 0], [-l, y + h, 0], [-l, y, w], [l, y, w]];
    const idx = [0, 1, 2, 0, 2, 3, 4, 3, 2, 4, 2, 5, 0, 3, 4, 1, 5, 2];
    prism.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    prism.setIndex(idx); prism.computeVertexNormals();
  }
  void roof;
  const pal = [['#8e2b20', 55], ['#efe9dc', 18], ['#d9b45a', 14], ['#9aa3a8', 8], ['#5d6d4e', 5]];
  const roofPal = ['#2b2c30', '#3a2a26', '#5a2a22', '#3c4045'];
  const pick = (r) => { let t = r * 100; for (const [c, w] of pal) { t -= w; if (t <= 0) return c; } return pal[0][0]; };
  const all = list.concat([[manor[0], manor[1], -1]]);
  const bm = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.85 }), all.length);
  const rm = new THREE.InstancedMesh(prism, new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }), all.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  all.forEach(([x, z, r], i) => {
    const isManor = r < 0;
    const ang = isManor ? -0.1 : (Math.floor(r * 4) * Math.PI / 2) + 0.35 + (r - 0.5) * 0.2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    const sc = isManor ? 2.4 : 0.85 + (r * 7 % 1) * 0.4;
    s.set(sc, isManor ? 1.6 : 1, sc * (isManor ? 0.8 : 1)); p.set(x, 0, z);
    m.compose(p, q, s); bm.setMatrixAt(i, m); rm.setMatrixAt(i, m);
    col.set(isManor ? '#e8d9a8' : pick((r * 13.7) % 1)); bm.setColorAt(i, col);
    col.set(isManor ? '#3b3d42' : roofPal[Math.floor(r * 97) % roofPal.length]); rm.setColorAt(i, col);
  });
  for (const mesh of [bm, rm]) { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
  void LABELS;
  return group;
}
