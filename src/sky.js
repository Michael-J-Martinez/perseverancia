import * as THREE from 'three';
import { COLORS, SUN_DIR } from './config.js';

// Cúpula de cielo: degradado caramelo, polvo en el horizonte, halo azul y disco solar.
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: SUN_DIR.clone().normalize() },
      zenith: { value: COLORS.zenith },
      mid: { value: COLORS.mid },
      horizon: { value: COLORS.horizon },
      halo: { value: COLORS.sunHalo },
      sun: { value: COLORS.sun },
      fogColor: { value: COLORS.fog },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, zenith, mid, horizon, halo, sun, fogColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, zenith, smoothstep(0.2, 1.0, h));
        // Capa de polvo pegada al horizonte, del color de la niebla.
        col = mix(col, fogColor, exp(-h * 18.0) * 0.85);

        float c = max(dot(d, normalize(sunDir)), 0.0);
        // Halo azulado del atardecer marciano y resplandor cálido amplio.
        col = mix(col, halo, pow(c, 40.0) * 0.75);
        col += vec3(1.0, 0.72, 0.42) * pow(c, 6.0) * 0.18;
        col += sun * pow(c, 900.0) * 1.6;
        // Disco solar (más pequeño que en la Tierra).
        float disk = smoothstep(0.99990, 0.99995, c);
        col = mix(col, sun * 14.0, disk);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(950, 64, 32), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
