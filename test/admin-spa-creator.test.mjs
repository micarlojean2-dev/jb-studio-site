import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = readFileSync(join(root, 'admin.html'), 'utf8');

assert.match(admin, /id="open-spa-creator-btn"[^>]*>\s*\+ Crear chatbot</);
assert.doesNotMatch(admin, />\+ Crear auto</);
assert.doesNotMatch(admin, /\/api\/generate-client-config/);
assert.match(admin, /id="spa-type"[\s\S]*?<option value="spa">Spa<\/option>/);
for (const id of ['spa-name', 'spa-address', 'spa-phone-country', 'spa-phone-number', 'spa-email', 'spa-timezone', 'spa-hours', 'spa-services', 'spa-capacity', 'spa-buffer']) {
  assert.match(admin, new RegExp(`id="${id}"`), `missing ${id}`);
}
assert.match(admin, /Nombre \| Precio \| Duración/);
assert.match(admin, /templateId:'spa', templateVersion:'1\.0'/);
assert.match(admin, /languages:\['es','en'\], primaryLanguage:'es', language:'es', plan:'pro'/);
assert.match(admin, /reservationIntervalMinutes:15, minNoticeHours:0, holidays:\[\], displayMode:'fullscreen', widgetPosition:'bottom-right'/);
assert.match(admin, /\.spa-hours-row, \.spa-service-row/);
assert.match(admin, /SPA_PROMPT_BASE/);

// ── Teléfono internacional: selector de país obligatorio, sin "US"/"+1" fijos ──
// (el wizard viejo inerte, en <script type="application/x-jb-legacy-wizard">,
// todavía contiene ese literal como código muerto — no se toca, así que este
// check se limita al bloque del creador Spa activo, no a todo el archivo.)
const spaCreatorScriptMatch = admin.match(/<script>\s*\(\(\) => \{[\s\S]*?\}\)\(\);\s*<\/script>/);
assert.ok(spaCreatorScriptMatch, 'no se encontró el <script> del creador Spa activo');
const spaCreatorScript = spaCreatorScriptMatch[0];
assert.doesNotMatch(spaCreatorScript, /phoneCountry:\s*'US'\s*,/, 'phoneCountry ya no puede ser un literal fijo en el payload del creador Spa');
assert.doesNotMatch(spaCreatorScript, /phoneCountryCode:\s*'\+1'\s*,/, 'phoneCountryCode ya no puede ser un literal fijo en el payload del creador Spa');
for (const code of ['US|+1', 'CA|+1', 'MX|+52', 'CL|+56', 'AR|+54', 'CO|+57', 'PE|+51', 'BR|+55', 'ES|+34', 'GB|+44']) {
  assert.match(admin, new RegExp(`value="${code.replace('+', '\\+')}"`), `missing phone option ${code}`);
}
// Estados Unidos y Canadá deben ser dos opciones independientes, no una
// combinada — antes un negocio canadiense se guardaba con phoneCountry:"US".
assert.doesNotMatch(admin, /Estados Unidos \/ Canadá/, 'ya no debe existir la opción combinada "Estados Unidos / Canadá"');
assert.match(admin, /<option value="US\|\+1">Estados Unidos \+1<\/option>/, 'falta la opción independiente de Estados Unidos');
assert.match(admin, /<option value="CA\|\+1">Canadá \+1<\/option>/, 'falta la opción independiente de Canadá');
assert.match(spaCreatorScript, /normalizePhoneNumber/);
// El payload construido en el submit debe usar las 3 variables calculadas
// (phoneCountry, phoneCountryCode, phoneNumber), no literales.
assert.match(spaCreatorScript, /payload = \{[\s\S]*?\bphoneCountry\b[\s\S]*?\bphoneCountryCode\b[\s\S]*?\bphoneNumber\b/,
  'el objeto payload debe incluir phoneCountry, phoneCountryCode y phoneNumber');

// ── Buffer: 0-240, con los 3 atributos HTML exactos ──────────────────────────
assert.match(admin, /id="spa-buffer"[^>]*min="0"/, 'falta min="0" en spa-buffer');
assert.match(admin, /id="spa-buffer"[^>]*max="240"/, 'falta max="240" en spa-buffer');
assert.match(admin, /id="spa-buffer"[^>]*step="1"/, 'falta step="1" en spa-buffer');
assert.match(admin, /\+v <= 240/);

// ── Botón desactivado: valores CSS exactos, no solo "la palabra existe" ──────
// Se extrae el bloque de la regla y se comprueban las 3 propiedades una por
// una (no una única regex laxa) para no dejar pasar un valor distinto al
// documentado si alguien edita la regla más adelante.
const disabledRuleMatch = admin.match(/#spa-create:disabled\s*\{([^}]*)\}/);
assert.ok(disabledRuleMatch, 'no se encontró la regla #spa-create:disabled');
const disabledRuleBody = disabledRuleMatch[1];
assert.match(disabledRuleBody, /opacity:\s*1;/, 'opacity debe ser 1, no una opacidad reducida');
assert.match(disabledRuleBody, /color:\s*#f3f7f4;/, 'falta el color de texto visible');
assert.match(disabledRuleBody, /background:\s*#3d5a49;/, 'falta el fondo específico del botón desactivado');
assert.match(disabledRuleBody, /cursor:\s*not-allowed;/);
assert.doesNotMatch(disabledRuleBody, /opacity:\s*0\.6/, 'no debe reutilizar la opacity reducida de .action-btn');
// La regla compartida .action-btn:disabled sigue intacta — ningún otro botón cambia.
assert.match(admin, /\.action-btn:disabled\s*\{\s*opacity:\s*0\.6;\s*cursor:\s*not-allowed;\s*\}/,
  '.action-btn:disabled no debe tocarse: así se confirma que ningún otro botón del panel cambió');

console.log('Spa-only manual creator contract verified (static checks)');

// ── Ejecución real de normalizePhoneNumber, extraída tal cual del archivo ───
// No se reimplementa la función: se recorta el bloque exacto del código
// fuente de admin.html y se ejecuta con `new Function`, así esta prueba se
// rompe si alguien cambia el comportamiento real sin actualizar el test.
const fnMatch = spaCreatorScript.match(/function normalizePhoneNumber\(dialCode, raw\) \{[\s\S]*?\n  \}/);
assert.ok(fnMatch, 'no se encontró la función normalizePhoneNumber en el creador Spa activo');
const normalizePhoneNumber = new Function(`${fnMatch[0]}\nreturn normalizePhoneNumber;`)();

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
};

console.log('normalizePhoneNumber() — ejecutado en vivo desde el código extraído de admin.html');
ok(normalizePhoneNumber('+1', '1234567890') === '1234567890',
  'US +1 local que empieza en "1" conserva TODOS sus dígitos (antes se comía el primero)');
ok(normalizePhoneNumber('+1', '+11234567890') === '1234567890',
  'US +1 completo con "+" se deduplica correctamente a 10 dígitos');
// Canadá comparte código de marcado (+1) con EE. UU. — la misma lógica de
// dedupe debe funcionar igual para el país recién separado en el selector.
ok(normalizePhoneNumber('+1', '14165551234') === '14165551234',
  'CA +1 local que empieza en "1" conserva TODOS sus dígitos (número local, sin "+" ni "00")');
ok(normalizePhoneNumber('+1', '+114165551234') === '14165551234',
  'CA +1 completo con "+" se deduplica correctamente');
ok(normalizePhoneNumber('+56', '912345678') === '912345678',
  'Chile local: no se recorta nada (no empieza con "+" ni "00")');
ok(normalizePhoneNumber('+56', '+56912345678') === '912345678',
  'Chile completo con "+": se recorta el código pegado, sin duplicarlo');
ok(normalizePhoneNumber('+52', '525512345678') === '525512345678',
  'México: número local sin "+" ni "00" que por casualidad empieza con "52" se trata como local, no se recorta');
ok(normalizePhoneNumber('+56', '0056912345678') === '912345678',
  'Chile con prefijo "00" explícito también se reconoce como internacional y se recorta');
if (failures) { console.error(`${failures} fallo(s) en normalizePhoneNumber`); process.exit(1); }
