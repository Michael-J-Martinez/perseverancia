import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mulberry32 } from './config.js';
import { heightAt } from './terrain.js';

// Las ruedas (52,5 cm de diámetro) trepan piedras de hasta ~45 cm; las más altas son obstáculos.
export const CLIMB_HEIGHT = 0.45;
const CELL = 10; // celdas de la rejilla para buscar rocas cercanas

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
  // Medidas de cada forma: radio horizontal típico y altura de la cima.
  const shapes = geos.map((geo) => {
    const p = geo.attributes.position;
    let rSum = 0;
    let top = 0;
    for (let i = 0; i < p.count; i++) {
      rSum += Math.hypot(p.getX(i), p.getZ(i));
      top = Math.max(top, p.getY(i));
    }
    return { radius: rSum / p.count, top };
  });
  const field = [];
  const PER = 260;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  const tint = new THREE.Color();

  for (const [g, geo] of geos.entries()) {
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
      const ground = heightAt(x, z);
      field.push({
        x,
        z,
        r: shapes[g].radius * (s.x + s.z) * 0.5,
        height: t.y + shapes[g].top * s.y - ground, // cuánto sobresale de la arena
      });
      tint.setHSL(0.04 + rand() * 0.03, 0.3 + rand() * 0.2, 0.45 + rand() * 0.25);
      mesh.setColorAt(i, tint);
    }
    group.add(mesh);
  }
  group.userData.field = createRockField(field);
  return group;
}

// Búsqueda rápida de rocas por zona, para el apoyo de las ruedas y los choques.
function createRockField(rocks) {
  const grid = new Map();
  const key = (ix, iz) => ix * 100003 + iz;
  for (const rock of rocks) {
    rock.solid = rock.height > CLIMB_HEIGHT;
    const k = key(Math.floor(rock.x / CELL), Math.floor(rock.z / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(rock);
  }
  const found = [];
  function near(x, z, radius) {
    found.length = 0;
    const reach = radius + 4; // el radio de las rocas más grandes
    for (let ix = Math.floor((x - reach) / CELL); ix <= Math.floor((x + reach) / CELL); ix++) {
      for (let iz = Math.floor((z - reach) / CELL); iz <= Math.floor((z + reach) / CELL); iz++) {
        for (const rock of grid.get(key(ix, iz)) ?? []) {
          if (Math.hypot(rock.x - x, rock.z - z) < radius + rock.r) found.push(rock);
        }
      }
    }
    return found;
  }
  return {
    rocks,
    near,
    /** Cuánto sube una rueda en (x, z) por estar encima de una piedra trepable (forma de cúpula). */
    lift(x, z) {
      let h = 0;
      for (const rock of near(x, z, 0)) {
        if (rock.solid) continue;
        const d = Math.hypot(rock.x - x, rock.z - z) / rock.r;
        if (d < 1) h = Math.max(h, rock.height * Math.sqrt(1 - d * d));
      }
      return h;
    },
  };
}
