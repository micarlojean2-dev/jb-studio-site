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
ok(/id="media-dropzone"/.test(html) && /id="media-file-input"[^>]*multiple/.test(html), 'bulk select and drop controls exist (galería general)');
// La asociación por selector se reemplazó por una tarjeta por servicio — el
// selector viejo no debe volver a aparecer (era la fuente del bug de
// asociaciones frágiles por nombre).
ok(!/id="media-association"/.test(html) && !/id="media-gallery"/.test(html), 'los selectores viejos de asociación ya no existen');
ok(/id="media-service-cards"/.test(html), 'existe el contenedor de la tabla por servicio (mismo id de siempre)');

console.log('2. Confirmed upload contract');
ok(/action=\$\{action\}/.test(html) && /request\('POST', 'upload'/.test(html), 'save requests signed upload instructions from /api/client-images');
ok(/'x-admin-token': token/.test(html) && /request\('POST', 'confirm'/.test(html), 'admin authentication and confirmation use the image API contract');
ok(/request\('PUT', '', \{ images: confirmed\.map/.test(html) && /confirmedMedia = confirmedMedia\.concat\(confirmed\)/.test(html), 'associations and gallery update happen only after confirmation (galería general)');
ok(/linkedType: 'gallery', linkedItemId: null/.test(html), 'la galería general asocia siempre con linkedType:gallery, sin selector');

console.log('3. Service photo table');
ok(/function serviceItems\(client\)/.test(html), 'existe serviceItems() — misma fuente que usan client-config.js/client-chat.js (services, si no menu)');
ok(/function findServiceImage\(item\)/.test(html) && /item\.id && confirmedMedia\.find/.test(html), 'findServiceImage() prioriza id sobre nombre, igual que el backend');
ok(/function renderServiceImageTable\(client\)/.test(html), 'existe renderServiceImageTable() (reemplaza a la antigua renderServiceCards())');
ok(!/function renderServiceCards\(/.test(html), 'la vieja renderServiceCards() ya no existe (renombrada, no duplicada)');
ok(/async function uploadServicePhoto\(client, item, file, btn\)/.test(html), 'existe uploadServicePhoto() — sin flujo nuevo, se reutiliza tal cual');
ok(/linkedType: 'service', linkedItemId: item\.id/.test(html), 'la foto de un servicio se asocia con linkedType:"service" y linkedItemId = item.id (no el nombre)');
ok(/linkedType === 'service' \|\| image\.linkedType === 'menu'/.test(html), 'al leer, sigue aceptando linkedType:"menu" legacy además del nuevo "service"');
ok(/method: 'DELETE'/.test(html) && /previous\.publicId/.test(html), 'al reemplazar la foto de un servicio se borra la anterior DESPUÉS de asociar la nueva (Cloudinary + Redis)');
ok(html.indexOf(`const [associatedImage] = await request('PUT'`) < html.indexOf(`previous.publicId`),
  'el orden real del código es: subir/asociar primero, borrar la anterior después (nunca al revés)');

console.log('4. Delete service photo');
ok(/async function deleteServicePhoto\(client, item, image, btn\)/.test(html), 'existe deleteServicePhoto()');
ok(/window\.confirm\(`¿Eliminar la foto de/.test(html), 'deleteServicePhoto() pide confirmación antes de borrar');
ok(/deleteServicePhoto[\s\S]{0,600}method: 'DELETE'/.test(html), 'deleteServicePhoto() usa DELETE /api/client-images, mismo contrato que el reemplazo de foto');
ok(/deleteServicePhoto[\s\S]{0,600}clientId=\$\{encodeURIComponent\(client\.id\)\}&publicId=\$\{encodeURIComponent\(image\.publicId\)\}/.test(html),
  'deleteServicePhoto() usa client.id + image.publicId, igual que el resto del flujo de imágenes');
ok(/deleteServicePhoto[\s\S]{0,800}confirmedMedia = confirmedMedia\.filter\(entry => entry !== image\)/.test(html),
  'deleteServicePhoto() actualiza confirmedMedia en memoria tras borrar');
ok(/deleteServicePhoto[\s\S]{0,1000}renderServiceImageTable\(client\)/.test(html), 'deleteServicePhoto() vuelve a renderizar la tabla tras borrar');
// No debe tocar la fuente de servicios: solo el estado de imágenes.
{
  const fnMatch = html.match(/async function deleteServicePhoto\(client, item, image, btn\) \{([\s\S]*?)\n    \}/);
  ok(!!fnMatch, 'se pudo extraer el cuerpo completo de deleteServicePhoto()');
  ok(fnMatch && !/client\.services\s*=/.test(fnMatch[1]) && !/client\.menu\s*=/.test(fnMatch[1]),
    'deleteServicePhoto() nunca reasigna client.services ni client.menu');
}

console.log('5. Table works generically across templates (no per-vertical branching)');
{
  const fnMatch = html.match(/function renderServiceImageTable\(client\) \{([\s\S]*?)\n    \}/);
  ok(!!fnMatch, 'se pudo extraer el cuerpo completo de renderServiceImageTable()');
  ok(fnMatch && !/templateId\s*===/.test(fnMatch[1]), 'renderServiceImageTable() no ramifica por templateId (spa/barber/restaurant genérico vía serviceItems())');
  ok(fnMatch && /serviceItems\(client\)/.test(fnMatch[1]), 'obtiene los servicios exclusivamente vía serviceItems(client)');
}

console.log('6. QR controls');
ok(/src="\/assets\/qrcode\.min\.js"/.test(html), 'QR generator is served locally under the production CSP');
ok(/id="copy-qr-url-btn"/.test(html) && /id="download-qr-btn"/.test(html) && /id="print-qr-btn"/.test(html), 'copy, download, and print controls exist');

if (failures) { console.error(`❌ ${failures} assertion(s) failed`); process.exit(1); }
console.log('✅ Admin gallery and QR UI contract verified');
