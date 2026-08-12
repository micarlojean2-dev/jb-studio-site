// MIGRACIÓN 1 — intérprete de intención + entidades.
//
// ETAPA 1: contrato { intent, text }.
// ETAPA 2 (este archivo, actualizado): contrato { intent, text, entities },
// entities = { service, date, time, name, email, phone, people, notes } —
// exactamente los 8 campos que CORE.extractBooking() extraía por regex
// (auditoría ETAPA 2 previa a la implementación), sin más.
//
// Este archivo prueba SOLO el saneamiento de FORMA/TIPO del lado servidor
// (lib/message-interpreter.js) — la validación de NEGOCIO (¿existe el
// servicio?, ¿la fecha es válida?, ¿la hora es ambigua?) vive del lado del
// navegador en CORE.sanitizeBookingEntities() (chat-core.js), porque es ahí
// donde está cfg/menu/businessHours; esa se prueba en
// test/etapa2-entities.test.mjs contra el motor real.
//
// Cubre lo que se puede probar de forma determinista y sin red:
//  1) sanitizeInterpretation() — el saneamiento fail-closed de "intent" y
//     de la FORMA de "entities" (nunca un tipo inesperado, nunca una clave
//     no declarada).
//  2) emptyInterpretation()/emptyEntities() — la degradación fail-closed.
//  3) INTERPRETER_SCHEMA — la forma exacta que se pide al modelo.
//  4) Verificación estructural real sobre widget.js/asistente.html/
//     api/client-chat.js: que la detección de intención Y la extracción de
//     entidades ya NO dependen de regex locales para decidirse, que
//     CORE.extractBooking() se conserva solo en sus 2 excepciones
//     documentadas, y que solo se hace UNA llamada al modelo por turno.
//
// La verificación de que el modelo REALMENTE clasifica/extrae bien mensajes
// reales (ES/EN) requiere una llamada en vivo al proveedor — eso se hace con
// scripts/interpreter-battery.mjs. Este archivo no la repite para no
// depender de red.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { sanitizeInterpretation, emptyInterpretation, emptyEntities, INTERPRETER_SCHEMA } = await import('../lib/message-interpreter.js');

const ENTITY_FIELDS = ['service', 'date', 'time', 'name', 'email', 'phone', 'people', 'notes'];

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); failures++; } };

console.log('1. sanitizeInterpretation() — fail-closed sobre "intent" y sobre la FORMA de "entities"');
{
  ok(sanitizeInterpretation(null) === null, 'null -> null (el llamador debe degradar a emptyInterpretation())');
  ok(sanitizeInterpretation('no soy un objeto') === null, 'string suelto -> null');
  ok(sanitizeInterpretation(undefined) === null, 'undefined -> null');
  ok(sanitizeInterpretation(42) === null, 'número suelto -> null');

  ok(sanitizeInterpretation({}).intent === 'unknown', 'objeto sin "intent" -> unknown');
  ok(sanitizeInterpretation({ intent: 'delete_all_reservations' }).intent === 'unknown',
    'un intent fuera del enum permitido nunca se acepta tal cual (degrada a unknown)');
  ok(sanitizeInterpretation({ intent: 123 }).intent === 'unknown', 'intent no-string -> unknown');
  ok(sanitizeInterpretation({ intent: null }).intent === 'unknown', 'intent null -> unknown');
  ok(sanitizeInterpretation({ intent: ['booking'] }).intent === 'unknown', 'intent como array -> unknown');

  for (const valid of ['general_question', 'booking', 'reschedule', 'cancellation', 'show_menu', 'show_gallery', 'unknown']) {
    ok(sanitizeInterpretation({ intent: valid }).intent === valid, `intent válido "${valid}" se acepta tal cual`);
  }

  // El contrato de esta etapa es {intent, entities} — sanitizeInterpretation
  // no debe devolver ningún otro campo de nivel superior.
  const topKeys = Object.keys(sanitizeInterpretation({ intent: 'booking' })).sort();
  ok(topKeys.length === 2 && topKeys.includes('intent') && topKeys.includes('entities'),
    'sanitizeInterpretation() devuelve exactamente {intent, entities} — nada más');

  // --- Saneamiento de FORMA de entities: sin objeto -> todo null ---
  ok(sanitizeInterpretation({ intent: 'booking' }).entities !== null, 'sin "entities" en absoluto -> igual devuelve un objeto entities (todo null)');
  {
    const e = sanitizeInterpretation({ intent: 'booking' }).entities;
    for (const f of ENTITY_FIELDS) ok(e[f] === null, `sin entities: campo "${f}" -> null`);
  }
  ok(sanitizeInterpretation({ intent: 'booking', entities: 'no soy un objeto' }).entities.service === null,
    'entities como string suelto -> se trata como vacío, cada campo null');
  ok(sanitizeInterpretation({ intent: 'booking', entities: null }).entities.service === null,
    'entities: null -> cada campo null');

  // --- Cada campo de entities se sanea por tipo, fail-closed ---
  {
    const e = sanitizeInterpretation({
      intent: 'booking',
      entities: {
        service: 'Manicura', date: 'viernes', time: '4 pm', name: 'Ana',
        email: 'ana@x.com', phone: '555-1234567', people: 3, notes: 'sin cebolla',
      },
    }).entities;
    ok(e.service === 'Manicura', 'entities.service string válido se conserva tal cual (la validación de negocio es de chat-core.js)');
    ok(e.date === 'viernes', 'entities.date string válido se conserva tal cual');
    ok(e.time === '4 pm', 'entities.time string válido se conserva tal cual');
    ok(e.name === 'Ana', 'entities.name string válido se conserva tal cual');
    ok(e.email === 'ana@x.com', 'entities.email string válido se conserva tal cual');
    ok(e.phone === '555-1234567', 'entities.phone string válido se conserva tal cual');
    ok(e.people === 3, 'entities.people entero válido se conserva tal cual');
    ok(e.notes === 'sin cebolla', 'entities.notes string válido se conserva tal cual');
  }
  {
    // Tipos inesperados (la IA "inventa" una forma rara) -> null, nunca se propaga tal cual.
    const e = sanitizeInterpretation({
      intent: 'booking',
      entities: {
        service: 123, date: {}, time: [], name: true, email: 42, phone: null, people: 'tres', notes: 5,
      },
    }).entities;
    for (const f of ['service', 'date', 'time', 'name', 'email', 'phone', 'notes']) {
      ok(e[f] === null, `entities.${f} con tipo inesperado -> null (fail-closed)`);
    }
    ok(e.people === null, 'entities.people no-numérico ("tres" como string, no entero) -> null');
  }
  ok(sanitizeInterpretation({ intent: 'booking', entities: { people: 3.5 } }).entities.people === null,
    'entities.people no-entero (3.5) -> null');
  ok(sanitizeInterpretation({ intent: 'booking', entities: { service: '   ' } }).entities.service === null,
    'entities.service solo espacios -> null (no un string "vacío" válido)');
  ok(sanitizeInterpretation({ intent: 'booking', entities: { service: '  Corte  ' } }).entities.service === 'Corte',
    'entities.service se recorta (trim) antes de devolverse');
  {
    // Clave no declarada en el contrato (ej. la IA inventa "confidence" o "extra") -> se descarta sin excepción.
    const e = sanitizeInterpretation({ intent: 'booking', entities: { service: 'Corte', confidence: 0.9, extra: 'algo' } }).entities;
    ok(Object.keys(e).sort().join(',') === ENTITY_FIELDS.slice().sort().join(','),
      'entities nunca trae una clave fuera del contrato, aunque la IA la invente');
  }
}

console.log('\n2. emptyInterpretation()/emptyEntities() — la degradación fail-closed que usa el fallback de callProvider()');
{
  const empty = emptyInterpretation();
  ok(empty.intent === 'unknown', 'intent unknown por defecto');
  ok(Object.keys(empty).sort().join(',') === 'entities,intent', 'trae exactamente {intent, entities} — nada de intentConfidence');
  for (const f of ENTITY_FIELDS) ok(empty.entities[f] === null, `emptyInterpretation().entities.${f} -> null`);

  const ee = emptyEntities();
  ok(Object.keys(ee).length === ENTITY_FIELDS.length, 'emptyEntities() trae exactamente los 8 campos del contrato');
  for (const f of ENTITY_FIELDS) ok(ee[f] === null, `emptyEntities().${f} -> null`);
}

console.log('\n3. INTERPRETER_SCHEMA — la forma exacta que se manda como output_config.format / response_format');
{
  ok(INTERPRETER_SCHEMA.required.length === 3 &&
     ['intent', 'text', 'entities'].every((k) => INTERPRETER_SCHEMA.required.includes(k)),
    'exige exactamente 3 campos: intent, text y entities');
  ok(INTERPRETER_SCHEMA.additionalProperties === false, 'additionalProperties:false (obliga forma exacta)');
  ok(!!INTERPRETER_SCHEMA.properties.entities, 'el schema SÍ define "entities" en la ETAPA 2');
  ok(INTERPRETER_SCHEMA.properties.entities.additionalProperties === false,
    'entities también exige forma exacta (additionalProperties:false)');
  const entityProps = Object.keys(INTERPRETER_SCHEMA.properties.entities.properties).sort();
  ok(entityProps.join(',') === ENTITY_FIELDS.slice().sort().join(','),
    'entities declara exactamente los 8 campos del contrato, ni uno más');
  ok(!INTERPRETER_SCHEMA.properties.intentConfidence, 'el schema NO define "intentConfidence" (no tiene caller real)');
  ok(!INTERPRETER_SCHEMA.properties.entities.properties.tablePreference &&
     !INTERPRETER_SCHEMA.properties.entities.properties.barberPreference,
    'entities NO incluye tablePreference/barberPreference (fuera del alcance mínimo de esta etapa)');
  ok(INTERPRETER_SCHEMA.properties.intent.enum.length === 7, 'el enum de intent tiene los 7 valores del contrato');
}

console.log('\n4. widget.js — intención Y entidades ya no dependen de regex locales para el turno estructurado');
{
  const widget = readFileSync(join(root, 'widget.js'), 'utf8');
  ok(!/CORE\.pareceReserva\(\w/.test(widget), 'widget.js ya no llama a CORE.pareceReserva(...) para decidir el flujo (solo queda mencionado en comentarios)');
  ok(!/BOOKING_TRIGGERS\.test\(/.test(widget), 'widget.js ya no usa BOOKING_TRIGGERS.test() para decidir intención');
  ok(!/MODIFY_TRIGGERS\.test\(/.test(widget), 'widget.js ya no usa MODIFY_TRIGGERS.test() para decidir intención');
  ok(!/isCancellationRequest\(t\)/.test(widget), 'widget.js ya no llama a isCancellationRequest(t) para decidir intención');
  ok(/var interp = \(d && d\.interpretation\) \|\| null;/.test(widget), 'existe la degradación explícita a null si el backend no manda interpretación');
  ok(/intent = interp \? interp\.intent : 'unknown'/.test(widget), 'sin interpretación válida, intent cae a "unknown" (fail-closed)');

  // ETAPA 2: interp.entities SÍ se lee ahora (lo contrario de la ETAPA 1).
  ok(/interp\.entities/.test(widget), 'widget.js SÍ lee interp.entities (ETAPA 2)');
  ok(widget.includes('CORE.sanitizeBookingEntities('), 'widget.js sanea las entities antes de tocar bookingData');
  ok(widget.includes('CORE.mergeBookingEntities('), 'widget.js usa el merge centralizado (no vuelve a copiar Object.keys(...).forEach a mano)');
  ok(!/interp\.intentConfidence/.test(widget), 'widget.js no lee interp.intentConfidence (no existe en el contrato)');

  // CORE.extractBooking() se conserva SOLO en su excepción documentada
  // (nombre de una sola palabra) como llamada DIRECTA — no como fuente
  // general de entidades. El modo "Modificar" explícito la sigue usando
  // también, pero INDIRECTAMENTE a través de CORE.buildModifyUpdate() (que
  // widget.js llama por su nombre, no "CORE.extractBooking(" literal).
  const extractBookingCallLines = widget.split('\n')
    .filter((l) => l.includes('CORE.extractBooking(') && !l.trim().startsWith('//'));
  ok(extractBookingCallLines.length === 1,
    `CORE.extractBooking() queda solo en su excepción directa documentada (encontradas: ${extractBookingCallLines.length})`);
  ok(widget.includes('CORE.buildModifyUpdate(t, cfg, activeReservation)'),
    'widget.js: el modo "Modificar" explícito sigue usando CORE.buildModifyUpdate() (indirectamente extractBooking) — excepción documentada');
}

console.log('\n5. asistente.html — misma migración que widget.js (ETAPA 2 la exige explícitamente)');
{
  const asistente = readFileSync(join(root, 'asistente.html'), 'utf8');
  ok(!/CORE\.pareceReserva\(\w/.test(asistente), 'asistente.html ya no llama a CORE.pareceReserva(...) para decidir el flujo');
  ok(!/\bBOOKING_TRIGGERS\.test\(/.test(asistente), 'asistente.html ya no usa BOOKING_TRIGGERS.test() para decidir intención');
  ok(!/\bMODIFY_TRIGGERS\.test\(/.test(asistente), 'asistente.html ya no usa MODIFY_TRIGGERS.test() para decidir intención');
  ok(!/isCancellationRequest\(t\)/.test(asistente), 'asistente.html ya no llama a isCancellationRequest(t) para decidir intención');
  ok(/var interp = \(d && d\.interpretation\) \|\| null;/.test(asistente), 'asistente.html: misma degradación explícita a null');
  ok(/intent = interp \? interp\.intent : 'unknown'/.test(asistente), 'asistente.html: mismo fail-closed a "unknown"');
  ok(asistente.includes('CORE.sanitizeBookingEntities('), 'asistente.html sanea las entities antes de tocar bookingData');
  ok(asistente.includes('CORE.mergeBookingEntities('), 'asistente.html usa el mismo merge centralizado que widget.js');
  // asistente.html tiene 2 excepciones DIRECTAS documentadas: nombre de una
  // sola palabra (igual que widget.js) y el flujo de reagendar por enlace de
  // correo (emailAction — no existe en widget.js, es exclusivo del
  // asistente standalone). El modo "Modificar" explícito, igual que en
  // widget.js, la usa indirectamente vía CORE.buildModifyUpdate().
  const extractBookingCallLinesA = asistente.split('\n')
    .filter((l) => l.includes('CORE.extractBooking(') && !l.trim().startsWith('//'));
  ok(extractBookingCallLinesA.length === 2,
    `asistente.html: CORE.extractBooking() queda solo en sus 2 excepciones directas documentadas (nombre corto + emailAction) (encontradas: ${extractBookingCallLinesA.length})`);
  ok(asistente.includes('CORE.buildModifyUpdate(t, cfg, activeReservation)'),
    'asistente.html: el modo "Modificar" explícito sigue usando CORE.buildModifyUpdate() (indirectamente extractBooking) — excepción documentada');
}

console.log('\n6. chat-core.js — sanitizeBookingEntities()/mergeBookingEntities() existen y se exportan');
{
  const coreSrc = readFileSync(join(root, 'chat-core.js'), 'utf8');
  ok(coreSrc.includes('function sanitizeBookingEntities('), 'chat-core.js define sanitizeBookingEntities()');
  ok(coreSrc.includes('function mergeBookingEntities('), 'chat-core.js define mergeBookingEntities()');
  ok(coreSrc.includes('sanitizeBookingEntities: sanitizeBookingEntities'), 'sanitizeBookingEntities se expone vía CORE');
  ok(coreSrc.includes('mergeBookingEntities: mergeBookingEntities'), 'mergeBookingEntities se expone vía CORE');
  ok(coreSrc.includes('function buildModifyUpdateFromEntities('), 'chat-core.js define buildModifyUpdateFromEntities() (reagendar por intent, sin llamada extra)');
}

console.log('\n7. api/client-chat.js — una sola llamada al modelo, en TODO turno, contrato completo, fail-closed');
{
  const clientChat = readFileSync(join(root, 'api', 'client-chat.js'), 'utf8');
  ok(clientChat.includes("import {\n  interpreterOutputConfig, deepseekResponseFormat, buildInterpreterInstructions,\n  emptyInterpretation, sanitizeInterpretation,\n} from '../lib/message-interpreter.js';"),
    'importa el intérprete desde lib/message-interpreter.js (no un endpoint nuevo)');
  // ETAPA 2: structured ahora se manda SIEMPRE (antes, ETAPA 1, solo fuera
  // de booking activo) — el turno de reserva en curso también pide entities.
  ok(clientChat.includes('{ activeLanguage, bookingActive }'),
    'la interpretación estructurada se pide en TODO turno (también dentro de una reserva en curso) — ETAPA 2');
  ok(!clientChat.includes('bookingActive ? null : { activeLanguage }'),
    'ya no existe el bloqueo de ETAPA 1 que solo pedía structured fuera de booking activo');
  ok(/catch \(err\) \{[\s\S]{0,700}interpretation = emptyInterpretation\(\);/.test(clientChat),
    'si el JSON del modelo no valida, se degrada a emptyInterpretation() en vez de propagar un valor a medio validar');
  ok(/const fallback = await callOpenAI\(messages, systemPrompt, 600\);/.test(clientChat),
    'ante fallo de interpretación, UNA llamada de respaldo en texto plano (nunca se deja al cliente sin respuesta)');
  ok(!clientChat.includes("app.post('/api/message-interpreter'") && !clientChat.includes('interpret-message'),
    'no se creó ningún endpoint serverless nuevo (reutiliza /api/client-chat, límite de 12 funciones de Vercel)');
  ok(!clientChat.includes('sanitizeInterpretation(parsed, client)'),
    'sanitizeInterpretation() no recibe "client" — la validación de negocio de entities vive en chat-core.js, no aquí');
  ok(clientChat.includes('INTERPRETER_MAX_TOKENS'), 'max_tokens del turno de clasificación es una constante nombrada, con su medición documentada junto a la declaración');
  ok(clientChat.includes('BOOKING_TURN_MAX_TOKENS'), 'max_tokens del turno de reserva en curso es una constante nombrada propia');
  ok(clientChat.includes('BOOKING_TURN_TEMPERATURE'), 'el turno de reserva en curso mantiene su propia temperatura (conversacional), distinta de la de clasificación');
}

console.log(failures ? `\n❌ ${failures} verificación(es) fallaron` : '\n✅ Intérprete de intención + entidades (MIGRACIÓN 1, ETAPA 2): contrato {intent, text, entities} y wiring verificados en widget.js y asistente.html');
process.exit(failures ? 1 : 0);
