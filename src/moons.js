import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { COLORS, mulberry32, skyDir } from './config.js';

const simplex = new SimplexNoise({ random: mulberry32(1877) }); // año del descubrimiento

function lumpyGeometry(stretch, seed) {
  const geo = new THREE.IcosahedronGeometry(1, 5);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let n = simplex.noise3d(v.x * 1.2 + seed, v.y * 1.2, v.z * 1.2) * 0.1;
    n += simplex.noise3d(v.x * 4 + seed, v.y * 4, v.z * 4) * 0.05;
    // Cráteres sencillos.
    const crater = Math.max(0, simplex.noise3d(v.x * 2.2, v.y * 2.2 + seed, v.z * 2.2) - 0.55);
    n -= crater * 0.5;
    v.multiplyScalar(1 + n);
    v.x *= stretch.x;
    v.y *= stretch.y;
    v.z *= stretch.z;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function moonMaterial() {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      // Luz lateral (desde la izquierda y hacia la cámara) para que se lea la fase.
      sunDir: { value: new THREE.Vector3(-1, 0.3, -0.15).normalize() },
      albedo: { value: new THREE.Color('#b09a84') },
      sky: { value: COLORS.mid },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, albedo, sky;
      varying vec3 vN;
      void main() {
        float lit = max(dot(normalize(vN), normalize(sunDir)), 0.0);
        vec3 col = albedo * (smoothstep(0.0, 0.5, lit) * 1.25 + 0.03);
        // Extinción atmosférica: la luna se mezcla un poco con el cielo polvoriento.
        col = mix(col, sky, 0.42);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

export function createMoons() {
  const group = new THREE.Group();
  const DIST = 700;

  // Tamaños exagerados para que se lean en pantalla (como haría el cine).
  const phobos = new THREE.Mesh(lumpyGeometry(new THREE.Vector3(1.25, 0.95, 1.0), 3), moonMaterial());
  phobos.position.copy(skyDir(24, 21)).multiplyScalar(DIST);
  phobos.scale.setScalar(17);
  phobos.rotation.set(0.4, 1.2, 0.2);

  const deimos = new THREE.Mesh(lumpyGeometry(new THREE.Vector3(1.15, 0.9, 1.0), 11), moonMaterial());
  deimos.position.copy(skyDir(-33, 25)).multiplyScalar(DIST);
  deimos.scale.setScalar(10);

  phobos.name = 'Phobos';
  deimos.name = 'Deimos';
  group.add(phobos, deimos);
  group.userData.update = (dt) => {
    phobos.rotation.y += dt * 0.02;
    deimos.rotation.y += dt * 0.01;
  };
  return group;
}
