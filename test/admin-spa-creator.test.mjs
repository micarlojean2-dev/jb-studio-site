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
for (const id of ['spa-name', 'spa-address', 'spa-phone', 'spa-email', 'spa-timezone', 'spa-hours', 'spa-services', 'spa-capacity', 'spa-buffer']) {
  assert.match(admin, new RegExp(`id="${id}"`), `missing ${id}`);
}
assert.match(admin, /Nombre \| Precio \| Duración/);
assert.match(admin, /templateId:'spa', templateVersion:'1\.0'/);
assert.match(admin, /languages:\['es','en'\], primaryLanguage:'es', language:'es', plan:'pro'/);
assert.match(admin, /reservationIntervalMinutes:15, minNoticeHours:0, holidays:\[\], displayMode:'fullscreen', widgetPosition:'bottom-right'/);
assert.match(admin, /\.spa-hours-row, \.spa-service-row/);
assert.match(admin, /SPA_PROMPT_BASE/);
console.log('Spa-only manual creator contract verified');
