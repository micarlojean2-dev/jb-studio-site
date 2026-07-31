// Cobertura de los 4 fixes del creador manual Spa (commit base 5e3b372):
// prompt dinámico, teléfono internacional, buffer 0-240, y el CSS del botón
// desactivado ya está cubierto en test/admin-spa-creator.test.mjs.
// No toca restaurante/barbería: se verifica explícitamente que quedan iguales.
import { __test as chatTest } from '../api/client-chat.js';
import { __test as reservationsTest } from '../api/reservations.js';

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
};

const { spaBusinessInfoBlock, buildSystemPrompt, langDirectiveFor } = chatTest;
const { validarReserva } = reservationsTest;

console.log('PROMPT DINÁMICO — spaBusinessInfoBlock');
{
  const spaClient = {
    templateId: 'spa',
    businessName: 'Spa QA Internacional',
    address: 'Av. QA 123',
    whatsapp: '+56912345678',
    timezone: 'America/Santiago',
    ownerEmail: 'owner-secreto@example.com',
    notificationEmails: ['owner-secreto@example.com', 'equipo@example.com'],
    panelToken: 'no-debe-aparecer-nunca-1234',
    businessHours: {
      monday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
      tuesday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
      wednesday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
      thursday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
      friday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
      saturday: { enabled: false, ranges: [] },
      sunday: { enabled: false, ranges: [] },
    },
    services: [
      { nombre: 'Masaje relajante', precio: '35000', duracion: '60' },
      { nombre: 'Facial hidratante', precio: '28000', duracion: '45' },
    ],
  };
  const block = spaBusinessInfoBlock(spaClient);

  ok(block.includes('Spa QA Internacional'), '1. DeepSeek recibe businessName');
  ok(block.includes('Av. QA 123'), '2. Recibe address');
  ok(block.includes('+56912345678'), '3. Recibe teléfono');
  ok(block.includes('Lunes: 10:00–19:00') && block.includes('Sábado: Cerrado'), '4. Recibe horarios completos');
  ok(block.includes('Masaje relajante') && block.includes('Facial hidratante'), '5. Recibe servicios');
  ok(block.includes('Precio: 35000') && block.includes('Precio: 28000'), '6. Recibe precios');
  ok(block.includes('Duración: 60 minutos') && block.includes('Duración: 45 minutos'), '7. Recibe duraciones');
  ok(!block.includes('owner-secreto@example.com'), '8. No recibe ownerEmail');
  ok(!block.includes('equipo@example.com'), '9. No recibe notificationEmails');
  ok(!block.includes('no-debe-aparecer-nunca-1234'), '10. No recibe panelToken');

  const promptEs = buildSystemPrompt('BASE-PROMPT-MARKER', spaClient, { gallery: 0, menuItems: [] }, 'es');
  ok(promptEs.includes('IDIOMA: Responde SIEMPRE en español') && promptEs.includes('Spa QA Internacional') && promptEs.includes('BASE-PROMPT-MARKER'),
    '11. Mantiene español (directiva + datos + basePrompt, los tres presentes)');
  const promptEn = buildSystemPrompt('BASE-PROMPT-MARKER', { ...spaClient, languages: undefined }, { gallery: 0, menuItems: [] }, 'en');
  ok(promptEn.includes('LANGUAGE: Always reply in English') && promptEn.includes('Spa QA Internacional'),
    '12. Mantiene inglés (directiva + los mismos datos del negocio)');

  // No duplicar servicios con el mismo nombre.
  const dup = spaBusinessInfoBlock({ ...spaClient, services: [...spaClient.services, { nombre: 'masaje relajante', precio: '999', duracion: '10' }] });
  ok((dup.match(/Masaje relajante/gi) || []).length === 1, 'no duplica un servicio con nombre repetido (case-insensitive)');

  // Alcance: solo templateId === 'spa'. Restaurante/barbería/legado sin cambios.
  ok(spaBusinessInfoBlock({ templateId: 'restaurant', businessName: 'Rest X' }) === '',
    'restaurante: spaBusinessInfoBlock no agrega nada (sin cambios)');
  ok(spaBusinessInfoBlock({ templateId: 'barber', businessName: 'Barber X' }) === '',
    'barbería: spaBusinessInfoBlock no agrega nada (sin cambios)');
  ok(spaBusinessInfoBlock({ businessName: 'Legacy X' }) === '',
    'cliente legado (sin templateId): spaBusinessInfoBlock no agrega nada (sin cambios)');
  const restPrompt = buildSystemPrompt('REST-BASE', { templateId: 'restaurant', businessName: 'Rest X' }, { gallery: 0, menuItems: [] }, 'es');
  ok(!restPrompt.includes('INFORMACIÓN VALIDADA DEL NEGOCIO') && restPrompt.includes('REST-BASE'),
    'restaurante: buildSystemPrompt sin la sección nueva, comportamiento intacto');
}

console.log('BUFFER — validarReserva con bufferMinutes: 10 (spa)');
{
  const hours = { monday: { enabled: true, ranges: [{ start: '09:00', end: '19:00' }] } };
  const spa = { templateId: 'spa', businessHours: hours, menu: [{ nombre: 'Facial', duracion: '60' }], capacityPerSlot: 1, bufferMinutes: 10 };
  const existing = [{ estado: 'confirmada', fechaISO: '2026-08-03', horaISO: '10:00', servicio: 'Facial', duracion: 60 }];
  ok(validarReserva(spa, '2026-08-03', '11:00', 'Facial', 0, existing).motivo === 'sin_disponibilidad',
    '24. api/reservations usa realmente buffer 10 (60+10=70 min bloqueados, 11:00 choca)');
  // La ocupación (60+10=70 min) libera el horario a las 11:10, pero los
  // inicios de reserva siguen la grilla de 15 min desde la apertura (09:00):
  // el próximo inicio válido en o después de 11:10 es 11:15.
  ok(validarReserva(spa, '2026-08-03', '11:15', 'Facial', 0, existing).ok,
    'con buffer 10, el siguiente hueco libre alineado a la grilla es 11:15 (ocupación termina a las 11:10)');
}

// ── api/clients.js: buffer 0-240 y teléfono internacional, end-to-end ──────
process.env.ADMIN_TOKEN = 'spa-fix-test-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://spa-fix-test.redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'spa-fix-test-token';
const redisStore = new Map();
globalThis.fetch = async (url, options = {}) => {
  const command = new URL(url).pathname.split('/').filter(Boolean).pop();
  const args = JSON.parse(options.body || '[]');
  const execute = (entry) => {
    const [op, ...values] = entry;
    if (String(op).toLowerCase() === 'get') return redisStore.get(values[0]) ?? null;
    if (String(op).toLowerCase() === 'set') { redisStore.set(values[0], values[1]); return 'OK'; }
    if (String(op).toLowerCase() === 'keys') {
      const prefix = String(values[0]).replace('*', '');
      return [...redisStore.keys()].filter(key => key.startsWith(prefix));
    }
    if (String(op).toLowerCase() === 'mget') return values.map(key => redisStore.get(key) ?? null);
    throw new Error(`Unsupported Redis command: ${op}`);
  };
  const result = command === 'pipeline' ? args.map(entry => ({ result: execute(entry) })) : { result: execute(args) };
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { default: clientHandler } = await import('../api/clients.js');

async function postClient(body) {
  let statusCode = 200; let responseBody = null;
  const res = { setHeader() {}, status(code) { statusCode = code; return this; }, json(b) { responseBody = b; return this; } };
  await clientHandler({ method: 'POST', query: {}, headers: { 'x-admin-token': process.env.ADMIN_TOKEN }, body }, res);
  return { statusCode, responseBody };
}

const baseSpa = (idSuffix, extra) => ({
  id: `spa-fix-${idSuffix}`, businessName: 'Spa Fix Test', prompt: 'Prompt seguro',
  templateId: 'spa', templateVersion: '1.0',
  address: 'Calle 1', ownerEmail: 'owner@example.com', timezone: 'America/Santiago',
  notificationEmails: ['owner@example.com'],
  businessHours: { monday: { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] } },
  services: [{ nombre: 'Facial', precio: '80', duracion: '60' }],
  capacityPerSlot: 2, phoneCountry: 'US', phoneCountryCode: '+1', phoneNumber: '5550100',
  ...extra,
});

console.log('BUFFER — POST /api/clients (0-240)');
for (const buffer of [0, 10, 15, 37, 240]) {
  const r = await postClient(baseSpa(`buf-${buffer}`, { bufferMinutes: buffer }));
  ok(r.statusCode === 201 && r.responseBody?.bufferMinutes === buffer, `19/20/buffer ${buffer} crea Spa correctamente`);
}
for (const [slug, buffer] of [['neg1', -1], ['241', 241], ['decimal', 10.5]]) {
  const r = await postClient(baseSpa(`buf-bad-${slug}`, { bufferMinutes: buffer }));
  ok(r.statusCode === 400 && r.responseBody?.fields?.includes('bufferMinutes'),
    `21/22/23. buffer ${buffer} se rechaza (400, fields incluye 'bufferMinutes')`);
}

console.log('TELÉFONO — POST /api/clients (+1, +52, +56)');
{
  const us = await postClient(baseSpa('phone-us', { bufferMinutes: 15, phoneCountry: 'US', phoneCountryCode: '+1', phoneNumber: '5551234567' }));
  ok(us.statusCode === 201 && us.responseBody?.whatsapp === '+15551234567', '13. +1 se guarda correctamente');

  const mx = await postClient(baseSpa('phone-mx', { bufferMinutes: 15, phoneCountry: 'MX', phoneCountryCode: '+52', phoneNumber: '5512345678' }));
  ok(mx.statusCode === 201 && mx.responseBody?.whatsapp === '+525512345678', '14. +52 se guarda correctamente');

  const cl = await postClient(baseSpa('phone-cl', { bufferMinutes: 15, phoneCountry: 'CL', phoneCountryCode: '+56', phoneNumber: '912345678' }));
  ok(cl.statusCode === 201 && cl.responseBody?.whatsapp === '+56912345678', '15. +56 se guarda correctamente');
  ok(!cl.responseBody?.whatsapp.includes('+1+'), '16. No produce "+1+56..."');

  // El admin pega el número con el código incluido: el servidor lo dedupe.
  const clDup = await postClient(baseSpa('phone-cl-dup', { bufferMinutes: 15, phoneCountry: 'CL', phoneCountryCode: '+56', phoneNumber: '56912345678' }));
  ok(clDup.statusCode === 201 && clDup.responseBody?.whatsapp === '+56912345678' && clDup.responseBody?.phoneNumber === '912345678',
    '17. No duplica código si el número lo trae pegado adelante');

  const empty = await postClient(baseSpa('phone-empty', { bufferMinutes: 15, phoneCountry: 'CL', phoneCountryCode: '+56', phoneNumber: '' }));
  ok(empty.statusCode === 400 && empty.responseBody?.fields?.includes('phone'), '18. Rechaza número vacío');
}

console.log('REGRESIÓN — restaurante y barbería no cambian con estos fixes');
{
  const restaurant = await postClient({
    id: 'rest-fix-check', businessName: 'Rest Fix Check', prompt: 'Prompt seguro',
    templateId: 'restaurant', templateVersion: '1.0',
    address: 'Calle 1', ownerEmail: 'owner@example.com', timezone: 'UTC',
    notificationEmails: ['owner@example.com'], phoneCountry: 'US', phoneCountryCode: '+1', phoneNumber: '5550100',
    businessHours: { monday: { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] } },
    services: [{ nombre: 'Plato', precio: '10' }],
  });
  ok(restaurant.statusCode === 201 && restaurant.responseBody?.templateId === 'restaurant',
    '34. Restaurante sigue creándose igual (sin bufferMinutes/capacityPerSlot obligatorios)');
}

console.log(failures ? `${failures} fallo(s)` : 'Todas las pruebas de client-chat.js/api/clients.js/reservations.js pasan');
if (failures) process.exit(1);
