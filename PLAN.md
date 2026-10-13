# Plan: Paisaje de Marte cinematográfico (Vite + Three.js)

## Contexto
Carpeta vacía (solo `claude.md` y `.git`). Objetivo: proyecto Vite + Three.js con un paisaje marciano "de película" (dunas, rocas, cielo caramelo con polvo, sol de tarde cálido con sombras suaves, Phobos y Deimos), servidor de desarrollo encendido lo antes posible para verlo en vivo en el navegador de Cursor, y un `npm run check` que abra la página en Chrome headless vía Playwright, guarde captura y liste errores de consola.

Entorno verificado:
- WSL2 (modo NAT, gateway Windows = `172.18.0.1`), Node 20.20, npm 10.8.
- **No hay Chrome en Linux**; sí en Windows: `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe` (v155). No hay Node en Windows.
- Proyecto en `/mnt/c/...` (OneDrive) → el file-watching de Vite necesita `usePolling`.

## Paso 0 — Guardar este plan
Copiar este plan tal cual a `PLAN.md` en la raíz del proyecto (primera acción tras aprobar).

## Paso 1 — Arranque rápido (meta: algo visible en < 2 min)
1. Escribir a mano (sin `create-vite` interactivo): `package.json` (`dev`, `build`, `check`), `vite.config.js` (`server.host: true`, `port: 5173`, `strictPort`, `watch.usePolling: true`), `index.html`, `src/main.js`, `.gitignore` (`node_modules`, `check-output/`).
2. `npm install three vite playwright-core` (`playwright-core` = sin descarga de navegadores).
3. Lanzar `npm run dev` en background inmediatamente → `http://localhost:5173` (Windows reenvía localhost a WSL, así que Cursor lo ve).
4. Primera versión de la escena (mínima pero ya con todo lo pedido): renderer con ACES tone mapping + sombras `PCFSoftShadowMap`, cielo degradado caramelo (shader en esfera), `FogExp2` polvoriento, terreno con dunas por ruido, rocas instanciadas, `DirectionalLight` cálida baja + `HemisphereLight`, disco solar, dos lunas pequeñas, `OrbitControls`. Vite recarga solo.

## Paso 2 — `npm run check` (`scripts/check.mjs`)
- Comprueba que el dev server responde; si no, error claro.
- Lanza el **Chrome de Windows** en headless con `--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=<temp Windows>` (perfil temporal para no tocar el Chrome abierto del usuario), `--use-angle=swiftshader --enable-unsafe-swiftshader` para WebGL fiable, ventana 1600×900.
- Se conecta con `playwright-core` `chromium.connectOverCDP('http://172.18.0.1:9222')` (IP del gateway calculada leyendo `ip route`). Abre `http://localhost:5173`, recoge `console` (error/warning), `pageerror` y `requestfailed`, espera ~5 s de render, guarda `check-output/screenshot.png`, imprime resumen y sale con código 1 si hay errores. Siempre mata el proceso de Chrome al terminar.
- **Plan B** si el puerto CDP no es alcanzable desde WSL (firewall/NAT): mismo Chrome de Windows con `--headless --screenshot=... --enable-logging=stderr --v=0`, parseando las líneas `CONSOLE(...)`/errores del stderr. Lo avisaría explícitamente si hubiera que usarlo.

## Paso 3 — Mejoras cinematográficas (en `src/`, separado por módulos)
- `src/terrain.js`: dunas con ruido fBm + crestas (ridged noise) y ondulaciones finas, colores por vértice (óxidos rojizos/ocres, crestas más claras), material estándar rugoso.
- `src/rocks.js`: rocas de icosaedro deformado por ruido, `InstancedMesh`, tamaños variados, semihundidas, `castShadow`.
- `src/sky.js`: shader de cielo caramelo/butterscotch con halo azulado alrededor del sol (como el atardecer real marciano), dispersión de polvo hacia el horizonte; sol con glow.
- `src/moons.js`: Phobos (más grande, irregular) y Deimos (pequeño), iluminados por el sol, colocados visibles en el encuadre inicial.
- `src/dust.js`: partículas de polvo en suspensión a la deriva.
- Post-proceso: `EffectComposer` + `UnrealBloomPass` suave + viñeta/grano ligero; cámara inicial baja y encuadrada hacia el sol con las lunas en cuadro, rotación lenta opcional.

## Verificación (máximo 3 rondas)
Tras el paso 1, y tras cada mejora grande: `npm run check` → leer `check-output/screenshot.png` con la herramienta Read → corregir errores de consola y lo que falte visualmente. Termina cuando: 0 errores de consola y la captura muestra dunas, rocas, cielo caramelo con polvo, sol cálido con sombras suaves y ambas lunas.

## Archivos
`PLAN.md`, `package.json`, `vite.config.js`, `index.html`, `src/main.js`, `src/{terrain,rocks,sky,moons,dust}.js`, `scripts/check.mjs`, `.gitignore`.
