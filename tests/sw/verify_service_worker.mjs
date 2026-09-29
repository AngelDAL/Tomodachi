#!/usr/bin/env node
/**
 * Verifica en un navegador real que el service worker de Tomodachi se instala,
 * se ACTIVA y deja el precache completo — el fallo de TAB-35 (precache con dos
 * CSS inexistentes + `cache.addAll` atómico) dejaba el SW sin activar y esto lo
 * detecta.
 *
 * Maneja Chrome por CDP con la WebSocket nativa de Node: sin dependencias.
 *
 * Uso:
 *   node tests/sw/verify_service_worker.mjs --url http://127.0.0.1:8091
 *   node tests/sw/verify_service_worker.mjs --url http://127.0.0.1:18811 \
 *        --page /public/sales.html --json /tmp/sw.json
 *
 * Opciones:
 *   --url <base>            origen a probar (obligatorio). Debe ser https o
 *                           localhost/127.0.0.1: los SW solo viven en contexto seguro.
 *   --page <ruta>           página que abre la prueba (default /public/index.html)
 *   --sw <ruta>             url del service worker (default /public/sw.js)
 *   --cache <nombre>        nombre de caché esperado (default: el del sw.js servido)
 *   --allow-missing <ruta>  activo del precache que PUEDE faltar (repetible)
 *   --expect ok|fail        ok = el SW debe activar (default); fail = NO debe
 *   --chrome <bin>          binario de Chrome (default google-chrome)
 *   --timeout <ms>          tope para la activación (default 20000)
 *   --json <ruta>           guarda el informe completo en JSON
 *
 * Salida: informe legible en stdout; exit 0 si pasa, 1 si falla, 2 si no se
 * pudo correr (p. ej. sin Chrome).
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------- argumentos

function parseArgs(argv) {
  const o = {
    url: null, page: '/public/index.html', sw: '/public/sw.js', cache: null,
    allowMissing: [], expect: 'ok', chrome: 'google-chrome', timeout: 20000, json: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--url': o.url = next(); break;
      case '--page': o.page = next(); break;
      case '--sw': o.sw = next(); break;
      case '--cache': o.cache = next(); break;
      case '--allow-missing': o.allowMissing.push(next()); break;
      case '--expect': o.expect = next(); break;
      case '--chrome': o.chrome = next(); break;
      case '--timeout': o.timeout = Number(next()); break;
      case '--json': o.json = next(); break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Error(`opción desconocida: ${a}`);
    }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help || !opts.url) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').trim());
  process.exit(opts.help ? 0 : 2);
}
opts.url = opts.url.replace(/\/$/, '');
const baseHost = new URL(opts.url).hostname;
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseHost) && new URL(opts.url).protocol !== 'https:') {
  console.error(`SKIP | ${opts.url} no es contexto seguro (se necesita https o localhost/127.0.0.1)`);
  process.exit(2);
}

// ---------------------------------------------------------------- utilidades

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 10000, interval = 100, what = 'condición' } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timeout esperando ${what}`);
    await sleep(interval);
  }
}

/** Cliente CDP mínimo sobre la WebSocket de Node. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
        return;
      }
      for (const h of this.handlers) h(msg);
    });
  }

  static connect(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => reject(new Error('timeout abriendo WebSocket CDP')), timeout);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(new Cdp(ws)); });
      ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error(`error WebSocket CDP: ${e.message || e.type}`)); });
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch { /* ya cerrada */ } }
}

// --------------------------------------------------------------- lanzamiento

function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sw-verify-'));
  const child = spawn(opts.chrome, [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    // Chrome rechaza conexiones CDP con Origin ajeno; la WebSocket de Node
    // manda Origin propio. Es el flag documentado para clientes locales.
    '--remote-allow-origins=*',
    '--disable-background-networking', '--disable-sync',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  let spawnError = null;
  // Sin este manejador, un binario inexistente tumba el proceso con un
  // 'error' no capturado en vez de dar un SKIP/utilizable.
  child.on('error', (e) => { spawnError = e; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, userDataDir, exited, stderr: () => stderr, spawnError: () => spawnError };
}

// -------------------------------------------------------------------- main

const report = {
  url: opts.url, page: opts.page, sw: opts.sw, expect: opts.expect,
  when: new Date().toISOString(), failures: [], checks: {}, enableErrors: [],
  serviceWorkers: [], console: { page: [], sw: [] }, httpErrors: [],
};

let chrome = null;
let cdp = null;
let exitCode = 1;

try {
  chrome = launchChrome();
  const portFile = join(chrome.userDataDir, 'DevToolsActivePort');
  const port = await waitFor(() => {
    if (chrome.spawnError()) throw new Error(`no pude ejecutar el navegador ${opts.chrome}: ${chrome.spawnError().message}`);
    if (!existsSync(portFile)) return null;
    const line = readFileSync(portFile, 'utf8').split('\n')[0].trim();
    return line ? Number(line) : null;
  }, { timeout: 20000, what: 'que Chrome abra el puerto de depuración' }).catch(async (e) => {
    if (await Promise.race([chrome.exited, sleep(200).then(() => null)]) !== null || !chrome.child.pid) throw e;
    throw new Error(`${e.message}; stderr de Chrome: ${chrome.stderr().slice(-500)}`);
  });
  report.chromePort = port;

  const devtoolsInfo = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  // CDP del navegador: se necesita su webSocketDebuggerUrl (/json/version no acepta comandos).
  cdp = await Cdp.connect(devtoolsInfo.webSocketDebuggerUrl);

  const c = cdp;
  let pageSession = null;
  const swSessions = new Map();
  const pageLoads = [];
  const mainFrameNavigations = [];
  c.on(async (msg) => {
    if (msg.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = msg.params;
      // Solo interesa el SW de la app: se engancha al vuelo para capturar su
      // consola (el aviso de precache incompleto). Las pestañas las maneja la
      // prueba explícitamente con Target.attachToTarget.
      if (targetInfo.type === 'service_worker' && targetInfo.url.endsWith(opts.sw)) {
        report.serviceWorkers.push({ type: targetInfo.type, url: targetInfo.url });
        swSessions.set(sessionId, targetInfo.url);
        for (const dominio of ['Runtime.enable', 'Log.enable', 'Network.enable']) {
          try {
            await c.send(dominio, {}, sessionId);
          } catch (e) {
            report.enableErrors.push(`${targetInfo.type}: ${dominio}: ${e.message}`);
          }
        }
      }
      return;
    }

    const isSw = swSessions.has(msg.sessionId);
    // Solo la consola de la pestaña de la prueba y la del SW de la app: la de
    // extensiones internas de Chrome es ruido.
    const bucket = isSw ? report.console.sw : (msg.sessionId === pageSession ? report.console.page : null);

    if (msg.method === 'Runtime.consoleAPICalled') {
      if (bucket) bucket.push({
        type: msg.params.type,
        text: msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
      });
    } else if (msg.method === 'Log.entryAdded') {
      if (bucket) bucket.push({ type: msg.params.entry.level, text: msg.params.entry.text });
    } else if (msg.method === 'Network.responseReceived') {
      const r = msg.params.response;
      if (r.status >= 400) report.httpErrors.push({ status: r.status, url: r.url, source: isSw ? 'service_worker' : 'page', fromServiceWorker: !!r.fromServiceWorker });
    } else if (msg.method === 'Page.frameNavigated' && !msg.params.frame.parentId && msg.sessionId === pageSession) {
      mainFrameNavigations.push(msg.params.frame.url);
    } else if (msg.method === 'Page.loadEventFired' && msg.sessionId === pageSession) {
      pageLoads.push(Date.now());
    }
  });

  // Enganche automático SIN pausar: solo para descubrir el target del SW.
  await c.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  // La pestaña de la prueba se crea y se engancha explícitamente: engancharse
  // por auto-attach con pausa deja de entregar los eventos de Page.
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const adjunto = await c.send('Target.attachToTarget', { targetId, flatten: true });
  pageSession = adjunto.sessionId;
  for (const dominio of ['Runtime.enable', 'Log.enable', 'Network.enable', 'Page.enable']) {
    try {
      await c.send(dominio, {}, pageSession);
    } catch (e) {
      report.enableErrors.push(`page: ${dominio}: ${e.message}`);
    }
  }
  report.pageTargetId = targetId;

  const evaluate = async (expression, { awaitPromise = true, timeout = 30000 } = {}) => {
    const res = await c.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, pageSession);
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result.value;
  };

  const load = async () => {
    const beforeNav = mainFrameNavigations.length;
    await c.send('Page.navigate', { url: opts.url + opts.page }, pageSession);
    await waitFor(() => mainFrameNavigations.length > beforeNav,
      { timeout: 30000, what: 'navegación de la página' });
    await waitFor(async () => {
      try { return await evaluate('document.readyState === "complete"'); } catch { return false; }
    }, { timeout: 30000, interval: 200, what: 'que la página termine de cargar (readyState complete)' });
    report.navegaciones = [...mainFrameNavigations];
    // deja correr los scripts diferidos: offline.js registra el SW en window.load
    await sleep(800);
  };

  // -- 1ª carga ------------------------------------------------------------
  await load();
  report.firstLoad = { title: await evaluate('document.title'), url: await evaluate('location.href') };

  // El precache esperado se lee del sw.js SERVIDO (no de una copia en el test):
  // así la prueba falla si el archivo servido y el esperado divergen.
  const swSource = await (await fetch(opts.url + opts.sw)).text();
  const m = swSource.match(/const\s+STATIC_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error(`no pude leer STATIC_ASSETS de ${opts.sw}`);
  const expectedAssets = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] || x[2]);
  const cacheName = opts.cache
    || (swSource.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  report.expectedAssets = expectedAssets;
  report.cacheName = cacheName;

  // registro explícito + espera de activación (el camino que usa offline.js)
  const reg = await evaluate(`(async () => {
    const swUrl = ${JSON.stringify(opts.sw)};
    try {
      const reg = await navigator.serviceWorker.register(swUrl, { scope: '/public/' });
      const worker = reg.installing || reg.waiting || reg.active;
      const estado = await new Promise((resolve) => {
        if (reg.active) return resolve(reg.active.state);
        if (!worker) return resolve('sin-worker');
        const t = setTimeout(() => resolve(worker.state), ${opts.timeout});
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated' || worker.state === 'redundant') { clearTimeout(t); resolve(worker.state); }
        });
      });
      return { ok: true, estado, active: !!reg.active, waiting: !!reg.waiting, installing: !!reg.installing, scope: reg.scope };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  })()`, { timeout: opts.timeout + 5000 });
  report.registration = reg;

  const regs = await evaluate(`(async () => {
    const rs = await navigator.serviceWorker.getRegistrations();
    return rs.map(r => ({ scope: r.scope, active: r.active && r.active.state, waiting: r.waiting && r.waiting.state, installing: r.installing && r.installing.state }));
  })()`);
  report.registrations = regs;
  report.controllerFirstLoad = await evaluate('(() => navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null)()');

  const cachesDump = await evaluate(`(async () => {
    const out = {};
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      out[k] = (await c.keys()).map(r => new URL(r.url).pathname);
    }
    return out;
  })()`);
  report.caches = cachesDump;

  // -- 2ª carga: el SW ya debe controlar la página --------------------------
  await load();
  report.controllerSecondLoad = await evaluate('(() => navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null)()');
  const regsSegunda = await evaluate(`(async () => {
    const rs = await navigator.serviceWorker.getRegistrations();
    return rs.map(r => ({ scope: r.scope, active: r.active && r.active.state, waiting: r.waiting && r.waiting.state, installing: r.installing && r.installing.state }));
  })()`);
  report.registrationsSegundaCarga = regsSegunda;

  // -- veredicto -----------------------------------------------------------
  const cached = new Set(cachesDump[cacheName] || []);
  const missing = expectedAssets.filter((a) => !cached.has(a));
  const notAllowed = missing.filter((a) => !opts.allowMissing.includes(a));
  const unexpectedCached = [...cached].filter((u) => !expectedAssets.includes(u));
  // la raíz '/' y la página precacheada por navegación no cuentan como activo declarado
  const sw404 = report.httpErrors.filter((e) => e.status === 404
    && expectedAssets.some((a) => e.url.endsWith(a))
    && !opts.allowMissing.some((a) => e.url.endsWith(a)));

  report.checks = {
    registroActivo: regs.length > 0 && regs.some((r) => r.active === 'activated'),
    registroActivoSegundaCarga: regsSegunda.length > 0 && regsSegunda.some((r) => r.active === 'activated'),
    instalacionSinError: reg.ok === true && reg.estado === 'activated',
    controlaEnSegundaCarga: !!report.controllerSecondLoad,
    cacheEsperadaPresente: Object.prototype.hasOwnProperty.call(cachesDump, cacheName),
    activosPrecachePresentes: notAllowed.length === 0,
    faltantesPermitidos: missing,
    sin404DePrecache: sw404.length === 0,
    precacheExtra: unexpectedCached,
  };

  const ck = report.checks;
  const failures = [];
  if (opts.expect === 'ok') {
    if (!ck.registroActivo) failures.push(`getRegistrations() sin worker activo (registros=${regs.length})`);
    if (!ck.registroActivoSegundaCarga) failures.push(`getRegistrations() tras la segunda carga sin worker activo (registros=${regsSegunda.length})`);
    if (!ck.instalacionSinError) failures.push(`install no activó el SW (${reg.ok ? reg.estado : reg.error})`);
    if (!ck.controlaEnSegundaCarga) failures.push('navigator.serviceWorker.controller es null en la segunda carga');
    if (!ck.cacheEsperadaPresente) failures.push(`caches.keys() no incluye ${cacheName}`);
    if (!ck.activosPrecachePresentes) failures.push(`activos del precache ausentes de la caché: ${notAllowed.join(', ')}`);
    if (!ck.sin404DePrecache) failures.push(`404 al instalar el precache: ${sw404.map((e) => e.url).join(', ')}`);
  } else {
    if (ck.registroActivo && ck.controlaEnSegundaCarga) {
      failures.push('el SW SÍ se activó y controla la página, pero --expect fail esperaba lo contrario');
    }
  }
  report.failures = failures;
  report.ok = failures.length === 0;

  // -- informe -------------------------------------------------------------
  const line = (s) => console.log(s);
  line(`===== Service worker en ${opts.url}${opts.page} =====`);
  line(`sw servido: ${opts.sw}   caché esperada: ${cacheName}   activos declarados: ${expectedAssets.length}`);
  line(`registros: ${JSON.stringify(regs)}`);
  line(`registros tras 2ª carga: ${JSON.stringify(regsSegunda)}`);
  line(`controller: 1ª carga=${report.controllerFirstLoad || 'null'}  2ª carga=${report.controllerSecondLoad || 'null'}`);
  line(`cachés: ${Object.entries(cachesDump).map(([k, v]) => `${k}(${v.length})`).join(', ') || '(ninguna)'}`);
  line(`activos ausentes de la caché: ${missing.length ? missing.join(', ') : 'ninguno'}`);
  line(`respuestas HTTP >=400: ${report.httpErrors.length ? report.httpErrors.map((e) => `${e.status} ${new URL(e.url).pathname}`).join(', ') : 'ninguna'}`);
  if (report.console.sw.length) {
    line('consola del SW:');
    for (const c of report.console.sw) line(`  [${c.type}] ${c.text}`);
  }
  line('');
  for (const [k, v] of Object.entries(ck)) line(`  ${v === true || v === false ? (v ? 'PASS' : 'FAIL') : 'info'} | ${k}: ${Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (typeof v === 'string' ? v : v)}`);
  line('');
  if (report.ok) line(`PASS | service worker activo y precache verificado (${opts.expect === 'ok' ? 'esperado: activo' : 'esperado: sin activar'})`);
  else for (const f of failures) line(`FAIL | ${f}`);
  exitCode = report.ok ? 0 : 1;
} catch (err) {
  report.failures.push(`error de la prueba: ${err.message}`);
  report.ok = false;
  console.error(`ERROR | ${err.message}`);
  if (chrome?.stderr) {
    const s = chrome.stderr().trim();
    if (s) console.error(`--- stderr de Chrome (últimas líneas) ---\n${s.split('\n').slice(-8).join('\n')}`);
  }
  exitCode = 2;
} finally {
  cdp?.close();
  if (chrome) {
    try { chrome.child.kill('SIGKILL'); } catch { /* ya muerto */ }
    await Promise.race([chrome.exited, sleep(2000)]);
    try { rmSync(chrome.userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (opts.json) {
    try { writeFileSync(opts.json, JSON.stringify(report, null, 2)); console.log(`informe: ${opts.json}`); }
    catch (e) { console.error(`no pude escribir ${opts.json}: ${e.message}`); }
  }
}

process.exit(exitCode);
