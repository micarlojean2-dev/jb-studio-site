// Cobertura de la auditoría FASE 3 (idioma persistido en la reserva, correos
// bilingües, lookup de solo lectura por actionToken, contexto reconstruido al
// entrar desde un enlace de correo, mensajes de disponibilidad centralizados
// por idioma/plantilla, y generalización a Barbería/Restaurante). No toca
// Redis ni Resend reales: usa dobles en memoria / mocks inyectados.
// Ejecutar: node test/reservation-language-and-context.test.mjs
import fs from 'node:fs';

process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'fake-token';

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
}

const chatCoreSrc = fs.readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8');
const widget = fs.readFileSync(new URL('../widget.js', import.meta.url), 'utf8');
const asistente = fs.readFileSync(new URL('../asistente.html', import.meta.url), 'utf8');
const win = {};
new Function('window', chatCoreSrc)(win);
const CORE = win.JBChatCore;

// ── Redis falso, protocolo REST de Upstash (mismo patrón ya probado en
// test/spa-manual-creator-fixes.test.mjs) — sin red real. ───────────────────
const redisStore = new Map();
function installFakeRedis() {
  redisStore.clear();
  globalThis.fetch = async (url, options = {}) => {
    const command = new URL(url).pathname.split('/').filter(Boolean).pop();
    const args = JSON.parse(options.body || '[]');
    const execute = (entry) => {
      const [op, ...values] = entry;
      const o = String(op).toLowerCase();
      if (o === 'get') return redisStore.get(values[0]) ?? null;
      if (o === 'set') { redisStore.set(values[0], values[1]); return 'OK'; }
      if (o === 'del') { redisStore.delete(values[0]); return 1; }
      if (o === 'keys') {
        const prefix = String(values[0]).replace('*', '');
        return [...redisStore.keys()].filter((key) => key.startsWith(prefix));
      }
      if (o === 'mget') return values.map((key) => redisStore.get(key) ?? null);
      throw new Error(`Unsupported Redis command: ${op}`);
    };
    const result = command === 'pipeline' ? args.map((entry) => ({ result: execute(entry) })) : { result: execute(args) };
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}
installFakeRedis();
const { default: handler } = await import('../api/reservations.js');
const { __test } = await import('../api/reservations.js');

function response() {
  return {
    statusCode: null, body: null,
    setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; },
  };
}
async function call(body) {
  const res = response();
  await handler({ method: 'POST', headers: { 'x-forwarded-for': `lang-test-${Math.random()}` }, body }, res);
  return res;
}

// 2026-08-10 y 2026-08-12 caen lunes/miércoles: se cubren ambos días para no
// mezclar "día cerrado" con lo que cada prueba realmente quiere verificar.
const HOURS_ALL_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  .reduce((acc, d) => { acc[d] = { enabled: true, ranges: [{ start: '00:00', end: '23:59' }] }; return acc; }, {});
const seedClient = (id, extra) => {
  const client = Object.assign({
    id, active: true, businessName: 'Spa QA', templateId: 'spa', language: 'es',
    timezone: 'UTC', businessHours: HOURS_ALL_WEEK, menu: [{ nombre: 'Masaje', duracion: '60' }],
    reservationIntervalMinutes: 15, capacityPerSlot: 1, minNoticeHours: 0,
  }, extra);
  // Igual que produciría un `redis.set()` real: el cliente @upstash/redis
  // serializa a JSON string; sembrar el mapa con el objeto crudo rompe la
  // deserialización del propio cliente al leerlo de vuelta.
  redisStore.set(`client:${id}`, JSON.stringify(client));
  return client;
};
const seedReservation = (key, value) => redisStore.set(key, JSON.stringify(value));

console.log('1. reservationLanguage() — saneamiento y fallback (unidad)');
{
  ok(__test.reservationLanguage({ language: 'es' }, 'en') === 'en', 'idioma explícito válido gana');
  ok(__test.reservationLanguage({ language: 'en' }, 'fr') === 'en', 'idioma inválido cae al del negocio');
  ok(__test.reservationLanguage({ language: 'es' }, undefined) === 'es', 'idioma ausente cae al del negocio (es)');
  ok(__test.reservationLanguage({}, undefined) === 'es', 'sin idioma en ningún lado -> es por defecto (nunca inglés por defecto)');
}

console.log('2. Reserva nueva persiste reservation.language; reagendado hereda desde actionToken, no del body');
{
  seedClient('lang-en', { language: 'en' });
  const created = await call({ clientId: 'lang-en', nombre: 'Mike', telefono: '5551234567', email: 'mike@example.com', fecha: '2026-08-10', hora: '11:00', servicio: 'Masaje', language: 'en' });
  ok(created.statusCode === 201 && created.body.ok, 'la reserva se crea correctamente');
  const key = [...redisStore.keys()].find((k) => k.startsWith('reservations:lang-en:'));
  ok(JSON.parse(redisStore.get(key)).language === 'en', 'reservation.language === "en" queda persistido en Redis');

  seedClient('lang-fallback', { language: 'en' });
  const createdNoLang = await call({ clientId: 'lang-fallback', nombre: 'Ana', telefono: '5551234567', email: 'ana@example.com', fecha: '2026-08-10', hora: '11:00', servicio: 'Masaje' });
  const key2 = [...redisStore.keys()].find((k) => k.startsWith('reservations:lang-fallback:'));
  ok(JSON.parse(redisStore.get(key2)).language === 'en', 'sin language en el body: cae al idioma del negocio (en)');

  // Reserva vieja (creada "antes" de este cambio, sin language) reagendada:
  // el idioma se hereda del propio negocio, nunca de un ?lang= del request.
  seedClient('lang-reschedule', { language: 'en' });
  const oldKey = 'reservations:lang-reschedule:1000';
  seedReservation(oldKey, {
    clientId: 'lang-reschedule', nombre: 'Old', telefono: '555', email: 'old@example.com',
    fecha: '2026-08-01', fechaISO: '2026-08-01', hora: '10:00', horaISO: '10:00', servicio: 'Masaje',
    actionToken: 'old-token-123', estado: 'confirmada',
    // sin `language`: simula una reserva anterior a este cambio
  });
  const rescheduled = await call({ clientId: 'lang-reschedule', action: 'reschedule', actionToken: 'old-token-123', fecha: '2026-08-12', hora: '12:00', language: 'es' });
  ok(rescheduled.statusCode === 200 && rescheduled.body.ok, 'reagendado exitoso');
  ok(rescheduled.body.reservation.language === 'en', 'idioma heredado del negocio (en), IGNORANDO el "language":"es" manipulable del request');
}

console.log('3. Lookup de solo lectura por actionToken — seguridad (no revela datos ni de otro token ni de otro cliente)');
{
  seedClient('lookup-a', { language: 'en' });
  seedClient('lookup-b', { language: 'es' });
  seedReservation('reservations:lookup-a:2000', {
    clientId: 'lookup-a', nombre: 'Mike', telefono: '5559990000', email: 'mike@secret.com',
    fecha: 'tomorrow', hora: '6:00 PM', servicio: 'Hot Stone Massage', actionToken: 'tok-a', estado: 'confirmada',
    // sin `language`: prueba también el fallback de lectura para reservas viejas
  });
  seedReservation('reservations:lookup-b:2001', {
    clientId: 'lookup-b', nombre: 'Otra Persona', telefono: '5551110000', email: 'otra@secret.com',
    fecha: 'mañana', hora: '5:00 PM', servicio: 'Corte', actionToken: 'tok-b', estado: 'confirmada', language: 'es',
  });

  const found = await call({ clientId: 'lookup-a', action: 'lookup', actionToken: 'tok-a' });
  ok(found.statusCode === 200 && found.body.found === true, 'token válido: encontrado');
  ok(found.body.reservation.nombre === 'Mike' && found.body.reservation.servicio === 'Hot Stone Massage', 'devuelve nombre y servicio reales');
  ok(found.body.reservation.language === 'en', 'reserva vieja sin language: cae al idioma del negocio (en) en la respuesta del lookup');
  ok(found.body.reservation.email === undefined && found.body.reservation.telefono === undefined,
    'NUNCA expone email ni teléfono en la respuesta pública del lookup');
  ok(JSON.stringify(found.body).indexOf('secret.com') === -1, 'el correo real no aparece en ningún campo de la respuesta');

  const wrongToken = await call({ clientId: 'lookup-a', action: 'lookup', actionToken: 'no-existe' });
  ok(wrongToken.statusCode === 200 && wrongToken.body.found === false, 'token inválido: found:false, sin datos');

  // El token de OTRO cliente, consultado bajo un clientId que no es el suyo,
  // nunca debe encontrarse (el lookup busca solo dentro de reservations:{clientId}:*).
  const crossClient = await call({ clientId: 'lookup-a', action: 'lookup', actionToken: 'tok-b' });
  ok(crossClient.statusCode === 200 && crossClient.body.found === false,
    'un actionToken real de OTRO cliente no se encuentra bajo un clientId distinto (aislamiento entre clientes)');

  // El propio dueño del token, bajo su clientId correcto, sí lo encuentra.
  const ownToken = await call({ clientId: 'lookup-b', action: 'lookup', actionToken: 'tok-b' });
  ok(ownToken.statusCode === 200 && ownToken.body.found === true && ownToken.body.reservation.nombre === 'Otra Persona',
    'el mismo token, bajo su clientId correcto, sí se encuentra');

  const missingToken = await call({ clientId: 'lookup-a', action: 'lookup' });
  ok(missingToken.statusCode === 400, 'lookup sin actionToken: 400 (nunca intenta listar sin token)');
}

console.log('4. Capacidad, buffer, solapes, exclusión de la propia reserva y alternativa (validarReserva real)');
{
  const spa = { templateId: 'spa', bufferMinutes: 10, capacityPerSlot: 1, reservationIntervalMinutes: 15,
    menu: [{ nombre: 'Masaje relajante', duracion: '60' }],
    businessHours: { monday: { enabled: true, ranges: [{ start: '10:00', end: '18:00' }] } } };
  const existing = [{ estado: 'confirmada', fechaISO: '2026-08-10', horaISO: '12:00', servicio: 'Masaje relajante', duracion: 60 }];

  const overlap = __test.validarReserva(spa, '2026-08-10', '12:15', 'Masaje relajante', undefined, existing);
  ok(overlap.ok === false && overlap.motivo === 'sin_disponibilidad', 'capacidad 1: horario solapado (con buffer) se rechaza');
  ok(overlap.alternativa === '1:15 PM', `alternativa correcta considerando servicio+buffer (fue: ${overlap.alternativa})`);

  const clear = __test.validarReserva(spa, '2026-08-10', '13:15', 'Masaje relajante', undefined, existing);
  ok(clear.ok === true, 'fuera del solape: se acepta');

  // Exclusión de la propia reserva: el caller (rama reschedule) filtra el
  // índice propio antes de llamar a validarReserva — se simula pasando un
  // array de "otras" reservas ya sin la propia.
  const selfExcluded = __test.validarReserva(spa, '2026-08-10', '12:15', 'Masaje relajante', undefined, []);
  ok(selfExcluded.ok === true, 'reagendar la propia reserva a su mismo horario (ya excluida por el caller) no choca consigo misma');

  // Horario tan corto que el servicio (60+10 buffer=70min) no cabe en NINGÚN
  // momento del día: no existe ninguna alternativa real que ofrecer.
  const noAlt = __test.validarReserva({ ...spa, businessHours: { monday: { enabled: true, ranges: [{ start: '10:00', end: '10:30' }] } } },
    '2026-08-10', '10:15', 'Masaje relajante', undefined, []);
  ok(noAlt.ok === false && (noAlt.alternativa === null || noAlt.alternativa === undefined),
    'sin alternativa real disponible ese día: nunca se inventa una (alternativa null)');
}

console.log('5. CORE.motivoDisponibilidadMensaje() — Spa/Barbería/Restaurante, es/en, con y sin alternativa');
{
  ok(CORE.motivoDisponibilidadMensaje('sin_disponibilidad', { templateId: 'spa' }, 'es', '12:00 PM')
    === 'Ese horario ya está reservado, pero tengo disponibilidad a las 12:00 PM. ¿Te funciona? 😊', 'Spa (es) — texto exacto');
  ok(CORE.motivoDisponibilidadMensaje('sin_disponibilidad', { templateId: 'barber' }, 'es', '12:00 PM')
    === 'Ese horario ya está tomado. Tengo disponible las 12:00 PM ✂️ ¿Quieres mover tu cita a esa hora?', 'Barbería (es) — texto exacto');
  ok(CORE.motivoDisponibilidadMensaje('sin_disponibilidad', { templateId: 'restaurant' }, 'es', '12:00 PM')
    === 'Ese horario ya está completo. La opción más cercana es a las 12:00 PM 🍽️', 'Restaurante (es) — texto exacto');

  for (const tpl of ['spa', 'barber', 'restaurant']) {
    const es = CORE.motivoDisponibilidadMensaje('sin_disponibilidad', { templateId: tpl }, 'es', '12:00 PM');
    const en = CORE.motivoDisponibilidadMensaje('sin_disponibilidad', { templateId: tpl }, 'en', '12:00 PM');
    ok(es !== en, `${tpl}: es y en producen textos distintos`);
    ok(en.includes('12:00 PM'), `${tpl} (en): incluye la alternativa`);
    ok(!/[áéíóúñ¿¡]/i.test(en), `${tpl} (en): sin caracteres en español colados`);
  }

  const sinAlt = CORE.motivoDisponibilidadMensaje('sin_disponibilidad', { templateId: 'spa' }, 'es', '');
  ok(!/\d/.test(sinAlt), 'sin alternativa: el mensaje no menciona ninguna hora inventada');

  ok(CORE.motivoDisponibilidadMensaje('fuera_de_horario', {}, 'en', '9:00 AM').includes('9:00 AM'), 'fuera_de_horario (en) usa la alternativa cuando existe');
  ok(CORE.motivoDisponibilidadMensaje('desconocido', {}, 'es', '').length > 0, 'motivo desconocido: siempre hay un mensaje de respaldo (nunca vacío)');
}

console.log('6. CORE.emailActionContextoMensaje() — contexto real, no saludo genérico');
{
  const en = CORE.emailActionContextoMensaje('reschedule', { templateId: 'spa' }, 'en', { nombre: 'Mike', servicio: 'Hot Stone Massage', fecha: 'tomorrow', hora: '6:00 PM' });
  ok(en === "Hi Mike 😊 Let's reschedule your Hot Stone Massage appointment. It is currently booked for tomorrow at 6:00 PM. What new date and time would you prefer?",
    `EN — texto exacto del ejemplo (fue: ${en})`);
  const es = CORE.emailActionContextoMensaje('reschedule', { templateId: 'spa' }, 'es', { nombre: 'Mike', servicio: 'Masaje de piedras calientes', fecha: 'mañana', hora: '6:00 PM' });
  ok(es === 'Hola Mike 😊 Vamos a reagendar tu cita de Masaje de piedras calientes. Actualmente está reservada para mañana a las 6:00 PM. ¿Qué nueva fecha y hora prefieres?',
    `ES — texto exacto del ejemplo (fue: ${es})`);
  ok(/¿Confirmas|Do you want me to cancel/.test(CORE.emailActionContextoMensaje('cancel', { templateId: 'spa' }, 'es', { nombre: 'Mike' })),
    'cancel: pregunta de confirmación de cancelación');
  const restaurantMsg = CORE.emailActionContextoMensaje('reschedule', { templateId: 'restaurant' }, 'es', { nombre: 'Ana', fecha: 'viernes', hora: '8:00 PM' });
  ok(restaurantMsg.includes('reserva') && !restaurantMsg.includes('cita'), 'restaurante usa "reserva", nunca "cita" (citaLabel plantilla-consciente)');
  const sinDatos = CORE.emailActionContextoMensaje('reschedule', { templateId: 'spa' }, 'es', { nombre: 'Mike' });
  ok(!sinDatos.includes('undefined') && !sinDatos.includes('null'), 'sin servicio/fecha/hora: nunca imprime undefined/null');
}

console.log('7. lib/reservation-emails.js — correos bilingües (customer en el idioma de la reserva, dueño en el del negocio)');
{
  const { reservationEmailHtml, sendReservationEmails, __test: emailTest } = await import('../lib/reservation-emails.js');
  const client = { businessName: 'Spa Luna', color: '#1a4a2e', language: 'es', ownerEmail: 'owner@x.com' };
  const reservationEn = { clientId: 'spa', nombre: 'Mike', servicio: 'Hot Stone Massage', fecha: 'tomorrow', hora: '6:00 PM', email: 'mike@example.com', telefono: '123', actionToken: 'tok', language: 'en' };

  const htmlEn = reservationEmailHtml(client, reservationEn, 'confirmed');
  ok(htmlEn.includes('Reservation confirmed') && htmlEn.includes('>Reschedule<') && htmlEn.includes('>Cancel<'), 'cliente en inglés: título y botones en inglés');
  ok(!/Reagendar|Cancelar|está confirmada/.test(htmlEn), 'cliente en inglés: cero texto en español colado');

  const htmlEs = reservationEmailHtml(client, { ...reservationEn, language: 'es' }, 'confirmed');
  ok(htmlEs.includes('Reserva confirmada') && htmlEs.includes('>Reagendar<') && htmlEs.includes('>Cancelar<'), 'cliente en español: título y botones en español');

  const htmlCancelled = reservationEmailHtml(client, { ...reservationEn, language: 'en' }, 'cancelled');
  ok(htmlCancelled.includes('Reservation cancelled') && !htmlCancelled.includes('>Reschedule<'), 'cancelado (en): sin botones de acción, título correcto');

  ok(emailTest.emailLanguage({ language: 'en' }, { language: undefined }) === 'en', 'reserva sin language: cae al idioma del negocio');
  ok(emailTest.emailLanguage({ language: 'es' }, { language: 'en' }) === 'en', 'idioma de la reserva manda sobre el del negocio para el cliente');

  // El correo del DUEÑO usa el idioma del NEGOCIO, no el de la reserva del
  // cliente — un cliente que reservó en inglés no le cambia el idioma al
  // aviso interno de un negocio en español.
  const sentSubjects = [];
  const fakeResend = { emails: { async send(args) { sentSubjects.push({ to: args.to, subject: args.subject, html: args.html }); return { data: { id: 'x' } }; } } };
  const result = await sendReservationEmails(client, reservationEn, 'confirmed', { resend: fakeResend });
  ok(result.customer.sent === true && result.owners.sent === true, 'ambos correos se envían');
  const customerMail = sentSubjects.find((s) => s.to === 'mike@example.com');
  const ownerMail = sentSubjects.find((s) => s.to === 'owner@x.com');
  ok(customerMail.subject.includes('reservation confirmed'), 'asunto del cliente en inglés (idioma de SU reserva)');
  ok(ownerMail.subject.includes('reserva confirmada'), 'asunto del dueño en español (idioma del NEGOCIO), aunque el cliente reservó en inglés');
  ok(customerMail.html.includes('Reservation confirmed'), 'cuerpo del cliente en inglés');
  ok(ownerMail.html.includes('Reserva confirmada') || ownerMail.html.includes('Teléfono:'), 'cuerpo del dueño en español');
}

console.log('8. Paridad widget.js / asistente.html — mismo comportamiento en lo compartido');
{
  for (const [name, source] of [['widget.js', widget], ['asistente.html', asistente]]) {
    ok(source.includes('bookingData = CORE.confirmarNombreUnaPalabra(bookingData, t, extraCampos, lang)'), `${name}: usa la confirmación de nombre compartida`);
    ok(source.includes("body:    JSON.stringify(Object.assign({ clientId: clientId }, bookingData, { language: lang }))") ||
       source.includes("body: JSON.stringify(Object.assign({ clientId: clientId }, bookingData, { language: lang }))"),
      `${name}: envía language al crear la reserva`);
    ok((source.match(/CORE\.motivoDisponibilidadMensaje\(/g) || []).length >= 2,
      `${name}: usa el mensaje de disponibilidad centralizado en sus puntos de consumo`);
  }
  // Solo asistente.html maneja el enlace de correo (widget.js no tiene emailAction).
  ok(!widget.includes('emailAction'), 'widget.js: sigue sin lógica de enlaces de correo (no aplica — solo asistente.html)');
  ok(asistente.includes("action: 'lookup'"), 'asistente.html: usa el lookup de solo lectura');
  ok(asistente.includes('CORE.emailActionContextoMensaje'), 'asistente.html: usa el mensaje de contexto compartido');
}

console.log('9. asistente.html — entrada desde enlace de reagendado: ejecución real, sin saludo general');
{
  ok(/else if \(!emailAction\) showGreetingNow\(\);/.test(asistente), 'el saludo genérico NUNCA se dispara cuando hay emailAction (verificado en el propio código)');
  ok(/if \(emailAction\) \{\s*\/\/ A secure email link[\s\S]*?sessionStorage\.removeItem\(SESS\);[\s\S]*?sessionStorage\.removeItem\(BOOKING_SESS\);[\s\S]*?sessionStorage\.removeItem\(RESERVA_SESS\);[\s\S]*?\} catch \(e\) \{\}\s*\} else \{\s*try \{ msgs = JSON\.parse\(sessionStorage\.getItem\(SESS\)/.test(asistente),
    'enlace seguro con sesión previa: descarta historial, reserva activa y flujo pendiente antes de restaurar estado');

  const anchor = asistente.indexOf('Links from email must work even if this browser has an unrelated');
  const start = asistente.indexOf('if (emailAction) {', anchor);
  const end = asistente.indexOf('setTimeout(function () { inp.focus(); }, 200);', start);
  const blockSrc = asistente.slice(start, end);

  async function runEmailActionBlock({ emailAction, cfg, mockResponse, mockError }) {
    const calls = [];
    const paintCalls = { n: 0 };
    const fetchMock = () => mockError
      ? Promise.reject(new Error('network'))
      : Promise.resolve({ json: async () => mockResponse });
    const fn = new Function('emailAction', 'cfg', 'CORE', 'fetch', 'addMsg', 'paint', 'API', 'clientId', blockSrc);
    fn(emailAction, cfg, CORE, fetchMock, (role, text) => calls.push(text), () => { paintCalls.n++; }, '', 'spa');
    await new Promise((r) => setTimeout(r, 20));
    return { calls, paintCalls, cfg };
  }

  const foundResult = await runEmailActionBlock({
    emailAction: { action: 'reschedule', token: 'tok-a' },
    cfg: { templateId: 'spa', language: 'es' },
    mockResponse: { found: true, reservation: { nombre: 'Mike', servicio: 'Hot Stone Massage', fecha: 'tomorrow', hora: '6:00 PM', language: 'en' } },
  });
  ok(foundResult.calls.length === 1, 'reserva encontrada: se muestra UN solo mensaje (nunca saludo + prompt genérico)');
  ok(foundResult.calls[0].includes('Mike') && foundResult.calls[0].includes('Hot Stone Massage'), 'el mensaje nombra el contexto real de la reserva');
  ok(foundResult.cfg.language === 'en', 'el idioma se toma de la reserva encontrada (no del negocio)');
  ok(foundResult.paintCalls.n >= 1, 'se repinta la UI para reflejar el idioma real de la reserva');

  const notFoundResult = await runEmailActionBlock({
    emailAction: { action: 'reschedule', token: 'no-existe' },
    cfg: { templateId: 'spa', language: 'es' },
    mockResponse: { found: false },
  });
  ok(notFoundResult.calls.length === 1 && /no encontré|could not find/i.test(notFoundResult.calls[0]),
    'reserva no encontrada: mensaje claro, sin inventar contexto');

  const errorResult = await runEmailActionBlock({
    emailAction: { action: 'cancel', token: 'tok-a' },
    cfg: { templateId: 'spa', language: 'es' },
    mockError: true,
  });
  ok(errorResult.calls.length === 1, 'si el lookup falla en red: fallback seguro, el enlace no queda bloqueado');
}

console.log('');
if (failures) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('✅ Idioma persistido, correos bilingües, lookup seguro, contexto reconstruido y mensajes centralizados verificados');
