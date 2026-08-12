/* JB Studio — intérprete de intención + entidades (MIGRACIÓN 1).
 *
 * ETAPA 1 sustituyó la DETECCIÓN DE INTENCIÓN que decidían BOOKING_TRIGGERS /
 * MODIFY_TRIGGERS / CANCEL_TRIGGERS / pareceReserva() en el navegador.
 *
 * ETAPA 2 (este archivo) añade "entities": la IA también interpreta
 * servicio/fecha/hora/nombre/email/teléfono/personas/notas del mensaje,
 * sustituyendo la EXTRACCIÓN por regex de CORE.extractBooking() (chat-core.js).
 *
 * Frontera de autoridad, sin excepciones:
 *   LA IA SOLO INTERPRETA — transcribe lo que el cliente dijo, tal cual.
 *   EL CÓDIGO SIGUE SIENDO LA AUTORIDAD — valida cada entity antes de tocar
 *   bookingData (ver sanitizeBookingEntities() en chat-core.js, que reutiliza
 *   los mismos validadores deterministas que ya existían: EMAIL_RE2,
 *   valorValido(), extraerFecha(), resolverHora()).
 *
 * Este archivo (server-side, Node) solo hace saneamiento DE FORMA/TIPO — nunca
 * de negocio: no sabe qué servicios tiene el negocio ni su horario. Esa
 * validación real vive en el navegador (chat-core.js), porque es ahí donde
 * está cfg/menu/businessHours. Aquí solo se garantiza que "entities" nunca
 * llegue con un tipo inesperado o un campo no declarado, pase lo que pase en
 * la respuesta del modelo.
 *
 * No toca el backend transaccional (api/reservations.js,
 * api/cancel-reservation.js, validarReserva, actionToken, Redis, emails).
 */

const INTENTS = ['general_question', 'booking', 'reschedule', 'cancellation', 'show_menu', 'show_gallery', 'unknown'];

// Los 8 campos que CORE.extractBooking() extrae y que el flujo real usa hoy
// (auditoría ETAPA 2 previa a esta implementación) — tablePreference/
// barberPreference quedan fuera a propósito: son de solo 2 de las 3
// plantillas y su "extracción" ya depende de configuración específica del
// negocio (nombres de personal), no de comprensión de lenguaje genérica.
const ENTITY_FIELDS = ['service', 'date', 'time', 'name', 'email', 'phone', 'people', 'notes'];

// JSON Schema para output_config.format / response_format:{type:'json_object'} (OpenAI)
export const INTERPRETER_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    text: { type: 'string' },
    entities: {
      type: 'object',
      properties: {
        service: { type: ['string', 'null'] },
        date: { type: ['string', 'null'] },
        time: { type: ['string', 'null'] },
        name: { type: ['string', 'null'] },
        email: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        people: { type: ['integer', 'null'] },
        notes: { type: ['string', 'null'] },
      },
      required: ENTITY_FIELDS,
      additionalProperties: false,
    },
  },
  required: ['intent', 'text', 'entities'],
  additionalProperties: false,
};

export function interpreterOutputConfig() {
  return { format: { type: 'json_schema', schema: INTERPRETER_SCHEMA } };
}

// Salida en formato JSON para OpenAI (response_format:{type:'json_object'}).
export function jsonResponseFormat() {
  return { type: 'json_object' };
}
export const deepseekResponseFormat = jsonResponseFormat;

// Bloque que se añade al system prompt en TODO turno que pida interpretación
// estructurada (ETAPA 2: ahora también el turno de reserva en curso, no solo
// el turno inicial — ver runInterpretedChat/callProvider en api/client-chat.js).
export function buildInterpreterInstructions(activeLanguage) {
  const en = activeLanguage === 'en';
  if (en) {
    return `

STRUCTURED OUTPUT — read carefully, this changes your response FORMAT only, not your personality or rules.

Reply with a single JSON object matching exactly this shape (no markdown, no text outside the JSON):
{
  "intent": one of "general_question" | "booking" | "reschedule" | "cancellation" | "show_menu" | "show_gallery" | "unknown",
  "text": "<your normal conversational reply, following every rule above: warm tone, no markdown, never invent data, never confirm a reservation yourself, use only the verified business info or real-time availability slots when present in system prompt>",
  "entities": {
    "service": "<the EXACT name of a service from the catalog above, or null>",
    "date": "<the date exactly as the customer said it (e.g. 'friday', 'tomorrow', 'july 24'), or null>",
    "time": "<the time exactly as the customer said it (e.g. '4pm', '16:00', '4'), or null>",
    "name": "<the customer's name, or null>",
    "email": "<the email, or null>",
    "phone": "<the phone number, or null>",
    "people": <party size as an integer, or null>,
    "notes": "<a preference or special request the customer volunteered, or null>"
  }
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
- A short correction to a detail the assistant already asked about (e.g. changing the requested service) -> booking WHEN it happens inside an active booking flow already under way; with no prior conversation, the same short phrase is "unknown".

CRITICAL rules for "entities" — you only TRANSCRIBE, you never decide or invent:
- Extract ONLY what this message explicitly states or unambiguously corrects. If it is not clearly there, use null — never guess, never carry over a value from a previous message.
- "service": copy the EXACT name from the catalog above. If what the customer said does not clearly match one catalog item, use null — never invent a service that is not listed.
- "date"/"time": write down exactly what the customer said, in their own words. Do NOT normalize, convert, or resolve it yourself — the system validates and normalizes it. If they said "4" with no am/pm and nothing in the conversation makes it obvious, still write "4" — do NOT decide AM or PM yourself, and do NOT write "16:00" unless the customer said 24h time or the meridiem is truly unambiguous from context.
- "name": only if stated as their own name, never a random word.
- "people": only a real number stated as a party size, as an integer.
- "notes": only a preference/special request the customer volunteered on their own — never a structured field (never put a date, time, email or phone here).
- If the customer corrects a previously given value ("actually make it saturday", "no, manicure"), put the NEW value in that field and leave every other field null — do not repeat old values.
- If this message adds no booking data at all, every field in "entities" must be null.`;
  }
  return `

SALIDA ESTRUCTURADA — lee con cuidado, esto cambia el FORMATO de tu respuesta, no tu personalidad ni tus reglas.

Responde con un único objeto JSON con exactamente esta forma (sin markdown, sin texto fuera del JSON):
{
  "intent": uno de "general_question" | "booking" | "reschedule" | "cancellation" | "show_menu" | "show_gallery" | "unknown",
  "text": "<tu respuesta conversacional normal, siguiendo todas las reglas de arriba: tono cálido, sin markdown, nunca inventar datos, nunca confirmar una reserva por tu cuenta, usa la información del negocio o la disponibilidad en tiempo real inyectada si está presente>",
  "entities": {
    "service": "<el nombre EXACTO de un servicio del catálogo de arriba, o null>",
    "date": "<la fecha tal como la dijo el cliente (ej. 'viernes', 'mañana', '24 de julio'), o null>",
    "time": "<la hora tal como la dijo el cliente (ej. '4 pm', '16:00', '4'), o null>",
    "name": "<el nombre del cliente, o null>",
    "email": "<el correo, o null>",
    "phone": "<el teléfono, o null>",
    "people": <número de personas como entero, o null>,
    "notes": "<una preferencia o petición especial que el cliente mencionó por su cuenta, o null>"
  }
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
- "no, manicura" -> booking CUANDO corrige un dato dentro de una reserva ya en curso (por ejemplo el servicio que el asistente había entendido); sin conversación previa, la misma frase corta es "unknown".

Reglas CRÍTICAS para "entities" — solo TRANSCRIBES, nunca decides ni inventas:
- Extrae SOLO lo que este mensaje dice explícitamente o corrige sin ambigüedad. Si no está claro, usa null — nunca lo adivines, nunca repitas un valor de un mensaje anterior.
- "service": copia el nombre EXACTO del catálogo de arriba. Si lo que dijo el cliente no coincide claramente con un ítem del catálogo, usa null — nunca inventes un servicio que no está en la lista.
- "date"/"time": escribe tal cual lo dijo el cliente, con sus propias palabras. NO lo normalices, conviertas ni resuelvas tú — el sistema lo valida y normaliza. Si dijo "4" sin am/pm y nada en la conversación lo deja claro, igual escribe "4" — NO decidas tú si es AM o PM, y NO escribas "16:00" salvo que el cliente haya dicho la hora en formato 24h o el meridiano sea realmente inequívoco por contexto.
- "name": solo si lo dice como su propio nombre, nunca una palabra suelta al azar.
- "people": solo un número real dicho como cantidad de personas, como entero.
- "notes": solo una preferencia/petición especial que el cliente haya dicho por su cuenta — nunca un dato estructurado (nunca pongas aquí una fecha, hora, correo o teléfono).
- Si el cliente corrige un dato ya dado ("mejor el sábado", "no, manicura"), pon el valor NUEVO en ese campo y deja los demás en null — no repitas valores viejos.
- Si este mensaje no aporta ningún dato de reserva, todos los campos de "entities" deben ir en null.`;
}

export function emptyInterpretation() {
  return { intent: 'unknown', entities: emptyEntities() };
}

// Saneamiento de FORMA/TIPO únicamente (no de negocio — eso vive en
// chat-core.js/sanitizeBookingEntities, donde sí hay cfg/menu/businessHours).
// Cualquier campo con tipo inesperado, o cualquier clave no declarada, se
// descarta sin excepción: nunca se propaga algo que no sea exactamente
// string-o-null (o integer-o-null para "people").
function sanitizeEntitiesShape(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  for (const field of ENTITY_FIELDS) {
    if (field === 'people') {
      const n = Number(src[field]);
      out[field] = Number.isInteger(n) ? n : null;
    } else {
      const v = src[field];
      out[field] = (typeof v === 'string' && v.trim()) ? v.trim() : null;
    }
  }
  return out;
}

export function emptyEntities() {
  return sanitizeEntitiesShape(null);
}

// Fail-closed: si intent no existe, no es string, o no pertenece al enum
// permitido, degrada a "unknown" — nunca asume booking/reschedule/
// cancellation sin una clasificación válida del modelo. `parsed` debe ser
// ya el resultado de JSON.parse(); si no es un objeto no nulo, se devuelve
// null (el llamador decide degradar con emptyInterpretation()).
export function sanitizeInterpretation(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const intent = INTENTS.indexOf(parsed.intent) !== -1 ? parsed.intent : 'unknown';
  const entities = sanitizeEntitiesShape(parsed.entities);
  return { intent, entities };
}
