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
  // Asking for photos no longer forces the whole service catalog open, and
  // asking for the catalog no longer requires also asking for photos: each
  // marker controls its own block. [BUG-FOTOS-GALERIA]
  assert.match(source, /if \(showMenu\) renderMenu\(\);/, `${file} renders the catalog only on its own trigger`);
  assert.match(source, /if \(showGallery\) renderGallery\(\);/, `${file} renders confirmed media only on its own trigger`);

  // Regression: "estaAlFondo" measures against the CURRENT scrollHeight, so
  // right after a tall gallery block grows the container, a customer who was
  // at the bottom of the text reply no longer reads as "at the bottom" of the
  // new, taller total — the passive/smart scroll refused to move and the
  // gallery rendered completely out of view below the fold. This is a direct
  // reaction to the customer's own message (same as addMsg's role==='user'
  // case), so it must always force the scroll, not ask permission.
  // [BUG-SCROLL-GALERIA]
  const galleryFn = source.match(/function renderGallery\(\)[\s\S]*?\n  \}/)[0];
  assert.equal((galleryFn.match(/irAlFondo\(msgsEl, true\)/g) || []).length, 2,
    `${file} renderGallery() forces the scroll into view (initial render and "ver más fotos")`);
  const menuFn = source.match(/function renderMenu\(\)[\s\S]*?\n  \}/)[0];
  assert.match(menuFn, /irAlFondo\(msgsEl, true\)/,
    `${file} renderMenu() forces the scroll into view`);
}
console.log('Public assistants render confirmed gallery previews on the menu trigger');
