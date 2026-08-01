// Pruebas obligatorias del sistema de IDs estables de servicios.
// Ejecución real: importa lib/services.js tal cual, extrae y ejecuta el
// listener real de "Duplicar" desde admin.html (misma técnica que ya usa
// test/admin-spa-creator.test.mjs con normalizePhoneNumber), y prueba
// api/client-config.js/api/client-chat.js reales con Redis mockeado.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createServiceId, isValidServiceId, sanitizeServiceId,
  sanitizeServiceList, findServiceByLinkedItemId,
} from '../lib/services.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
};

console.log('1. Servicio nuevo sin id -> se genera uno');
{
  const out = sanitizeServiceList([{ nombre: 'Masaje', precio: '35', duracion: '45 min', descripcion: '' }], 40);
  ok(out.length === 1, 'devuelve el servicio');
  ok(isValidServiceId(out[0].id), `id generado con formato válido (${out[0].id})`);
  ok(out[0].nombre === 'Masaje' && out[0].precio === '35' && out[0].duracion === '45 min', 'nombre/precio/duracion intactos');
}

console.log('\n2. Servicio existente con id válido -> se conserva, no cambia');
{
  const idOriginal = 'svc_123456789abc';
  ok(isValidServiceId(idOriginal), 'el id de ejemplo es válido (control del test)');
  const out = sanitizeServiceList([{ id: idOriginal, nombre: 'Corte', precio: '20', duracion: '30', descripcion: '' }], 40);
  ok(out[0].id === idOriginal, `mismo id preservado (${out[0].id})`);
  // No debe regenerarse en llamadas repetidas (no "cada lectura crea uno nuevo").
  const out2 = sanitizeServiceList(out, 40);
  ok(out2[0].id === idOriginal, 'estable entre llamadas repetidas (no se regenera en cada lectura)');
}

console.log('\n3. Duplicar un servicio -> el duplicado pierde el id (recibe uno nuevo al guardar)');
{
  const html = readFileSync(join(root, 'admin.html'), 'utf8');
  const handlerMatch = html.match(/card\.querySelector\('\.svc-dup-btn'\)\.addEventListener\('click', \(\) => \{([\s\S]*?)\}\);/);
  ok(!!handlerMatch, 'se encontró el listener real de .svc-dup-btn en admin.html');

  // Ejecuta el cuerpo real del listener (sin reescribirlo) contra un
  // estado mínimo que imita state.services/idx/svc/formTouched/renderServices.
  const state = { services: [{ id: 'svc_111111111111', nombre: 'Masaje', precio: '35', duracion: '45', descripcion: '' }] };
  const idx = 0;
  const svc = state.services[0];
  let formTouched = false;
  let rendered = 0;
  const renderServices = () => { rendered++; };
  const fn = new Function('state', 'idx', 'svc', 'setFormTouched', 'renderServices', `
    ${handlerMatch[1]}
  `.replace('formTouched = true;', 'setFormTouched();'));
  fn(state, idx, svc, () => { formTouched = true; }, renderServices);

  ok(state.services.length === 2, 'se insertó una segunda tarjeta (duplicado)');
  ok(state.services[1].nombre === 'Masaje', 'el duplicado conserva el nombre');
  ok(state.services[1].id === undefined, 'el duplicado NO tiene id (el backend le asignará uno propio al guardar)');
  ok(state.services[0].id === 'svc_111111111111', 'el original conserva su id sin tocar');
  ok(formTouched === true && rendered === 1, 'dispara formTouched y renderServices, igual que antes');

  // El id nuevo que recibiría al guardar es distinto del original.
  const guardado = sanitizeServiceList(state.services, 40);
  ok(guardado[0].id === 'svc_111111111111', 'original: mismo id al guardar');
  ok(isValidServiceId(guardado[1].id) && guardado[1].id !== guardado[0].id, `duplicado: id NUEVO y distinto al guardar (${guardado[1].id})`);
}

console.log('\n4. Imagen antigua (linkedItemId = nombre) -> se encuentra por fallback a nombre');
{
  const items = [{ id: 'svc_1aaaaaaaaaaa', nombre: 'Masaje' }];
  const found = findServiceByLinkedItemId(items, 'Masaje');
  ok(found === items[0], 'encuentra el servicio aunque linkedItemId sea el nombre, no el id');
}

console.log('\n5. Imagen nueva (linkedItemId = id) -> se encuentra por id');
{
  const items = [{ id: 'svc_1aaaaaaaaaaa', nombre: 'Masaje' }];
  const found = findServiceByLinkedItemId(items, 'svc_1aaaaaaaaaaa');
  ok(found === items[0], 'encuentra el servicio por id directo');
}

console.log('\n6. createServiceId() — formato svc_<uuid sin guiones>');
{
  const a = createServiceId();
  const b = createServiceId();
  ok(isValidServiceId(a), `formato válido (${a})`);
  ok(!a.includes('-'), 'sin guiones');
  ok(a !== b, 'cada llamada genera un id distinto');
}

console.log('\n7. sanitizeServiceId() — reglas de preservar/generar');
{
  ok(sanitizeServiceId('svc_deadbeef0000') === 'svc_deadbeef0000', 'preserva un id ya válido');
  ok(isValidServiceId(sanitizeServiceId(undefined)), 'genera uno si no existe');
  ok(isValidServiceId(sanitizeServiceId('Masaje')), 'genera uno si lo que llega no tiene formato válido (nunca lo usa tal cual)');
}

console.log('\n8. sanitizeServiceList() — límite, limpieza de strings, descarta sin nombre');
{
  // El límite se aplica ANTES de filtrar por nombre (slice, luego filter):
  // un item sin nombre dentro del límite resta del conteo final, no se
  // reemplaza por el siguiente. Comportamiento existente, no de esta ronda.
  const conLimite = sanitizeServiceList([
    { nombre: 'A' }, { nombre: 'B' }, { nombre: 'C' },
  ], 2);
  ok(conLimite.length === 2 && conLimite[0].nombre === 'A' && conLimite[1].nombre === 'B',
    'respeta el límite (2), toma los primeros 2 del array de entrada');

  const sinNombreDentroDelLimite = sanitizeServiceList([{ nombre: '' }, { nombre: 'B' }], 2);
  ok(sinNombreDentroDelLimite.length === 1 && sinNombreDentroDelLimite[0].nombre === 'B',
    'descarta el servicio sin nombre (el límite ya se aplicó, no se compensa)');

  const out = sanitizeServiceList([{ nombre: 'A', imagen: 'data:image/png;base64,xxxx' }], 40);
  ok(out[0].imagen === '', 'rechaza data:base64 en imagen');
}

console.log('\n9. Rename de un servicio mantiene su imagen asociada (id nuevo "service" + legacy "menu")');
{
  process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'https://service-ids-test.redis';
  process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'service-ids-test-token';
  const redisStore = new Map();
  globalThis.fetch = async (url, options = {}) => {
    const command = new URL(url).pathname.split('/').filter(Boolean).pop();
    const args = JSON.parse(options.body || '[]');
    const execute = (entry) => {
      const [op, ...values] = entry;
      const o = String(op).toLowerCase();
      if (o === 'get') return redisStore.get(values[0]) ?? null;
      if (o === 'keys') { const p = String(values[0]).replace('*', ''); return [...redisStore.keys()].filter((k) => k.startsWith(p)); }
      if (o === 'mget') return values.map((k) => redisStore.get(k) ?? null);
      throw new Error(`Unsupported: ${op}`);
    };
    const result = command === 'pipeline' ? args.map((e) => ({ result: execute(e) })) : { result: execute(args) };
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  redisStore.set('client:svc-rename-test', JSON.stringify({
    businessName: 'Spa Rename Test', templateId: 'spa',
    menu: [
      { id: 'svc_renamedddddd', nombre: 'Nombre Nuevo Tras Rename', precio: '20', duracion: '30', descripcion: '' },
      { nombre: 'Manicure Legacy', precio: '15', duracion: '30', descripcion: '' }, // sin id: legacy
    ],
  }));
  // Asociación NUEVA: linkedType:'service', por id — sobrevive el rename porque el id no cambió.
  redisStore.set('client-images:svc-rename-test:clients/svc-rename-test/img1', JSON.stringify({
    publicId: 'clients/svc-rename-test/img1', imageUrl: 'https://x/nuevo.jpg', thumbnailUrl: 'https://x/nuevo-t.jpg',
    linkedType: 'service', linkedItemId: 'svc_renamedddddd', confirmed: true,
  }));
  // Asociación LEGACY: linkedType:'menu', por nombre — sigue funcionando sin id.
  redisStore.set('client-images:svc-rename-test:clients/svc-rename-test/img2', JSON.stringify({
    publicId: 'clients/svc-rename-test/img2', imageUrl: 'https://x/legacy.jpg', thumbnailUrl: 'https://x/legacy-t.jpg',
    linkedType: 'menu', linkedItemId: 'Manicure Legacy', confirmed: true,
  }));

  const { createClientConfigHandler } = await import('../api/client-config.js');
  const handler = createClientConfigHandler();
  let status, body;
  await handler({ method: 'GET', query: { id: 'svc-rename-test' } }, {
    setHeader() {}, status(c) { status = c; return this; }, json(b) { body = b; return this; },
  });
  ok(status === 200, 'GET /api/client-config -> 200');
  ok(body.menu[0].imagen === 'https://x/nuevo.jpg', 'imagen linkedType:"service" (por id) se resuelve tras el rename');
  ok(body.menu[1].imagen === 'https://x/legacy.jpg', 'imagen linkedType:"menu" legacy (por nombre) se sigue resolviendo');

  const { __test } = await import('../api/client-chat.js');
  const client = JSON.parse(redisStore.get('client:svc-rename-test'));
  const media = await __test.confirmedMedia('svc-rename-test', client);
  ok(media.menuItems.includes('Nombre Nuevo Tras Rename'), 'el chatbot ve el NOMBRE ACTUAL (post-rename) del servicio con imagen por id');
  ok(media.menuItems.includes('Manicure Legacy'), 'el chatbot también ve el servicio con imagen legacy por nombre');
}

if (failures) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('\nTodas las pruebas del sistema de IDs de servicios pasan.');
