import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mulberry32 } from './config.js';
import { heightAt } from './terrain.js';

const rand = mulberry32(42);
const simplex = new SimplexNoise({ random: mulberry32(7) });

// Roca: icosaedro deformado con ruido y aplastado; caras planas = aspecto basáltico.
function rockGeometry(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n =
      simplex.noise3d(v.x * 0.9 + seed, v.y * 0.9, v.z * 0.9) * 0.35 +
      simplex.noise3d(v.x * 2.5, v.y * 2.5 + seed, v.z * 2.5) * 0.12;
    v.multiplyScalar(1 + n);
    v.y *= 0.62;
    // Corte plano por abajo para que se asienten sobre la arena.
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.2;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createRocks() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#8a5640', roughness: 0.93, metalness: 0, flatShading: true });
  const geos = [rockGeometry(1.3), rockGeometry(7.1), rockGeometry(13.7)];
  const PER = 260;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  const tint = new THREE.Color();

  for (const geo of geos) {
    const mesh = new THREE.InstancedMesh(geo, mat, PER);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (let i = 0; i < PER; i++) {
      // Más densidad cerca de la cámara (en z ~ 10).
      const r = 6 + Math.pow(rand(), 1.4) * 210;
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 5;
      let size = 0.1 + Math.pow(rand(), 6) * 3.4;
      // Cerca de la cámara (0, 26) solo piedras pequeñas.
      const dCam = Math.hypot(x, z - 26);
      if (dCam < 30) size = Math.min(size, 0.15 + dCam * 0.025);
      s.set(size * (0.8 + rand() * 0.5), size * (0.7 + rand() * 0.6), size * (0.8 + rand() * 0.5));
      e.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
      q.setFromEuler(e);
      t.set(x, heightAt(x, z) + s.y * 0.05, z);
      m.compose(t, q, s);
      mesh.setMatrixAt(i, m);
      tint.setHSL(0.04 + rand() * 0.03, 0.3 + rand() * 0.2, 0.45 + rand() * 0.25);
      mesh.setColorAt(i, tint);
    }
    group.add(mesh);
  }
  return group;
}
