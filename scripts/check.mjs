// npm run check: abre la página en el Chrome de Windows (headless) vía Playwright,
// guarda capturas, comprueba el control de misión (4 datos reales y la tecla T),
// las ruedas (giro y dirección) y los choques con rocas, y lista los errores de consola.
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright-core';

const URL_PAGE = process.env.CHECK_URL || 'http://localhost:5173/';
const CHROME = process.env.CHROME_PATH || '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9339; // puerto de depuración de Chrome (en Windows)
const RELAY_PORT = 9340; // puerto local en WSL
const OUT = 'check-output';
const SHOT = `${OUT}/screenshot.png`;
const SHOT_DRIVE = `${OUT}/screenshot-drive.png`;
const SHOT_TRACKS = `${OUT}/screenshot-tracks.png`;
const SHOT_HIDDEN = `${OUT}/screenshot-hidden.png`;
const SHOT_CRASH = `${OUT}/screenshot-crash.png`;
const SHOT_WHEELS = `${OUT}/screenshot-wheels.png`;
const SHOT_PHOTO = `${OUT}/screenshot-photo.png`;
const SHOT_ZOOM = `${OUT}/screenshot-photo-zoom.png`;
const SHOT_LOGO = `${OUT}/screenshot-logo.png`;
const WAIT_MS = Number(process.env.CHECK_WAIT || 6000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

// Chrome solo escucha en 127.0.0.1 de Windows y WSL (modo NAT) no llega ahí:
// cada conexión local se reenvía a través de powershell.exe (stdio <-> TCP).
function startRelay() {
  const script = sh(`wslpath -w "${path.resolve('scripts/cdp-relay.ps1')}"`);
  const server = net.createServer((sock) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', String(PORT)],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    sock.pipe(ps.stdin);
    ps.stdout.pipe(sock);
    const end = () => {
      sock.destroy();
      ps.kill();
    };
    sock.on('error', end).on('close', end);
    ps.stdin.on('error', () => {});
    ps.on('exit', () => sock.destroy());
  });
  return new Promise((resolve) => server.listen(RELAY_PORT, '127.0.0.1', () => resolve(server)));
}

// Mata el árbol del Chrome headless que escucha en nuestro puerto (no toca otros Chrome).
function killChrome() {
  try {
    const pids = new Set();
    for (const line of sh('cmd.exe /c netstat -ano').split(/\r?\n/)) {
      const c = line.trim().split(/\s+/);
      if (c[1]?.endsWith(`:${PORT}`) && c[3] === 'LISTENING') pids.add(c[4]);
    }
    for (const pid of pids) sh(`taskkill.exe /F /T /PID ${pid}`);
  } catch {}
}

if (!(await waitFor(URL_PAGE, 3000))) {
  console.error(`✗ El servidor no responde en ${URL_PAGE}. Lanza "npm run dev" primero.`);
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
killChrome(); // por si quedó uno de una ejecución anterior
const winTemp = sh('cmd.exe /c echo %TEMP%');
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${winTemp}\\perseverancia-check-profile`,
    '--no-first-run',
    '--no-default-browser-check',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1600,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const relay = await startRelay();
const cdp = `http://127.0.0.1:${RELAY_PORT}`;
const problems = [];
const logs = [];
let browser;
try {
  if (!(await waitFor(`${cdp}/json/version`, 25000))) {
    throw new Error('No se pudo conectar al puerto de depuración de Chrome');
  }
  const { webSocketDebuggerUrl } = await (await fetch(`${cdp}/json/version`)).json();
  browser = await chromium.connectOverCDP(webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, `ws://127.0.0.1:${RELAY_PORT}`));
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });

  page.on('console', (msg) => {
    if (msg.type() === 'log' || msg.type() === 'info') logs.push(msg.text());
    // "GL Driver Message" es ruido de rendimiento del renderizado por software, no de la página.
    if ((msg.type() === 'error' || msg.type() === 'warning') && !msg.text().includes('GL Driver Message')) {
      problems.push(`[console.${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`[http ${res.status()}] ${res.url()}`);
  });
  page.on('requestfailed', (req) => problems.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ''}`));

  await page.goto(URL_PAGE, { waitUntil: 'load' });
  // La página pone window.__ready cuando ha cargado todo (p. ej. el modelo del rover).
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }).catch(() => {
    problems.push('[check] la página no llegó a window.__ready en 30 s');
  });
  await sleep(WAIT_MS);

  // Control de misión: los 4 datos reales tienen que haber llegado con un número.
  await page
    .waitForFunction(
      () => {
        const d = window.__mission?.data;
        return d && Object.keys(d).length === 4 && Object.values(d).every((e) => e.status !== 'loading');
      },
      null,
      { timeout: 30000 },
    )
    .catch(() => problems.push('[check] el control de misión no terminó de cargar en 30 s'));
  const mission = await page.evaluate(() => window.__mission?.data ?? {});
  console.log('\nControl de misión:');
  for (const [key, e] of Object.entries(mission)) {
    const ok = e.status === 'ok' && Number.isFinite(e.value) && e.points > 1;
    const value = ok ? `${e.value.toFixed(3)} ${e.unit}` : e.error ?? e.status;
    console.log(`  ${ok ? '✓' : '✗'} ${e.name.padEnd(27)} ${value.padEnd(14)} ${String(e.points).padStart(5)} pts · ${e.provider}`);
    if (!ok) problems.push(`[check] ${key} no cargó: ${value}`);
  }
  if (Object.keys(mission).length !== 4) problems.push(`[check] se esperaban 4 datos y hay ${Object.keys(mission).length}`);
  // El tiempo de luz es en vivo: tiene que cambiar solo.
  const lt0 = mission['percy.lighttime']?.value;
  await sleep(3000);
  const lt1 = await page.evaluate(() => window.__mission?.data['percy.lighttime']?.value);
  console.log(`  tiempo de luz en vivo: ${(lt0 * 60).toFixed(4)} s → ${(lt1 * 60).toFixed(4)} s ${lt0 !== lt1 ? '(cambia ✓)' : '(no cambió ✗)'}`);
  if (lt0 === lt1) problems.push('[check] el tiempo de luz no se actualiza en vivo');

  await page.screenshot({ path: SHOT });
  console.log(`Captura: ${SHOT}`);

  // T oculta el panel y lo vuelve a mostrar.
  const panelVisible = () => page.evaluate(() => {
    const el = document.querySelector('.mc');
    return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  });
  await page.keyboard.press('KeyT');
  await sleep(300);
  const hiddenOk = !(await panelVisible());
  await page.screenshot({ path: SHOT_HIDDEN });
  await page.keyboard.press('KeyT');
  await sleep(300);
  const shownOk = await panelVisible();
  console.log(`Tecla T: oculta ${hiddenOk ? '✓' : '✗'} · vuelve a mostrar ${shownOk ? '✓' : '✗'}  (captura oculto: ${SHOT_HIDDEN})`);
  if (!hiddenOk) problems.push('[check] la tecla T no oculta el control de misión');
  if (!shownOk) problems.push('[check] la tecla T no vuelve a mostrar el control de misión');

  // Cámaras de Percy: pasar el ratón muestra el nombre; el clic abre una foto real de Marte.
  console.log('\nCámaras:');
  const markers = await page.evaluate(() => window.__cameras?.markers ?? []);
  if (markers.length !== 4) problems.push(`[check] se esperaban 4 cámaras con punto y hay ${markers.length}`);
  for (const [n, m] of markers.entries()) {
    if (!m.visible) {
      problems.push(`[check] el punto de ${m.name} no está en pantalla`);
      continue;
    }
    await page.mouse.move(m.x + 30, m.y + 30);
    await page.mouse.move(m.x, m.y, { steps: 4 });
    await sleep(400);
    const label = await page.evaluate((key) => {
      const el = document.querySelector(`.cam-dot[data-key="${key}"] .cam-label`);
      return el && getComputedStyle(el).display !== 'none' ? el.querySelector('b').textContent : null;
    }, m.key);
    await page.mouse.click(m.x, m.y);
    const opened = await page
      .waitForFunction(() => window.__cameras.viewer.loaded, null, { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    const v = await page.evaluate(() => {
      const img = document.querySelector('.photo img');
      return { ...window.__cameras.viewer, natural: img?.naturalWidth ?? 0, cam: document.querySelector('[data-photo-cam]')?.textContent, sol: document.querySelector('[data-photo-sol]')?.textContent, ago: document.querySelector('[data-photo-ago]')?.textContent, desc: document.querySelector('[data-photo-desc]')?.textContent };
    });
    const real = opened && v.natural > 0 && /^https:\/\/mars\.nasa\.gov\/mars2020-raw-images\//.test(v.src);
    console.log(`  ${real ? '✓' : '✗'} ${m.name.padEnd(17)} hover: ${label ?? '✗ sin nombre'} · ${real ? `${v.cam} · ${v.sol} · ${v.ago} · ${v.natural}px · «${v.desc}»` : 'no abrió una foto real'}`);
    if (!label) problems.push(`[check] pasar el ratón por ${m.name} no muestra su nombre`);
    if (!real) problems.push(`[check] ${m.name} no abrió una foto real (${v.src ?? 'sin src'})`);
    if (real && n === 0) {
      await sleep(3600); // que termine de revelarse
      await page.screenshot({ path: SHOT_PHOTO });
      console.log(`    captura con la foto abierta: ${SHOT_PHOTO}`);
      // → otra foto de la misma cámara.
      await page.keyboard.press('ArrowRight');
      const next = await page
        .waitForFunction(() => window.__cameras.viewer.loaded && window.__cameras.viewer.index === 1, null, { timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      console.log(`    flecha →: ${next ? 'foto 2 cargada ✓' : 'no cambió ✗'}`);
      if (!next) problems.push('[check] la flecha → no muestra otra foto de la cámara');
      // Clic en la foto: ampliar.
      await sleep(3400);
      await page.click('.photo img');
      await sleep(2500);
      const zoom = await page.evaluate(() => window.__cameras.viewer.zoom);
      await page.screenshot({ path: SHOT_ZOOM });
      console.log(`    clic: ${zoom ? 'ampliada ✓' : 'no se amplió ✗'}  (captura: ${SHOT_ZOOM})`);
      if (!zoom) problems.push('[check] el clic no amplía la foto');
    }
    await page.keyboard.press('Escape');
    await sleep(300);
    const closed = await page.evaluate(() => !window.__cameras.viewer.open && document.querySelector('.photo').hidden);
    if (!closed) problems.push(`[check] Esc no cerró la foto de ${m.name}`);
  }
  console.log(`  Esc vuelve al juego: ${problems.some((p) => p.includes('Esc no cerró')) ? '✗' : '✓'}`);

  // Logo de la NASA: cámara de lado, cerca del costado izquierdo del chasis.
  const logo = await page.evaluate(() => {
    const g = window.__game;
    if (!g.logos?.length) return null;
    // Centro del logo del costado que mira a la cámara, y su normal hacia fuera.
    const root = g.driver.rover.root;
    const centers = g.logos.map((m) => {
      m.geometry.computeBoundingBox();
      return root.localToWorld(m.geometry.boundingBox.getCenter(g.camera.position.clone()));
    });
    const c = centers.reduce((best, p) => (p.distanceTo(g.camera.position) < best.distanceTo(g.camera.position) ? p : best));
    const out = c.clone().sub(root.position).setY(0).normalize();
    g.holdCamera(true);
    g.camera.position.copy(c).addScaledVector(out, 2.6);
    g.camera.position.y += 0.35;
    g.controls.target.copy(c);
    g.controls.update();
    return { count: g.logos.length };
  });
  await sleep(1500);
  await page.screenshot({ path: SHOT_LOGO });
  await page.evaluate(() => window.__game.holdCamera(false));
  console.log(`Logo de la NASA: ${logo ? `${logo.count} piezas ✓` : 'no está ✗'}  (captura: ${SHOT_LOGO})`);
  if (!logo) problems.push('[check] el rover no tiene el logo de la NASA');

  // Parado con A: gira sobre sí mismo; las 4 ruedas de las esquinas se orientan y las centrales no.
  await page.mouse.click(800, 450);
  const drive = (seconds) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__game?.step(1 / 30); }, Math.round(seconds * 30));
  const heading0 = await page.evaluate(() => window.__game.driver.state.heading);
  await page.keyboard.down('KeyA');
  await drive(1);
  const steering = await page.evaluate((h0) => {
    const g = window.__game;
    // Cámara de lado y cerca para ver las ruedas.
    const p = g.driver.rover.root.position;
    const h = g.driver.state.heading;
    g.camera.position.set(p.x + Math.cos(h) * 5.5 + Math.sin(h) * 2.5, p.y + 1.6, p.z - Math.sin(h) * 5.5 + Math.cos(h) * 2.5);
    g.controls.target.set(p.x, p.y + 0.5, p.z);
    return {
      turned: ((g.driver.state.heading - h0) * 180) / Math.PI,
      wheels: g.driver.rover.wheels.map((w) => ({ name: w.name, deg: (w.angle * 180) / Math.PI, steerable: w.steerable })),
    };
  }, heading0);
  await page.keyboard.up('KeyA');
  await page.evaluate(() => window.__game.controls.update());
  await sleep(1200);
  await page.screenshot({ path: SHOT_WHEELS });
  console.log(`Giro en el sitio con A: ${steering.turned.toFixed(0)}° · ${steering.wheels.map((w) => `${w.name} ${w.deg.toFixed(0)}°`).join(' · ')}  (captura: ${SHOT_WHEELS})`);
  if (Math.abs(steering.turned) < 5) problems.push('[check] con A el rover no gira sobre sí mismo');
  if (!steering.wheels.every((w) => (w.steerable ? Math.abs(w.deg) > 20 : Math.abs(w.deg) < 0.5))) {
    problems.push('[check] la dirección de las ruedas no responde a A');
  }
  await drive(1.5); // las ruedas vuelven a enderezarse

  // Conduce un poco (W + giro) para comprobar movimiento, huellas y cámara de seguimiento.
  // El headless renderiza por software (pocos FPS), así que con las teclas pulsadas
  // se avanza la simulación a 30 Hz desde aquí (drive) para no depender del framerate.
  await page.keyboard.down('KeyW');
  await drive(4);
  await page.keyboard.down('KeyA');
  await drive(2.5);
  await page.keyboard.up('KeyA');
  await drive(1.5);
  await page.keyboard.up('KeyW');
  await drive(2);
  await sleep(1500);
  const state = await page.evaluate(() => {
    const g = window.__game;
    if (!g) return null;
    const s = g.driver.state;
    return { x: s.x.toFixed(1), z: s.z.toFixed(1), rumbo: ((s.heading * 180) / Math.PI).toFixed(0), huellas: g.tracks.count };
  });
  if (state) console.log(`Tras conducir: x=${state.x} z=${state.z} rumbo=${state.rumbo}° huellas=${state.huellas}`);
  const rolled = await page.evaluate(() => window.__game.driver.rover.wheels.map((w) => w.roll));
  console.log(`Ruedas: ${rolled.length} sueltas · vueltas = ${rolled.map((r) => (r / (2 * Math.PI)).toFixed(1)).join(', ')}`);
  if (rolled.length !== 6) problems.push(`[check] se esperaban 6 ruedas sueltas y hay ${rolled.length}`);
  if (!rolled.every((r) => r > 2 * Math.PI)) problems.push('[check] alguna rueda no giró al avanzar');

  await page.screenshot({ path: SHOT_DRIVE });
  console.log(`Captura conduciendo: ${SHOT_DRIVE}`);

  // Gira la cámara ~180° con el ratón para ver las huellas detrás del rover.
  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.mouse.move(1250, 620, { steps: 10 });
  await page.mouse.up();
  await drive(3);
  await sleep(1500);
  await page.screenshot({ path: SHOT_TRACKS });
  console.log(`Captura de huellas: ${SHOT_TRACKS}`);

  // Choque: se coloca el rover a 8 m de la roca alta más cercana, mirándola, y se acelera.
  const rock = await page.evaluate(() => {
    const g = window.__game;
    const s = g.driver.state;
    const rocks = g.rocks.rocks;
    // Una roca alta con el pasillo de llegada (8 m × 4 m) libre de otras rocas altas.
    const clear = (rock, h) => {
      const fx = Math.sin(h), fz = Math.cos(h);
      return rocks.every((o) => {
        if (o === rock || !o.solid) return true;
        const dx = o.x - rock.x, dz = o.z - rock.z;
        const along = -(dx * fx + dz * fz); // distancia hacia atrás desde la roca
        const side = Math.abs(dx * fz - dz * fx);
        return along < -1 || along > 11 || side > 2 + o.r;
      });
    };
    const candidates = rocks
      .filter((r) => r.solid && r.height > 0.5)
      .sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    for (const rock of candidates) {
      for (let k = 0; k < 8; k++) {
        const h = (k / 8) * Math.PI * 2;
        if (!clear(rock, h)) continue;
        Object.assign(s, { x: rock.x - Math.sin(h) * 8, z: rock.z - Math.cos(h) * 8, heading: h, speed: 0 });
        return { ...rock, crashesBefore: s.crashes };
      }
    }
    return null;
  });
  if (!rock) throw new Error('no se encontró una roca con el camino libre para la prueba de choque');
  await page.keyboard.down('KeyW');
  await drive(5);
  await page.screenshot({ path: SHOT_CRASH });
  await page.keyboard.up('KeyW');
  const crash = await page.evaluate(({ x, z }) => {
    const s = window.__game.driver.state;
    return { crashes: s.crashes, gap: Math.hypot(s.x - x, s.z - z), last: s.lastCrash };
  }, rock);
  const crashed = crash.crashes > rock.crashesBefore;
  console.log(
    `Choque: roca de ${rock.height.toFixed(2)} m (radio ${rock.r.toFixed(2)} m) → ${crashed ? `chocó a ${crash.last.speed.toFixed(1)} m/s ✓` : 'no chocó ✗'}` +
      ` · quedó a ${crash.gap.toFixed(2)} m de su centro ${crash.gap > rock.r ? '(no la atravesó ✓)' : '(la atravesó ✗)'}  (captura: ${SHOT_CRASH})`,
  );
  if (!crashed) problems.push('[check] el rover no chocó contra la roca');
  if (crash.gap <= rock.r) problems.push('[check] el rover atravesó la roca');
  await page.close();
} catch (err) {
  problems.push(`[check] ${err.message}`);
} finally {
  try {
    await browser?.close();
  } catch {}
  chrome.kill();
  killChrome();
  relay.close();
}

if (logs.length) {
  console.log('\nConsola de la página:');
  for (const l of logs) console.log('  ' + l);
}
const errors = problems.filter((p) => !p.startsWith('[console.warning]'));
if (problems.length) {
  console.log(`\n${problems.length} mensaje(s):`);
  for (const p of problems) console.log('  ' + p);
}
console.log(errors.length ? `\n✗ ${errors.length} error(es)` : '\n✓ Sin errores de consola');
process.exit(errors.length ? 1 : 0);
