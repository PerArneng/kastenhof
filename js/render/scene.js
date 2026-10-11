// Renderer, camera, sky, lights, post-processing and time-of-day presets.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { MAP_HALF } from '../network/build.js';

export const BLOCK_DEPTH = 34; // metres of soil under the diorama surface

export const TOD = {
  day: {
    label: 'Dag', sun: [-0.5, 0.78, 0.62], sunColor: 0xfff3e0, sunI: 3.1, hemiSky: 0xcfe6ff, hemiGround: 0x5c7a4a, hemiI: 0.45,
    fog: 0xc9dbe6, backdrop: ['#e9f1f4', '#bcd2dc', '#93aebb'], exposure: 0.95, turbidity: 5, rayleigh: 1.2, bloom: [0.12, 0.4, 4.0], lights: 0, envI: 0.35,
  },
  golden: {
    label: 'Kväll', sun: [-0.92, 0.13, 0.36], sunColor: 0xffb46b, sunI: 3.4, hemiSky: 0xffd2a8, hemiGround: 0x3e4a3a, hemiI: 0.55,
    fog: 0xe8b98f, backdrop: ['#f6dcc0', '#d9a98a', '#6f5a5c'], exposure: 0.85, turbidity: 9, rayleigh: 2.6, bloom: [0.35, 0.5, 1.6], lights: 0.6, envI: 0.55,
  },
  night: {
    label: 'Natt', sun: [0.35, 0.55, -0.55], sunColor: 0x9db4e0, sunI: 0.5, hemiSky: 0x34476b, hemiGround: 0x10161a, hemiI: 0.4,
    fog: 0x0c1420, backdrop: ['#1b2738', '#0d1522', '#05080d'], exposure: 1.0, turbidity: 1, rayleigh: 0.2, bloom: [0.95, 0.55, 0.85], lights: 1, envI: 0.12, night: true,
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

  // The map is a diorama: a block of land floating in front of a soft
  // backdrop. Everything is clipped at the block edges, so roads, cars and
  // trees that run past the edge are cut cleanly.
  const pad = 0.02;
  renderer.clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), MAP_HALF[0] + pad), new THREE.Plane(new THREE.Vector3(1, 0, 0), MAP_HALF[0] + pad),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), MAP_HALF[1] + pad), new THREE.Plane(new THREE.Vector3(0, 0, 1), MAP_HALF[1] + pad),
  ];

  const scene = new THREE.Scene();
  // Narrow field of view: close to isometric, but still perspective so
  // zooming in on a single junction feels natural.
  const camera = new THREE.PerspectiveCamera(24, window.innerWidth / window.innerHeight, 1, 12000);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.32;
  controls.minDistance = 12;
  controls.maxDistance = 4200;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true; // scroll zooms towards the point under the mouse
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 1.1;
  controls.addEventListener('change', () => {
    const t = controls.target;
    t.x = THREE.MathUtils.clamp(t.x, -MAP_HALF[0], MAP_HALF[0]);
    t.z = THREE.MathUtils.clamp(t.z, -MAP_HALF[1], MAP_HALF[1]);
    t.y = 0;
    // Road layers sit only centimetres apart, so keep the near plane as far
    // out as the view allows; a fixed near of 1 m loses depth precision when
    // zoomed out and the asphalt/shoulder/markings z-fight (flicker).
    const near = THREE.MathUtils.clamp(camera.position.distanceTo(t) * 0.2, 1, 400);
    if (Math.abs(near - camera.near) > 0.01 * near) { camera.near = near; camera.updateProjectionMatrix(); }
  });

  // Sky: only used to light the scene (environment map); the visible
  // background is a soft gradient behind the diorama.
  const sky = new Sky();
  sky.scale.setScalar(8000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  // Lights
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5c7a4a, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  const shadowRes = renderer.capabilities.maxTextureSize >= 16384 ? 4096 : 2048;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  const sc = sun.shadow.camera;
  sc.left = -MAP_HALF[0] - 60; sc.right = MAP_HALF[0] + 60; sc.top = MAP_HALF[1] + 60; sc.bottom = -MAP_HALF[1] - 60;
  sc.near = 10; sc.far = 3000;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.45;
  scene.add(sun, sun.target);

  scene.fog = new THREE.Fog(0xc9dbe6, 5000, 12000);

  // Post
  // The canvas' own antialias doesn't apply once we render through the
  // composer, so give its targets MSAA; otherwise the thin lane markings
  // (sub-pixel when zoomed out) break up and shimmer as the camera moves.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  // Replace NaN/Inf and clamp extreme HDR values (e.g. specular glints) so a
  // single bad pixel can never be smeared over the whole screen by the bloom.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
        gl_FragColor = vec4(clamp(c.rgb, 0.0, 24.0), 1.0); }`,
  }));
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
    if (scene.background) scene.background.dispose();
    scene.background = backdrop(p.backdrop);
    // environment reflections from the sky
    const envScene = new THREE.Scene();
    if (p.night) envScene.background = new THREE.Color(0x0a1220);
    else { const s2 = new Sky(); s2.scale.setScalar(1000); Object.assign(s2.material.uniforms.sunPosition.value, skyDir); s2.material.uniforms.turbidity.value = p.turbidity; s2.material.uniforms.rayleigh.value = p.rayleigh; envScene.add(s2); }
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = p.envI;
    bloom.enabled = p.bloom[0] > 0.2;
    bloom.strength = p.bloom[0]; bloom.radius = p.bloom[1]; bloom.threshold = p.bloom[2];
  }

  // Vertical gradient backdrop behind the block.
  function backdrop([top, mid, bottom]) {
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 512;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, top); g.addColorStop(0.55, mid); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 512);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function fitView(animate = false) {
    // Frame the whole block from the south-west at an isometric-like angle.
    const target = new THREE.Vector3(0, 0, 0);
    const polar = 0.86, az = -0.42;
    let lo = 100, hi = 4000;
    const corners = [];
    for (const y of [0, -BLOCK_DEPTH]) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) corners.push(new THREE.Vector3(a * MAP_HALF[0], y, b * MAP_HALF[1]));
    const tmp = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 1, 10000);
    for (let i = 0; i < 40; i++) {
      const d = (lo + hi) / 2;
      tmp.position.set(target.x + d * Math.sin(polar) * Math.sin(az), d * Math.cos(polar), target.z + d * Math.sin(polar) * Math.cos(az));
      tmp.lookAt(target); tmp.updateMatrixWorld(); tmp.updateProjectionMatrix();
      let m = 0;
      for (const c of corners) { const p = c.clone().project(tmp); m = Math.max(m, Math.abs(p.x), Math.abs(p.y)); }
      if (m > 0.9) lo = d; else hi = d;
    }
    const d = hi;
    const pos = new THREE.Vector3(target.x + d * Math.sin(polar) * Math.sin(az), target.y + d * Math.cos(polar), target.z + d * Math.sin(polar) * Math.cos(az));
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
  // If the GPU drops the context (driver reset, memory pressure), recover by reloading.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    const l = document.getElementById('loading');
    if (l) { l.classList.remove('done'); l.innerHTML = '<div class="spinner"></div><div>Grafikkortet tappade kontexten – startar om…</div>'; }
    setTimeout(() => location.reload(), 1500);
  });

  setTimeOfDay('day');
  resize();
  fitView();
  // Drone hover: a slow, mostly vertical drift added to the camera only while
  // rendering, so OrbitControls never sees it. A few mismatched sines never
  // quite repeat; amplitude scales with zoom and eases in/out when toggled.
  let hoverOn = true, hoverK = 1, lastT = performance.now();
  const bob = new THREE.Vector3(), side = new THREE.Vector3();
  function render() {
    const now = performance.now(), t = now / 1000;
    hoverK += ((hoverOn ? 1 : 0) - hoverK) * Math.min(1, ((now - lastT) / 1000) * 0.8);
    lastT = now;
    if (hoverK > 0.001) {
      const amp = camera.position.distanceTo(controls.target) * 0.0035 * hoverK;
      side.subVectors(controls.target, camera.position).cross(camera.up).normalize();
      bob.set(0, amp * (0.6 * Math.sin(t * 0.53) + 0.3 * Math.sin(t * 0.31 + 1.7) + 0.1 * Math.sin(t * 0.97 + 0.4)), 0)
        .addScaledVector(side, amp * 0.35 * Math.sin(t * 0.23 + 0.9));
      camera.position.add(bob);
      composer.render();
      camera.position.sub(bob);
    } else composer.render();
  }
  const setHover = (on) => { hoverOn = on; };

  return { renderer, scene, camera, controls, composer, sun, hemi, state, setTimeOfDay, fitView, setHover, render };
}
