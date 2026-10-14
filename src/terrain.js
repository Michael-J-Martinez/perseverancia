import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mulberry32 } from './config.js';

const simplex = new SimplexNoise({ random: mulberry32(1976) });
const n2 = (x, z) => simplex.noise(x, z);

function fbm(x, z, octaves) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * n2(x * freq, z * freq);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

// Altura del terreno: lomas amplias + crestas de dunas alargadas + dunas pequeñas.
export function heightAt(x, z) {
  let h = fbm(x * 0.0035, z * 0.0035, 4) * 16;

  // Crestas de duna perpendiculares al viento, con el eje deformado por ruido.
  const wx = x + n2(x * 0.008, z * 0.008) * 30;
  const wz = z + n2(x * 0.008 + 50, z * 0.008) * 30;
  // 1 - |n| suavizado: cresta redondeada en vez de pico.
  const rn = n2(wx * 0.0035, wz * 0.0075);
  const ridge = 1 - Math.sqrt(rn * rn + 0.08);
  h += Math.pow(Math.max(ridge, 0), 2.2) * 11;

  const sn = n2(wx * 0.008, wz * 0.018);
  const small = 1 - Math.sqrt(sn * sn + 0.04);
  h += small * small * 1.1;

  // Zona delantera un poco más llana, donde se reparten rocas.
  const d = Math.hypot(x, z - 10);
  const flat = THREE.MathUtils.smoothstep(d, 20, 90);
  return h * (0.35 + 0.65 * flat);
}

// Mapa de normales de ondulaciones de arena (ripples), tileable.
function rippleNormalMap(size = 256) {
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const warp = Math.sin(v * Math.PI * 2) * 0.06 + Math.sin((u + v) * Math.PI * 2) * 0.03;
      const p = (u * 9 + warp * 3) * Math.PI * 2;
      // Perfil asimétrico (pendiente suave y cara abrupta).
      const s = (p / (Math.PI * 2)) % 1;
      hgt[y * size + x] = s < 0.75 ? s / 0.75 : (1 - s) / 0.25;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 1.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 1.2;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

const SIZE = 1800, SEG = 480, CELL = SIZE / SEG;
let grid = null; // alturas de los vértices de la malla, fila a fila en z

// Altura exacta de la superficie renderizada (interpola el mismo triángulo que dibuja la GPU),
// para que el rover y las huellas apoyen sobre la malla y no sobre la función continua.
export function groundHeight(x, z) {
  if (!grid) return heightAt(x, z);
  const gx = THREE.MathUtils.clamp((x + SIZE / 2) / CELL, 0, SEG - 1e-4);
  const gz = THREE.MathUtils.clamp((z + SIZE / 2) / CELL, 0, SEG - 1e-4);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const at = (i, j) => grid[j * (SEG + 1) + i];
  const ha = at(ix, iz), hb = at(ix, iz + 1), hc = at(ix + 1, iz + 1), hd = at(ix + 1, iz);
  // PlaneGeometry divide cada celda por la diagonal b-d.
  if (fx + fz <= 1) return ha + fx * (hd - ha) + fz * (hb - ha);
  return hc + (1 - fx) * (hb - hc) + (1 - fz) * (hd - hc);
}

export function createTerrain() {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  grid = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, h);
    grid[i] = h;
  }
  geo.computeVertexNormals();

  // Color por vértice: valles oscuros, crestas claras, motas de óxido.
  const nor = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color('#6e2c14');
  const base = new THREE.Color('#b0532b');
  const light = new THREE.Color('#d88a57');
  const dusty = new THREE.Color('#c9875a');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = THREE.MathUtils.clamp((y + 4) / 22, 0, 1);
    c.copy(dark).lerp(base, THREE.MathUtils.smoothstep(t, 0, 0.45)).lerp(light, THREE.MathUtils.smoothstep(t, 0.55, 1));
    const flat = nor.getY(i);
    c.lerp(dusty, (1 - flat) * 0.6);
    const mott = fbm(x * 0.05, z * 0.05, 3);
    c.multiplyScalar(0.9 + mott * 0.25);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const normalMap = rippleNormalMap();
  normalMap.repeat.set(SIZE / 2.5, SIZE / 2.5);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
    normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
