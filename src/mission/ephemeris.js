// Posiciones de la Tierra y Marte con los elementos orbitales de JPL
// ("Approximate Positions of the Planets", E. M. Standish, tabla 1, válida 1800–2050).
// Error típico: unos segundos de arco, es decir, menos de 1 s en el tiempo de luz.

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;
const DEG = Math.PI / 180;

// [a (UA), e, I (°), L (°), ϖ (°), Ω (°)] y su variación por siglo juliano.
const ELEMENTS = {
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
};

// Siglos julianos desde J2000 (TT ≈ UTC + 69 s).
const centuries = (ms) => (ms / 86400000 + 2440587.5 + 69 / 86400 - 2451545) / 36525;

function helio(planet, T) {
  const [base, rate] = ELEMENTS[planet];
  const [a, e, I, L, varpi, Omega] = base.map((v, i) => v + rate[i] * T);
  const w = (varpi - Omega) * DEG;
  const O = Omega * DEG;
  const i = I * DEG;
  let M = ((L - varpi) % 360) * DEG;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [cw, sw, cO, sO, ci, si] = [Math.cos(w), Math.sin(w), Math.cos(O), Math.sin(O), Math.cos(i), Math.sin(i)];
  return [
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

/** Distancia Tierra–Marte en km en el instante `ms` (milisegundos UTC). */
export function earthMarsKm(ms) {
  const T = centuries(ms);
  const p = helio('earth', T);
  const q = helio('mars', T);
  return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) * AU_KM;
}

/** Tiempo que tarda la luz (o una orden de radio) de la Tierra a Marte, en segundos. */
export const lightSeconds = (ms) => earthMarsKm(ms) / C_KM_S;
