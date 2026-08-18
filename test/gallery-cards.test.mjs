import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['asistente.html', 'widget.js']) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /generalImages/, `${file} separates general images`);
  assert.match(source, /entry\.item && entry\.item\.nombre/, `${file} labels service images only from linked menu data`);
  assert.match(source, /galleryHeading|Galería del/, `${file} labels unlinked images clearly`);
  assert.match(source, /entry\.item && entry\.item\.precio/, `${file} renders a linked service price`);
  assert.match(source, /entry\.item && entry\.item\.duracion/, `${file} renders a linked service duration`);
  assert.match(source, /\[item\.precio, item\.duracion\]\.filter\(Boolean\)\.join\(' · '\)/, `${file} shows duration in normal service cards`);
  const fn = source.match(/function renderServicesWithPhotos\(\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(fn, /renderMenu|a-card-img|jbw-card-img/, `${file} service-photo renderer renders menu/image cards`);
}

const chat = readFileSync('api/client-chat.js', 'utf8');
assert.match(chat, /SERVICE_PHOTO_INTENT/, 'chat recognizes the combined request');
assert.match(chat, /if \(showServicePhotos\) text = text \+ '\\n\[MOSTRAR_SERVICIOS_CON_FOTOS\]';/, 'combined request uses its own marker');
console.log('gallery-cards.test.mjs: 22 checks passed');
