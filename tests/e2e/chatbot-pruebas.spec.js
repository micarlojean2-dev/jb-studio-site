// Auditoría de conversación — cliente Spa, asistente.html vía Playwright real
// (navegador real, tipeo real, lectura real del DOM — no page.evaluate()
// directo a funciones internas como hacen otros specs de este directorio).
//
// Diseño: /api/client-config y /api/reservations se mockean con
// page.route() (config fija de un spa de prueba, backend de reservas
// determinista); /api/client-chat se mockea respondiendo según el TEXTO
// EXACTO del último mensaje del usuario (un mapa {mensaje -> respuesta}, no
// una cola por orden de llamada) — esto es deliberado: cuando un mensaje
// arranca una reserva nueva, el código real encadena DOS llamadas a
// /api/client-chat en el mismo turno (la de clasificación inicial y la de
// askBookingTurn() inmediatamente después, ver widget.js/asistente.html,
// rama "arranque de reserva nueva"). Una cola por orden se desalinea con
// ese doble fetch; responder por contenido del mensaje es inmune a eso y
// además es 100% reproducible y gratis (no llama al modelo real).
//
// Esto NO reemplaza una auditoría con el modelo real (ver docs/QA-STATUS.md,
// categorías A/B/L "pendiente: conversaciones con el modelo real") — esa
// fase es no-determinista y no es apta para una regresión reusable. Este
// spec cubre exactamente lo que SÍ se puede probar de forma determinista:
// el manejo de estado del frontend turno a turno, sesión, y las
// salvaguardas de código (reservationContext, sanitizeBookingEntities,
// validación de horario) — que es donde han vivido los bugs reales
// encontrados en las auditorías de esta sesión.
//
// Corre en un único proyecto de Playwright (ver playwright.config.js,
// entrada "chatbot-pruebas") para que sus 10 escenarios se ejecuten en
// SERIE y puedan escribir, cada uno, su sección al mismo archivo
// REPORTE_PRUEBAS.md sin pisarse entre sí.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.LOCAL_AUDIT_URL || 'http://localhost:4173';
const REPORT_PATH = path.join(__dirname, '..', '..', 'REPORTE_PRUEBAS.md');

test.describe.configure({ mode: 'serial' });

// ── Config de negocio fija para todos los escenarios (spa de prueba) ──────
// Un solo idioma a propósito: evita el selector de idioma inicial y así
// cada escenario puede ir directo al primer mensaje real de la prueba.
const CLIENT_CONFIG = {
  businessName: 'Spa QA Playwright',
  templateId: 'spa',
  language: 'es',
  languages: ['es'],
  color: '#1a4a2e',
  style: 'Moderno',
  active: true,
  businessHours: {
    monday:    { enabled: true,  ranges: [{ start: '10:00', end: '19:00' }] },
    tuesday:   { enabled: true,  ranges: [{ start: '10:00', end: '19:00' }] },
    wednesday: { enabled: true,  ranges: [{ start: '10:00', end: '19:00' }] },
    thursday:  { enabled: true,  ranges: [{ start: '10:00', end: '19:00' }] },
    friday:    { enabled: true,  ranges: [{ start: '10:00', end: '19:00' }] },
    saturday:  { enabled: true,  ranges: [{ start: '10:00', end: '16:00' }] },
    sunday:    { enabled: false, ranges: [] },
  },
  menu: [
    { nombre: 'Masaje relajante', precio: '700', duracion: '60' },
    { nombre: 'Manicura', precio: '250', duracion: '45' },
  ],
  features: { reservations: true, cancellation: true, rescheduling: true },
};

function emptyEntities() {
  return { service: null, date: null, time: null, name: null, email: null, phone: null, people: null, notes: null };
}
function norm(t) { return String(t || '').trim().toLowerCase(); }

// Instala los 3 mocks de red para un test.
// `responses` es un objeto { "texto exacto del mensaje (case-insensitive)": {intent, entities, text} }.
// Si el mensaje no está en el mapa, se responde con intent:'unknown' y
// entities vacías (equivalente a "la IA no entendió nada nuevo") — nunca se
// lanza un error, igual que el fail-closed real del servidor.
async function mockApi(page, { responses = {}, reservationResult } = {}) {
  const clientChatCalls = [];
  const reservationCalls = [];
  const lookup = {};
  Object.entries(responses).forEach(([k, v]) => { lookup[norm(k)] = v; });

  await page.route('**/api/client-config**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(CLIENT_CONFIG) }));

  await page.route('**/api/client-chat', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    clientChatCalls.push(body);
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    const found = lookup[norm(lastUser && lastUser.content)];
    const intent = found ? found.intent : 'unknown';
    const entities = { ...emptyEntities(), ...((found && found.entities) || {}) };
    const text = found ? (found.text || 'Entendido.') : 'Disculpa, no entendí bien 😅 ¿me lo puedes repetir?';
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text, interpretation: { intent, entities } }) });
  });

  await page.route('**/api/reservations', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    reservationCalls.push(body);
    if (body.action === 'validate') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    const result = typeof reservationResult === 'function'
      ? reservationResult(body)
      : (reservationResult || { ok: true, reservationId: 'r-qa', actionToken: 'tok-qa', status: 'confirmada', email: { customer: { sent: true } } });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });

  return { clientChatCalls, reservationCalls };
}

async function send(page, text) {
  const input = page.locator('#a-inp');
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(600); // cubre hasta 2 fetch mockeados encadenados en el mismo turno
}

// Transcripción completa en orden: mensajes de usuario/bot y los botones
// rápidos que se hayan mostrado (resumen, confirmar, modificar…).
async function transcript(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('#a-msgs > *')].map((el) => {
      if (el.classList.contains('a-quick')) {
        return { role: 'botones', text: [...el.querySelectorAll('button')].map((b) => b.textContent).join(' | ') };
      }
      const role = el.classList.contains('a-u') ? 'cliente' : 'bot';
      return { role, text: el.textContent.trim() };
    });
  });
}

async function bookingSessionState(page, clientId) {
  return page.evaluate((cid) => {
    try { return JSON.parse(sessionStorage.getItem(`jba_${cid}_booking`) || 'null'); }
    catch (e) { return null; }
  }, clientId);
}

// ── Reporte: se reinicia una sola vez, cada test agrega su sección ────────
function resetReportOnce() {
  if (resetReportOnce._done) return;
  resetReportOnce._done = true;
  const header = `# Reporte de pruebas — chatbot Spa (asistente.html)

Generado automáticamente por \`tests/e2e/chatbot-pruebas.spec.js\` (Playwright, navegador real, mocks deterministas de \`/api/client-config\`, \`/api/client-chat\`, \`/api/reservations\` — sin llamar al modelo real ni escribir en Redis real).

**Nota:** el Escenario 2 cubre el bug ya conocido ("si el cliente da su nombre en un mensaje casual antes de que el bot detecte intent=\`booking\`, ese dato se pierde y luego se vuelve a preguntar" — \`widget.js:1538-1552\` / \`asistente.html:1569-1583\`), corregido en esta misma ronda junto con los otros dos hallazgos de la corrida anterior.

---

`;
  fs.writeFileSync(REPORT_PATH, header);
}

function appendReport(md) {
  fs.appendFileSync(REPORT_PATH, md + '\n');
}

function formatTranscript(rows) {
  return rows.map((r) => `- **${r.role}:** ${r.text.replace(/\n+/g, ' ⏎ ')}`).join('\n');
}

test.beforeEach(() => resetReportOnce());

// ============================================================================
// 1) Cliente normal — todos los datos ordenados
// ============================================================================
test('Escenario 1 — cliente normal, datos ordenados', async ({ page }) => {
  const clientId = 'qa-01';
  const { reservationCalls } = await mockApi(page, {
    responses: {
      'quiero reservar una cita': { intent: 'booking', entities: {}, text: '¿Qué servicio te gustaría reservar?' },
      'masaje relajante': { intent: 'booking', entities: { service: 'Masaje relajante' }, text: '¿Qué día te gustaría venir?' },
      'el viernes': { intent: 'booking', entities: { date: 'viernes' }, text: '¿A qué hora?' },
      'a las 4 pm': { intent: 'booking', entities: { time: '4 pm' }, text: '¿Me compartes tu nombre?' },
      'ana lópez': { intent: 'booking', entities: { name: 'Ana López' }, text: '¿Tu teléfono?' },
      '5551234567': { intent: 'booking', entities: { phone: '5551234567' }, text: '¿Tu correo?' },
      'ana@example.com': { intent: 'booking', entities: { email: 'ana@example.com' }, text: 'Perfecto, dame un momento.' },
      'no': { intent: 'booking', entities: {}, text: 'Entendido, sin peticiones especiales.' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, 'Quiero reservar una cita');
  await send(page, 'Masaje relajante');
  await send(page, 'El viernes');
  await send(page, 'A las 4 pm');
  await send(page, 'Ana López');
  await send(page, '5551234567');
  await send(page, 'ana@example.com');
  await send(page, 'No');

  const rows = await transcript(page);
  const problemas = [];
  const preguntaRepetidaSpecialRequests = rows.filter((r) => r.role === 'bot' && /sensibilidad, alergia/i.test(r.text)).length > 1;
  const resumen = rows.find((r) => r.role === 'bot' && /revisemos que todo/i.test(r.text));
  const preguntasRepetidas = ['qué servicio', 'qué día', 'a qué hora', 'tu nombre', 'tu teléfono', 'tu correo']
    .filter((frag) => rows.filter((r) => r.role === 'bot' && r.text.toLowerCase().includes(frag)).length > 1);

  if (preguntaRepetidaSpecialRequests) {
    // HALLAZGO NUEVO — no es el bug ya conocido de nombre/servicio en el
    // primer mensaje. Root cause exacto (confirmado por lectura de código Y
    // reproducción en vivo con Playwright, mismo patrón byte a byte en
    // widget.js:914-923 y asistente.html:948-956):
    //   tryLocalBookingShortcut(lang, faltan) — si bookingPending===
    //   'specialRequests', SIEMPRE vuelve a mostrar la pregunta enlatada y
    //   retorna true de inmediato, ANTES de intentar interpretar la
    //   respuesta del cliente. Esto corta el turno completo antes de llegar
    //   al fetch cuyo .then() contiene la ÚNICA lógica que sabría capturar
    //   una respuesta "desnuda" (BARE_OK) para ese campo
    //   (asistente.html:1007-1013 / widget.js equivalente). Por eso esa
    //   lógica es CÓDIGO MUERTO para specialRequests: nunca se alcanza.
    //   La única asignación real de bookingData.specialRequests en todo el
    //   repo es CORE.foodPreferencesToSpecialRequests() (asistente.html:899,
    //   widget.js:863), que solo reconoce frases de comida ("sin queso",
    //   "bien cocida", etc.) — inútil para un spa/barbería, e inútil incluso
    //   en un restaurante si el cliente simplemente responde "No".
    // Resultado: bookingRequirements() nunca deja de listar 'specialRequests'
    // como pendiente, así que NINGUNA reserva puede completarse jamás por
    // conversación normal en NINGUNA plantilla, salvo que el propio dato ya
    // viniera pre-cargado en bookingData desde antes (por eso ningún test
    // existente del repo lo detectó: todos los fixtures de flujo completo
    // preseleccionan specialRequests:'' a mano en vez de dejar que la
    // conversación lo complete).
    problemas.push('BUG NUEVO (no es el ya conocido): la pregunta "¿alguna sensibilidad, alergia...?" se repite indefinidamente — ninguna respuesta del cliente puede completarla. Causa exacta: tryLocalBookingShortcut() (asistente.html:948-956 / widget.js:914-923) vuelve a mostrar esa pregunta ANTES de intentar procesar la respuesta en cada turno, dejando inalcanzable la única lógica que la capturaría (asistente.html:1007-1013). La única función que asigna bookingData.specialRequests (CORE.foodPreferencesToSpecialRequests) solo reconoce frases de comida — inútil para spa/barbería, e inútil en restaurante ante un simple "No". Ninguna reserva puede completarse por conversación normal mientras esto no se corrija.');
  }
  if (!resumen) problemas.push('nunca se mostró el resumen final tras dar todos los datos (consecuencia directa del bug de specialRequests de arriba)');
  else {
    ['Masaje relajante', 'viernes', '4:00 PM', 'Ana', '5551234567', 'ana@example.com'].forEach((dato) => {
      if (!resumen.text.includes(dato)) problemas.push(`el resumen no incluye "${dato}" (dato perdido)`);
    });
  }
  if (preguntasRepetidas.length) problemas.push(`se repitió una pregunta ya respondida: ${preguntasRepetidas.join(', ')}`);
  const botonConfirmar = rows.find((r) => r.role === 'botones' && /confirmar cita/i.test(r.text));
  if (!botonConfirmar) problemas.push('no apareció el botón real de confirmación (consecuencia directa: nunca se llegó al resumen)');

  if (botonConfirmar) {
    await page.getByRole('button', { name: /confirmar cita/i }).click();
    await page.waitForTimeout(400);
  }
  const finalRows = await transcript(page);
  const exito = finalRows.find((r) => r.role === 'bot' && /quedó confirmada/i.test(r.text));
  if (!exito) problemas.push('no se mostró el mensaje de éxito real tras confirmar (consecuencia directa: nunca hubo botón que pulsar)');
  const creacionesReales = reservationCalls.filter((c) => !c.action).length;
  if (creacionesReales !== 1) problemas.push(`se esperaba exactamente 1 creación real de reserva, hubo ${creacionesReales} (consecuencia directa del bug de arriba)`);

  appendReport(`## Escenario 1 — Cliente normal, datos ordenados

**Mensajes enviados y respuestas:**
${formatTranscript(finalRows)}

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}**
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- Sin problemas encontrados: cada dato se pidió una sola vez, el resumen refleja todo lo dado, y la confirmación real solo ocurrió tras pulsar el botón.'}
`);
  // Se registra el veredicto en el reporte y en las anotaciones de Playwright
  // SIN hacer fallar el test: los 10 escenarios corren en serie (para poder
  // escribir el mismo REPORTE_PRUEBAS.md en orden) y un fallo real que
  // abortara el test detendría también los escenarios siguientes (así
  // funciona el modo serial de Playwright). El veredicto real de cada
  // escenario vive en REPORTE_PRUEBAS.md, no en el semáforo de Playwright.
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});

// ============================================================================
// 2) Nombre y servicio en el PRIMER mensaje (bug ya conocido, no se re-reporta)
// ============================================================================
test('Escenario 2 — nombre y servicio en el primer mensaje (antes de intent=booking)', async ({ page }) => {
  const clientId = 'qa-02';
  await mockApi(page, {
    responses: {
      // Texto neutro a propósito: este mismo mensaje se consulta DOS veces en
      // el mismo turno (la clasificación inicial y, si arranca una reserva,
      // el askBookingTurn() encadenado) — no debe asumir qué falta, porque
      // eso ya lo decide bookingData real, no el texto fijo de esta prueba.
      'hola, soy carla y quiero una manicura': { intent: 'general_question', entities: { name: 'Carla', service: 'Manicura' }, text: 'Hola Carla 😊 ¿en qué te ayudo?' },
      'quiero reservar': { intent: 'booking', entities: {}, text: 'Perfecto, dame un momento.' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, 'Hola, soy Carla y quiero una manicura');
  await send(page, 'Quiero reservar');

  const rows = await transcript(page);
  const state = await bookingSessionState(page, clientId);
  const problemas = [];
  // "Carla" es una sola palabra: bookingRequirements() la deja como
  // pendiente de confirmación natural a propósito (Objetivo 5, no es este
  // bug) — lo relevante aquí es que el DATO no se haya perdido del todo.
  if (!state || state.bookingData.servicio !== 'Manicura') problemas.push(`el servicio dado en el mensaje casual se perdió (bookingData.servicio = "${state && state.bookingData.servicio}")`);
  if (!state || state.bookingData.nombre !== 'Carla') problemas.push(`el nombre dado en el mensaje casual se perdió (bookingData.nombre = "${state && state.bookingData.nombre}")`);
  const pidioNombreDeNuevo = rows.some((r) => r.role === 'bot' && /(cuál es tu nombre|me compartes tu nombre)/i.test(r.text));
  const pidioServicioDeNuevo = rows.some((r) => r.role === 'bot' && /qué servicio te gustaría/i.test(r.text));
  if (pidioNombreDeNuevo) problemas.push('el bot volvió a pedir el nombre explícitamente pese a que ya se había dado');
  if (pidioServicioDeNuevo) problemas.push('el bot volvió a pedir el servicio explícitamente pese a que ya se había dado');

  appendReport(`## Escenario 2 — Nombre y servicio en el primer mensaje, antes de "quiero reservar"

**Mensajes enviados y respuestas:**
${formatTranscript(rows)}

**bookingData tras arrancar la reserva:** \`${JSON.stringify(state && state.bookingData)}\`

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}** (bug ya conocido — \`widget.js:1538-1552\` / \`asistente.html:1569-1583\` — ahora corregido con \`preBookingMemory\`)
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- El nombre ("Carla") y el servicio ("Manicura") dados en el mensaje casual, antes de que el intent fuera `booking`, sobrevivieron y se aplicaron a bookingData al arrancar la reserva — ya no se pierden ni se vuelven a pedir.'}
`);
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});

// ============================================================================
// 3) Cliente cambia de opinión a mitad de la reserva
// ============================================================================
test('Escenario 3 — cambia de opinión de servicio a mitad del flujo', async ({ page }) => {
  const clientId = 'qa-03';
  await mockApi(page, {
    responses: {
      'quiero un masaje relajante': { intent: 'booking', entities: { service: 'Masaje relajante' }, text: '¿Qué día te gustaría?' },
      'mejor manicura': { intent: 'booking', entities: { service: 'Manicura' }, text: 'Perfecto, manicura. ¿Qué día te gustaría?' },
      'el sábado': { intent: 'booking', entities: { date: 'sábado' }, text: '¿A qué hora?' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, 'Quiero un masaje relajante');
  await send(page, 'Mejor manicura');
  await send(page, 'El sábado');

  const rows = await transcript(page);
  const state = await bookingSessionState(page, clientId);
  const problemas = [];
  if (!state || state.bookingData.servicio !== 'Manicura') problemas.push(`el servicio final debería ser "Manicura", quedó "${state && state.bookingData.servicio}"`);
  if (!state || state.bookingData.fecha !== 'sábado') problemas.push('la fecha dada después del cambio de servicio no se guardó');
  const volvioAPedirServicio = rows.filter((r) => r.role === 'bot' && /qué servicio/i.test(r.text)).length;
  if (volvioAPedirServicio > 0) problemas.push('el bot volvió a pedir el servicio después de que el cliente ya lo había corregido');

  appendReport(`## Escenario 3 — Cambia de opinión de servicio a mitad del flujo

**Mensajes enviados y respuestas:**
${formatTranscript(rows)}

**bookingData final en sessionStorage:** \`${JSON.stringify(state && state.bookingData)}\`

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}**
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- El cambio de servicio se aplicó correctamente (Masaje → Manicura) sin perder ni repetir nada, y el flujo siguió pidiendo el siguiente dato real (fecha).'}
`);
  // Se registra el veredicto en el reporte y en las anotaciones de Playwright
  // SIN hacer fallar el test: los 10 escenarios corren en serie (para poder
  // escribir el mismo REPORTE_PRUEBAS.md en orden) y un fallo real que
  // abortara el test detendría también los escenarios siguientes (así
  // funciona el modo serial de Playwright). El veredicto real de cada
  // escenario vive en REPORTE_PRUEBAS.md, no en el semáforo de Playwright.
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});

// ============================================================================
// 4) Cliente corrige un dato ya dado (fecha, hora)
// ============================================================================
test('Escenario 4 — corrige fecha y hora ya dadas', async ({ page }) => {
  const clientId = 'qa-04';
  await mockApi(page, {
    responses: {
      'quiero un masaje relajante': { intent: 'booking', entities: { service: 'Masaje relajante' }, text: '¿Qué día?' },
      'el jueves': { intent: 'booking', entities: { date: 'jueves' }, text: '¿A qué hora?' },
      'a las 5 pm': { intent: 'booking', entities: { time: '5 pm' }, text: '¿Me compartes tu nombre?' },
      'mejor el viernes': { intent: 'booking', entities: { date: 'viernes' }, text: 'Listo, cambiado a viernes.' },
      'mejor a las 6 pm': { intent: 'booking', entities: { time: '6 pm' }, text: 'Cambiado a las 6 pm. ¿Me compartes tu nombre?' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, 'Quiero un masaje relajante');
  await send(page, 'El jueves');
  await send(page, 'A las 5 pm');
  await send(page, 'Mejor el viernes');
  await send(page, 'Mejor a las 6 pm');

  const rows = await transcript(page);
  const state = await bookingSessionState(page, clientId);
  const problemas = [];
  if (!state || state.bookingData.fecha !== 'viernes') problemas.push(`la fecha debería quedar en "viernes", quedó "${state && state.bookingData.fecha}"`);
  if (!state || state.bookingData.hora !== '6:00 PM') problemas.push(`la hora debería quedar en "6:00 PM", quedó "${state && state.bookingData.hora}"`);
  if (!state || state.bookingData.servicio !== 'Masaje relajante') problemas.push('el servicio se perdió al corregir fecha/hora (no debería tocarse)');

  appendReport(`## Escenario 4 — Corrige fecha y hora ya dadas

**Mensajes enviados y respuestas:**
${formatTranscript(rows)}

**bookingData final:** \`${JSON.stringify(state && state.bookingData)}\`

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}**
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- Ambas correcciones (fecha y hora) se aplicaron sin afectar el servicio ya elegido.'}
`);
  // Se registra el veredicto en el reporte y en las anotaciones de Playwright
  // SIN hacer fallar el test: los 10 escenarios corren en serie (para poder
  // escribir el mismo REPORTE_PRUEBAS.md en orden) y un fallo real que
  // abortara el test detendría también los escenarios siguientes (así
  // funciona el modo serial de Playwright). El veredicto real de cada
  // escenario vive en REPORTE_PRUEBAS.md, no en el semáforo de Playwright.
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});

// ============================================================================
// 5) Todo en un solo mensaje largo
// ============================================================================
test('Escenario 5 — todos los datos en un solo mensaje largo', async ({ page }) => {
  const clientId = 'qa-05';
  const mensajeLargo = 'Hola, quiero reservar un masaje relajante para el viernes a las 4 pm, me llamo Sofía Ruiz y mi teléfono es 5559876543';
  await mockApi(page, {
    responses: {
      [mensajeLargo]: { intent: 'booking', entities: { name: 'Sofía Ruiz', service: 'Masaje relajante', date: 'viernes', time: '4 pm', phone: '5559876543' }, text: '¿Me compartes tu correo?' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, mensajeLargo);

  const rows = await transcript(page);
  const state = await bookingSessionState(page, clientId);
  const problemas = [];
  const esperado = { servicio: 'Masaje relajante', fecha: 'viernes', hora: '4:00 PM', nombre: 'Sofía Ruiz', telefono: '5559876543' };
  Object.entries(esperado).forEach(([campo, valor]) => {
    if (!state || state.bookingData[campo] !== valor) problemas.push(`campo "${campo}" esperado "${valor}", quedó "${state && state.bookingData[campo]}"`);
  });
  const pidioAlgoYaDado = rows.some((r) => r.role === 'bot' && /(qué servicio te gustaría|qué día|a qué hora|tu nombre|tu teléfono)/i.test(r.text));
  if (pidioAlgoYaDado) problemas.push('el bot volvió a pedir un dato que ya vino en el mensaje único');

  appendReport(`## Escenario 5 — Todos los datos en un solo mensaje largo

**Mensajes enviados y respuestas:**
${formatTranscript(rows)}

**bookingData final:** \`${JSON.stringify(state && state.bookingData)}\`

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}**
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- Los 5 datos del único mensaje se capturaron todos en el mismo turno; solo se pidió el correo, que era lo único faltante.'}
`);
  // Se registra el veredicto en el reporte y en las anotaciones de Playwright
  // SIN hacer fallar el test: los 10 escenarios corren en serie (para poder
  // escribir el mismo REPORTE_PRUEBAS.md en orden) y un fallo real que
  // abortara el test detendría también los escenarios siguientes (así
  // funciona el modo serial de Playwright). El veredicto real de cada
  // escenario vive en REPORTE_PRUEBAS.md, no en el semáforo de Playwright.
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});

// ============================================================================
// 6) Pregunta precio/horario en medio de reservar, sin cancelar
// ============================================================================
test('Escenario 6 — pregunta precio a mitad de la reserva sin cancelar', async ({ page }) => {
  const clientId = 'qa-06';
  await mockApi(page, {
    responses: {
      'quiero un masaje relajante': { intent: 'booking', entities: { service: 'Masaje relajante' }, text: '¿Qué día te gustaría?' },
      '¿cuánto cuesta?': { intent: 'general_question', entities: {}, text: 'El masaje relajante cuesta $700 y dura 60 minutos. ¿Seguimos con tu reserva?' },
      'el sábado': { intent: 'booking', entities: { date: 'sábado' }, text: '¿A qué hora?' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, 'Quiero un masaje relajante');
  await send(page, '¿Cuánto cuesta?');
  await send(page, 'El sábado');

  const rows = await transcript(page);
  const state = await bookingSessionState(page, clientId);
  const problemas = [];
  if (!state || state.bookingData.servicio !== 'Masaje relajante') problemas.push('el servicio se perdió al preguntar el precio en medio del flujo');
  if (!state || state.bookingData.fecha !== 'sábado') problemas.push('la fecha dada después de la pregunta de precio no se guardó');
  const respuestaPrecio = rows.find((r) => r.role === 'bot' && /\$700/.test(r.text));
  if (!respuestaPrecio) problemas.push('no se mostró la respuesta del precio');
  const precioInventado = rows.some((r) => r.role === 'bot' && /\$\d+/.test(r.text) && !/\$700/.test(r.text));
  if (precioInventado) problemas.push('el bot mostró un precio distinto al $700 real del catálogo (precio inventado)');

  appendReport(`## Escenario 6 — Pregunta precio a mitad de la reserva, sin cancelar

**Mensajes enviados y respuestas:**
${formatTranscript(rows)}

**bookingData final:** \`${JSON.stringify(state && state.bookingData)}\`

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}**
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- La pregunta de precio se respondió sin interrumpir ni perder el estado de la reserva en curso.'}
`);
  // Se registra el veredicto en el reporte y en las anotaciones de Playwright
  // SIN hacer fallar el test: los 10 escenarios corren en serie (para poder
  // escribir el mismo REPORTE_PRUEBAS.md en orden) y un fallo real que
  // abortara el test detendría también los escenarios siguientes (así
  // funciona el modo serial de Playwright). El veredicto real de cada
  // escenario vive en REPORTE_PRUEBAS.md, no en el semáforo de Playwright.
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});

// ============================================================================
// 7) Cliente pide cancelar a mitad del flujo
// ============================================================================
test('Escenario 7 — cancela a mitad del flujo', async ({ page }) => {
  const clientId = 'qa-07';
  const { clientChatCalls } = await mockApi(page, {
    responses: {
      'quiero un masaje relajante': { intent: 'booking', entities: { service: 'Masaje relajante' }, text: '¿Qué día te gustaría?' },
      'el viernes': { intent: 'booking', entities: { date: 'viernes' }, text: '¿A qué hora?' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, 'Quiero un masaje relajante');
  await send(page, 'El viernes');
  const llamadasAntesDeCancelar = clientChatCalls.length;
  await send(page, 'cancelar');

  const rows = await transcript(page);
  const state = await bookingSessionState(page, clientId);
  const problemas = [];
  const confirmoCancelacion = rows.some((r) => r.role === 'bot' && /reserva cancelada/i.test(r.text));
  if (!confirmoCancelacion) problemas.push('no se mostró un mensaje claro de cancelación');
  if (clientChatCalls.length !== llamadasAntesDeCancelar) problemas.push('cancelar disparó una llamada a la IA (debería ser 100% local/determinista)');

  // Comprobación empírica del hallazgo: si bookingData quedó en sessionStorage
  // pese a haberse limpiado en memoria, un refresh justo después de cancelar
  // debería resucitar los datos "cancelados".
  let stateTrasRecargar = null;
  if (state && state.bookingData && Object.keys(state.bookingData).length > 0) {
    await page.reload();
    await page.waitForTimeout(400);
    stateTrasRecargar = await bookingSessionState(page, clientId);
    problemas.push(`BUG NUEVO: bookingData NO se limpió en sessionStorage al cancelar — quedó \`${JSON.stringify(state.bookingData)}\`. Causa exacta: la rama "cancelar" (asistente.html:1435-1443 / widget.js:1373-1382) resetea bookingStep/bookingData/selectedService en memoria pero NUNCA llama a save() — a diferencia de todas las demás ramas del flujo, que sí lo hacen. save() (asistente.html:465-469) es la única función que borra BOOKING_SESS de sessionStorage cuando bookingStep vuelve a 0. Consecuencia comprobada: recargar la página justo después de cancelar restaura la reserva "cancelada" como si nunca se hubiera cancelado (bookingData tras recargar: \`${JSON.stringify(stateTrasRecargar && stateTrasRecargar.bookingData)}\`).`);
  }

  appendReport(`## Escenario 7 — Cancela a mitad del flujo

**Mensajes enviados y respuestas:**
${formatTranscript(rows)}

**bookingData tras cancelar (en memoria, mensaje mostrado correctamente):** \`${JSON.stringify(state && state.bookingData)}\`
${stateTrasRecargar !== null ? `**bookingData tras RECARGAR la página inmediatamente después de cancelar:** \`${JSON.stringify(stateTrasRecargar && stateTrasRecargar.bookingData)}\`` : ''}

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}**
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- La cancelación fue inmediata, local (sin llamar a la IA), con mensaje claro y bookingData limpio incluso tras recargar.'}
`);
  // Se registra el veredicto en el reporte y en las anotaciones de Playwright
  // SIN hacer fallar el test: los 10 escenarios corren en serie (para poder
  // escribir el mismo REPORTE_PRUEBAS.md en orden) y un fallo real que
  // abortara el test detendría también los escenarios siguientes (así
  // funciona el modo serial de Playwright). El veredicto real de cada
  // escenario vive en REPORTE_PRUEBAS.md, no en el semáforo de Playwright.
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});

// ============================================================================
// 8) Errores de ortografía / mensajes abreviados
// ============================================================================
test('Escenario 8 — errores de ortografía y mensajes abreviados', async ({ page }) => {
  const clientId = 'qa-08';
  await mockApi(page, {
    responses: {
      // Primer mensaje mal escrito: se simula una IA que NO logra entenderlo
      // del todo (queda fuera del mapa -> fallback intent:'unknown').
      'que horario tienen': { intent: 'general_question', entities: {}, text: 'Abrimos de 10am a 7pm entre semana, y sábados de 10am a 4pm.' },
      // "kiero un masaj" — se simula que la IA SÍ logra reconocerlo (típico
      // de un modelo real con buena tolerancia a errores de tecleo).
      'kiero un masaj': { intent: 'booking', entities: { service: 'Masaje relajante' }, text: '¡Claro! ¿qué día te gustaría?' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, 'q dia tenes libre');       // no está en el mapa -> fallback "no entendí"
  await send(page, 'que horario tienen');
  await send(page, 'kiero un masaj');

  const rows = await transcript(page);
  const state = await bookingSessionState(page, clientId);
  const problemas = [];
  if (!state || state.bookingData.servicio !== 'Masaje relajante') problemas.push('el servicio no quedó capturado tras "kiero un masaj"');
  const respondioATodo = rows.filter((r) => r.role === 'bot').length >= 3;
  if (!respondioATodo) problemas.push('el bot dejó algún mensaje sin responder');
  const noEntendi = rows.find((r) => r.role === 'bot' && /no entendí/i.test(r.text));
  if (!noEntendi) problemas.push('el mensaje ambiguo no disparó el fallback esperado de "no entendí" (revisar si cambió el texto exacto)');

  appendReport(`## Escenario 8 — Errores de ortografía y mensajes abreviados

**Mensajes enviados y respuestas:**
${formatTranscript(rows)}

**bookingData final:** \`${JSON.stringify(state && state.bookingData)}\`

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}**
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- El código manejó correctamente tanto el caso de "no entendí" (intent unknown) como el caso de comprensión exitosa, sin trabarse ni perder estado.'}

**Aclaración importante:** este escenario usa una interpretación SIMULADA para cada mensaje — la tolerancia REAL a errores de ortografía depende del modelo de IA en vivo (DeepSeek), no de este código, y no puede verificarse con mocks. Esta prueba solo confirma que el CÓDIGO se comporta bien sea cual sea el resultado que la IA devuelva (entendido o no entendido), no mide qué tan bien la IA real entiende texto con errores. Esa verificación queda pendiente como "conversaciones con el modelo real" (ver \`docs/QA-STATUS.md\`).
`);
  // Se registra el veredicto en el reporte y en las anotaciones de Playwright
  // SIN hacer fallar el test: los 10 escenarios corren en serie (para poder
  // escribir el mismo REPORTE_PRUEBAS.md en orden) y un fallo real que
  // abortara el test detendría también los escenarios siguientes (así
  // funciona el modo serial de Playwright). El veredicto real de cada
  // escenario vive en REPORTE_PRUEBAS.md, no en el semáforo de Playwright.
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});

// ============================================================================
// 9) Hora fuera del horario del negocio
// ============================================================================
test('Escenario 9 — hora fuera del horario del negocio', async ({ page }) => {
  const clientId = 'qa-09';
  await mockApi(page, {
    responses: {
      'quiero un masaje relajante': { intent: 'booking', entities: { service: 'Masaje relajante' }, text: '¿Qué día te gustaría?' },
      'el lunes': { intent: 'booking', entities: { date: 'lunes' }, text: '¿A qué hora?' },
      // El negocio cierra a las 19:00 entre semana — 9 PM está fuera de horario.
      'a las 9 pm': { intent: 'booking', entities: { time: '9 pm' }, text: 'Anotado.' },
      'mejor a las 6 pm': { intent: 'booking', entities: { time: '6 pm' }, text: '¿Me compartes tu nombre?' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, 'Quiero un masaje relajante');
  await send(page, 'El lunes');
  await send(page, 'A las 9 pm');

  let rows = await transcript(page);
  let state = await bookingSessionState(page, clientId);
  const problemas = [];
  if (state && state.bookingData.hora === '9:00 PM') problemas.push('se guardó una hora fuera del horario del negocio (9 PM, cierra a las 7 PM)');
  const rechazo = rows.some((r) => r.role === 'bot' && /(cerrados|fuera de horario|no disponible)/i.test(r.text));
  if (!rechazo) problemas.push('no se mostró ningún aviso de que esa hora está fuera de horario');

  // El cliente corrige a una hora válida — debe aceptarse con normalidad.
  await send(page, 'Mejor a las 6 pm');
  rows = await transcript(page);
  state = await bookingSessionState(page, clientId);
  if (!state || state.bookingData.hora !== '6:00 PM') problemas.push('una hora válida dada después del rechazo no se guardó');

  appendReport(`## Escenario 9 — Hora fuera del horario del negocio

**Mensajes enviados y respuestas:**
${formatTranscript(rows)}

**bookingData final:** \`${JSON.stringify(state && state.bookingData)}\`

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}**
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- La hora fuera de horario (9 PM) se rechazó correctamente sin guardarse, y la corrección a una hora válida (6 PM) sí se aceptó.'}
`);
  // Se registra el veredicto en el reporte y en las anotaciones de Playwright
  // SIN hacer fallar el test: los 10 escenarios corren en serie (para poder
  // escribir el mismo REPORTE_PRUEBAS.md en orden) y un fallo real que
  // abortara el test detendría también los escenarios siguientes (así
  // funciona el modo serial de Playwright). El veredicto real de cada
  // escenario vive en REPORTE_PRUEBAS.md, no en el semáforo de Playwright.
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});

// ============================================================================
// 10) Cliente se queda callado y recarga la página a mitad del flujo
// ============================================================================
test('Escenario 10 — recarga de página a mitad del flujo (sessionStorage)', async ({ page }) => {
  const clientId = 'qa-10';
  await mockApi(page, {
    responses: {
      'quiero una manicura el sábado': { intent: 'booking', entities: { service: 'Manicura', date: 'sábado' }, text: '¿A qué hora?' },
      'a las 11 am': { intent: 'booking', entities: { time: '11 am' }, text: '¿Me compartes tu nombre?' },
    },
  });

  await page.goto(`${BASE}/asistente.html?id=${clientId}`);
  await send(page, 'Quiero una manicura el sábado');

  const stateAntes = await bookingSessionState(page, clientId);
  const problemas = [];
  if (!stateAntes || stateAntes.bookingData.servicio !== 'Manicura' || stateAntes.bookingData.fecha !== 'sábado') {
    problemas.push('el estado antes de recargar ya venía incompleto/incorrecto');
  }

  await page.reload();
  await page.waitForTimeout(500);

  const stateDespues = await bookingSessionState(page, clientId);
  if (!stateDespues) problemas.push('sessionStorage no sobrevivió a la recarga (bookingData perdido por completo)');
  else {
    if (stateDespues.bookingData.servicio !== 'Manicura') problemas.push('el servicio se perdió tras recargar la página');
    if (stateDespues.bookingData.fecha !== 'sábado') problemas.push('la fecha se perdió tras recargar la página');
    if (stateDespues.bookingStep !== 1) problemas.push('bookingStep no se restauró correctamente tras recargar');
  }

  // Retoma la conversación después de "quedarse callado" y recargar.
  await send(page, 'A las 11 am');
  const rows = await transcript(page);
  const stateFinal = await bookingSessionState(page, clientId);
  if (!stateFinal || stateFinal.bookingData.hora !== '11:00 AM') problemas.push('el dato dado DESPUÉS de recargar no se aplicó sobre el estado restaurado');
  if (!stateFinal || stateFinal.bookingData.servicio !== 'Manicura' || stateFinal.bookingData.fecha !== 'sábado') problemas.push('los datos de ANTES de recargar no sobrevivieron hasta el final de la conversación');
  const volvioAPreguntarServicioOFecha = rows.some((r) => r.role === 'bot' && /(qué servicio|qué día)/i.test(r.text));
  if (volvioAPreguntarServicioOFecha) problemas.push('tras recargar, el bot volvió a preguntar un dato que ya se había dado antes de la recarga');

  appendReport(`## Escenario 10 — Recarga de página a mitad del flujo

**Estado en sessionStorage antes de recargar:** \`${JSON.stringify(stateAntes && stateAntes.bookingData)}\`
**Estado en sessionStorage justo después de recargar:** \`${JSON.stringify(stateDespues && stateDespues.bookingData)}\`

**Mensajes enviados y respuestas (incluye lo posterior a la recarga):**
${formatTranscript(rows)}

**Verdicto: ${problemas.length ? 'FALLÓ' : 'PASÓ'}**
${problemas.length ? problemas.map((p) => `- ${p}`).join('\n') : '- sessionStorage restauró bookingData/bookingStep exactamente como quedaron antes de recargar, y la conversación continuó sin repetir preguntas ni perder datos.'}
`);
  // Se registra el veredicto en el reporte y en las anotaciones de Playwright
  // SIN hacer fallar el test: los 10 escenarios corren en serie (para poder
  // escribir el mismo REPORTE_PRUEBAS.md en orden) y un fallo real que
  // abortara el test detendría también los escenarios siguientes (así
  // funciona el modo serial de Playwright). El veredicto real de cada
  // escenario vive en REPORTE_PRUEBAS.md, no en el semáforo de Playwright.
  if (problemas.length) test.info().annotations.push({ type: 'FALLÓ', description: problemas.join(' | ') });
  console.log(`  -> ${problemas.length ? 'FALLÓ' : 'PASÓ'}: ${test.info().title}`);
});
