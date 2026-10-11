// Preview of the auto-mode camera loop, shown while hovering the Auto button.
// Drawn on a 2D canvas over the scene, by projecting the 3D path each frame.
// The diorama clips all geometry at the block edges, and much of the chopper
// path lies outside the block, so a 3D overlay would be cut off.
import * as THREE from 'three';

const COLOR = '255, 211, 77';
const ARROW_GAP = 46;   // px between arrows
const FLOW = 28;        // px/s arrow drift

export function createPathPreview(canvas, view, autoCam) {
  const ctx = canvas.getContext('2d');
  const path = autoCam.samples(900);
  const shots = autoCam.shots();
  let visible = false;
  const v = new THREE.Vector3();

  // Screen position of a world point, or null if it is behind the camera.
  function project(p) {
    v.copy(p).applyMatrix4(view.camera.matrixWorldInverse);
    if (v.z > -view.camera.near) return null;
    v.applyMatrix4(view.camera.projectionMatrix);
    return [(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight];
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function chevron(x, y, ang) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(4, 0); ctx.lineTo(-5, 6);
    ctx.stroke(); ctx.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!visible) return;
    view.camera.updateMatrixWorld();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // Sight lines: from each shot's camera position down to what it looks at.
    ctx.setLineDash([3, 5]); ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${COLOR}, 0.45)`;
    for (const sh of shots) {
      const a = project(sh.p), b = project(sh.t);
      if (a && b) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
    }
    ctx.setLineDash([]);

    // The loop itself, split wherever it passes behind the camera.
    const runs = [[]];
    for (const s of path) {
      const q = project(s.p);
      if (q) runs[runs.length - 1].push(q); else if (runs[runs.length - 1].length) runs.push([]);
    }
    ctx.lineWidth = 2; ctx.strokeStyle = `rgba(${COLOR}, 0.5)`;
    for (const r of runs) {
      if (r.length < 2) continue;
      ctx.beginPath(); ctx.moveTo(...r[0]); for (const q of r) ctx.lineTo(...q); ctx.stroke();
    }
    // Arrows drifting along each run in the direction of flight.
    ctx.lineWidth = 2.2; ctx.strokeStyle = `rgba(${COLOR}, 0.9)`;
    for (const r of runs) {
      let next = (t * FLOW) % ARROW_GAP, acc = 0;
      for (let i = 1; i < r.length; i++) {
        const dx = r[i][0] - r[i - 1][0], dy = r[i][1] - r[i - 1][1], len = Math.hypot(dx, dy);
        while (acc + len >= next) {
          const k = (next - acc) / (len || 1);
          chevron(r[i - 1][0] + dx * k, r[i - 1][1] + dy * k, Math.atan2(dy, dx));
          next += ARROW_GAP;
        }
        acc += len;
      }
    }

    // Focus points with their names.
    ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    for (const sh of shots) {
      const b = project(sh.t);
      if (!b) continue;
      ctx.lineWidth = 2; ctx.strokeStyle = `rgba(${COLOR}, 0.95)`; ctx.fillStyle = `rgba(${COLOR}, 0.25)`;
      ctx.beginPath(); ctx.arc(b[0], b[1], 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(b[0], b[1], 2, 0, Math.PI * 2); ctx.fillStyle = `rgba(${COLOR}, 1)`; ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20, 24, 28, 0.75)'; ctx.fillStyle = '#fff';
      ctx.strokeText(sh.name, b[0] + 12, b[1]); ctx.fillText(sh.name, b[0] + 12, b[1]);
    }
  }

  return {
    show(on) { visible = on; if (!on) draw(0); },
    update(t) { if (visible) draw(t); },
  };
}
