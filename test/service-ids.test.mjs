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
  sanitizeServiceList, findServiceByLinkedItemId, assignUniqueServiceIds,
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

console.log('\n10. sanitizeServiceList() — ids duplicados en el mismo array se regeneran');
{
  const idCompartido = 'svc_deadbeef0001'; // hex válido (d,e,a,d,b,e,e,f)
  const out = sanitizeServiceList([
    { id: idCompartido, nombre: 'Masaje' },
    { id: idCompartido, nombre: 'Manicure' },
    { nombre: 'Pedicure' },
  ], 40);
  ok(out.length === 3, 'devuelve los 3 servicios');
  ok(out[0].id === idCompartido, 'el primero conserva el id original');
  ok(isValidServiceId(out[1].id) && out[1].id !== idCompartido, `el duplicado recibe un id NUEVO (${out[1].id})`);
  ok(isValidServiceId(out[2].id), 'el tercero (sin id) recibe uno propio, válido');
  const ids = out.map((s) => s.id);
  ok(new Set(ids).size === ids.length, 'los 3 ids finales son todos distintos entre sí');
}

console.log('\n11. migrate-service-ids.mjs: migrateClient() — legacy menu-only se promueve a services+menu');
{
  const { migrateClient } = await import('../scripts/migrate-service-ids.mjs');

  // Cliente legacy: sin services, con menu sin ids.
  const legacyClient = {
    businessName: 'Spa Legacy',
    menu: [
      { nombre: 'Masaje', precio: '35', duracion: '45', descripcion: '' },
      { nombre: 'Manicure', precio: '15', duracion: '30', descripcion: '' },
    ],
  };
  const r1 = migrateClient(legacyClient);
  ok(r1.changed === true, 'detecta que el cliente legacy necesita migración');
  ok(r1.wasLegacy === true, 'lo marca como legacy (venía sin services)');
  ok(Array.isArray(r1.updatedClient.services) && r1.updatedClient.services.length === 2, 'crea client.services con los 2 items');
  ok(r1.updatedClient.services.every((s) => isValidServiceId(s.id)), 'todos los services migrados tienen id válido');
  ok(Array.isArray(r1.updatedClient.menu) && r1.updatedClient.menu.length === 2, 'client.menu queda derivado, con 2 items');
  ok(r1.updatedClient.menu[0].id === r1.updatedClient.services[0].id && r1.updatedClient.menu[1].id === r1.updatedClient.services[1].id,
    'services y menu comparten exactamente los mismos ids, en el mismo orden');
  ok(legacyClient.menu[0].id === undefined, 'el objeto original no se muta (migrateClient devuelve uno nuevo)');

  // Caso exacto de la auditoría: menu-only con id YA válido -> debe
  // promoverse a services igual, SIN regenerar el id (changed:true por la
  // promoción estructural, no porque falte un id).
  const legacyConIdValido = {
    businessName: 'Spa Legacy Con Id',
    menu: [{ id: 'svc_abc123abc123', nombre: 'Masaje' }],
  };
  const r1b = migrateClient(legacyConIdValido);
  ok(r1b.changed === true, 'changed:true aunque el id ya sea válido — falta crear services');
  ok(r1b.wasLegacy === true, 'se marca como legacy');
  ok(r1b.updatedClient.services.length === 1 && r1b.updatedClient.services[0].id === 'svc_abc123abc123',
    'services se crea preservando el id existente, sin regenerarlo');
  ok(r1b.updatedClient.menu.length === 1 && r1b.updatedClient.menu[0].id === 'svc_abc123abc123',
    'menu queda derivado con el mismo id');
  ok(r1b.faltantesCount === 0, 'ningún id se regeneró (0 ids nuevos): el cambio es solo estructural (promoción)');

  // Cliente ya migrado (services con ids válidos): no debe tocarse nada.
  const yaMigrado = {
    businessName: 'Spa Al Día',
    services: [{ id: 'svc_abc123abc123', nombre: 'Corte', precio: '20', duracion: '30', descripcion: '' }],
    menu: [{ id: 'svc_abc123abc123', nombre: 'Corte', precio: '20', duracion: '30', descripcion: '' }],
  };
  const r2 = migrateClient(yaMigrado);
  ok(r2.changed === false, 'cliente con todos los ids válidos no necesita cambios');
  ok(r2.updatedClient === yaMigrado, 'devuelve el mismo objeto, sin copiarlo, cuando no hay nada que migrar');

  // Cliente no-legacy con services mezclando ids válidos e inválidos.
  const mixto = {
    businessName: 'Spa Mixto',
    services: [
      { id: 'svc_facade000001', nombre: 'Facial', precio: '40', duracion: '60', descripcion: '' },
      { nombre: 'Depilación', precio: '25', duracion: '20', descripcion: '' },
    ],
    menu: [],
  };
  const r3 = migrateClient(mixto);
  ok(r3.changed === true && r3.wasLegacy === false, 'cliente con services (aunque incompletos) no se cuenta como legacy');
  ok(r3.updatedClient.services[0].id === 'svc_facade000001', 'conserva el id ya válido tal cual');
  ok(isValidServiceId(r3.updatedClient.services[1].id), 'genera id nuevo solo para el que faltaba');
  ok(r3.updatedClient.menu.map((m) => m.id).join(',') === r3.updatedClient.services.map((s) => s.id).join(','),
    'menu queda como espejo exacto de services, mismo orden e ids');
}

console.log('\n12. admin.html: uploadServicePhoto() bloquea si el servicio no tiene id');
{
  const html = readFileSync(join(root, 'admin.html'), 'utf8');
  const guardMatch = html.match(/if \(!item\.id\) \{\n([\s\S]*?)\n {6}\}/);
  ok(!!guardMatch, 'se encontró el guard real de item.id en uploadServicePhoto()');

  const runGuard = (item) => {
    let message = null;
    let reachedFetch = false;
    const showServiceMediaMessage = (text, isOk) => { message = { text, isOk }; };
    // Ejecuta el bloque real tal cual está en admin.html: si dispara
    // `return`, el Function simplemente termina ahí (mismo comportamiento
    // que dentro de uploadServicePhoto).
    const wrapped = new Function('item', 'showServiceMediaMessage', 'markReached', `
      if (!item.id) {
      ${guardMatch[1]}
      }
      markReached();
    `);
    wrapped(item, showServiceMediaMessage, () => { reachedFetch = true; });
    return { message, reachedFetch };
  };

  const sinId = runGuard({ nombre: 'Masaje' });
  ok(sinId.message && sinId.message.isOk === false, 'servicio sin id: muestra un mensaje de error');
  ok(sinId.message.text.includes('Masaje') && sinId.message.text.toLowerCase().includes('id estable'), 'el mensaje nombra el servicio y explica que falta el id estable');
  ok(sinId.reachedFetch === false, 'servicio sin id: NUNCA llega al código que haría la subida (linkedItemId undefined)');

  const conId = runGuard({ id: 'svc_111111111111', nombre: 'Masaje' });
  ok(conId.message === null, 'servicio con id: no muestra ningún mensaje de bloqueo');
  ok(conId.reachedFetch === true, 'servicio con id: sigue de largo hacia el flujo normal de subida');
}

console.log('\n13. migrate-service-ids.mjs: migrateClient() — ids duplicados YA persistidos en services se corrigen');
{
  const { migrateClient } = await import('../scripts/migrate-service-ids.mjs');
  const idDuplicado = 'svc_deadbeef0001';
  const client = {
    businessName: 'Spa Duplicado',
    services: [
      { id: idDuplicado, nombre: 'Masaje' },
      { id: idDuplicado, nombre: 'Facial' },
    ],
    menu: [
      { id: idDuplicado, nombre: 'Masaje' },
      { id: idDuplicado, nombre: 'Facial' },
    ],
  };
  const r = migrateClient(client);
  ok(r.changed === true, 'detecta el duplicado persistido y marca changed:true');
  ok(r.wasLegacy === false, 'no es legacy: ya tenía services');
  ok(r.updatedClient.services[0].id === idDuplicado, 'el primer servicio conserva el id original');
  ok(isValidServiceId(r.updatedClient.services[1].id) && r.updatedClient.services[1].id !== idDuplicado,
    `el segundo servicio recibe un id NUEVO (${r.updatedClient.services[1].id})`);
  const idsServices = r.updatedClient.services.map((s) => s.id);
  ok(new Set(idsServices).size === idsServices.length, 'services termina con ids únicos');
  ok(r.updatedClient.menu.map((m) => m.id).join(',') === idsServices.join(','), 'menu queda como espejo exacto, con los mismos ids únicos');
  ok(r.faltantesCount === 1, 'cuenta 1 id regenerado (solo el duplicado, no el primero)');
}

console.log('\n14. assignUniqueServiceIds() — el while reintenta si la regeneración también colisiona (colisión controlada)');
{
  const primerId = 'svc_deadbeef0001';
  const segundoId = 'svc_deadbeef0002'; // ya ocupado por otro servicio del mismo array
  const idFinal = 'svc_deadbeef0003';
  let llamadas = 0;
  // Generador amañado: el primer intento de regenerar devuelve un id que
  // TAMBIÉN está ocupado (segundoId), obligando al while a reintentar.
  const generateId = () => { llamadas += 1; return llamadas === 1 ? segundoId : idFinal; };

  const items = [
    { id: primerId, nombre: 'Masaje' },
    { id: segundoId, nombre: 'Facial' },
    { id: primerId, nombre: 'Manicure' }, // duplicado del primero
  ];
  const out = assignUniqueServiceIds(items, { generateId });

  ok(out[0].id === primerId, 'primer servicio conserva su id');
  ok(out[1].id === segundoId, 'segundo servicio conserva su id (no es duplicado dentro del array)');
  ok(llamadas === 2, 'el generador se invoca 2 veces: el primer intento choca con el id del segundo servicio y reintenta');
  ok(out[2].id === idFinal, `el duplicado termina con el id del SEGUNDO intento, no con el que colisionó (${out[2].id})`);
  const ids = out.map((s) => s.id);
  ok(new Set(ids).size === ids.length, 'los 3 ids finales son únicos, ninguna colisión sobrevive');
}

console.log('\n15. assignUniqueServiceIds()/sanitizeServiceList() — un servicio sin nombre no le roba el id a uno real posterior');
{
  const idCompartido = 'svc_deadbeef0009';
  const items = [
    { id: idCompartido, nombre: '' },           // sin nombre: no debe "reservar" idCompartido
    { id: idCompartido, nombre: 'Pedicure' },   // mismo id, pero es el único con nombre real
  ];
  const out = assignUniqueServiceIds(items);
  ok(out[0].id === idCompartido, 'el item sin nombre no se toca (mismo id que traía)');
  ok(out[1].id === idCompartido, 'el servicio real CONSERVA su id: el sin-nombre no lo marcó como usado');

  // A través de sanitizeServiceList() (que filtra los sin nombre al
  // final), el resultado no debe mostrar ningún cambio innecesario de id.
  const sanitized = sanitizeServiceList(items, 40);
  ok(sanitized.length === 1, 'el item sin nombre se descarta del resultado final');
  ok(sanitized[0].id === idCompartido, 'el servicio con nombre conserva su id original, no se regeneró innecesariamente');
}

if (failures) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('\nTodas las pruebas del sistema de IDs de servicios pasan.');
