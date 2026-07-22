// Static admin media regression: no network or storage access.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'admin.html'), 'utf8');
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
};

console.log('1. Gallery controls');
ok(/id="mg-media"/.test(html), 'client management exposes the gallery action');
ok(/id="media-dropzone"/.test(html) && /id="media-file-input"[^>]*multiple/.test(html), 'bulk select and drop controls exist');
ok(/id="media-association"/.test(html) && /id="media-gallery"/.test(html), 'association selectors exist');

console.log('2. Confirmed upload contract');
ok(/action=\$\{action\}/.test(html) && /request\('POST', 'upload'/.test(html), 'save requests signed upload instructions from /api/client-images');
ok(/'x-admin-token': token/.test(html) && /request\('POST', 'confirm'/.test(html), 'admin authentication and confirmation use the image API contract');
ok(/request\('PUT', '', \{ images: confirmed\.map/.test(html) && /confirmedMedia = confirmedMedia\.concat\(confirmed\)/.test(html), 'associations and gallery update happen only after confirmation');

console.log('3. QR controls');
ok(/src="\/assets\/qrcode\.min\.js"/.test(html), 'QR generator is served locally under the production CSP');
ok(/id="copy-qr-url-btn"/.test(html) && /id="download-qr-btn"/.test(html) && /id="print-qr-btn"/.test(html), 'copy, download, and print controls exist');

if (failures) { console.error(`❌ ${failures} assertion(s) failed`); process.exit(1); }
console.log('✅ Admin gallery and QR UI contract verified');
