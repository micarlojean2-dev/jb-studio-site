import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/client-chat.js', import.meta.url), 'utf8');
const prompt = readFileSync(new URL('../templates/restaurant/prompt-base.txt', import.meta.url), 'utf8');

assert.doesNotMatch(source, /function needsRestaurantMedicalWarning/);
assert.doesNotMatch(source, /needsRestaurantMenuConfirmation/);
assert.doesNotMatch(source, /bookingActive/);
assert.doesNotMatch(source, /booking\.captured/);
assert.match(prompt, /PREFERENCIAS DE COMIDA/);
assert.match(prompt, /sin queso/);
assert.match(prompt, /Solo si menciona explicitamente alergia/);
console.log('Restaurant food preferences and medical-only warning contract verified');
