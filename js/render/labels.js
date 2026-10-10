// Map labels: road names laid on the ground beside the roads (like the map),
// the river name, POI pins, E20 shields and "86 Kastenhofsmotet" exit signs.
import * as THREE from 'three';
import { toM } from '../network/build.js';
import { LABELS } from '../network/roads.js';

const FONT = 'Inter, system-ui, -apple-system, sans-serif';

function textCanvas(text, { size = 64, weight = 600, color = '#fff', shadow = 'rgba(0,0,0,0.55)', italic = false, pad = 18, stroke = null } = {}) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2, h = Math.ceil(size * 1.45) + pad;
  cv.width = w; cv.height = h;
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineWidth = size * 0.16; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(text, w / 2, h / 2); }
  ctx.shadowColor = shadow; ctx.shadowBlur = size * 0.18; ctx.shadowOffsetY = size * 0.04;
  ctx.fillStyle = color; ctx.fillText(text, w / 2, h / 2);
  return cv;
}
const tex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

function groundLabel(text, x, z, angle, height, opts) {
  const cv = textCanvas(text, opts);
  const aspect = cv.width / cv.height;
  const g = new THREE.PlaneGeometry(height * aspect, height);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.position.set(x, 0.3, z);
  m.rotation.y = -angle;
  m.renderOrder = 4;
  return m;
}

function sprite(cv, h) {
  const mat = new THREE.SpriteMaterial({ map: tex(cv), depthTest: true, sizeAttenuation: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(h * cv.width / cv.height, h, 1);
  s.renderOrder = 5;
  return s;
}

function shieldCanvas(text, bg, fg, border) {
  const cv = document.createElement('canvas'); const ctx = cv.getContext('2d');
  ctx.font = `700 46px ${FONT}`;
  const w = Math.ceil(ctx.measureText(text).width) + 40, h = 70;
  cv.width = w; cv.height = h;
  const r = 12;
  ctx.beginPath(); ctx.roundRect(3, 3, w - 6, h - 6, r); ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = border; ctx.stroke();
  ctx.font = `700 46px ${FONT}`; ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2 + 2);
  return cv;
}

function exitCanvas() {
  const cv = document.createElement('canvas'); cv.width = 360; cv.height = 96; const ctx = cv.getContext('2d');
  ctx.beginPath(); ctx.roundRect(2, 2, 356, 92, 10); ctx.fillStyle = '#f6d64a'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#6b5a12'; ctx.stroke();
  ctx.fillStyle = '#222'; ctx.font = `700 34px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillText('86', 18, 30);
  ctx.font = `600 32px ${FONT}`; ctx.fillText('Kastenhofsmotet', 18, 68);
  return cv;
}

function pinCanvas(text, kind) {
  const cv = document.createElement('canvas'); const ctx = cv.getContext('2d');
  ctx.font = `600 34px ${FONT}`;
  const tw = Math.ceil(ctx.measureText(text).width);
  cv.width = tw + 96; cv.height = 72;
  // icon
  ctx.beginPath(); ctx.arc(36, 36, 24, 0, Math.PI * 2); ctx.fillStyle = kind === 'parking' ? '#4b6bd6' : '#5f6b78'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `800 26px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (kind === 'parking') ctx.fillText('P', 36, 37); else { ctx.beginPath(); ctx.arc(36, 36, 8, 0, Math.PI * 2); ctx.fill(); }
  ctx.font = `600 34px ${FONT}`; ctx.textAlign = 'left';
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(15,22,28,0.75)'; ctx.lineJoin = 'round'; ctx.strokeText(text, 72, 37);
  ctx.fillStyle = '#fff'; ctx.fillText(text, 72, 37);
  return cv;
}

export function buildLabels(scene, net) {
  const group = new THREE.Group();
  for (const L of LABELS.roads) {
    const raw = net.rawRoads[L.road];
    const [x, z] = toM(L.at);
    const q = raw.nearest(x, z);
    const [px, pz] = raw.point(q.s), [tx, tz] = raw.tangent(q.s);
    let ang = Math.atan2(tz, tx);
    if (Math.cos(ang) < 0) ang += Math.PI; // keep text reading left-to-right
    const side = q.side || 1, [nx, nz] = raw.normal(q.s);
    const off = 9.5 * side;
    group.add(groundLabel(L.text, px + nx * off, pz + nz * off, ang, 6.2, { color: '#ffffff', shadow: 'rgba(10,20,10,0.75)' }));
  }
  for (const W of LABELS.water) {
    const [x, z] = toM(W.at);
    group.add(groundLabel(W.text, x, z, W.angle, 9, { color: '#d9f1ff', italic: true, weight: 600, shadow: 'rgba(0,30,50,0.7)' }));
  }
  for (const at of LABELS.shields) {
    const [x, z] = toM(at);
    const s = sprite(shieldCanvas('E20', '#2f7d32', '#fff', '#eaf5ea'), 0.014); s.position.set(x, 12, z); group.add(s);
  }
  for (const at of LABELS.exits) {
    const [x, z] = toM(at);
    const s = sprite(exitCanvas(), 0.019); s.position.set(x, 14, z); group.add(s);
  }
  for (const p of LABELS.pois) {
    const [x, z] = toM(p.at);
    const s = sprite(pinCanvas(p.text, p.kind), 0.019); s.center.set(36 / (s.material.map.image.width), 0.5); s.position.set(x, 6, z); group.add(s);
  }
  scene.add(group);
  return group;
}
