import * as THREE from 'three';

// Dirección en el cielo a partir de acimut (grados, + = derecha mirando a -Z) y elevación.
export function skyDir(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export const SUN_DIR = skyDir(-14, 9);

// Paleta (sRGB). El cielo marciano de tarde: caramelo arriba, polvo claro en el horizonte
// y un halo azulado alrededor del sol.
export const COLORS = {
  zenith: new THREE.Color('#6a3a1c'),
  mid: new THREE.Color('#bd7d42'),
  horizon: new THREE.Color('#d9a46c'),
  sunHalo: new THREE.Color('#b4bfc4'),
  sun: new THREE.Color('#fff1d6'),
  fog: new THREE.Color('#c99462'),
  sunLight: new THREE.Color('#ffc890'),
};

// Generador pseudoaleatorio con semilla para que el paisaje sea siempre el mismo.
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
