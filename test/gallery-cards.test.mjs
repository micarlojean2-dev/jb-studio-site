import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['asistente.html', 'widget.js']) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /generalImages/, `${file} separates general images`);
  assert.match(source, /entry\.item && entry\.item\.nombre/, `${file} labels service images only from linked menu data`);
  assert.match(source, /Galería del Spa/, `${file} labels unlinked images clearly`);
  assert.match(source, /entry\.item && entry\.item\.precio/, `${file} renders a linked service price`);
  assert.match(source, /entry\.item && entry\.item\.duracion/, `${file} renders a linked service duration`);
}

const chat = readFileSync('api/client-chat.js', 'utf8');
assert.match(chat, /SERVICE_PHOTO_INTENT/, 'chat recognizes the combined request');
assert.match(chat, /if \(showServicePhotos\) text = text \+ '\\n\[MOSTRAR_MENU\]';/, 'combined request uses the normal menu marker');
for (const file of ['asistente.html', 'widget.js']) {
  assert.doesNotMatch(readFileSync(file, 'utf8'), /renderServicesWithPhotos/, `${file} has no positional service-photo renderer`);
}

console.log('gallery-cards.test.mjs: 13 checks passed');
