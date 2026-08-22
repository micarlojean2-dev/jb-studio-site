import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = readFileSync(join(root, 'admin.html'), 'utf8');

assert.match(admin, /id="open-spa-creator-btn"[^>]*>\s*\+ Crear chatbot</);
assert.doesNotMatch(admin, />\+ Crear auto</);
assert.doesNotMatch(admin, /\/api\/generate-client-config/);
for (const id of ['spa-type', 'spa-name', 'spa-address', 'spa-phone-country', 'spa-phone-number', 'spa-email', 'spa-timezone', 'spa-hours', 'spa-services', 'spa-capacity', 'spa-buffer']) {
  assert.match(admin, new RegExp(`id="${id}"`), `missing ${id}`);
}
assert.match(admin, /Nombre \| Precio \| Duración/);
assert.match(admin, /reservationIntervalMinutes: 15, minNoticeHours: 0, holidays: \[\]/);
assert.match(admin, /\.spa-hours-row, \.spa-service-row/);

// ── Auditoría "creador multi plantilla": ya no es un formulario Spa-only ──
// El selector #spa-type ya no está deshabilitado ni trae una única opción
// fija; se puebla en runtime desde el registro oficial de plantillas
// (GET /api/clients?action=templates), la misma fuente de verdad que usa
// el backend — nunca una lista de nombres duplicada en el HTML.
assert.doesNotMatch(admin, /id="spa-type" class="admin-input" disabled/, 'spa-type ya no debe estar deshabilitado');
assert.doesNotMatch(admin, /<option value="spa">Spa<\/option>\s*<\/select>/, 'spa-type ya no debe traer una única opción "Spa" fija en el HTML');
assert.match(admin, /fetch\('\/api\/clients\?action=templates'/, 'el creador debe pedir la lista real de plantillas al backend');
assert.match(admin, /let TEMPLATES = \[\];/);
assert.match(admin, /let selectedTemplate = null;/);

const spaCreatorScriptMatch = admin.match(/<script>\s*\(\(\) => \{[\s\S]*?\}\)\(\);\s*<\/script>/);
assert.ok(spaCreatorScriptMatch, 'no se encontró el <script> del creador activo');
const spaCreatorScript = spaCreatorScriptMatch[0];

// El prompt ya NO se manda desde el navegador: el backend lo deriva de la
// plantilla oficial (api/clients.js, buildTemplatePrompt). Antes existía
// una constante SPA_PROMPT_BASE embebida — ese es exactamente el hueco de
// seguridad que se cerró.
assert.doesNotMatch(spaCreatorScript, /SPA_PROMPT_BASE/, 'ya no debe existir un prompt hardcodeado en el navegador');
assert.doesNotMatch(spaCreatorScript, /\bprompt\s*:/, 'el payload de creación ya no debe mandar prompt: el servidor lo deriva de la plantilla');
assert.doesNotMatch(spaCreatorScript, /businessType\s*:/, 'el payload ya no debe mandar businessType: el servidor lo fija desde templateId');
assert.doesNotMatch(spaCreatorScript, /templateId:\s*'spa'/, 'templateId ya no puede estar fijo a spa');
assert.match(spaCreatorScript, /templateId:\s*selectedTemplate\.id,\s*templateVersion:\s*selectedTemplate\.version/,
  'templateId/templateVersion deben venir de la plantilla realmente seleccionada, no de un literal');

// capacityPerSlot y bufferMinutes aplican a las 3 plantillas
// (api/reservations.js: "cuántas citas simultáneas admite el negocio" y
// bufferMinutesFor() que suma el tiempo de limpieza para cualquier tipo).
// Ambos deben mandarse siempre en el payload y el grupo del buffer debe
// quedar siempre visible, sin gating por plantilla.
assert.match(spaCreatorScript, /capacityPerSlot:\s*\+\$\('spa-capacity'\)\.value,[\s\S]{0,200}?bufferMinutes:\s*\+\$\('spa-buffer'\)\.value/,
  'capacityPerSlot y bufferMinutes deben ir siempre en el payload, sin gating por plantilla');
assert.match(admin, /id="spa-buffer-group"/, 'el grupo del buffer debe existir');
assert.doesNotMatch(admin, /\$\('spa-buffer-group'\)\.hidden = !isSpa/, 'el buffer ya no debe ocultarse para plantillas no-Spa');
assert.doesNotMatch(spaCreatorScript, /\.\.\.\(isSpa \? \{ bufferMinutes: \+\$\('spa-buffer'\)\.value \} : \{\}\)/, 'bufferMinutes ya no debe ir condicionado a isSpa');
assert.doesNotMatch(admin, /id="spa-capacity"[^>]*hidden|id="spa-reservas-section"/, 'la capacidad (y su sección) ya no deben poder ocultarse por completo');

// Duración de servicio: obligatoria y válida (misma gramática que el backend,
// no un chequeo numérico propio y más laxo) para Spa/Barbería, opcional para
// Restaurante (auditoría, "validación estricta de duraciones").
assert.match(spaCreatorScript, /const durationOk = isRestaurant \|\| isValidDurationMinutes\(service\.duracion\)/);
assert.match(spaCreatorScript, /const parseDurationMinutes = txt => \{/, 'el frontend debe reutilizar la misma gramática de duración que el backend, no un chequeo propio');

// Límites explícitos en el frontend (antes el backend los recortaba en
// silencio: sanitizeBusinessHours a 2 rangos/día, sanitizeServices a 40).
assert.match(spaCreatorScript, /const MAX_SERVICES = 40;/);
assert.match(spaCreatorScript, /const MAX_RANGES_PER_DAY = 2;/);

// XSS: los datos de un servicio (nombre/precio/duración, incluida la
// importación por texto pegado) ya no se insertan sin escapar en innerHTML.
assert.match(spaCreatorScript, /const esc = s =>/, 'falta el helper de escape HTML');
assert.match(spaCreatorScript, /value="\$\{esc\(service\.name\)\}"/, 'el nombre del servicio debe escaparse al insertarse en innerHTML');
assert.doesNotMatch(spaCreatorScript, /value="\$\{service\.name \|\| ''\}"/, 'ya no debe quedar la inserción sin escapar de service.name');

// "Fila vacía inicial": Importar lista debe limpiar filas vacías antes de agregar.
assert.match(spaCreatorScript, /if \(empty\) row\.remove\(\);/, 'Importar lista debe quitar filas de servicio vacías antes de importar');

// Errores del backend: si vienen fields específicos, deben mostrarse, no solo el mensaje genérico.
assert.match(spaCreatorScript, /client\.fields/, 'el manejo de errores debe leer client.fields, no solo client.error');

// Teléfono: la etiqueta debe aclarar que es el teléfono público del negocio.
assert.match(admin, /Teléfono del negocio \(lo verán tus clientes\)/, 'la etiqueta del teléfono debe aclarar que es pública/del negocio');

// ── Teléfono internacional: selector de país obligatorio, sin "US"/"+1" fijos ──
// (el wizard viejo inerte, en <script type="application/x-jb-legacy-wizard">,
// todavía contiene ese literal como código muerto — no se toca, así que este
// check se limita al bloque del creador activo, no a todo el archivo.
// spaCreatorScript ya se extrajo más arriba.)
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

// ── Buffer: select con opciones (0-60) y validación 0-240 ────────────────────
assert.match(admin, /<select id="spa-buffer"[^>]*>/, 'spa-buffer debe ser un select');
assert.match(admin, /option value="0">0 minutos/, 'spa-buffer debe ofrecer 0 minutos');
assert.match(admin, /option value="60">60 minutos/, 'spa-buffer debe ofrecer hasta 60 minutos');
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

console.log('Multi-template manual creator contract verified (static checks)');

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
