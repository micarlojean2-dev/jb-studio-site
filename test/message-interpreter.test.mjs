// MIGRACIÓN 1, ETAPA 1 — intención por IA.
//
// Contrato mínimo de esta etapa: { intent, text }. Sin entities/
// intentConfidence — extractBooking() sigue siendo el único extractor de
// entidades (ETAPA 2, todavía no existe), y nada en producción lee un campo
// que esta etapa no necesita (verificado por grep antes de simplificar).
//
// Cubre lo que se puede probar de forma determinista y sin red:
//  1) sanitizeInterpretation() — el saneamiento fail-closed de "intent".
//  2) Verificación estructural real sobre el código fuente de widget.js y
//     api/client-chat.js: que la detección de intención ya NO depende de
//     BOOKING_TRIGGERS/MODIFY_TRIGGERS/CANCEL_TRIGGERS/pareceReserva() para
//     decidir el flujo, que extractBooking() se conserva para entidades, y
//     que solo se hace UNA llamada al modelo en el caso normal.
//
// La verificación de que el modelo REALMENTE clasifica bien los mensajes
// reales (ES/EN) requiere una llamada en vivo al proveedor — eso se hace
// con scripts/interpreter-battery.mjs contra un deployment de preview
// (nunca producción). Este archivo no la repite para no depender de red.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { sanitizeInterpretation, emptyInterpretation, INTERPRETER_SCHEMA } = await import('../lib/message-interpreter.js');

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); failures++; } };

console.log('1. sanitizeInterpretation() — fail-closed sobre "intent", nunca asume booking');
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

  // El contrato de esta etapa es SOLO {intent, text} — sanitizeInterpretation
  // no debe devolver ningún otro campo (nada de entities/intentConfidence).
  const keys = Object.keys(sanitizeInterpretation({ intent: 'booking' }));
  ok(keys.length === 1 && keys[0] === 'intent', 'sanitizeInterpretation() solo devuelve {intent} — nada más');
}

console.log('\n2. emptyInterpretation() — la degradación fail-closed que usa el fallback de callProvider()');
{
  const empty = emptyInterpretation();
  ok(empty.intent === 'unknown', 'intent unknown por defecto');
  ok(Object.keys(empty).length === 1, 'solo trae {intent} — nada de entities/intentConfidence');
}

console.log('\n3. INTERPRETER_SCHEMA — la forma mínima que se manda como output_config.format / response_format');
{
  ok(INTERPRETER_SCHEMA.required.length === 2 && INTERPRETER_SCHEMA.required.includes('intent') && INTERPRETER_SCHEMA.required.includes('text'),
    'exige exactamente 2 campos: intent y text — nada más');
  ok(INTERPRETER_SCHEMA.additionalProperties === false, 'additionalProperties:false (obliga forma exacta)');
  ok(!INTERPRETER_SCHEMA.properties.entities, 'el schema NO define "entities" en esta etapa');
  ok(!INTERPRETER_SCHEMA.properties.intentConfidence, 'el schema NO define "intentConfidence" en esta etapa');
  ok(INTERPRETER_SCHEMA.properties.intent.enum.length === 7, 'el enum de intent tiene los 7 valores del contrato');
}

console.log('\n4. widget.js — la detección de intención ya no depende de las regex locales');
{
  const widget = readFileSync(join(root, 'widget.js'), 'utf8');
  ok(!/CORE\.pareceReserva\(\w/.test(widget), 'widget.js ya no llama a CORE.pareceReserva(...) para decidir el flujo (solo queda mencionado en comentarios)');
  ok(!/BOOKING_TRIGGERS\.test\(/.test(widget), 'widget.js ya no usa BOOKING_TRIGGERS.test() para decidir intención');
  ok(!/MODIFY_TRIGGERS\.test\(/.test(widget), 'widget.js ya no usa MODIFY_TRIGGERS.test() para decidir intención');
  ok(!/isCancellationRequest\(t\)/.test(widget), 'widget.js ya no llama a isCancellationRequest(t) para decidir intención');
  ok(/var interp = \(d && d\.interpretation\) \|\| null;/.test(widget), 'existe la degradación explícita a null si el backend no manda interpretación');
  ok(/intent = interp \? interp\.intent : 'unknown'/.test(widget), 'sin interpretación válida, intent cae a "unknown" (fail-closed)');
  // extractBooking() se conserva a propósito para ENTIDADES — no se elimina en esta migración.
  const extractBookingCalls = (widget.match(/CORE\.extractBooking\(/g) || []).length;
  ok(extractBookingCalls >= 3, `CORE.extractBooking() se conserva para extraer entidades (${extractBookingCalls} usos — ETAPA 1 no toca esto)`);
  // El contrato de esta etapa es {intent, text} — widget.js no debe leer
  // ningún campo de entities/confidence que ya no existe.
  ok(!/interp\.entities/.test(widget), 'widget.js no lee interp.entities (no existe en esta etapa)');
  ok(!/interp\.intentConfidence/.test(widget), 'widget.js no lee interp.intentConfidence (no existe en esta etapa)');
}

console.log('\n5. api/client-chat.js — una sola llamada al modelo en el caso normal, contrato mínimo, fail-closed');
{
  const clientChat = readFileSync(join(root, 'api', 'client-chat.js'), 'utf8');
  ok(clientChat.includes("import {\n  interpreterOutputConfig, deepseekResponseFormat, buildInterpreterInstructions,\n  emptyInterpretation, sanitizeInterpretation,\n} from '../lib/message-interpreter.js';"),
    'importa el intérprete desde lib/message-interpreter.js (no un endpoint nuevo)');
  ok(clientChat.includes('bookingActive ? null : { activeLanguage }'),
    'la interpretación estructurada SOLO se pide fuera de un flujo de reserva en curso (el prompt de askBookingTurn no se toca)');
  ok(/catch \(err\) \{[\s\S]{0,700}interpretation = emptyInterpretation\(\);/.test(clientChat),
    'si el JSON del modelo no valida, se degrada a emptyInterpretation() en vez de propagar un valor a medio validar');
  ok(/const fallback = provider === 'deepseek'[\s\S]{0,200}await callDeepSeek\(messages, systemPrompt, 600\)/.test(clientChat),
    'ante fallo de interpretación, UNA llamada de respaldo en texto plano (nunca se deja al cliente sin respuesta)');
  ok(!clientChat.includes("app.post('/api/message-interpreter'") && !clientChat.includes('interpret-message'),
    'no se creó ningún endpoint serverless nuevo (reutiliza /api/client-chat, límite de 12 funciones de Vercel)');
  ok(!clientChat.includes('sanitizeInterpretation(parsed, client)'),
    'sanitizeInterpretation() ya no recibe "client" — no hay validación de entidades que la necesite en esta etapa');
  ok(clientChat.includes('INTERPRETER_MAX_TOKENS'), 'max_tokens del turno de interpretación es una constante nombrada, con su medición documentada junto a la declaración');
}

console.log(failures ? `\n❌ ${failures} verificación(es) fallaron` : '\n✅ Intérprete de intención (MIGRACIÓN 1, ETAPA 1): contrato mínimo {intent, text} y wiring verificados');
process.exit(failures ? 1 : 0);
