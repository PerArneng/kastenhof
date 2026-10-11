import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildNetwork } from './network/build.js';
import { World } from './sim/world.js';
import { createScene } from './render/scene.js';
import { buildTerrain } from './render/terrain.js';
import { buildRoads } from './render/roads.js';
import { buildLabels } from './render/labels.js';
import { createVehicleRenderer } from './render/vehicles.js';
import { createRouteOverlay } from './render/routeOverlay.js';
import { createAutoCam } from './render/autoCam.js';
import { createPathPreview } from './ui/pathPreview.js';
import { createControls } from './ui/controls.js';

const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function main() {
  const net = buildNetwork();
  const world = new World(net, { seed: (Date.now() & 0xffff) | 1 });
  const view = createScene(document.getElementById('scene'));
  await nextFrame();
  const [ref, landcover, satellite] = await Promise.all([
    loadImage('references/kastenhof.png'), loadImage('references/landcover.png'), loadImage('references/satellite-map.webp'),
  ]);
  const terrain = buildTerrain(view.scene, net, ref, { landcover, satellite });
  const roads = buildRoads(view.scene, net);
  buildLabels(view.scene, net);
  const vehicles = createVehicleRenderer(view.scene, net);
  const debug = buildDebug(view.scene, net);
  const routeOverlay = createRouteOverlay(view.scene, net, world.router, view);
  const autoCam = createAutoCam(view);
  const pathPreview = createPathPreview(document.getElementById('overlay2d'), view, autoCam);

  // Warm up so the map isn't empty when it first appears.
  for (let i = 0; i < 30 * 45; i++) world.step(CONFIG.sim.dt);

  let nightK = 0, nightTarget = 0;
  const ui = createControls({
    world,
    onHoverRoute: (r) => routeOverlay.show(r),
    onHoverAuto: (on) => pathPreview.show(on),
    onToggle(kind, value) {
      if (kind === 'tod') { view.setTimeOfDay(value); nightTarget = value === 'night' ? 1 : value === 'golden' ? 0.35 : 0; }
      if (kind === 'debug') debug.visible = value;
      if (kind === 'ref') terrain.setReference(value);
      if (kind === 'view') view.fitView(true);
      if (kind === 'hover') view.setHover(value);
      if (kind === 'auto') autoCam.setEnabled(value);
      if (kind === 'autoSpeed') autoCam.setSpeed(value);
    },
  });

  // Any orbit / pan / zoom by the user hands the camera back to them.
  view.controls.addEventListener('start', () => ui.setAuto(false));
  autoCam.setSpeed(ui.state.autoSpeed);
  ui.setAuto(true); // ambient dashboard: start flying

  document.getElementById('loading').classList.add('done');
  let last = performance.now(), simTime = 0;
  function frame(now) {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!ui.state.paused) {
      const total = dtReal * ui.state.speed;
      const steps = Math.max(1, Math.ceil(total / CONFIG.sim.dt));
      const dt = total / steps;
      for (let i = 0; i < steps; i++) world.step(dt);
      simTime += total;
    }
    nightK += (nightTarget - nightK) * Math.min(1, dtReal * 2.5);
    vehicles.setNight(nightK);
    roads.furniture.userData.setNight(nightK);
    vehicles.update(world, simTime, ui.state.debug);
    terrain.update(now / 1000);
    routeOverlay.update(now / 1000);
    pathPreview.update(now / 1000);
    if (autoCam.enabled) autoCam.update(dtReal); else view.controls.update();
    ui.update(now);
    view.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.kastenhof = { net, world, view, autoCam }; // handy for tuning from the console
}

// Debug overlay: lane centrelines by type, stop lines and conflict points.
function buildDebug(scene, net) {
  const g = new THREE.Group();
  const colors = { lane: 0x56ccf2, accel: 0xf2c94c, ramp: 0xbb6bd9, conn: 0xf2994a, ring: 0x6fcf97 };
  const byKind = {};
  for (const p of net.paths) {
    const arr = (byKind[p.kind] ||= []);
    for (let i = 0; i < p.n - 1; i++) arr.push(p.x[i], p.h[i] + 0.4, p.z[i], p.x[i + 1], p.h[i + 1] + 0.4, p.z[i + 1]);
  }
  for (const [k, arr] of Object.entries(byKind)) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: colors[k] || 0xffffff, depthTest: false, transparent: true, opacity: 0.85 })));
  }
  const pts = [], cols = [];
  const c = new THREE.Color();
  for (const p of net.paths) for (const cf of p.conflicts) {
    if (!cf.iYield) continue;
    const [x, z] = p.point(cf.s);
    pts.push(x, 0.6, z);
    c.set(cf.rule === 'right' ? '#56ccf2' : cf.rule === 'exit' ? '#bb6bd9' : '#f2c94c'); cols.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false })));
  g.renderOrder = 10;
  g.visible = false;
  scene.add(g);
  return g;
}

main().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  l.innerHTML = `<div style="color:#f88;max-width:600px;padding:20px">Failed to start: ${e.message}</div>`;
});
