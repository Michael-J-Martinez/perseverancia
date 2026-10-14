import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { groundHeight } from './terrain.js';

// Dimensiones reales de Perseverance (NASA): 3 m de largo, 2.7 m de ancho, 2.2 m de alto.
const REAL_HEIGHT = 2.2;
const CAMERA_PART = /cam|watson|lens/i;
const NOT_CAMERA = /cover|wiring|bracket/i;

const MAX_SPEED = 4; // m/s (el real va a ~0.04 m/s; aquí acelerado para explorar)
const ACCEL = 3;
const TURN_RATE = 0.9; // rad/s

export async function loadRover(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;

  // Escala a tamaño real usando la altura (el brazo extendido distorsiona el largo).
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = REAL_HEIGHT / size.y;
  model.scale.setScalar(scale);
  box.setFromObject(model);
  // Ruedas apoyadas en y = 0 y el origen en el centro de las 6 ruedas
  // (ahí está el eje sobre el que gira en el sitio).
  const wheelsAt = model.getObjectByName('Wheels_objs');
  const center = (wheelsAt ? new THREE.Box3().setFromObject(wheelsAt) : box).getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);

  const cameraParts = [];
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
    if (CAMERA_PART.test(o.name) && !NOT_CAMERA.test(o.name)) cameraParts.push(o);
  });

  const wheelsNode = model.getObjectByName('Wheels_objs');
  const wheelBox = wheelsNode ? new THREE.Box3().setFromObject(wheelsNode) : box;
  const hullBox = new THREE.Box3().setFromObject(model);
  const dims = hullBox.getSize(new THREE.Vector3());

  const root = new THREE.Group();
  root.name = 'Perseverance';
  root.add(model);
  root.updateMatrixWorld(true);
  const wheels = wheelsNode ? splitWheels(wheelsNode, root) : [];

  return {
    root,
    model,
    cameraParts,
    dims,
    wheels,
    wheelRadius: wheels[0]?.radius ?? 0.26,
    // Mitad de la vía (centro de rueda) y mitad de la batalla, para apoyar y dejar huellas.
    halfTrack: (wheelBox.max.x - wheelBox.min.x) / 2 - 0.2,
    halfBase: (wheelBox.max.z - wheelBox.min.z) / 2 - 0.25,
    // Caja del rover vista desde arriba (para chocar): ancho total y del parachoques trasero al brazo.
    hull: { halfWidth: (wheelBox.max.x - wheelBox.min.x) / 2, rear: hullBox.min.z + 0.1, front: hullBox.max.z - 0.4 },
  };
}

// El modelo trae las 6 ruedas fundidas en una sola malla. Se separan por posición
// (lado izquierdo/derecho × delante/centro/detrás) y cada una queda colgando de dos
// pivotes: uno de dirección (eje vertical) y otro de giro (eje del palier).
function splitWheels(node, root) {
  const groups = Array.from({ length: 6 }, () => []);
  const meshes = [];
  node.traverse((o) => o.isMesh && meshes.push(o));
  const slot = (x, z) => (x > 0 ? 0 : 3) + (z > 0.55 ? 0 : z < -0.55 ? 2 : 1);

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const index = geo.index ? geo.index.array : Array.from({ length: pos.count }, (_, i) => i);
    const tris = Array.from({ length: 6 }, () => []);
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
      const x = pos.getX(a) + pos.getX(b) + pos.getX(c);
      const z = pos.getZ(a) + pos.getZ(b) + pos.getZ(c);
      tris[slot(x / 3, z / 3)].push(a, b, c);
    }
    tris.forEach((list, w) => list.length && groups[w].push({ mesh, geometry: subGeometry(geo, list) }));
    mesh.removeFromParent();
  }

  const unit = 1 / root.children[0].scale.x; // metros → unidades del modelo
  const names = ['delantera izq.', 'central izq.', 'trasera izq.', 'delantera der.', 'central der.', 'trasera der.'];
  return groups.map((parts, w) => {
    const bounds = new THREE.Box3();
    for (const { geometry } of parts) {
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    steer.position.copy(center);
    steer.add(spin);
    for (const { mesh, geometry } of parts) {
      geometry.translate(-center.x, -center.y, -center.z);
      const piece = new THREE.Mesh(geometry, mesh.material);
      piece.castShadow = piece.receiveShadow = true;
      spin.add(piece);
    }
    node.add(steer);
    steer.updateMatrixWorld(true);
    // Posición del centro de la rueda en el sistema del rover (metros).
    const at = root.worldToLocal(steer.getWorldPosition(new THREE.Vector3()));
    return {
      name: names[w],
      steer,
      spin,
      restY: center.y,
      unit,
      at,
      radius: ((bounds.max.y - bounds.min.y) / 2) / unit,
      steerable: w % 3 !== 1, // en Perseverance giran las 4 de las esquinas; las centrales no
      angle: 0, // dirección actual (rad)
      roll: 0, // vueltas acumuladas (rad)
      lift: 0, // cuánto sube por la suspensión (m)
    };
  });
}

// Copia solo los triángulos indicados, con sus vértices renumerados.
function subGeometry(geo, tris) {
  const remap = new Map();
  const order = [];
  const index = tris.map((v) => {
    if (!remap.has(v)) {
      remap.set(v, order.length);
      order.push(v);
    }
    return remap.get(v);
  });
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const size = attr.itemSize;
    const data = new attr.array.constructor(order.length * size);
    order.forEach((v, i) => {
      for (let k = 0; k < size; k++) data[i * size + k] = attr.getComponent(v, k);
    });
    out.setAttribute(name, new THREE.BufferAttribute(data, size, attr.normalized));
  }
  out.setIndex(index);
  return out;
}

// Conducción WASD / flechas con física sencilla pero real:
// - motores con aceleración limitada, gravedad de Marte en las pendientes y freno al soltar;
// - A/D mueven la dirección de las 4 ruedas de las esquinas: en marcha traza curvas
//   y parado gira sobre sí mismo (como el Perseverance de verdad);
// - cada rueda gira según su propia velocidad y sube o baja con la suspensión;
// - las piedras bajas se trepan; contra las rocas altas el rover se estrella.
export function createDriver(rover, { x = 0, z = 0, heading = 0 } = {}, rockField = null) {
  const keys = new Set();
  const map = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
  addEventListener('keydown', (e) => {
    if (map[e.code]) {
      keys.add(map[e.code]);
      e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => keys.delete(map[e.code]));
  addEventListener('blur', () => keys.clear());

  const state = { x, z, heading, speed: 0, steer: 0, yawRate: 0, crashes: 0, lastCrash: null, onCrash: null };
  const jolt = { angle: 0, vel: 0 };
  const fwd = new THREE.Vector3();
  const left = new THREE.Vector3();
  const up = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const target = new THREE.Quaternion();
  const base = new THREE.Quaternion();
  const joltQ = new THREE.Quaternion();
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const tmp = new THREE.Vector3();
  const wheels = rover.wheels;
  const ground = new Float64Array(wheels.length);

  function contact(out, dx, dz) {
    // dx: lateral (+ = izquierda), dz: longitudinal (+ = delante)
    const s = Math.sin(state.heading), c = Math.cos(state.heading);
    const wx = state.x + dz * s + dx * c;
    const wz = state.z + dz * c - dx * s;
    return out.set(wx, groundHeight(wx, wz), wz);
  }

  // Altura del suelo bajo cada rueda (arena + piedra trepable si la hay).
  function sampleWheels() {
    wheels.forEach((w, i) => {
      contact(tmp, w.at.x, w.at.z);
      ground[i] = tmp.y + (rockField ? rockField.lift(tmp.x, tmp.z) : 0);
    });
  }

  // Apoya el chasis: inclinación por la media de cada lado/eje (como el balancín rocker-bogie)
  // y luego cada rueda se estira o encoge para tocar su propio suelo.
  function place(dt, snap = false) {
    sampleWheels();
    const avg = (pick) => {
      let sum = 0, n = 0;
      wheels.forEach((w, i) => pick(w) && ((sum += ground[i]), n++));
      return sum / n;
    };
    const front = avg((w) => w.at.z > 0.55), rear = avg((w) => w.at.z < -0.55);
    const lft = avg((w) => w.at.x > 0), rgt = avg((w) => w.at.x < 0);
    const zf = wheels.find((w) => w.at.z > 0.55).at.z, zr = wheels.find((w) => w.at.z < -0.55).at.z;
    const xl = wheels.find((w) => w.at.x > 0).at.x, xr = wheels.find((w) => w.at.x < 0).at.x;
    const s = Math.sin(state.heading), c = Math.cos(state.heading);
    fwd.set(s, (front - rear) / (zf - zr), c).normalize();
    left.set(c, (lft - rgt) / (xl - xr), -s).normalize();
    up.crossVectors(fwd, left).normalize();
    left.crossVectors(up, fwd).normalize();
    m.makeBasis(left, up, fwd);
    target.setFromRotationMatrix(m);
    const y = avg(() => true);
    const k = snap ? 1 : 1 - Math.exp(-dt * 10);
    base.slerp(target, k);
    // Sacudida del choque: un muelle amortiguado que cabecea el chasis.
    jolt.vel += (-140 * jolt.angle - 9 * jolt.vel) * dt;
    jolt.angle += jolt.vel * dt;
    rover.root.quaternion.copy(base).multiply(joltQ.setFromAxisAngle(X_AXIS, jolt.angle));
    rover.root.position.set(state.x, THREE.MathUtils.lerp(rover.root.position.y, y, k), state.z);
    rover.root.updateMatrixWorld(true);

    // Suspensión: cuánto le falta (o sobra) a cada rueda para tocar su suelo.
    wheels.forEach((w, i) => {
      tmp.set(w.at.x, w.at.y - w.radius, w.at.z); // apoyo de la rueda en reposo
      rover.root.localToWorld(tmp);
      const want = THREE.MathUtils.clamp(ground[i] - tmp.y, -0.12, 0.25);
      w.lift += (want - w.lift) * (snap ? 1 : 1 - Math.exp(-dt * 20));
      w.steer.position.y = w.restY + w.lift * w.unit;
    });
  }

  // Cada rueda: hacia dónde se mueve su centro y a qué velocidad → ángulo de dirección y giro.
  function turnWheels(dt) {
    const v = state.speed, w = state.yawRate;
    for (const wheel of wheels) {
      const along = v - w * wheel.at.x; // velocidad hacia delante en esa rueda
      const side = w * wheel.at.z; // velocidad hacia la izquierda en esa rueda
      if (wheel.steerable) {
        let want = 0;
        if (Math.abs(along) + Math.abs(side) > 1e-3) want = Math.atan(side / (Math.abs(along) < 1e-4 ? 1e-4 * Math.sign(along || 1) : along));
        else if (state.steer !== 0) want = wheel.angle; // parado: mantiene la dirección
        // Los actuadores de dirección no son instantáneos (~100°/s).
        wheel.angle += THREE.MathUtils.clamp(want - wheel.angle, -1.8 * dt, 1.8 * dt);
        wheel.steer.rotation.y = wheel.angle;
      }
      const rolling = along * Math.cos(wheel.angle) + side * Math.sin(wheel.angle);
      wheel.roll += (rolling / wheel.radius) * dt;
      wheel.spin.rotation.x = wheel.roll;
    }
  }

  // Choques: la caja del rover (vista desde arriba) contra las rocas altas.
  function collide() {
    if (!rockField) return;
    const { halfWidth, rear, front } = rover.hull;
    const s = Math.sin(state.heading), c = Math.cos(state.heading);
    for (const rock of rockField.near(state.x, state.z, 3)) {
      if (!rock.solid) continue;
      const dx = rock.x - state.x, dz = rock.z - state.z;
      const lx = dx * c - dz * s; // hacia la izquierda del rover
      const lz = dx * s + dz * c; // hacia delante del rover
      const cx = THREE.MathUtils.clamp(lx, -halfWidth, halfWidth);
      const cz = THREE.MathUtils.clamp(lz, rear, front);
      let nx = cx - lx, nz = cz - lz;
      let d = Math.hypot(nx, nz);
      if (d >= rock.r) continue;
      if (d < 1e-6) {
        nx = 0;
        nz = lz > 0 ? -1 : 1;
        d = 0;
      } else {
        nx /= d;
        nz /= d;
      }
      // Empuja fuera de la roca (n apunta de la roca hacia el rover, en ejes del rover).
      const pen = rock.r - d;
      state.x += (nx * c + nz * s) * pen;
      state.z += (-nx * s + nz * c) * pen;
      // Velocidad hacia la roca: solo cuenta la componente que avanza contra ella.
      const impact = -state.speed * nz;
      if (impact > 0.05) {
        state.speed *= Math.abs(nz) > 0.5 ? -0.25 : 0.6; // de frente rebota; de refilón roza
        if (impact > 0.6 && cooldown <= 0) {
          state.crashes++;
          state.lastCrash = { speed: impact, height: rock.height, x: rock.x, z: rock.z };
          jolt.vel += Math.sign(nz) * impact * 0.35; // de frente levanta el morro
          cooldown = 1;
          state.onCrash?.(state.lastCrash);
        }
      }
    }
  }

  const G_MARS = 3.71;
  let cooldown = 0; // un choque cuenta una vez, aunque siga empujando la roca
  function update(dt) {
    cooldown -= dt;
    const throttle = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0);
    const steerKey = (keys.has('l') ? 1 : 0) - (keys.has('r') ? 1 : 0);
    // Volante con recorrido: llega a tope en ~0.4 s y vuelve solo al centro.
    state.steer += THREE.MathUtils.clamp(steerKey - state.steer, -2.5 * dt, 2.5 * dt);

    // Motores: buscan la velocidad pedida con fuerza limitada; sin acelerador frenan.
    const targetSpeed = throttle * MAX_SPEED * (throttle < 0 ? 0.5 : 1);
    const motor = THREE.MathUtils.clamp((targetSpeed - state.speed) * 4, -ACCEL * (throttle ? 1 : 1.6), ACCEL * (throttle ? 1 : 1.6));
    const slope = -G_MARS * fwd.y; // la gravedad empuja cuesta abajo
    state.speed += (motor + slope) * dt;
    if (!throttle && Math.abs(state.speed) < 0.05 && Math.abs(slope) < ACCEL * 1.6) state.speed = 0; // freno de mano

    // Curvas: en marcha, giro proporcional a la velocidad (radio mínimo ~3 m);
    // parado, giro sobre sí mismo.
    const moving = Math.min(Math.abs(state.speed) / 1.2, 1);
    state.yawRate = state.speed * state.steer * 0.33 + (1 - moving) * state.steer * TURN_RATE;
    state.heading += state.yawRate * dt;
    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z += Math.cos(state.heading) * state.speed * dt;
    collide();
    place(dt);
    turnWheels(dt);
    return Math.abs(state.speed) > 0.01 || Math.abs(state.steer) > 0.01;
  }

  base.copy(rover.root.quaternion);
  place(0, true);
  return { state, update, keys, contact };
}

// Logo oficial de la NASA (SVG de dominio público) proyectado sobre los dos costados del chasis.
// El modelo trae el logo, pero diminuto (en la placa de los nombres); así se ve desde el juego.
export async function addNasaLogos(rover, url = '/textures/nasa-logo.svg', size = 0.34) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  // El SVG mide 110×92 con el círculo centrado en x≈50: se centra en un lienzo cuadrado.
  const k = 1024 / 92;
  ctx.drawImage(img, 512 - 50 * k, 0, 110 * k, 92 * k);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    roughness: 0.55,
    metalness: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });

  const body = rover.model.getObjectByName('Body');
  const targets = [];
  body.traverse((o) => o.isMesh && targets.push(o));
  rover.root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const helper = new THREE.Object3D();
  const logos = [];
  for (const side of [1, -1]) {
    // Desde fuera hacia el costado del chasis, en el hueco libre (sin ruedas ni balancines delante)
    // entre la rueda central y la trasera: de 0,8 a 1,1 m de alto.
    const origin = new THREE.Vector3(side * 3, 0.95, -0.75);
    ray.set(origin, new THREE.Vector3(-side, 0, 0));
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) continue;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    helper.position.copy(hit.point);
    helper.lookAt(hit.point.clone().add(normal));
    for (const mesh of targets) {
      const geo = new DecalGeometry(mesh, hit.point, helper.rotation.clone(), new THREE.Vector3(size, size, 0.3));
      if (!geo.attributes.position.count) continue;
      const decal = new THREE.Mesh(geo, material);
      decal.receiveShadow = true;
      decal.name = 'NASA_logo';
      // DecalGeometry sale en coordenadas del mundo; el rover aún está en el origen.
      rover.root.add(decal);
      logos.push(decal);
    }
  }
  return logos;
}
