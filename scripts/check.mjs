// npm run check: abre la página en el Chrome de Windows (headless) vía Playwright,
// guarda una captura y lista los errores de consola.
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
  await sleep(WAIT_MS);
  await page.screenshot({ path: SHOT });
  console.log(`Captura: ${SHOT}`);
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

const errors = problems.filter((p) => !p.startsWith('[console.warning]'));
if (problems.length) {
  console.log(`\n${problems.length} mensaje(s):`);
  for (const p of problems) console.log('  ' + p);
}
console.log(errors.length ? `\n✗ ${errors.length} error(es)` : '\n✓ Sin errores de consola');
process.exit(errors.length ? 1 : 0);
