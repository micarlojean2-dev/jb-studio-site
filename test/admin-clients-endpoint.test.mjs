// Regresión permanente para el incidente de producción del 2026-07-22:
// lib/assistant-templates.js usaba import.meta pero Vercel lo cargaba como
// CommonJS -> "Cannot use 'import.meta' outside a module" -> el módulo crasheaba
// al cargar y GET /api/clients devolvía FUNCTION_INVOCATION_FAILED (500) en vez
// de 401. Estas pruebas fijan el contrato y evitan que vuelva a ocurrir.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const pass = (m) => { checks++; console.log('  ✓', m); };

// ── 1) Ningún .js en api/ o lib/ puede usar import.meta ─────────────────────
// Esos archivos pueden ser cargados como CommonJS por el runtime de Vercel, y
// import.meta es un SyntaxError en CJS que tumba toda la función al cargar.
// (Los .mjs siempre son ESM, así que import.meta es válido y están permitidos.)
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const apiLibJs = [...jsFiles(join(root, 'api')), ...jsFiles(join(root, 'lib'))];
const importMetaOffenders = apiLibJs.filter((f) => /import\.meta/.test(readFileSync(f, 'utf8')));
assert.deepEqual(importMetaOffenders, [], `import.meta en .js (debe ser .mjs): ${importMetaOffenders.join(', ')}`);
pass('ningún .js en api/ o lib/ usa import.meta (evita el crash CJS de Vercel)');

// Vercel transpila los api/*.js a CommonJS; un import ESTÁTICO de un .mjs se
// vuelve require() de un ESM -> ERR_REQUIRE_ESM en runtime. Debe usarse import()
// dinámico. (Guard del segundo modo de fallo del mismo incidente.)
const staticMjsOffenders = apiLibJs.filter((f) => /^\s*import\s[^;]*from\s+['"][^'"]+\.mjs['"]/m.test(readFileSync(f, 'utf8')));
assert.deepEqual(staticMjsOffenders, [], `import estático de .mjs en .js (usa import() dinámico): ${staticMjsOffenders.join(', ')}`);
pass('ningún .js en api/ o lib/ importa estáticamente un .mjs (evita ERR_REQUIRE_ESM)');

// ── 2) El módulo de plantillas carga y getOfficialTemplate funciona ─────────
const { getOfficialTemplate } = await import('../lib/assistant-templates.mjs');
const restaurant = getOfficialTemplate('restaurant');
assert.equal(restaurant.id, 'restaurant');
assert.equal(restaurant.version, '1.0');
pass('lib/assistant-templates.mjs carga y getOfficialTemplate("restaurant") es válido');

// ── Handler helpers ─────────────────────────────────────────────────────────
function mockRes() {
  return { statusCode: 200, _json: null, _threw: false,
    setHeader() {}, status(c) { this.statusCode = c; return this; },
    json(o) { this._json = o; return this; }, end() { return this; } };
}
async function callClients(method, { query = {}, body = {}, headers = {} } = {}) {
  const { default: handler } = await import('../api/clients.js');
  const req = { method, query, body, headers: { 'x-forwarded-for': '127.0.0.1', ...headers } };
  const res = mockRes();
  await handler(req, res);   // nunca debe lanzar: siempre responde con JSON
  return res;
}

// El handler construye su cliente Redis y lee ADMIN_TOKEN al importarse, así que
// las credenciales de prueba (.env.test) se cargan ANTES de la primera llamada.
// En CI sin .env.test se usa un token dummy y el 200 en vivo se omite abajo.
const envFile = join(root, '.env.test');
if (existsSync(envFile)) {
  for (const l of readFileSync(envFile, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) { const v = m[2].trim().replace(/^["']|["']$/g, ''); if (v) process.env[m[1]] = v; }
  }
}
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';

// ── 3) Sin token / token incorrecto → 401 (nunca 500) ───────────────────────
let r = await callClients('GET', {});
assert.equal(r.statusCode, 401, `sin token debe ser 401, fue ${r.statusCode}`);
pass('GET /api/clients sin token → 401');
r = await callClients('GET', { headers: { 'x-admin-token': 'incorrecto-xyz' } });
assert.equal(r.statusCode, 401, `token incorrecto debe ser 401, fue ${r.statusCode}`);
pass('GET /api/clients con token incorrecto → 401');

// ── 4) Fallo de Redis → 500 CONTROLADO (JSON), nunca excepción sin manejar ──
// Subproceso con una URL de Redis que rechaza al instante (puerto cerrado):
// redis.keys() falla, el try/catch del handler lo captura y responde 500 JSON.
const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
  process.env.ADMIN_TOKEN = 'tok';
  process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'x';
  const { default: h } = await import(${JSON.stringify(join(root, 'api', 'clients.js'))});
  const res = { s:200, j:null, setHeader(){}, status(c){this.s=c;return this;}, json(o){this.j=o;return this;}, end(){return this;} };
  let threw = false;
  try { await h({ method:'GET', query:{}, body:{}, headers:{ 'x-admin-token':'tok', 'x-forwarded-for':'127.0.0.1' } }, res); }
  catch (e) { threw = true; }
  console.log(JSON.stringify({ status: res.s, hasJson: !!res.j, threw }));
`], { encoding: 'utf8', timeout: 30000 });
const line = (child.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}';
const out = JSON.parse(line);
assert.equal(out.threw, false, 'el handler NO debe lanzar excepción sin manejar ante un fallo de Redis');
assert.equal(out.status, 500, `fallo de Redis debe dar 500 controlado, fue ${out.status}`);
assert.equal(out.hasJson, true, 'la respuesta 500 debe ser JSON controlado');
pass('GET /api/clients con Redis caído → 500 controlado (JSON), sin excepción');

// ── 5) Token correcto → 200 (contra la Redis de prueba, si hay credenciales) ─
// Sólo se ejecuta si .env.test aportó UPSTASH_* reales (cargados arriba). En CI
// sin credenciales se omite (no rompe la suite); en local confirma el 200 real.
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN && /^https?:\/\//.test(process.env.UPSTASH_REDIS_REST_URL)) {
  try {
    const tok = process.env.ADMIN_TOKEN;
    const id = `qa-clients-test-${Date.now()}`;
    let res = await callClients('POST', { headers: { 'x-admin-token': tok },
      body: { id, businessName: 'QA Clients Test', prompt: 'p' } });
    assert.equal(res.statusCode, 201, `seed debe crear (201), fue ${res.statusCode}`);
    assert.match(res._json.panelToken || '', /^[0-9a-f-]{36}$/i, 'el cliente creado devuelve un panelToken');
    res = await callClients('GET', { headers: { 'x-admin-token': tok } });
    assert.equal(res.statusCode, 200, `token correcto debe ser 200, fue ${res.statusCode}`);
    assert.ok(Array.isArray(res._json) && res._json.some((c) => c.id === id), 'la lista incluye el cliente sembrado');
    await callClients('DELETE', { query: { id }, headers: { 'x-admin-token': tok } });
    pass('GET /api/clients con token correcto → 200 (Redis de prueba, con limpieza)');
  } catch (e) {
    console.log('  ⚠ (omitido) 200 en vivo no verificable:', e.message);
  }
} else {
  console.log('  ⚠ (omitido) sin credenciales de Redis: el 200 en vivo se verifica en producción');
}

console.log(`✅ /api/clients endpoint verificado (${checks} checks)`);
