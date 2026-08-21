// Auditoría supervisada del chatbot. Todo el estado refleja únicamente texto o
// clics ya enviados por el cliente automatizado; nunca datos planeados.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = 'https://jbstudio.app';
const LOCAL_URL = 'http://127.0.0.1:4173';
const clientId = process.argv[2] || 'spa';
const assistantUrl = `${BASE_URL}/asistente.html?id=${encodeURIComponent(clientId)}`;
const timestamp = Date.now();
const capturesDir = `auditoria-capturas-${clientId}-${timestamp}`;
const reportPath = `auditoria-conversaciones-${clientId}-${timestamp}.md`;
const MAX_TURNS = 20;
const HUMAN_DELAY = 2000;
fs.mkdirSync(capturesDir, { recursive: true });

const emptyState = () => ({
  servicio: null, fecha: null, hora: null, nombre: null,
  telefono: null, email: null, notas: null,
});
const scenarios = [
  { code: 'A', name: 'Preguntas informativas sin reservar', goal: 'informacion_servicio', initial: '¿cuál es el precio y la duración del masaje relajante?', rephrase: '¿cuánto cuesta el masaje relajante y cuánto dura?' },
  { code: 'B', name: 'Reserva con corrección coherente', goal: 'resumen_reserva', initial: 'Quiero reservar un masaje relajante para el próximo sábado a las 4 de la tarde.', rephrase: 'Me gustaría agendar un masaje relajante el sábado próximo, a las cuatro de la tarde.' },
  { code: 'C', name: 'Horario ocupado y alternativa', goal: 'alternativa_horario', initial: 'Quiero reservar un masaje relajante para el próximo sábado a las 4 de la tarde.', rephrase: 'Busco una cita para masaje relajante el sábado próximo a las 4 PM.' },
  { code: 'D', name: 'Slots reales de disponibilidad', goal: 'slots_disponibles', initial: 'Quiero reservar un masaje relajante para el próximo sábado. ¿Qué horarios tienen disponibles?', rephrase: 'Para el sábado próximo necesito conocer las horas libres para un masaje relajante.' },
  { code: 'E', name: 'Memoria y actualización de datos', goal: 'correccion_dato', initial: 'Quiero reservar un masaje relajante para el próximo sábado a las 4 de la tarde.', rephrase: 'Necesito programar un masaje relajante para el sábado próximo, a las cuatro de la tarde.' },
  { code: 'J', name: 'Día cerrado u horario inválido', goal: 'rechazo_horario', initial: 'Quiero reservar un masaje relajante para este domingo a las 3 de la mañana.', rephrase: 'Quisiera una cita de masaje relajante este domingo a las tres de la mañana.' },
  { code: 'K', name: 'Hora explícita PM', goal: 'hora_pm_sin_pregunta', initial: 'Quiero reservar un masaje relajante para el próximo sábado a las 4 de la tarde.', rephrase: 'Quiero agendar un masaje relajante el sábado próximo a las cuatro de la tarde.' },
  { code: 'L', name: 'Hora explícita AM sin fecha falsa', goal: 'hora_am_sin_fecha', initial: 'Quiero reservar un masaje relajante a las 3 de la mañana.', rephrase: 'Necesito una cita de masaje relajante a las tres de la mañana.' },
  { code: 'M', name: 'Hora implícita según horario', goal: 'hora_deducida_pm', initial: 'Quiero reservar el sábado a las 4.', rephrase: 'Para el sábado quiero una cita a las cuatro.' },
  { code: 'N', name: 'Ambigüedad real con botones', goal: 'botones_ampm', mode: 'local-mock', initial: 'Quiero reservar a las 4.' },
  { code: 'O', name: 'Fecha real más hora', goal: 'fecha_y_hora', initial: 'Mañana a las 3 PM.', rephrase: 'Quiero una cita mañana a las tres PM.' },
  { code: 'F', name: 'Persistencia backend', goal: 'escritura_produccion_bloqueada', blocked: true },
  { code: 'G', name: 'Modificación API', goal: 'escritura_produccion_bloqueada', blocked: true },
  { code: 'H', name: 'Cancelación API', goal: 'escritura_produccion_bloqueada', blocked: true },
  { code: 'I', name: 'Idempotencia', goal: 'escritura_produccion_bloqueada', blocked: true },
];

function text(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function isConfusion(reply) { return /no te entend[ií]|no entend[ií]|me lo repites|couldn't understand|didn't catch/i.test(reply); }
function isSummary(reply) { return /revisemos|resumen|todo correcto|all good|confirmar|confirm it/i.test(reply); }
function primaryBotIntent(reply) {
  const value = text(reply).toLowerCase();
  if (/(?:dime|indica|compart[eí]|cu[aá]l es|necesito).*(?:tu |el )?(?:nombre)|c[oó]mo te llamas|nombre completo/.test(value)) return 'nombre';
  if (/(?:dime|indica|compart[eí]|cu[aá]l es|necesito).*(?:tu |el )?(?:tel[eé]fono|celular)|n[uú]mero de (?:tel[eé]fono|celular)/.test(value)) return 'telefono';
  if (/(?:dime|indica|compart[eí]|cu[aá]l es|necesito).*(?:tu |el )?(?:correo|email)|correo electr[oó]nico/.test(value)) return 'email';
  if (/(?:qu[eé]|cu[aá]l).*(?:d[ií]a|fecha)|para qu[eé] (?:d[ií]a|fecha)|qu[eé] fecha/.test(value)) return 'fecha';
  if (/(?:qu[eé]|cu[aá]l).*(?:hora|horario)|a qu[eé] hora|te refieres a las/.test(value)) return 'hora';
  if (/(?:qu[eé]|cu[aá]l).*(?:servicio|masaje)|qu[eé] servicio|elige.*(?:servicio|masaje)/.test(value)) return 'servicio';
  if (/(?:deseas|quieres|puedes).*(?:confirmar|confirmaci[oó]n)|todo correcto|all good|yes,? confirm|s[ií],? confirmar/.test(value)) return 'confirmacion';
  return null;
}
function timeMatches(value) {
  return text(value).match(/\b(?:[0-1]?\d|2[0-3]):[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)\b/gi) || [];
}
async function isSlots(page, reply) {
  const buttonSlots = (await page.locator('.a-quick-btn').allTextContents()).map(text).filter(value => timeMatches(value).length > 0);
  const replySlots = timeMatches(reply);
  if (buttonSlots.length) return { found: true, source: 'chatbot-ui', slots: buttonSlots, backendValidated: false };
  if (replySlots.length >= 2) return { found: true, source: 'chatbot-text', slots: replySlots, backendValidated: false };
  return { found: false, source: null, slots: [], backendValidated: false };
}
function isCatalog(page, reply) {
  return page.locator('.a-card, .a-cards-wrap').count().then(n => n > 0);
}
function snapshotState(state) { return { ...state }; }
async function readBookingData(page) {
  return page.evaluate(() => {
    for (const key of Object.keys(sessionStorage)) {
      if (!key.endsWith('_booking')) continue;
      try { return JSON.parse(sessionStorage.getItem(key) || '{}').bookingData || {}; } catch (_) {}
    }
    return {};
  });
}
async function syncActualState(page, state) {
  const bookingData = await readBookingData(page);
  for (const key of Object.keys(state)) {
    if (bookingData[key] !== undefined) state[key] = bookingData[key] || null;
  }
  return bookingData;
}

function setActualState(state, message) {
  const m = text(message);
  if (/masaje relajante/i.test(m)) state.servicio = 'masaje relajante';
  if (/domingo/i.test(m)) state.fecha = 'domingo';
  else if (/s[aá]bado/i.test(m)) state.fecha = 'sábado';
  if (/3 de la ma[ñn]ana|3:00\s*am/i.test(m)) state.hora = '3:00 AM';
  else if (/5 de la tarde|5:00\s*pm|\b5\s*pm\b/i.test(m)) state.hora = '5:00 PM';
  else if (/4 de la tarde|4:00\s*pm|\b4\s*pm\b/i.test(m)) state.hora = '4:00 PM';
  const name = m.match(/(?:me llamo|mi nombre es)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,60})/i);
  if (name) state.nombre = text(name[1]);
  const phone = m.match(/\b\d{7,15}\b/);
  if (phone) state.telefono = phone[0];
  const email = m.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  if (email) state.email = email[0];
  if (/sin (?:peticiones|solicitudes) especiales|ninguna.*petici[oó]n/i.test(m)) state.notas = 'sin peticiones especiales';
}

function validarMensajeCliente({ ultimaRespuestaBot, mensajePropuesto, estado, escenario }) {
  const message = text(mensajePropuesto).toLowerCase();
  const intent = primaryBotIntent(ultimaRespuestaBot);
  if (!message) return { valido: false, motivo: 'Mensaje vacío.' };
  if (intent === 'nombre' && !/(me llamo|mi nombre es|^[a-záéíóúñ ]{3,}$)/i.test(message)) return { valido: false, motivo: 'El bot pidió nombre y la respuesta propuesta no aporta un nombre.' };
  if (intent === 'telefono' && !/\d{7,}/.test(message)) return { valido: false, motivo: 'El bot pidió teléfono y la respuesta propuesta no aporta teléfono.' };
  if (intent === 'email' && !/@/.test(message)) return { valido: false, motivo: 'El bot pidió correo y la respuesta propuesta no aporta correo.' };
  if (intent === 'fecha' && !/(s[aá]bado|domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|pr[oó]ximo)/.test(message)) return { valido: false, motivo: 'El bot pidió fecha y el mensaje no aporta fecha.' };
  if (intent === 'hora' && !/(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|ma[ñn]ana|tarde)/.test(message) && !/horarios disponibles/.test(message)) return { valido: false, motivo: 'El bot pidió hora y el mensaje no aporta una hora compatible.' };
  if (intent === 'servicio' && !/(masaje relajante|servicios|cat[aá]logo)/.test(message)) return { valido: false, motivo: 'El bot pidió servicio y el mensaje no elige ni consulta un servicio.' };
  if (/cambiar|corregir/.test(message)) {
    if (/(hora|horario)/.test(message) && !estado.hora) return { valido: false, motivo: 'Intentaría cambiar una hora que nunca fue enviada.' };
    if (/fecha|d[ií]a/.test(message) && !estado.fecha) return { valido: false, motivo: 'Intentaría cambiar una fecha que nunca fue enviada.' };
    if (/nombre/.test(message) && !estado.nombre) return { valido: false, motivo: 'Intentaría cambiar un nombre que nunca fue enviado.' };
  }
  return { valido: true, motivo: `La respuesta es compatible con la intención principal del bot (${intent || 'sin petición detectable'}) y el estado real.` };
}

function nextMessage(scenario, reply, state, control) {
  const lower = reply.toLowerCase();
  const intent = primaryBotIntent(reply);
  if (isConfusion(reply)) {
    if (control.rephrases === 0) {
      control.rephrases++;
      return { type: 'send', message: scenario.rephrase, note: 'Reformulación de la misma intención.' };
    }
    control.goalFailed = true;
    return { type: 'continue-with-finding', reason: 'El chatbot no entendió la intención original tras una reformulación equivalente.', origin: 'chatbot', message: scenario.initial };
  }
  // La petición visible del bot manda sobre el objetivo histórico: contestar
  // el campo actual mantiene el flujo real y evita recuperaciones genéricas.
  if (intent === 'nombre' && !state.nombre) return { type: 'send', message: 'Me llamo Miguel Carlo.', note: 'Respuesta al pedido actual de nombre.' };
  if (intent === 'telefono' && !state.telefono) return { type: 'send', message: 'Mi teléfono es 5551234567.', note: 'Respuesta al pedido actual de teléfono.' };
  if (intent === 'email' && !state.email) return { type: 'send', message: 'Mi correo es miguel.carlo@example.com.', note: 'Respuesta al pedido actual de correo.' };
  if (intent === 'servicio' && !state.servicio) return { type: 'send', message: 'Quiero el masaje relajante.', note: 'Respuesta al pedido actual de servicio.' };
  if (intent === 'fecha' && !state.fecha) return { type: 'send', message: scenario.code === 'J' ? 'Este domingo.' : 'El próximo sábado.', note: 'Respuesta al pedido actual de fecha.' };
  if (intent === 'hora' && !state.hora) return { type: 'send', message: scenario.code === 'J' ? 'A las 3 de la mañana.' : 'A las 4 de la tarde.', note: 'Respuesta al pedido actual de hora.' };
  if (/te refieres a las \d+ de la (?:tarde|ma[ñn]ana)/i.test(reply) && state.hora) {
    return { type: 'send', message: `Sí, a las ${state.hora.replace(':00 ', ' de la ').replace('PM', 'tarde').replace('AM', 'mañana')}.`, note: 'Confirma la franja AM/PM solicitada por el bot.' };
  }
  if (/petici[oó]n especial|alergia|restricci[oó]n/.test(lower) && state.notas === null) return { type: 'send', message: 'No tengo peticiones especiales.', note: 'Respuesta al pedido actual de petición especial.' };
  if (intent === 'confirmacion' || isSummary(reply)) return { type: 'confirmation-reached', reason: 'Llegó a la etapa de confirmación; no se pulsa ningún botón ni se crea una reserva.' };

  if (scenario.goal === 'informacion_servicio' && /precio|duraci[oó]n|cuesta|dura/i.test(reply)) return { type: 'complete', reason: 'Respondió información de precio o duración.' };
  if (scenario.goal === 'slots_disponibles' && control.slotEvidence?.found && control.slotEvidence.source.startsWith('chatbot-')) return { type: 'complete', reason: `Mostró slots reales desde ${control.slotEvidence.source}: ${control.slotEvidence.slots.join(', ')}.` };
  if (scenario.goal === 'hora_pm_sin_pregunta' && control.redundantAmpmEvidence) {
    control.goalFailed = true;
    return { type: 'continue-with-finding', reason: `Pidió una aclaración AM/PM redundante en el turno ${control.redundantAmpmEvidence.turn}.`, origin: 'chatbot', message: scenario.initial };
  }
  if (scenario.goal === 'hora_pm_sin_pregunta' && state.hora === '4:00 PM') return { type: 'complete', reason: 'Guardó 4:00 PM sin pedir aclaración AM/PM.' };
  if (scenario.goal === 'hora_am_sin_fecha' && state.hora === '3:00 AM' && state.fecha !== 'mañana') return { type: 'complete', reason: 'Guardó 3:00 AM sin crear fecha mañana.' };
  if (scenario.goal === 'hora_deducida_pm' && state.hora === '4:00 PM' && !control.ampmButtons.length) return { type: 'complete', reason: 'Dedujo 4:00 PM sin mostrar botones AM/PM.' };
  if (scenario.goal === 'fecha_y_hora' && state.fecha === 'mañana' && state.hora === '3:00 PM') return { type: 'complete', reason: 'Guardó fecha mañana y hora 3:00 PM.' };
  if (scenario.goal === 'alternativa_horario' && /ocupad|reservad|alternativ|ofrec/i.test(reply)) return { type: 'complete', reason: 'Ofreció una alternativa tras un horario no disponible.' };
  if (scenario.goal === 'rechazo_horario' && /cerrad|fuera de horario|no disponible|no atendemos/i.test(reply)) return { type: 'complete', reason: 'Explicó el rechazo de día/hora inválido.' };
  if (scenario.goal === 'correccion_dato' && state.hora === '4:00 PM' && /perfecto|\b4(?::00)?\s*(?:pm|p\.m\.|de la tarde)\b|resumen|confirm/i.test(reply) && !control.corrected) {
    control.corrected = true;
    return { type: 'send', message: 'En realidad, prefiero cambiar la hora a las 5 de la tarde.', note: 'Corrección de una hora enviada previamente.' };
  }
  if (scenario.goal === 'correccion_dato' && control.corrected && /\b5(?::00)?\s*(?:pm|p\.m\.|de la tarde)\b/i.test(reply) && !/\b4(?::00)?\s*(?:pm|p\.m\.|de la tarde)\b/i.test(reply)) control.correctionAccepted = true;
  if (scenario.goal === 'correccion_dato' && control.correctionAccepted && isSummary(reply) && /\b5(?::00)?\s*(?:pm|p\.m\.|de la tarde)\b/i.test(reply) && !/\b4(?::00)?\s*(?:pm|p\.m\.|de la tarde)\b/i.test(reply)) return { type: 'complete', reason: 'El resumen final conserva 5 PM y no vuelve a mencionar 4 PM.' };
  if (/(nombre).*(tel[eé]fono|celular).*(correo|email)|(correo|email).*(tel[eé]fono|celular).*(nombre)/.test(lower)) return { type: 'send', message: 'Me llamo Miguel Carlo, mi teléfono es 5551234567 y mi correo es miguel.carlo@example.com.', note: 'El bot pidió múltiples datos y se responden juntos.' };
  return { type: 'continue-with-finding', reason: `No hay una continuación específica para esta respuesta del bot: "${reply}"`, origin: 'script', message: scenario.initial };
}

async function waitForReply(page, previousBotCount) {
  const botMessages = page.locator('.a-r.a-bot .a-b');
  await page.waitForFunction(count => document.querySelectorAll('.a-r.a-bot .a-b').length > count, previousBotCount, { timeout: 35_000 });
  await page.waitForFunction(() => !document.querySelector('#a-ty') && !document.querySelector('#a-inp')?.disabled, null, { timeout: 35_000 });
  const first = text(await botMessages.last().textContent());
  await page.waitForTimeout(500);
  const stable = text(await botMessages.last().textContent());
  if (!stable || stable !== first) {
    await page.waitForTimeout(500);
  }
  return text(await botMessages.last().textContent());
}
async function capture(page, scenario, turn, reply, state, requestedTag = 'respuesta-bot') {
  const catalog = await isCatalog(page, reply);
  const slotEvidence = await isSlots(page, reply);
  const stateHour = state.hora === '5:00 PM' ? /\b5(?::00)?\s*(?:pm|p\.m\.|de la tarde)\b/i : state.hora === '4:00 PM' ? /\b4(?::00)?\s*(?:pm|p\.m\.|de la tarde)\b/i : state.hora === '3:00 AM' ? /\b3(?::00)?\s*(?:am|a\.m\.|de la ma[ñn]ana)\b/i : null;
  const reservationSummary = isSummary(reply) && Boolean(state.servicio && state.fecha && state.hora && stateHour?.test(reply));
  const normalized = requestedTag === 'escenario-detenido' ? 'escenario-detenido' : slotEvidence.found ? 'horarios-disponibles' : catalog ? 'servicios-mostrados' : reservationSummary ? 'resumen-reserva' : 'respuesta-bot';
  const filename = `escenario-${scenario.code}-turno-${turn}-${normalized}.png`;
  await page.screenshot({ path: `${capturesDir}/${filename}`, fullPage: true });
  return { file: `./${capturesDir}/${filename}`, tag: normalized, turn, bot: reply, state: snapshotState(state), slotEvidence, reason: slotEvidence.found ? `Slots reales verificados desde ${slotEvidence.source}: ${slotEvidence.slots.join(', ')}.` : catalog ? 'Tarjetas de servicio verificadas en el DOM.' : reservationSummary ? 'Resumen de reserva compatible con el estado real.' : 'Respuesta del bot sin evidencia para una etiqueta específica.' };
}

async function runScenario(context, scenario) {
  if (scenario.blocked) {
    return { ...scenario, result: 'NO EJECUTADO COMPLETAMENTE', outcome: 'Bloqueado: requiere escritura de reservas en producción, no autorizada.', state: emptyState(), transcript: [], captures: [], findings: [{ origen: 'script', escenario: scenario.code, turno: 0, tipo: 'EJECUCIÓN BLOQUEADA', severidad: 'INFO', evidencia: 'Crear, modificar, cancelar o repetir confirmaciones escribiría datos en producción.' }], blocked: [] };
  }
  if (scenario.mode === 'local-mock') return runLocalAmbiguityScenario(context, scenario);
  const page = await context.newPage();
  const state = emptyState();
  const control = { rephrases: 0, corrected: false, correctionAccepted: false, slotEvidence: null, ampmButtons: [], redundantAmpmEvidence: null, recoveryPrompts: 0, goalFailed: false, history: [], repeatedBotReplies: 0, unchangedStateTurns: 0 };
  const transcript = [], captures = [], findings = [], blocked = [];
  let result = 'NO EJECUTADO COMPLETAMENTE';
  let outcome = 'No alcanzó el objetivo.';
  try {
    await page.goto(assistantUrl, { waitUntil: 'networkidle' });
    await page.locator('#a-inp').waitFor({ timeout: 15_000 });
    captures.push(await capture(page, scenario, 0, '', state));
    const spanish = page.getByRole('button', { name: /espa[nñ]ol/i });
    if (await spanish.count()) { await spanish.click(); transcript.push({ speaker: 'Cliente', text: '[Clic en Español]' }); }
    let botCount = await page.locator('.a-r.a-bot .a-b').count();
    let reply = text(await page.locator('.a-r.a-bot .a-b').last().textContent());
    transcript.push({ speaker: 'Bot', text: reply });
    let proposed = scenario.initial;
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const validation = validarMensajeCliente({ ultimaRespuestaBot: reply, mensajePropuesto: proposed, estado: state, escenario: scenario.code });
      if (!validation.valido) {
        blocked.push({ turn, bot: reply, proposed, reason: validation.motivo, state: snapshotState(state) });
        findings.push({ origen: 'script', escenario: scenario.code, turno: turn, tipo: 'MENSAJE BLOQUEADO POR INCOHERENTE', severidad: 'ALTO', evidencia: validation.motivo });
        outcome = validation.motivo;
        control.recoveryPrompts++;
        const intent = primaryBotIntent(reply);
        proposed = intent === 'nombre' ? 'Me llamo Miguel Carlo.' : intent === 'telefono' ? 'Mi teléfono es 5551234567.' : intent === 'email' ? 'Mi correo es miguel.carlo@example.com.' : intent === 'servicio' ? 'Quiero el masaje relajante.' : intent === 'fecha' ? 'El próximo sábado.' : intent === 'hora' ? 'A las 4 de la tarde.' : scenario.initial;
        continue;
      }
      await page.waitForTimeout(HUMAN_DELAY);
      await page.locator('#a-inp').fill(proposed);
      await page.locator('#a-snd').click();
      setActualState(state, proposed);
      transcript.push({ speaker: 'Cliente', text: proposed, validation: validation.motivo, state: snapshotState(state) });
      reply = await waitForReply(page, botCount);
      await page.waitForTimeout(HUMAN_DELAY);
      botCount = await page.locator('.a-r.a-bot .a-b').count();
      await syncActualState(page, state);
      transcript.push({ speaker: 'Bot', text: reply, state: snapshotState(state) });
      console.log(['', '================================', `HORA: ${new Date().toISOString()}`, `ESCENARIO ${scenario.code}`, `TURNO ${turn}/${MAX_TURNS}`, `MENSAJES: ${transcript.length}`, '', 'CLIENTE:', proposed, '', 'BOT:', reply, '', 'BOOKING DATA:', JSON.stringify(state, null, 2), '================================'].join('\n'));
      const stateAfterReply = JSON.stringify(snapshotState(state));
      const previous = control.history.at(-1);
      control.repeatedBotReplies = previous?.bot === reply ? control.repeatedBotReplies + 1 : 1;
      control.unchangedStateTurns = previous?.state === stateAfterReply ? control.unchangedStateTurns + 1 : 0;
      control.history.push({ turn, client: proposed, bot: reply, state: stateAfterReply });
      if (control.repeatedBotReplies >= 3 || control.unchangedStateTurns >= 3) {
        const reason = control.repeatedBotReplies >= 3 ? `El bot repitió ${control.repeatedBotReplies} veces la misma respuesta: "${reply}"` : `El estado no cambió durante ${control.unchangedStateTurns} turnos.`;
        const recentTurns = control.history.slice(-3).map(item => ({ turno: item.turn, cliente: item.client, bot: item.bot, bookingData: JSON.parse(item.state) }));
        findings.push({ origen: 'chatbot', escenario: scenario.code, turno: turn, tipo: 'LOOP DETECTADO', severidad: 'ALTO', evidencia: reason, ultimosTresTurnos: recentTurns });
        outcome = reason;
        break;
      }
      control.ampmButtons = (await page.locator('.a-quick-btn').allTextContents()).map(text).filter(value => timeMatches(value).length > 0);
      const redundantAmpmQuestion = /de la (?:tarde|ma[ñn]ana)|\b(?:am|pm)\b/i.test(proposed) && /te refieres a las \d+ de la (?:tarde|ma[ñn]ana)|morning or afternoon/i.test(reply);
      if (redundantAmpmQuestion && !control.redundantAmpmEvidence) {
        control.redundantAmpmEvidence = { turn, client: proposed, bot: reply };
        findings.push({ origen: 'chatbot', escenario: scenario.code, turno: turn, tipo: 'ACLARACIÓN REDUNDANTE DE HORA', severidad: 'MEDIO', evidencia: `Cliente: "${proposed}". Bot: "${reply}"` });
      }
      const evidence = await capture(page, scenario, turn, reply, state);
      control.slotEvidence = evidence.slotEvidence;
      captures.push(evidence);
      const decision = nextMessage(scenario, reply, state, control);
      if (decision.type === 'confirmation-reached') {
        result = control.goalFailed ? 'NO EJECUTADO COMPLETAMENTE' : 'ETAPA DE CONFIRMACIÓN ALCANZADA';
        outcome = decision.reason;
        break;
      }
      if (decision.type === 'complete') {
        if (!control.goalFailed) {
          result = 'OBJETIVO ALCANZADO';
          outcome = decision.reason;
          break;
        }
        outcome = `Se alcanzó el flujo posterior, pero falló un criterio del chatbot: ${decision.reason}`;
        proposed = scenario.initial;
        continue;
      }
      if (decision.type === 'continue-with-finding') {
        findings.push({ origen: decision.origin, escenario: scenario.code, turno: turn, tipo: 'CONTINUACIÓN SIN RUTA ESPECÍFICA', severidad: decision.origin === 'chatbot' ? 'ALTO' : 'MEDIO', evidencia: decision.reason });
        outcome = decision.reason;
      }
      proposed = decision.message;
    }
    if (result !== 'OBJETIVO ALCANZADO' && result !== 'ETAPA DE CONFIRMACIÓN ALCANZADA') outcome = `Límite de ${MAX_TURNS} turnos alcanzado. ${outcome}`;
  } catch (error) {
    findings.push({ origen: 'script', escenario: scenario.code, turno: transcript.length, tipo: 'ERROR DE EJECUCIÓN', severidad: 'ALTO', evidencia: error.message });
    outcome = error.message;
  } finally { await page.close(); }
  return { ...scenario, result, outcome, state, transcript, captures, findings, blocked };
}

async function runLocalAmbiguityScenario(context, scenario) {
  const page = await context.newPage();
  const state = emptyState();
  const transcript = [], captures = [], findings = [], blocked = [];
  try {
    const config = { businessName: 'Auditoría local AM/PM', templateId: 'spa', language: 'es', languages: ['es'], active: true, color: '#1a4a2e', businessHours: { monday: { enabled: true, ranges: [{ start: '00:00', end: '23:59' }] } }, menu: [{ nombre: 'Masaje relajante', precio: '70', duracion: '60' }], features: { reservations: true } };
    const entities = { service: null, date: null, time: '4', name: null, email: null, phone: null, people: null, notes: null };
    await page.route('**/api/client-config**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) }));
    await page.route('**/api/client-chat', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: '¿Me compartes tu nombre?', interpretation: { intent: 'booking', entities } }) }));
    await page.goto(`${LOCAL_URL}/asistente.html?id=auditoria-local-ampm`, { waitUntil: 'networkidle' });
    captures.push(await capture(page, scenario, 0, '', state));
    const botCount = await page.locator('.a-r.a-bot .a-b').count();
    transcript.push({ speaker: 'Bot', text: text(await page.locator('.a-r.a-bot .a-b').last().textContent()) });
    await page.locator('#a-inp').fill(scenario.initial);
    await page.locator('#a-snd').click();
    transcript.push({ speaker: 'Cliente', text: scenario.initial, state: snapshotState(state) });
    await page.waitForFunction(count => document.querySelectorAll('.a-quick-btn').length >= 2 || document.querySelectorAll('.a-r.a-bot .a-b').length > count, botCount, { timeout: 15_000 });
    const buttons = (await page.locator('.a-quick-btn').allTextContents()).map(text).filter(value => timeMatches(value).length > 0);
    const reply = text(await page.locator('.a-r.a-bot .a-b').last().textContent());
    transcript.push({ speaker: 'Bot', text: reply });
    captures.push(await capture(page, scenario, 1, reply, state));
    const textQuestion = /te refieres|morning or afternoon/i.test(await page.locator('#a-msgs').innerText());
    const ok = buttons.some(value => /4:00\s*AM/i.test(value)) && buttons.some(value => /4:00\s*PM/i.test(value)) && !textQuestion;
    if (!ok) findings.push({ origen: 'script', escenario: scenario.code, turno: 1, tipo: 'VALIDACIÓN LOCAL FALLIDA', severidad: 'ALTO', evidencia: `Botones: ${buttons.join(', ') || 'ninguno'}. Pregunta textual: ${textQuestion}.` });
    return { ...scenario, result: ok ? 'OBJETIVO ALCANZADO' : 'NO EJECUTADO COMPLETAMENTE', outcome: ok ? 'Mostró botones 4:00 AM y 4:00 PM sin pregunta textual.' : 'No mostró la ambigüedad AM/PM esperada.', state, transcript, captures, findings, blocked };
  } catch (error) {
    findings.push({ origen: 'script', escenario: scenario.code, turno: transcript.length, tipo: 'ERROR DE EJECUCIÓN', severidad: 'ALTO', evidencia: error.message });
    return { ...scenario, result: 'NO EJECUTADO COMPLETAMENTE', outcome: error.message, state, transcript, captures, findings, blocked };
  } finally { await page.close(); }
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 250 });
  const context = await browser.newContext();
  const runs = [];
  for (const scenario of scenarios) {
    const run = await runScenario(context, scenario);
    runs.push(run);
    // Supervisión explícita posterior a cada escenario: el script ya dejó
    // trazada cada validación y marca solo como chatbot las respuestas malas a
    // entradas que pasaron validarMensajeCliente().
    console.log(`${run.code}: ${run.result} — ${run.outcome}`);
  }
  await browser.close();
  const findings = runs.flatMap(run => run.findings);
  const md = [
    `# Auditoría supervisada — ${clientId}`,
    `**Fecha:** ${new Date().toISOString()}`,
    `**URL:** ${assistantUrl}`,
    `**Capturas:** \`./${capturesDir}/\``, '',
    '## Matriz', '| Escenario | Objetivo | Resultado | Motivo |', '|---|---|---|---|',
    ...runs.map(run => `| ${run.code} | ${run.goal} | **${run.result}** | ${run.outcome} |`), '',
    '## Conversaciones completas',
    ...runs.flatMap(run => [`### ${run.code} — ${run.name}`, `**Estado final real:** \`${JSON.stringify(run.state)}\``, `**Resultado:** ${run.result} — ${run.outcome}`, '', '```text', ...run.transcript.flatMap((item, index) => [`${index + 1}. [${item.speaker}]`, item.text, item.state ? `BOOKING DATA: ${JSON.stringify(item.state)}` : '', '']), '```', '',
      '#### Capturas', ...run.captures.map(c => `- Turno ${c.turn}: ${c.tag}. ${c.reason} Estado: \`${JSON.stringify(c.state)}\`\n  ![](${c.file})`), '',
      '#### Mensajes bloqueados por incoherencia', ...(run.blocked.length ? run.blocked.map(b => `- Turno ${b.turn}: propuesto \`${b.proposed}\`. Bot: \`${b.bot}\`. Motivo: ${b.reason}. Estado: \`${JSON.stringify(b.state)}\``) : ['- Ninguno.']), '']),
    '## Hallazgos clasificados',
    ...findings.map(f => `- **${f.origen.toUpperCase()}** | ${f.escenario}, turno ${f.turno} | ${f.tipo} | ${f.severidad} | ${f.evidencia}`),
  ];
  fs.writeFileSync(reportPath, `${md.join('\n')}\n`);
  console.log(`Reporte: ${reportPath}`);
  console.log(`Capturas: ${capturesDir}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
