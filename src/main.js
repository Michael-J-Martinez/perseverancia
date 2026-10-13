import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { COLORS, SUN_DIR } from './config.js';
import { createTerrain, heightAt } from './terrain.js';
import { createRocks } from './rocks.js';
import { createSky } from './sky.js';
import { createMoons } from './moons.js';
import { createDust } from './dust.js';

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

// Cámara baja, mirando hacia el sol de tarde.
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 3000);
const camZ = 26;
camera.position.set(0, heightAt(0, camZ) + 2.2, camZ);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, camera.position.y + 6.5, camZ - 40);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.53;
controls.minDistance = 5;
controls.maxDistance = 200;

// Luz: sol bajo y cálido + cielo/suelo rebotado.
scene.add(new THREE.HemisphereLight('#e2ad7c', '#5a2914', 1.1));
const sun = new THREE.DirectionalLight(COLORS.sunLight, 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(150);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -110;
sc.right = 110;
sc.top = 110;
sc.bottom = -110;
sc.near = 1;
sc.far = 500;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 6;
sun.target.position.set(0, 0, -20);
scene.add(sun, sun.target);

const sky = createSky();
const terrain = createTerrain();
const rocks = createRocks();
const moons = createMoons();
const dust = createDust();
scene.add(sky, terrain, rocks, moons, dust);

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

const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();
  controls.update();
  sky.position.copy(camera.position);
  moons.userData.update(dt);
  dust.userData.update(dt, t, camera);
  film.uniforms.time.value = t % 100;
  composer.render();
});
