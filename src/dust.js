import * as THREE from 'three';
import { mulberry32 } from './config.js';

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Polvo en suspensión que deriva con el viento alrededor de la cámara.
export function createDust(count = 5000) {
  const rand = mulberry32(99);
  const BOX = new THREE.Vector3(240, 30, 240);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rand() - 0.5) * BOX.x;
    pos[i * 3 + 1] = rand() * BOX.y;
    pos[i * 3 + 2] = (rand() - 0.5) * BOX.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.35,
    map: softDot(),
    color: '#e8b98a',
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const wind = new THREE.Vector3(2.2, 0.15, 0.6);
  points.userData.update = (dt, time, camera) => {
    const p = geo.attributes.position;
    for (let i = 0; i < count; i++) {
      let x = p.getX(i) + (wind.x + Math.sin(time * 0.7 + i) * 0.6) * dt;
      let y = p.getY(i) + (wind.y + Math.sin(time * 1.3 + i * 0.37) * 0.25) * dt;
      let z = p.getZ(i) + wind.z * dt;
      // Envolver dentro de la caja centrada en la cámara.
      const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y - 6;
      if (x - cx > BOX.x / 2) x -= BOX.x;
      if (x - cx < -BOX.x / 2) x += BOX.x;
      if (z - cz > BOX.z / 2) z -= BOX.z;
      if (z - cz < -BOX.z / 2) z += BOX.z;
      if (y - cy > BOX.y) y -= BOX.y;
      if (y - cy < 0) y += BOX.y;
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
  };
  return points;
}
