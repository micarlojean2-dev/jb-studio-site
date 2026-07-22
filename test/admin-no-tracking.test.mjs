// Privacidad del panel admin: admin.html NO debe cargar el Meta Pixel ni enviar
// nada a Facebook (PageView, clics de botones, títulos, cookies fbp/fbc). El
// pixel se conserva a propósito en las páginas públicas de ventas.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const pass = (m) => { checks++; console.log('  ✓', m); };

const admin = readFileSync(join(root, 'admin.html'), 'utf8');

// ── Meta Pixel ausente en admin.html ────────────────────────────────────────
const forbidden = ['connect.facebook.net', 'facebook.com/tr', 'fbevents.js', "fbq(", '1062633503132094'];
for (const needle of forbidden) {
  assert.ok(!admin.includes(needle), `admin.html no debe contener "${needle}" (fuga de datos a Facebook)`);
}
pass('admin.html no carga connect.facebook.net ni facebook.com/tr (sin Meta Pixel)');

// ── El pixel se conserva en las páginas públicas de ventas ──────────────────
// (Solo se comprueba en las que existan; el objetivo es no haberlo borrado de más.)
const publicPages = ['ventas.html', 'index.html', 'success.html', 'cancel.html'];
const present = publicPages.filter((p) => existsSync(join(root, p)) &&
  readFileSync(join(root, p), 'utf8').includes('connect.facebook.net'));
assert.ok(present.length > 0, 'el Meta Pixel debe seguir en al menos una página pública de ventas');
pass(`Meta Pixel conservado en páginas públicas: ${present.join(', ')}`);

// ── El wizard de creación NO prellena horarios inventados ───────────────────
// freshBusinessHours() debe iniciar todos los días sin habilitar y sin rangos,
// para que la validación (hasValidHours) obligue al admin a escribirlos.
const fresh = admin.match(/function freshBusinessHours\(\)\s*\{[\s\S]*?\n\s*\}/);
assert.ok(fresh, 'no se encontró freshBusinessHours()');
// Se comprueba la línea de código (DAYS.forEach), no los comentarios.
const freshCode = fresh[0].split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
assert.ok(/enabled:\s*false,\s*ranges:\s*\[\]/.test(freshCode),
  'freshBusinessHours() debe iniciar con enabled:false y ranges:[] (sin 09:00–19:00 inventado)');
assert.ok(!/\d{2}:\d{2}/.test(freshCode), 'freshBusinessHours() no debe prellenar horas en el código');
pass('wizard de creación arranca sin horarios prellenados (hasValidHours obliga al admin)');

console.log(`✅ admin sin tracking + sin horarios inventados (${checks} checks)`);
