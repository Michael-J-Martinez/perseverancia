// Los dos proveedores de datos reales de Percy.
import { earthMarsKm, lightSeconds } from './ephemeris.js';

// Historial de manejos que publica la NASA (MMGIS, el mapa oficial de la misión M2020).
export const WAYPOINTS_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';

const LANDING_MS = Date.parse('2021-02-18T20:55:00Z');
const JEZERO_LON_E = 77.45;

/** Sol (día marciano) de la misión en hora local de Jezero; el aterrizaje fue el sol 0. */
export function missionSol(ms) {
  const msd = (ms / 86400000 + 2440587.5 + 69.184 / 86400 - 2405522.0028779) / 1.0274912517;
  return msd + JEZERO_LON_E / 360 - 52304;
}

// --- Proveedor 1: NASA · historial de manejos (solo historial) ---------------------------
let waypoints = null;
function loadWaypoints() {
  waypoints ??= fetch(WAYPOINTS_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${WAYPOINTS_URL}`);
      return res.json();
    })
    .then((json) =>
      json.features
        .map((f) => f.properties)
        // "y" = fin de un manejo. Los puntos intermedios ("m") traen la distancia a 0.
        .filter((p) => p.final === 'y'),
    )
    .catch((err) => {
      waypoints = null; // permite reintentar
      throw err;
    });
  return waypoints;
}

const FIELDS = {
  'percy.distance': (p) => p.dist_total_m / 1000,
  'percy.elevation': (p) => p.elev_geoid,
  'percy.tilt': (p) => p.tilt,
};

export const nasaWaypoints = {
  name: 'NASA · historial de manejos (MMGIS M20)',
  supportsRequest: (obj) => obj.key in FIELDS,
  async request(obj) {
    const pick = FIELDS[obj.key];
    return (await loadWaypoints()).map((p) => ({ x: p.sol, y: pick(p), site: p.site, drive: p.drive }));
  },
};

// --- Proveedor 2: efemérides JPL calculadas aquí mismo (historial + en vivo) --------------
export const jplEphemeris = {
  name: 'Efemérides JPL · cálculo en vivo',
  supportsRequest: (obj) => obj.key === 'percy.lighttime',
  supportsSubscribe: (obj) => obj.key === 'percy.lighttime',
  async request() {
    const out = [];
    for (let ms = LANDING_MS; ms < Date.now(); ms += 86400000) out.push(sample(ms));
    out.push(sample(Date.now()));
    return out;
  },
  subscribe(obj, callback) {
    const tick = () => {
      const now = Date.now();
      // También la distancia y cuánto cambia por segundo: eso sí se ve moverse en pantalla.
      callback({ ...sample(now), km: earthMarsKm(now), kmPerSec: earthMarsKm(now + 1000) - earthMarsKm(now) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  },
};

const sample = (ms) => ({ x: missionSol(ms), y: lightSeconds(ms) / 60 });
