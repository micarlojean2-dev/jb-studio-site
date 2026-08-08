/* JB Studio — intérprete de intención (MIGRACIÓN 1, ETAPA 1).
 *
 * Sustituye la DETECCIÓN DE INTENCIÓN que hoy deciden BOOKING_TRIGGERS /
 * MODIFY_TRIGGERS / CANCEL_TRIGGERS / pareceReserva() en el navegador, sin
 * tocar el backend transaccional (api/reservations.js,
 * api/cancel-reservation.js, validarReserva, actionToken, Redis, emails) ni
 * la extracción de entidades (CORE.extractBooking() sigue siendo quien
 * saca fecha/hora/servicio/etc. — eso es la ETAPA 2, todavía no existe).
 *
 * Contrato mínimo de esta etapa — SOLO lo que widget.js realmente consume:
 *   { "intent": "...", "text": "..." }
 * Nada de entities/intentConfidence aquí: no tienen ningún caller en esta
 * etapa y agregarlos infla la respuesta del modelo sin ningún beneficio de
 * comportamiento (medido: ~75% del tamaño de una respuesta típica era el
 * esqueleto de entities, descartado siempre por widget.js).
 *
 * Vive en lib/, no en api/: el proyecto está en el límite de 12 funciones
 * serverless del plan Hobby de Vercel — un archivo nuevo en api/ contaría
 * como una función más.
 */

const INTENTS = ['general_question', 'booking', 'reschedule', 'cancellation', 'show_menu', 'show_gallery', 'unknown'];

// JSON Schema para output_config.format (Anthropic) / la forma que se le pide
// a DeepSeek vía response_format:{type:'json_object'} + este mismo texto en
// el prompt. `text` viaja en el mismo objeto que `intent` para no pagar una
// segunda llamada al modelo en el caso normal (ver runInterpretedChat en
// api/client-chat.js) — es un campo de texto libre más, no una restricción
// de prosa distinta a la de siempre.
export const INTERPRETER_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    text: { type: 'string' },
  },
  required: ['intent', 'text'],
  additionalProperties: false,
};

export function interpreterOutputConfig() {
  return { format: { type: 'json_schema', schema: INTERPRETER_SCHEMA } };
}

// El proveedor real de este proyecto es DeepSeek (confirmado en vivo:
// provider:"deepseek", model:"deepseek-v4-flash"). Su API (compatible con
// OpenAI) no tiene un modo de schema estricto — solo garantiza JSON
// sintácticamente válido, no que cumpla esta forma exacta. Por eso
// sanitizeInterpretation() de abajo nunca confía en el proveedor, sea cual
// sea, y siempre revalida.
export function deepseekResponseFormat() {
  return { type: 'json_object' };
}

// Bloque que se añade al system prompt SOLO en el turno inicial (fuera de
// un flujo de reserva ya en curso — el prompt de askBookingTurn(), muy
// ajustado, no se toca en esta migración).
export function buildInterpreterInstructions(activeLanguage) {
  const en = activeLanguage === 'en';
  if (en) {
    return `

STRUCTURED OUTPUT — read carefully, this changes your response FORMAT only, not your personality or rules.

Reply with a single JSON object matching exactly this shape (no markdown, no text outside the JSON):
{
  "intent": one of "general_question" | "booking" | "reschedule" | "cancellation" | "show_menu" | "show_gallery" | "unknown",
  "text": "<your normal conversational reply, following every rule above: warm tone, no markdown, never invent data, never confirm a reservation, never claim availability>"
}

Rules for "intent":
- "booking": the visitor wants to schedule, or asks about availability for themselves ("can I come tomorrow?").
- "reschedule": wants to change an existing appointment's date/time or details.
- "cancellation": wants to cancel an existing appointment.
- "show_menu": asks to see the services/menu/catalog itself (not a price/duration question about one item).
- "show_gallery": asks to see photos, images, or the place itself.
- "general_question": asks about price, hours, location, parking, or anything about the business that is NOT a request to book/change/cancel for themselves.
- "unknown": anything else, or the message is unclear.

Frontier cases (read the CONVERSATION HISTORY above, not just the last message, before deciding):
- "what time do you close tomorrow?" / "how much is the massage?" -> general_question, even though it names a date, time, or service — the person is asking for information, not expressing intent to go.
- "can I come tomorrow?" -> booking — asking about availability FOR THEMSELVES is intent to book, not a plain information question.
- "1pm please" / "actually make it saturday" -> booking WHEN the prior turns show an active booking already in progress (the assistant was asking for date/time/service). The same words with NO prior conversation at all (this is the very first message) are "unknown", not "booking" — a bare date and/or time with no other words is not, by itself, a stated intent to book.
- A short correction to a detail the assistant already asked about (e.g. changing the requested service) -> booking WHEN it happens inside an active booking flow already under way; with no prior conversation, the same short phrase is "unknown".`;
  }
  return `

SALIDA ESTRUCTURADA — lee con cuidado, esto cambia el FORMATO de tu respuesta, no tu personalidad ni tus reglas.

Responde con un único objeto JSON con exactamente esta forma (sin markdown, sin texto fuera del JSON):
{
  "intent": uno de "general_question" | "booking" | "reschedule" | "cancellation" | "show_menu" | "show_gallery" | "unknown",
  "text": "<tu respuesta conversacional normal, siguiendo todas las reglas de arriba: tono cálido, sin markdown, nunca inventar datos, nunca confirmar una reserva, nunca afirmar disponibilidad>"
}

Reglas para "intent":
- "booking": el visitante quiere agendar, o pregunta por disponibilidad para sí mismo ("¿puedo pasar mañana?").
- "reschedule": quiere cambiar la fecha/hora/datos de una cita ya existente.
- "cancellation": quiere cancelar una cita ya existente.
- "show_menu": pide ver el catálogo/menú/servicios en sí (no una pregunta de precio/duración de un solo ítem).
- "show_gallery": pide ver fotos, imágenes, o el lugar.
- "general_question": pregunta precio, horario, ubicación, estacionamiento, o cualquier cosa del negocio que NO sea pedir agendar/cambiar/cancelar para sí mismo.
- "unknown": cualquier otra cosa, o el mensaje no es claro.

Casos frontera (lee el HISTORIAL DE LA CONVERSACIÓN de arriba, no solo el último mensaje, antes de decidir):
- "¿qué horario tienen mañana?" / "¿cuánto cuesta el masaje?" -> general_question, aunque nombren una fecha, hora o servicio — la persona pide información, no expresa intención de ir.
- "¿puedo pasar mañana?" -> booking — preguntar por disponibilidad PARA SÍ MISMO es intención de reservar, no una simple pregunta informativa.
- "quiero uñas el viernes" -> booking.
- "el viernes a eso de las 4" -> booking CUANDO los turnos anteriores muestran una reserva ya en curso (el asistente venía pidiendo fecha/hora/servicio). Con CERO conversación previa (este es el primer mensaje), las mismas palabras son "unknown", no "booking" — una fecha y/o hora sueltas, sin ninguna otra palabra, no son por sí solas una intención expresada de reservar.
- "no, manicura" -> booking CUANDO corrige un dato dentro de una reserva ya en curso (por ejemplo el servicio que el asistente había entendido); sin conversación previa, la misma frase corta es "unknown".`;
}

export function emptyInterpretation() {
  return { intent: 'unknown' };
}

// Fail-closed: si intent no existe, no es string, o no pertenece al enum
// permitido, degrada a "unknown" — nunca asume booking/reschedule/
// cancellation sin una clasificación válida del modelo. `parsed` debe ser
// ya el resultado de JSON.parse(); si no es un objeto no nulo, se devuelve
// null (el llamador decide degradar con emptyInterpretation()).
export function sanitizeInterpretation(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const intent = INTENTS.indexOf(parsed.intent) !== -1 ? parsed.intent : 'unknown';
  return { intent };
}
