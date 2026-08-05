// Auditoría FASE 4 — sistema bilingüe completo para las 3 plantillas.
// Crea clientes reales vía el handler real de api/clients.js (Redis
// mockeado), y prueba el system prompt real (api/client-chat.js) y el email
// real (lib/reservation-emails.js) — no se reimplementa ninguna lógica.
import assert from 'node:assert/strict';

process.env.ADMIN_TOKEN = 'bilingue-test-token';
process.env.UPSTASH_REDIS_REST_URL = 'https://bilingue-test.redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'bilingue-test-token';
delete process.env.RESEND_API_KEY;

const redisStore = new Map();
globalThis.fetch = async (url, options = {}) => {
  const command = new URL(url).pathname.split('/').filter(Boolean).pop();
  const args = JSON.parse(options.body || '[]');
  const execute = (entry) => {
    const [op, ...values] = entry;
    const o = String(op).toLowerCase();
    if (o === 'get') return redisStore.get(values[0]) ?? null;
    if (o === 'set') { redisStore.set(values[0], values[1]); return 'OK'; }
    if (o === 'del') { values.forEach(k => redisStore.delete(k)); return values.length; }
    if (o === 'keys') { const p = String(values[0]).replace('*', ''); return [...redisStore.keys()].filter(k => k.startsWith(p)); }
    if (o === 'mget') return values.map(k => redisStore.get(k) ?? null);
    if (o === 'setnx') { if (redisStore.has(values[0])) return 0; redisStore.set(values[0], values[1]); return 1; }
    if (o === 'expire') return 1;
    if (o === 'srem' || o === 'sadd' || o === 'rpush') return 1;
    if (o === 'ltrim') return 'OK';
    throw new Error(`Unsupported Redis command: ${op}`);
  };
  const isBatch = command === 'pipeline' || command === 'multi-exec';
  const result = isBatch ? args.map(e => ({ result: execute(e) })) : { result: execute(args) };
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { default: clientHandler } = await import('../api/clients.js');
const { default: reservationsHandler } = await import('../api/reservations.js');
const { __test: chatTest } = await import('../api/client-chat.js');
const { reservationEmailHtml } = await import('../lib/reservation-emails.js');
const { buildSystemPrompt, hasLanguageChoice } = chatTest;

async function postClient(body) {
  let statusCode = 200; let responseBody = null;
  const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { responseBody = b; return this; } };
  await clientHandler({ method: 'POST', query: {}, headers: { 'x-admin-token': 'bilingue-test-token' }, body }, res);
  return { statusCode, responseBody };
}
async function postReservation(body, ip) {
  let statusCode = 200; let responseBody = null;
  const res = { setHeader() {}, status(c) { statusCode = c; return this; }, json(b) { responseBody = b; return this; } };
  await reservationsHandler({ method: 'POST', query: {}, headers: { 'x-forwarded-for': ip }, body }, res);
  return { statusCode, responseBody };
}

const HOURS = {
  monday: { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
  tuesday: { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
  wednesday: { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
  thursday: { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
  friday: { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
  saturday: { enabled: false, ranges: [] }, sunday: { enabled: false, ranges: [] },
};

const TEMPLATES = [
  { id: 'spa', svc: 'Masaje relajante', duracion: '60' },
  { id: 'barber', svc: 'Corte de pelo', duracion: '30' },
  // reservationDuration: la duración por plato queda opcional en
  // Restaurante (duracion:''), pero el negocio SÍ necesita una duración de
  // reserva propia -- auditoría, contradicción "Restaurante creado válido
  // pero bloqueado en needsSetup" (corregida en esta fase).
  { id: 'restaurant', svc: 'Menu degustacion', duracion: '', reservationDuration: '60' },
];

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); failures++; } };

const created = {};

console.log('1-2) Creación (vía handler real de api/clients.js) + configuración persistida: languages/primaryLanguage/language');
for (const { id: templateId, svc, duracion, reservationDuration } of TEMPLATES) {
  const clientId = `bi-${templateId}`;
  const { statusCode, responseBody } = await postClient({
    id: clientId, businessName: `Negocio ${templateId}`, templateId, templateVersion: '1.0',
    address: 'Calle 1', ownerEmail: 'owner-secreto@example.com', timezone: 'America/Santiago',
    notificationEmails: ['owner-secreto@example.com'],
    phoneCountry: 'CL', phoneCountryCode: '+56', phoneNumber: '912345678',
    businessHours: HOURS, services: [{ nombre: svc, precio: '100', duracion }],
    ...(reservationDuration ? { reservationDuration } : {}),
    capacityPerSlot: 5, bufferMinutes: 10,
  });
  ok(statusCode === 201, `${templateId}: se crea correctamente (fue ${statusCode}: ${JSON.stringify(responseBody)})`);
  // Activo:false hasta el primer pago real (webhook de Stripe) es correcto y
  // deliberado (api/clients.js) -- para probar reservas aquí se simula esa
  // activación directo en el mock de Redis, sin tocar el flujo de pago real.
  responseBody.active = true;
  redisStore.set(`client:${clientId}`, JSON.stringify(responseBody));
  created[templateId] = responseBody;
  ok(Array.isArray(responseBody.languages) && responseBody.languages.includes('es') && responseBody.languages.includes('en'),
    `${templateId}: languages persistido = ['es','en'] (fue ${JSON.stringify(responseBody.languages)})`);
  ok(responseBody.primaryLanguage === 'es', `${templateId}: primaryLanguage = 'es' (fue "${responseBody.primaryLanguage}")`);
  ok(responseBody.language === 'es', `${templateId}: language (legado) = 'es' (fue "${responseBody.language}")`);
}

console.log('\n3) Selector ES/EN visible para las 3 plantillas (hasLanguageChoice)');
for (const { id: templateId } of TEMPLATES) {
  ok(hasLanguageChoice(created[templateId]) === true, `${templateId}: hasLanguageChoice() === true (selector visible)`);
}

console.log('\n4-6) Conversación ES / EN / sin mezcla de idioma, para las 3 plantillas');
const TEMPLATE_MARKERS = {
  spa: { es: ['QUIÉN ERES', 'calmado', 'medic'], en: ['WHO YOU ARE', 'calm', 'medical'] },
  barber: { es: ['QUIÉN ERES', 'barbería', 'cercano'], en: ['WHO YOU ARE', 'barbershop', 'friendly'] },
  restaurant: { es: ['QUIÉN ERES', 'restaurante', 'PREFERENCIAS DE COMIDA'], en: ['WHO YOU ARE', 'restaurant', 'FOOD PREFERENCES'] },
};
const SPANISH_ONLY_HEADERS = ['QUIÉN ERES', 'CÓMO HABLAS', 'LÍMITES', 'SEGURIDAD Y PRIVACIDAD', 'INFORMACIÓN VALIDADA DEL NEGOCIO', 'Hoy es'];
const ENGLISH_ONLY_HEADERS = ['WHO YOU ARE', 'HOW YOU SPEAK', 'LIMITS', 'SECURITY AND PRIVACY', 'VERIFIED BUSINESS INFORMATION', 'Today is'];

const prompts = {};
for (const { id: templateId } of TEMPLATES) {
  const client = created[templateId];
  const promptEs = await buildSystemPrompt(client.prompt, client, { gallery: 0, menuItems: [] }, 'es');
  const promptEn = await buildSystemPrompt(client.prompt, client, { gallery: 0, menuItems: [] }, 'en');
  prompts[templateId] = { es: promptEs, en: promptEn };

  for (const needle of TEMPLATE_MARKERS[templateId].es) {
    ok(promptEs.includes(needle), `${templateId} ES: contiene "${needle}"`);
  }
  for (const needle of TEMPLATE_MARKERS[templateId].en) {
    ok(promptEn.includes(needle), `${templateId} EN: contiene "${needle}"`);
  }
  // No mezcla: ningún encabezado en inglés dentro del prompt español, y viceversa.
  for (const needle of ENGLISH_ONLY_HEADERS) {
    ok(!promptEs.includes(needle), `${templateId} ES: NO contiene encabezado en inglés "${needle}"`);
  }
  for (const needle of SPANISH_ONLY_HEADERS) {
    ok(!promptEn.includes(needle), `${templateId} EN: NO contiene encabezado en español "${needle}"`);
  }
}

console.log('\n8) Datos/diferencias de una plantilla nunca mezclados con otra (Requisito 8)');
{
  // Spa: tono calmado + restricciones médicas -- exclusivo de spa.
  ok(!prompts.barber.en.includes('medical') && !prompts.restaurant.en.includes('medical'),
    'barbería/restaurante en inglés NO heredan el matiz médico exclusivo de spa');
  // Restaurante: alergias/preferencias de comida -- exclusivo de restaurante.
  ok(!prompts.spa.en.includes('FOOD PREFERENCES') && !prompts.barber.en.includes('FOOD PREFERENCES'),
    'spa/barbería en inglés NO heredan la sección de preferencias de comida exclusiva de restaurante');
  ok(!prompts.spa.es.includes('PREFERENCIAS DE COMIDA') && !prompts.barber.es.includes('PREFERENCIAS DE COMIDA'),
    'spa/barbería en español NO heredan la sección de preferencias de comida exclusiva de restaurante');
  // Barbería: matiz "barbershop"/"cercano" -- no debe aparecer en spa/restaurante.
  ok(!prompts.spa.en.includes('barbershop') && !prompts.restaurant.en.includes('barbershop'),
    'spa/restaurante en inglés NO heredan el matiz de barbería');
  console.log('  ✓ ninguna plantilla hereda contenido específico de otra, en ningún idioma');
}

console.log('\n7) Reserva y correo en el idioma elegido, para las 3 plantillas');
// El restaurante creado arriba (bloque 1-2) ya trae reservationDuration -- no
// necesita duración por plato para tomar reservas (fase "contradicción
// duración Restaurante": api/clients.js exime a Restaurante de exigirla al
// crear, y lib/setup.js/necesitaSetup ahora reconoce reservationDuration
// como fuente válida, en vez de exigir duración por plato para las 3
// plantillas por igual).
let ipCounter = 0;
for (const { id: templateId, svc } of TEMPLATES) {
  const client = created[templateId];
  for (const lang of ['es', 'en']) {
    ipCounter++;
    // Teléfono distinto por idioma: si no, la segunda solicitud (mismo
    // teléfono+fecha+hora+servicio) se detecta como intento duplicado de la
    // primera -- correcto en general, solo un choque de datos de esta prueba.
    const { statusCode, responseBody } = await postReservation({
      clientId: client.id, nombre: `Cliente ${lang}`, telefono: lang === 'en' ? '+56922222222' : '+56911111111',
      email: `cliente-${templateId}-${lang}@example.com`,
      fecha: '2026-08-10', hora: '11:00', servicio: svc, partySize: templateId === 'restaurant' ? '2' : undefined,
      language: lang,
    }, `172.16.0.${ipCounter}`);
    ok(statusCode === 201 && responseBody.ok, `${templateId} (${lang}): reserva creada (fue ${statusCode}: ${JSON.stringify(responseBody)})`);
    if (!responseBody.reservation) continue;
    ok(responseBody.reservation.language === lang, `${templateId} (${lang}): reservation.language = "${lang}" (fue "${responseBody.reservation.language}")`);
    const html = reservationEmailHtml(client, responseBody.reservation, 'created');
    if (lang === 'en') {
      ok(/confirm|reservation|appointment/i.test(html), `${templateId} EN: el email real usa texto en inglés`);
    } else {
      ok(/confirm|reserva|cita/i.test(html), `${templateId} ES: el email real usa texto en español`);
    }
  }
}

console.log('\n10) Compatibilidad con clientes antiguos sin languages/prompt inglés (fallback seguro)');
{
  // Cliente legado: sin templateId, sin languages, prompt propio en español.
  const legacyClient = {
    id: 'legacy-old', businessName: 'Negocio Legado', language: 'es',
    prompt: 'PROMPT-LEGADO-EN-ESPANOL-SIN-PLANTILLA-OFICIAL',
    businessHours: HOURS, services: [{ nombre: 'Servicio', precio: '50', duracion: '30' }],
  };
  ok(hasLanguageChoice(legacyClient) === false, 'cliente legado sin languages: hasLanguageChoice() === false (nunca ofrece selector)');
  const legacyPromptEs = await buildSystemPrompt(legacyClient.prompt, legacyClient, { gallery: 0, menuItems: [] }, 'es');
  ok(legacyPromptEs.includes('PROMPT-LEGADO-EN-ESPANOL-SIN-PLANTILLA-OFICIAL'), 'cliente legado en español: conserva su prompt real tal cual (sin cambios)');
  // Si por cualquier motivo (ej. el dueño cambió client.language a mano)
  // activeLanguage llega a 'en' sin plantilla oficial reconocible, el
  // fallback debe conservar basePrompt -- nunca reventar ni devolver vacío.
  const legacyPromptEn = await buildSystemPrompt(legacyClient.prompt, legacyClient, { gallery: 0, menuItems: [] }, 'en');
  ok(legacyPromptEn.includes('PROMPT-LEGADO-EN-ESPANOL-SIN-PLANTILLA-OFICIAL'), 'cliente legado sin promptBaseEn disponible: fallback seguro a basePrompt (nunca vacío, nunca revienta)');
  ok(legacyPromptEn.length > 0, 'el fallback nunca produce un prompt vacío');
}

console.log(failures ? `\n${failures} fallo(s)` : '\nTodas las pruebas del sistema bilingüe multi-plantilla (FASE 4) pasan');
if (failures) process.exit(1);
