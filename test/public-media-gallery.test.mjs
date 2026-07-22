import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['asistente.html', 'widget.js']) {
  const source = readFileSync(join(root, file), 'utf8');
  assert.match(source, /cfg\.media && Array\.isArray\(cfg\.media\.gallery\)/, `${file} uses only the public gallery projection`);
  assert.match(source, /var shown = 4;/, `${file} initially limits the gallery to four images`);
  assert.match(source, /Ver más fotos/, `${file} includes a see-more affordance`);
  assert.match(source, /if \(showMenu\) \{ renderMenu\(\); renderGallery\(\); \}/, `${file} renders confirmed media only on the menu trigger`);
}
console.log('Public assistants render confirmed gallery previews on the menu trigger');
