// Prueba de regresión del login del admin.
// Carga el admin.html REAL en un DOM (jsdom), ejecuta sus scripts tal cual y
// verifica que el bug "Cannot read properties of null (reading 'addEventListener')"
// no vuelva: ese error abortaba la IIFE antes de registrar el listener del
// botón de acceso. Requiere jsdom (dev): npm install --no-save jsdom
// Ejecutar: node test/admin-login.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'admin.html'), 'utf8');

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); fallos++; } };
const flush = () => new Promise((r) => setTimeout(r, 0));

// ── Captura de errores de consola/JS durante la carga ────────────────────────
const errores = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errores.push(String(e && (e.detail || e.message || e))));
vc.on('error', (...a) => errores.push(a.map(String).join(' ')));

// ── fetch simulado: por defecto responde como token válido ([]). Cada prueba
//    lo reconfigura. Nunca toca la red. ────────────────────────────────────
let fetchResponder = () => ({ ok: true, status: 200, json: async () => [] });
const fetchCalls = [];
function fakeFetch(url, opts) {
  fetchCalls.push({ url: String(url), opts });
  const r = fetchResponder(url, opts);
  return Promise.resolve({ ok: r.ok, status: r.status, json: r.json, text: async () => '' });
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://jbstudio.app/admin',
  virtualConsole: vc,
  beforeParse(win) {
    win.fetch = fakeFetch;
    // APIs de navegador que jsdom no trae y que algún script podría tocar.
    win.matchMedia = win.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    win.IntersectionObserver = win.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
    win.ResizeObserver = win.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    win.scrollTo = win.scrollTo || (() => {});
  },
});
const { window } = dom;
const { document } = window;
const $ = (id) => document.getElementById(id);

console.log('1. Carga sin el error de regresión');
const nullAddEvt = errores.filter((e) => /Cannot read properties of null \(reading 'addEventListener'\)/.test(e));
ok(nullAddEvt.length === 0, 'cero errores "Cannot read properties of null (reading \'addEventListener\')"');
const nullAny = errores.filter((e) => /Cannot read properties of null/.test(e));
ok(nullAny.length === 0, 'cero errores "Cannot read properties of null" de cualquier tipo');
ok(!errores.some((e) => /setup-add-email/.test(e)), 'ningún error menciona setup-add-email');

console.log('2. La IIFE principal terminó de ejecutarse');
// __jbAdmin se define al final de la IIFE (después del listener del login).
// Si la IIFE hubiera abortado en 3145, esto no existiría.
ok(window.__jbAdmin && typeof window.__jbAdmin.getToken === 'function', 'window.__jbAdmin quedó expuesto (IIFE completa)');

console.log('3. El botón de acceso tiene su listener');
ok(!!$('login-btn'), 'existe #login-btn');
ok($('token-input').getAttribute('autocomplete') === 'new-password', 'el navegador no reutiliza una contraseña guardada');
fetchCalls.length = 0;
fetchResponder = () => ({ ok: true, status: 200, json: async () => [] });
$('token-input').value = 'probe-token';
$('login-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flush();
ok(fetchCalls.some((c) => c.url.includes('/api/clients')), 'un click en el botón dispara la llamada de login (listener activo)');

console.log('4. Contraseña correcta entra al panel');
// reset visual
$('login-screen').style.display = '';
$('admin-panel').style.display = '';
fetchResponder = (url, opts) => {
  const t = opts && opts.headers && opts.headers['x-admin-token'];
  return t === 'good' ? { ok: true, status: 200, json: async () => [] } : { ok: false, status: 401, json: async () => ({}) };
};
window.localStorage.setItem('jb_admin_token', 'old-saved-token');
window.sessionStorage.setItem('admin_token', 'old-saved-token');
$('token-input').value = 'good';
$('login-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flush(); await flush();
ok($('login-screen').style.display === 'none', 'oculta la pantalla de login');
ok($('admin-panel').style.display === 'block', 'muestra el panel de admin');
ok(fetchCalls.at(-1).opts.headers['x-admin-token'] === 'good', 'una contraseña nueva escrita gana sobre un token viejo guardado');

console.log('5. Salir elimina la sesión en memoria');
$('logout-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(window.__jbAdmin.getToken() === '', 'Salir borra el token de la sesión');
ok($('token-input').value === '', 'Salir vacía el campo de token');
ok($('login-screen').style.display === 'flex', 'Salir muestra la pantalla de login');
ok($('admin-panel').style.display === 'none', 'Salir oculta el panel de admin');

console.log('6. Contraseña incorrecta después de Salir limpia credenciales viejas');
$('login-error').style.display = 'none';
$('login-error').textContent = '';
window.localStorage.setItem('jb_admin_token', 'old-saved-token');
window.sessionStorage.setItem('admin_token', 'old-saved-token');
$('token-input').value = 'wrong';
$('login-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flush(); await flush();
ok($('login-error').style.display === 'block', 'muestra el mensaje de error');
ok($('login-error').textContent === 'Contraseña incorrecta.', 'el mensaje de error dice "Contraseña incorrecta"');
ok($('admin-panel').style.display !== 'block', 'NO entra al panel con token inválido');
ok(window.__jbAdmin.getToken() === '', 'un token inválido no restaura el token anterior');
ok($('token-input').value === '', '401 vacía el campo para obligar a escribir una contraseña nueva');
ok(window.localStorage.getItem('jb_admin_token') === null && window.sessionStorage.getItem('admin_token') === null,
  '401 elimina tokens heredados guardados');

console.log('7. Una contraseña nueva entra después de un 401');
$('token-input').value = 'good';
$('login-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flush(); await flush();
ok($('admin-panel').style.display === 'block', 'la contraseña nueva abre el panel después de limpiar el token viejo');

console.log('8. El resto del admin sigue presente');
// Elementos clave de otras secciones (modal de gestión, creador) siguen en el DOM.
ok(!!$('setup-add-email'), 'el botón del modal de setup existe en el DOM');
ok(!!$('add-menu-item') && !!$('mg-view-bot'), 'otras secciones (form y modal de gestión) intactas');

console.log('');
if (fallos) { console.error(`❌ ${fallos} aserción(es) fallaron`); process.exit(1); }
console.log('✅ Login del admin verificado: sin error de null y con el flujo completo');
