import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { COLORS, SUN_DIR } from './config.js';
import { createTerrain, groundHeight } from './terrain.js';
import { createRocks } from './rocks.js';
import { createSky } from './sky.js';
import { createMoons } from './moons.js';
import { createDust } from './dust.js';
import { loadRover, createDriver } from './rover.js';
import { createTracks } from './tracks.js';
import './mission/hud.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(COLORS.fog, 0.0032);

// El rover arranca mirando hacia el sol de tarde (-Z); la cámara va detrás, baja.
const START = { x: 0, z: 16, heading: Math.PI };
const CAM_DIST = 9;
const CAM_HEIGHT = 2.6;
const LOOK_HEIGHT = 3.2;

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 3000);
const startY = groundHeight(START.x, START.z);
camera.position.set(START.x, startY + CAM_HEIGHT, START.z + CAM_DIST);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(START.x, startY + LOOK_HEIGHT, START.z);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.53;
controls.minDistance = 4;
controls.maxDistance = 60;

// Luz: sol bajo y cálido + cielo/suelo rebotado.
scene.add(new THREE.HemisphereLight('#e2ad7c', '#5a2914', 1.1));
const sun = new THREE.DirectionalLight(COLORS.sunLight, 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(150);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
// La sombra sigue al rover: frustum más ajustado = sombras más definidas.
sc.left = -70;
sc.right = 70;
sc.top = 70;
sc.bottom = -70;
sc.near = 1;
sc.far = 500;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 6;
scene.add(sun, sun.target);

const sky = createSky();
const terrain = createTerrain();
const rocks = createRocks();
const moons = createMoons();
const dust = createDust();
const tracks = createTracks();
scene.add(sky, terrain, rocks, moons, dust, tracks.mesh);

// Rover oficial de la NASA (se carga en segundo plano; la escena ya se ve mientras tanto).
let driver = null;
const lastStamp = { l: new THREE.Vector3(), r: new THREE.Vector3() };
loadRover('/models/perseverance.glb').then((rover) => {
  scene.add(rover.root);
  driver = createDriver(rover, START, rocks.userData.field);
  driver.state.onCrash = onCrash;
  driver.contact(lastStamp.l, rover.halfTrack, 0);
  driver.contact(lastStamp.r, -rover.halfTrack, 0);
  driver.rover = rover;

  const { x, y, z } = rover.dims;
  console.log(`Perseverance cargado: ${x.toFixed(2)} m ancho × ${y.toFixed(2)} m alto × ${z.toFixed(2)} m largo`);
  console.log(`Piezas que son cámaras (${rover.cameraParts.length}):`);
  for (const part of rover.cameraParts) console.log(`  📷 ${part.name}`);
  // Estado accesible para npm run check.
  window.__game = {
    driver,
    tracks: tracks.mesh,
    rocks: rocks.userData.field,
    camera,
    controls,
    step(dt) {
      simulate(dt);
      controls.update();
    },
  };
  window.__ready = true;
});

const tmp = new THREE.Vector3();
const behind = new THREE.Vector3();
const prevRoverPos = new THREE.Vector3(START.x, startY, START.z);

// Choques contra rocas: temblor de cámara y un aviso breve.
let shake = 0;
const toast = document.createElement('div');
toast.className = 'crash-toast';
toast.hidden = true;
document.body.append(toast);
let toastTimer = 0;
function onCrash({ speed, height }) {
  shake = Math.min(1, 0.3 + speed / 4);
  const nf = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
  toast.innerHTML = `<b>¡Choque!</b> Roca de ${nf.format(height)} m a ${nf.format(speed * 3.6)} km/h<small>Demasiado alta para trepar. El Percy real la habría esquivado solo con su autonavegación.</small>`;
  toast.hidden = false;
  toast.classList.remove('show');
  void toast.offsetWidth; // reinicia la animación
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 3200);
  console.log(`Choque: roca de ${height.toFixed(2)} m a ${speed.toFixed(1)} m/s`);
}

function stampTracks() {
  const r = driver.rover;
  for (const [side, dx] of [['l', r.halfTrack], ['r', -r.halfTrack]]) {
    driver.contact(tmp, dx, 0);
    if (tmp.distanceTo(lastStamp[side]) >= tracks.step) {
      tracks.stamp(tmp.x, tmp.z, driver.state.heading);
      lastStamp[side].copy(tmp);
    }
  }
}

// Cámara de seguimiento: se mueve con el rover y, al conducir, vuelve suavemente a su espalda.
// Con el ratón se puede orbitar alrededor en cualquier momento.
function followCamera(dt, driving) {
  const pos = driver.rover.root.position;
  tmp.subVectors(pos, prevRoverPos);
  camera.position.add(tmp);
  controls.target.add(tmp);
  prevRoverPos.copy(pos);
  controls.target.lerp(tmp.set(pos.x, pos.y + LOOK_HEIGHT, pos.z), 1 - Math.exp(-dt * 6));

  if (driving) {
    const h = driver.state.heading;
    const dist = camera.position.distanceTo(controls.target);
    behind.set(pos.x - Math.sin(h) * dist, 0, pos.z - Math.cos(h) * dist);
    behind.y = Math.max(pos.y + CAM_HEIGHT, groundHeight(behind.x, behind.z) + 1.5);
    camera.position.lerp(behind, 1 - Math.exp(-dt * 1.8));
    // Mantener la distancia (la interpolación en línea recta la acortaría al girar).
    tmp.subVectors(camera.position, controls.target).setLength(dist);
    camera.position.copy(controls.target).add(tmp);
  }
  // Temblor de cámara tras un choque.
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.35;
    camera.position.y += (Math.random() - 0.5) * shake * 0.25;
    shake = Math.max(0, shake - dt * 2.5);
  }
  // Nunca bajo el suelo.
  const floor = groundHeight(camera.position.x, camera.position.z) + 0.8;
  if (camera.position.y < floor) camera.position.y = floor;
}

// Postproceso: bloom suave, tonemapping y viñeta con grano de película.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.7, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const film = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = smoothstep(0.85, 0.25, length(d * vec2(1.1, 1.0)));
      c.rgb *= mix(0.62, 1.0, vig);
      c.rgb += (hash(vUv * 1000.0 + time) - 0.5) * 0.035;
      gl_FragColor = c;
    }
  `,
});
composer.addPass(film);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

function simulate(dt) {
  if (!driver) return;
  const driving = driver.update(dt);
  stampTracks();
  followCamera(dt, driving);
  const pos = driver.rover.root.position;
  sun.position.copy(SUN_DIR).multiplyScalar(150).add(pos);
  sun.target.position.copy(pos);
}

const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();
  simulate(dt);
  controls.update();
  sky.position.copy(camera.position);
  moons.position.copy(camera.position);
  moons.userData.update(dt);
  dust.userData.update(dt, t, camera);
  film.uniforms.time.value = t % 100;
  composer.render();
});
