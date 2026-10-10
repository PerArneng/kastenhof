// Renderer, camera, sky, lights, post-processing and time-of-day presets.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MAP_HALF } from '../network/build.js';

export const TOD = {
  day: {
    label: 'Dag', sun: [-0.5, 0.78, 0.62], sunColor: 0xfff3e0, sunI: 3.1, hemiSky: 0xcfe6ff, hemiGround: 0x5c7a4a, hemiI: 0.45,
    fog: 0xc9dbe6, exposure: 0.95, turbidity: 5, rayleigh: 1.2, bloom: [0.12, 0.4, 4.0], lights: 0, envI: 0.35,
  },
  golden: {
    label: 'Kväll', sun: [-0.92, 0.13, 0.36], sunColor: 0xffb46b, sunI: 3.4, hemiSky: 0xffd2a8, hemiGround: 0x3e4a3a, hemiI: 0.55,
    fog: 0xe8b98f, exposure: 0.85, turbidity: 9, rayleigh: 2.6, bloom: [0.35, 0.5, 1.6], lights: 0.6, envI: 0.55,
  },
  night: {
    label: 'Natt', sun: [0.35, 0.55, -0.55], sunColor: 0x9db4e0, sunI: 0.5, hemiSky: 0x34476b, hemiGround: 0x10161a, hemiI: 0.4,
    fog: 0x0c1420, exposure: 1.0, turbidity: 1, rayleigh: 0.2, bloom: [0.95, 0.55, 0.85], lights: 1, envI: 0.12, night: true,
  },
};

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 2, 9000);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = 1.38;
  controls.minDistance = 22;
  controls.maxDistance = 2200;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 1.1;
  controls.addEventListener('change', () => {
    const t = controls.target;
    t.x = THREE.MathUtils.clamp(t.x, -MAP_HALF[0] * 1.15, MAP_HALF[0] * 1.15);
    t.z = THREE.MathUtils.clamp(t.z, -MAP_HALF[1] * 1.15, MAP_HALF[1] * 1.15);
    t.y = 0;
  });

  // Sky
  const sky = new Sky();
  sky.scale.setScalar(8000);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  // Lights
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5c7a4a, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -MAP_HALF[0] - 60; sc.right = MAP_HALF[0] + 60; sc.top = MAP_HALF[1] + 60; sc.bottom = -MAP_HALF[1] - 60;
  sc.near = 10; sc.far = 3000;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.45;
  scene.add(sun, sun.target);

  scene.fog = new THREE.Fog(0xc9dbe6, 2200, 6500);

  // Post
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.2, 0.4, 3.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const state = { tod: 'day', preset: TOD.day };

  function setTimeOfDay(key) {
    const p = TOD[key];
    state.tod = key; state.preset = p;
    const dir = new THREE.Vector3(...p.sun).normalize();
    sun.position.copy(dir).multiplyScalar(1500);
    sun.target.position.set(0, 0, 0);
    sun.color.set(p.sunColor); sun.intensity = p.sunI;
    hemi.color.set(p.hemiSky); hemi.groundColor.set(p.hemiGround); hemi.intensity = p.hemiI;
    scene.fog.color.set(p.fog);
    renderer.toneMappingExposure = p.exposure;
    const u = sky.material.uniforms;
    u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
    const skyDir = p.night ? new THREE.Vector3(0.2, -0.3, -1).normalize() : dir;
    u.sunPosition.value.copy(skyDir);
    sky.visible = !p.night;
    scene.background = p.night ? new THREE.Color(0x05080d) : null;
    // environment reflections from the sky
    const envScene = new THREE.Scene();
    if (p.night) envScene.background = new THREE.Color(0x0a1220);
    else { const s2 = new Sky(); s2.scale.setScalar(1000); Object.assign(s2.material.uniforms.sunPosition.value, skyDir); s2.material.uniforms.turbidity.value = p.turbidity; s2.material.uniforms.rayleigh.value = p.rayleigh; envScene.add(s2); }
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = p.envI;
    bloom.strength = p.bloom[0]; bloom.radius = p.bloom[1]; bloom.threshold = p.bloom[2];
  }

  function fitView(animate = false) {
    // Frame the whole map at a ~40° tilt so it fills the viewport.
    const target = new THREE.Vector3(0, 0, 12);
    const polar = 0.66, az = 0;
    let lo = 100, hi = 4000;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * MAP_HALF[0], 0, b * MAP_HALF[1]));
    const tmp = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 1, 10000);
    for (let i = 0; i < 40; i++) {
      const d = (lo + hi) / 2;
      tmp.position.set(target.x + d * Math.sin(polar) * Math.sin(az), d * Math.cos(polar), target.z + d * Math.sin(polar) * Math.cos(az));
      tmp.lookAt(target); tmp.updateMatrixWorld(); tmp.updateProjectionMatrix();
      let m = 0;
      for (const c of corners) { const p = c.clone().project(tmp); m = Math.max(m, Math.abs(p.x), Math.abs(p.y)); }
      if (m > 0.98) lo = d; else hi = d;
    }
    const d = hi * 0.93; // slight zoom so the map edges reach the screen edges
    const pos = new THREE.Vector3(target.x, d * Math.cos(polar), target.z + d * Math.sin(polar));
    if (!animate) { camera.position.copy(pos); controls.target.copy(target); controls.update(); return; }
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const start = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - start) / 900), e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(p0, pos, e); controls.target.lerpVectors(t0, target, e); controls.update();
      if (k < 1) requestAnimationFrame(tick);
    };
    tick();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', () => { resize(); });

  setTimeOfDay('day');
  resize();
  fitView();
  return { renderer, scene, camera, controls, composer, sun, hemi, state, setTimeOfDay, fitView, render: () => composer.render() };
}
