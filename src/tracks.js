import * as THREE from 'three';
import { groundHeight } from './terrain.js';

// Textura de la banda de rodadura: surcos en chevron como los de las ruedas del rover.
function treadTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  // Fondo: arena compactada.
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(4, 0, 56, 64);
  // Surcos.
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 7;
  for (let y = -16; y < 80; y += 16) {
    g.beginPath();
    g.moveTo(6, y);
    g.lineTo(32, y + 8);
    g.lineTo(58, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Huellas: un búfer circular de franjas planas que se pegan al terreno.
export function createTracks({ max = 6000, width = 0.42, step = 0.22 } = {}) {
  const geo = new THREE.PlaneGeometry(width, step * 1.15);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: '#2a0d04',
    alphaMap: treadTexture(),
    transparent: true,
    opacity: 0.85,
    roughness: 1,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.count = 0;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  let next = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const basisX = new THREE.Vector3();
  const basisZ = new THREE.Vector3();

  // Coloca una franja en (x, z) orientada según el rumbo y la pendiente del suelo.
  function stamp(x, z, heading) {
    const e = 0.3;
    up.set(groundHeight(x - e, z) - groundHeight(x + e, z), 2 * e, groundHeight(x, z - e) - groundHeight(x, z + e)).normalize();
    basisZ.set(Math.sin(heading), 0, Math.cos(heading));
    basisX.crossVectors(up, basisZ).normalize();
    basisZ.crossVectors(basisX, up);
    m.makeBasis(basisX, up, basisZ);
    q.setFromRotationMatrix(m);
    p.set(x, groundHeight(x, z) + 0.015, z);
    m.compose(p, q, one);
    mesh.setMatrixAt(next, m);
    next = (next + 1) % max;
    mesh.count = Math.min(mesh.count + 1, max);
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, stamp, step };
}
