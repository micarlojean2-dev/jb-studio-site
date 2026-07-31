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

// Teléfono internacional: selector de país obligatorio, sin "US"/"+1" fijos.
assert.doesNotMatch(admin, /phoneCountry:'US', phoneCountryCode:'\+1'/);
for (const code of ['US|+1', 'MX|+52', 'CL|+56', 'AR|+54', 'CO|+57', 'PE|+51', 'BR|+55', 'ES|+34', 'GB|+44']) {
  assert.match(admin, new RegExp(`value="${code.replace('+', '\\+')}"`), `missing phone option ${code}`);
}
assert.match(admin, /normalizePhoneNumber/);

// Buffer: 0-240 en frontend, ya no limitado a 0/15/30/45.
assert.match(admin, /id="spa-buffer"[^>]*max="240"/);
assert.match(admin, /\+v <= 240/);

// Botón desactivado: regla propia por ID, no opacity reducida sobre .action-btn.
assert.match(admin, /#spa-create:disabled\s*\{[^}]*opacity:\s*1;/);
assert.doesNotMatch(admin, /#spa-create:disabled\s*\{[^}]*opacity:\s*0\.6/);

console.log('Spa-only manual creator contract verified');
