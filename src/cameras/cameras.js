// Las cámaras de Percy: puntos que brillan sobre sus piezas del modelo y, al hacer clic,
// una foto real de Marte que se revela como en un cuarto oscuro.
import * as THREE from 'three';
import './cameras.css';
import { PHOTOS } from './photos.js';

// Pieza del modelo → cámara. `pick` elige el punto exacto dentro de la pieza
// (Mastcam-Z y NavCam comparten la cabeza del mástil: una a cada lado).
const CAMERAS = [
  {
    key: 'mastcam',
    part: 'Mastcam_Z_cams',
    name: 'Mastcam-Z',
    instrument: 'Mastcam-Z izquierda',
    role: 'Sus ojos a color, con zoom, en lo alto del mástil',
    pick: (b) => new THREE.Vector3(b.max.x - 0.04, (b.min.y + b.max.y) / 2, b.max.z),
  },
  {
    key: 'navcam',
    part: 'NavCams',
    name: 'NavCam',
    instrument: 'NavCam izquierda',
    role: 'Mira el camino para planear cada manejo',
    pick: (b) => new THREE.Vector3(b.min.x + 0.03, (b.min.y + b.max.y) / 2, b.max.z),
  },
  {
    key: 'hazcam',
    part: 'hazcams_front',
    name: 'HazCam delantera',
    instrument: 'HazCam delantera izquierda',
    role: 'Vigila los peligros frente a las ruedas',
    pick: (b) => new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z),
  },
  {
    key: 'watson',
    part: 'WATSON',
    name: 'WATSON',
    instrument: 'SHERLOC WATSON',
    role: 'Una lupa en la punta del brazo robótico',
    pick: (b) => b.getCenter(new THREE.Vector3()),
  },
];

const state = { markers: [], viewer: { open: false, zoom: false, key: null, index: 0, loaded: false, src: null, width: 0 } };
window.__cameras = state;

export function createCameraMarkers(rover, { onOpen, onClose } = {}) {
  rover.root.updateMatrixWorld(true);
  const layer = document.createElement('div');
  layer.className = 'cam-layer';
  document.body.append(layer);

  const markers = [];
  for (const cam of CAMERAS) {
    const part = rover.model.getObjectByName(cam.part);
    if (!part) continue;
    // Punto en coordenadas del rover (sigue al rover cuando se mueve).
    const local = rover.root.worldToLocal(cam.pick(new THREE.Box3().setFromObject(part)));
    const el = document.createElement('button');
    el.className = 'cam-dot';
    el.type = 'button';
    el.dataset.key = cam.key;
    el.setAttribute('aria-label', `${cam.name}: tomar foto`);
    el.innerHTML = `<span class="cam-ring"></span><span class="cam-label"><b>${cam.name}</b>${cam.role}<i>clic: tomar foto</i></span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      viewer.open(cam);
    });
    layer.append(el);
    const info = { key: cam.key, name: cam.name, x: 0, y: 0, visible: false, occluded: false };
    state.markers.push(info);
    markers.push({ cam, el, local, info, world: new THREE.Vector3() });
  }

  const viewer = createViewer({ onOpen, onClose });
  const ndc = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const solids = [];
  rover.root.traverse((o) => o.isMesh && o.name !== 'NASA_logo' && solids.push(o));
  let frame = 0;

  // Cada cuadro: proyecta los puntos a la pantalla; cada tanto, mira si el chasis los tapa.
  function update(camera) {
    const checkOcclusion = frame++ % 10 === 0;
    for (const m of markers) {
      rover.root.localToWorld(m.world.copy(m.local));
      ndc.copy(m.world).project(camera);
      const visible = ndc.z < 1 && Math.abs(ndc.x) < 1.05 && Math.abs(ndc.y) < 1.05;
      m.info.x = ((ndc.x + 1) / 2) * innerWidth;
      m.info.y = ((1 - ndc.y) / 2) * innerHeight;
      m.info.visible = visible;
      m.el.hidden = !visible;
      if (!visible) continue;
      m.el.style.transform = `translate(${m.info.x}px, ${m.info.y}px)`;
      if (checkOcclusion) {
        const dist = camera.position.distanceTo(m.world);
        ray.set(camera.position, m.world.clone().sub(camera.position).normalize());
        ray.far = dist - 0.12;
        m.info.occluded = ray.intersectObjects(solids, false).length > 0;
        m.el.classList.toggle('behind', m.info.occluded);
      }
    }
  }
  return { update, viewer };
}

// --- Visor de fotos ----------------------------------------------------------------------
function createViewer({ onOpen, onClose }) {
  const root = document.createElement('div');
  root.className = 'photo';
  root.hidden = true;
  root.innerHTML = `
    <div class="photo-flash"></div>
    <figure class="photo-card">
      <div class="photo-frame">
        <img alt="" draggable="false">
        <div class="photo-wait">Recibiendo imagen de Marte…</div>
      </div>
      <figcaption>
        <div class="photo-meta"><b data-photo-cam></b><span data-photo-sol></span><span data-photo-ago></span><span class="photo-count" data-photo-count></span></div>
        <div class="photo-desc" data-photo-desc></div>
        <div class="photo-help"><span><kbd>clic</kbd> ampliar</span><span><kbd>←</kbd><kbd>→</kbd> más fotos</span><span><kbd>Esc</kbd> volver al juego</span><a data-photo-link target="_blank" rel="noopener">ver en nasa.gov</a></div>
      </figcaption>
    </figure>`;
  document.body.append(root);
  const $ = (s) => root.querySelector(s);
  const img = $('img');
  const card = $('.photo-card');
  const flash = $('.photo-flash');
  const wait = $('.photo-wait');
  let cam = null;
  let list = [];
  let token = 0;

  function show(index, { shutter = true } = {}) {
    const v = state.viewer;
    v.index = (index + list.length) % list.length;
    const photo = list[v.index];
    v.loaded = false;
    v.zoom = false;
    v.src = photo.large;
    root.classList.remove('zoom', 'developed');
    if (shutter) {
      shutterSound();
      restart(flash, 'go');
    }
    $('[data-photo-cam]').textContent = cam.instrument;
    $('[data-photo-sol]').textContent = `Sol ${photo.sol}`;
    $('[data-photo-ago]').textContent = ago(photo.taken);
    $('[data-photo-count]').textContent = `${v.index + 1} / ${list.length}`;
    $('[data-photo-desc]').textContent = photo.desc;
    $('[data-photo-link]').href = photo.link;
    img.classList.remove('reveal');
    img.style.visibility = 'hidden';
    wait.hidden = false;
    const mine = ++token;
    img.onload = () => {
      if (mine !== token) return;
      wait.hidden = true;
      img.style.visibility = '';
      restart(img, 'reveal');
      Object.assign(v, { loaded: true, width: img.naturalWidth });
      setTimeout(() => mine === token && root.classList.add('developed'), 3200);
    };
    img.onerror = () => {
      if (mine !== token) return;
      wait.textContent = 'No llegó la imagen. Revisa la conexión y prueba otra (→).';
      console.error(`[cámaras] no se pudo cargar ${photo.large}`);
    };
    img.src = photo.large;
  }

  function open(which) {
    cam = which;
    list = PHOTOS[which.key];
    Object.assign(state.viewer, { open: true, key: which.key });
    root.hidden = false;
    wait.textContent = 'Recibiendo imagen de Marte…';
    onOpen?.();
    show(0);
  }

  function close() {
    root.hidden = true;
    token++;
    img.removeAttribute('src');
    Object.assign(state.viewer, { open: false, zoom: false, key: null, loaded: false, src: null });
    onClose?.();
  }

  // Clic en la foto: ampliar a pantalla completa (con la versión en resolución original).
  function toggleZoom() {
    const v = state.viewer;
    if (!v.loaded) return;
    v.zoom = !v.zoom;
    root.classList.toggle('zoom', v.zoom);
    if (v.zoom) {
      const photo = list[v.index];
      const full = new Image();
      const mine = token;
      full.onload = () => mine === token && v.zoom && (img.src = photo.full);
      full.src = photo.full;
    }
  }
  img.addEventListener('click', toggleZoom);
  // Clic fuera de la foto (en el fondo): salir del zoom.
  root.addEventListener('click', (e) => {
    if (e.target === root && state.viewer.zoom) toggleZoom();
  });

  // Teclado: mientras el visor está abierto, el juego no recibe teclas (ni WASD ni flechas).
  addEventListener(
    'keydown',
    (e) => {
      if (!state.viewer.open) return;
      e.stopImmediatePropagation();
      if (e.code === 'Escape') close();
      else if (e.code === 'ArrowRight') show(state.viewer.index + 1);
      else if (e.code === 'ArrowLeft') show(state.viewer.index - 1);
      else if (e.code === 'Enter' || e.code === 'Space') toggleZoom();
      else return;
      e.preventDefault();
    },
    true,
  );
  addEventListener('keyup', (e) => state.viewer.open && e.stopImmediatePropagation(), true);

  return { open, close, isOpen: () => state.viewer.open };
}

function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // reinicia la animación CSS
  el.classList.add(cls);
}

function ago(iso) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

// Sonido de obturador sintetizado (sin archivos): dos chasquidos de ruido filtrado.
let audio = null;
function shutterSound() {
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime;
    for (const [at, gain, freq] of [[0, 0.5, 2400], [0.075, 0.35, 1600]]) {
      const len = Math.floor(audio.sampleRate * 0.045);
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = audio.createBufferSource();
      src.buffer = buf;
      const bp = audio.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 0.8;
      const g = audio.createGain();
      g.gain.value = gain;
      src.connect(bp).connect(g).connect(audio.destination);
      src.start(t0 + at);
    }
  } catch {
    // Sin audio (p. ej. navegador sin permiso): la foto sale igual.
  }
}
