// Panel de control de misión dentro del juego. Es la "vista" (como el plot de Open MCT):
// no sabe de dónde vienen los datos, solo pide el historial y se suscribe a lo nuevo.
import './hud.css';
import { addProvider, getMetadata, request, subscribe } from './telemetry.js';
import { nasaWaypoints, jplEphemeris, missionSol } from './providers.js';

addProvider(nasaWaypoints);
addProvider(jplEphemeris);

const nf = (digits) => new Intl.NumberFormat('es', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const n0 = nf(0);
const n1 = nf(1);
const n2 = nf(2);

// Los 4 datos. Cada uno: clave, nombre, unidad (el proveedor lo pone getMetadata)
// y cómo se explica en una frase.
const OBJECTS = [
  {
    key: 'percy.distance',
    name: 'Distancia recorrida',
    unit: 'km',
    color: '#ffb35c',
    format: (v) => n2.format(v),
    meaning(points) {
      const last = points.at(-1);
      const pitches = Math.round((last.y * 1000) / 105);
      return `Lo que ha manejado Percy desde que aterrizó: unas ${n0.format(pitches)} canchas de fútbol en fila. Último manejo: sol ${last.x}.`;
    },
  },
  {
    key: 'percy.elevation',
    name: 'Altura del terreno',
    unit: 'm',
    color: '#f0845a',
    format: (v) => n0.format(v),
    meaning(points) {
      const climb = points.at(-1).y - points[0].y;
      return `Marte no tiene mar: la altura se mide contra un «nivel cero» promedio. Ya subió ${n0.format(climb)} m desde el fondo del cráter Jezero, como un edificio de ${n0.format(climb / 3)} pisos.`;
    },
  },
  {
    key: 'percy.tilt',
    name: 'Inclinación',
    unit: '°',
    color: '#e8c977',
    format: (v) => n1.format(v),
    meaning(points) {
      const max = points.reduce((a, b) => (b.y > a.y ? b : a));
      return `Cuánto quedó ladeado al terminar su último manejo. Su récord: ${n0.format(max.y)}° en el sol ${max.x}; aguanta 45° sin volcar.`;
    },
  },
  {
    key: 'percy.lighttime',
    name: 'Tiempo de luz Tierra–Marte',
    unit: 'min',
    color: '#8fd3ff',
    live: true,
    format: (v) => n2.format(v),
    meaning(points) {
      const { km, kmPerSec } = points.at(-1);
      const now = km
        ? `Ahora la Tierra y Marte están a ${n0.format(km)} km y se ${kmPerSec < 0 ? 'acercan' : 'alejan'} ${n1.format(Math.abs(kmPerSec))} km cada segundo. `
        : '';
      return `${now}Una orden tarda esto en llegar, por eso cada manejo se planea un día antes; aquí tú manejas sin esperar.`;
    },
  },
];

function minSec(minutes) {
  const total = minutes * 60;
  const m = Math.floor(total / 60);
  return `${m} min ${n1.format(total - m * 60)} s`;
}

// Estado que lee npm run check.
const state = { hidden: false, data: {} };
window.__mission = state;

// --- DOM ---------------------------------------------------------------------------------
const panel = document.createElement('aside');
panel.className = 'mc';
panel.setAttribute('aria-label', 'Control de misión');
panel.innerHTML = `
  <header class="mc-head">
    <div>
      <div class="mc-title">Control de misión</div>
      <div class="mc-sub">Mars 2020 · Perseverance</div>
    </div>
    <div class="mc-clock">
      <div class="mc-sol" data-sol>SOL —</div>
      <div class="mc-utc" data-utc>—</div>
    </div>
  </header>
  <div class="mc-cards"></div>
  <footer class="mc-foot"><span>Gráficas: toda la misión, por sol</span><span><kbd>T</kbd> ocultar</span></footer>`;
const cards = panel.querySelector('.mc-cards');

const pill = document.createElement('div');
pill.className = 'mc-pill';
pill.innerHTML = '<kbd>T</kbd> control de misión';
pill.hidden = true;
document.body.append(panel, pill);

function setHidden(hidden) {
  state.hidden = hidden;
  panel.hidden = hidden;
  pill.hidden = !hidden;
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyT' && !e.repeat) setHidden(!state.hidden);
});

// Reloj: sol de Jezero y hora UTC en la Tierra.
const solEl = panel.querySelector('[data-sol]');
const utcEl = panel.querySelector('[data-utc]');
function tickClock() {
  const now = Date.now();
  solEl.textContent = `SOL ${Math.floor(missionSol(now))} · Jezero`;
  utcEl.textContent = `Tierra ${new Date(now).toISOString().slice(11, 19)} UTC`;
}
tickClock();
setInterval(tickClock, 1000);

// --- Tarjetas ----------------------------------------------------------------------------
for (const obj of OBJECTS) mountCard(obj);

function mountCard(obj) {
  const meta = getMetadata(obj);
  const el = document.createElement('section');
  el.className = 'mc-card';
  el.style.setProperty('--c', obj.color);
  el.dataset.key = obj.key;
  el.innerHTML = `
    <div class="mc-row">
      <h2 class="mc-name">${meta.name}</h2>
      ${obj.live ? '<span class="mc-live">en vivo</span>' : ''}
    </div>
    <div class="mc-main">
      <div class="mc-value">
        <div><span data-value>···</span><span class="mc-unit">${meta.unit}</span></div>
        <div class="mc-extra" data-extra></div>
      </div>
      <div class="mc-chart">
        <canvas></canvas><div class="mc-tip" hidden></div>
        <div class="mc-axis"><span data-x0></span><span data-x1></span></div>
      </div>
    </div>
    <div class="mc-src"><i data-dot></i><span data-status>Pidiendo datos a: ${meta.provider}</span></div>
    <p class="mc-meaning" data-meaning>Estableciendo enlace…</p>`;
  cards.append(el);

  const $ = (sel) => el.querySelector(sel);
  const entry = { name: meta.name, unit: meta.unit, provider: meta.provider, status: 'loading', value: null, points: 0 };
  state.data[obj.key] = entry;
  const chart = createChart($('canvas'), $('.mc-tip'), obj, meta.unit);
  let points = [];

  function render() {
    const last = points.at(-1);
    $('[data-value]').textContent = obj.format(last.y);
    if (obj.live) $('[data-extra]').textContent = `= ${minSec(last.y)}`;
    $('[data-x0]').textContent = `sol ${Math.floor(points[0].x)}`;
    $('[data-x1]').textContent = `sol ${Math.floor(last.x)}`;
    $('[data-meaning]').textContent = obj.meaning(points);
    chart.draw(points);
    Object.assign(entry, { status: 'ok', value: last.y, points: points.length });
  }

  request(obj)
    .then((history) => {
      points = history;
      el.classList.add('ok');
      $('[data-status]').textContent = `${meta.provider} · ${n0.format(points.length)} puntos`;
      render();
      // En vivo: el proveedor manda un valor nuevo cada segundo y se añade al final.
      subscribe(obj, (p) => {
        if (points.at(-1).x >= p.x - 1) points[points.length - 1] = p;
        else points.push(p);
        render();
      });
    })
    .catch((err) => {
      el.classList.add('error');
      Object.assign(entry, { status: 'error', error: err.message });
      $('[data-value]').textContent = 'sin señal';
      $('[data-status]').textContent = `${meta.provider} · ${err.message}`;
      $('[data-meaning]').textContent = 'No llegó el dato. Revisa la conexión a internet y recarga.';
      console.error(`[control de misión] ${meta.name}: ${err.message}`);
    });
}

// --- Gráfica de línea de toda la misión (canvas 2D) --------------------------------------
function createChart(canvas, tip, obj, unit) {
  const ctx = canvas.getContext('2d');
  let points = [];
  let hover = null;
  let scale = null;

  function draw(next = points) {
    points = next;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let ymin = Infinity;
    let ymax = -Infinity;
    for (const p of points) {
      if (p.y < ymin) ymin = p.y;
      if (p.y > ymax) ymax = p.y;
    }
    const pad = (ymax - ymin) * 0.08 || 1;
    const x0 = points[0].x;
    const x1 = points.at(-1).x;
    const L = 30; // espacio para las etiquetas del eje y
    const T = 6;
    const B = h - 4;
    const sx = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (w - L - 6);
    const sy = (y) => B - ((y - (ymin - pad)) / (ymax - ymin + 2 * pad)) * (B - T);
    scale = { sx, x0, x1, L, w };

    // Rejilla y etiquetas: el valor más alto y el más bajo de la misión.
    ctx.font = '10px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const y of [ymax, ymin]) {
      ctx.strokeStyle = 'rgba(255, 220, 190, 0.12)';
      ctx.beginPath();
      ctx.moveTo(L, Math.round(sy(y)) + 0.5);
      ctx.lineTo(w, Math.round(sy(y)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 225, 200, 0.55)';
      ctx.fillText(n0.format(y), L - 5, sy(y));
    }

    // Área y línea.
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.y)) : ctx.moveTo(sx(p.x), sy(p.y))));
    ctx.strokeStyle = obj.color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineTo(sx(x1), B);
    ctx.lineTo(sx(x0), B);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, T, 0, B);
    grad.addColorStop(0, hexA(obj.color, 0.28));
    grad.addColorStop(1, hexA(obj.color, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    // Punto actual, con halo.
    const last = points.at(-1);
    ctx.fillStyle = hexA(obj.color, 0.25);
    ctx.beginPath();
    ctx.arc(sx(last.x), sy(last.y), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = obj.color;
    ctx.beginPath();
    ctx.arc(sx(last.x), sy(last.y), 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Lectura bajo el ratón.
    if (hover) {
      const X = sx(hover.x);
      ctx.strokeStyle = 'rgba(255, 235, 215, 0.45)';
      ctx.beginPath();
      ctx.moveTo(Math.round(X) + 0.5, T);
      ctx.lineTo(Math.round(X) + 0.5, B);
      ctx.stroke();
      ctx.fillStyle = '#fff3e6';
      ctx.beginPath();
      ctx.arc(X, sy(hover.y), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  canvas.addEventListener('pointermove', (e) => {
    if (!scale || !points.length) return;
    const r = canvas.getBoundingClientRect();
    const x = scale.x0 + ((e.clientX - r.left - scale.L) / (scale.w - scale.L - 6)) * (scale.x1 - scale.x0);
    hover = nearest(points, x);
    tip.hidden = false;
    tip.textContent = `sol ${Math.floor(hover.x)} · ${obj.format(hover.y)} ${unit}`;
    const left = Math.min(Math.max(scale.sx(hover.x), 55), scale.w - 55);
    tip.style.left = `${left}px`;
    draw();
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    tip.hidden = true;
    draw();
  });
  addEventListener('resize', () => points.length && draw());

  return { draw };
}

function nearest(points, x) {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].x - x) < Math.abs(points[hi].x - x) ? points[lo] : points[hi];
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
