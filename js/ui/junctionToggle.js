// Floating button next to the junction under test (J_CW) that switches it
// between today's crossing and a roundabout. It is a DOM button placed over
// the map each frame, projected from the junction's 3D position.
import * as THREE from 'three';

export function createJunctionToggle(el, view, center, onClick) {
  const v = new THREE.Vector3();
  el.addEventListener('click', () => onClick());
  const RING = 26; // m: put the button just outside the roundabout's footprint

  // Screen position of a world point, or null if it is behind the camera.
  function project(x, z) {
    v.set(x, 0, z).applyMatrix4(view.camera.matrixWorldInverse);
    if (v.z > -view.camera.near) return null;
    v.applyMatrix4(view.camera.projectionMatrix);
    return [(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight];
  }

  return {
    // layout: the one currently shown ('cross' or 'roundabout').
    set(layout) {
      const rb = layout === 'roundabout';
      const label = rb ? 'Byt till korsning' : 'Byt till cirkulationsplats';
      el.classList.toggle('rb', rb);
      el.title = `${label} (C)`;
      el.setAttribute('aria-label', label);
      el.setAttribute('aria-pressed', String(rb));
    },
    update() {
      view.camera.updateMatrixWorld();
      const c = project(center[0], center[1]);
      if (!c) { el.classList.add('off'); return; }
      // Above the junction on screen (open fields between the Dageborgsleden and ramp
      // arms; E20 is to the right), just outside the ring, never closer than 34 px.
      const { camera, controls } = view;
      const mpp = (camera.position.distanceTo(controls.target) * 2 * Math.tan((camera.fov * Math.PI) / 360)) / window.innerHeight;
      const x = c[0], y = c[1] - Math.max(34, RING / mpp);
      const off = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;
      el.classList.toggle('off', off);
      if (!off) el.style.transform = `translate(${(x - 22).toFixed(1)}px, ${(y - 22).toFixed(1)}px)`;
    },
  };
}
