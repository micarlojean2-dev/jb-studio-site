import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { sanitizeInterpretation, emptyInterpretation, emptyEntities, INTERPRETER_SCHEMA, parseInterpretation } = await import('../lib/message-interpreter.js');
const root = new URL('..', import.meta.url);
const clientChat = readFileSync(new URL('api/client-chat.js', root), 'utf8');

console.log('Intérprete estructurado V2');
const clean = sanitizeInterpretation({ intent: 'booking', entities: { service: 'Masaje', date: 'viernes', time: '4 pm', name: 'Ana', email: 'ana@example.com', phone: '5551234567', people: 2, notes: 'Sin perfume', ignored: true } });
assert.equal(clean.intent, 'booking');
assert.deepEqual(Object.keys(clean.entities).sort(), ['date', 'email', 'name', 'notes', 'people', 'phone', 'service', 'time']);
assert.equal(clean.entities.people, 2);
assert.equal(clean.entities.ignored, undefined);
console.log('  ✓ sanea intents y entidades a la forma declarada');

assert.equal(emptyInterpretation().intent, 'unknown');
assert.deepEqual(Object.values(emptyEntities()), Array(8).fill(null));
assert.equal(INTERPRETER_SCHEMA.properties.entities.additionalProperties, false);
assert.equal(parseInterpretation('{"intent":"booking","entities":{"service":"Masaje"}}').entities.service, 'Masaje');
console.log('  ✓ mantiene degradación fail-closed y schema estricto');

assert.match(clientChat, /buildInterpreterInstructions/);
assert.match(clientChat, /interpretation = emptyInterpretation\(\)/);
console.log('  ✓ api/client-chat devuelve interpretación estructurada con fallback seguro');
