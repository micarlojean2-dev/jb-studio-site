import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const window = {};
new Function('window', readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8'))(window);
const CORE = window.JBChatCore;
const restaurant = { templateId: 'restaurant' };
const menu = [{ nombre: 'Hamburguesa Clásica' }, { nombre: 'Pizza' }];
let count = 0;
function check(value, message) { assert.ok(value, message); count++; }
function food(text, prior) { return CORE.applyFoodPreferences(prior || null, text, restaurant); }

// Spanish preferences, natural language, spelling variants, and short replies.
for (const [text, key, value] of [
  ['sin queso', 'remove', 'cheese'], ['sin keso', 'remove', 'cheese'], ['sin qeso', 'remove', 'cheese'],
  ['sin cebolla', 'remove', 'onions'], ['sin cebollas', 'remove', 'onions'], ['sin seboya', 'remove', 'onions'], ['sin tomate', 'remove', 'tomatoes'],
  ['sin tomates', 'remove', 'tomatoes'], ['sin pepinillos', 'remove', 'pickles'], ['sin catsup', 'remove', 'ketchup'],
  ['sin ketchup', 'remove', 'ketchup'], ['extra salsa', 'extra', 'sauce'], ['más salsa', 'extra', 'sauce'], ['poquita salsa', 'notes', 'light_sauce'],
  ['extra tocino', 'extra', 'bacon'], ['doble carne', 'extra', 'meat'], ['bien cocida', 'cooking', 'well_done'],
  ['muy cocida', 'cooking', 'well_done'], ['término medio', 'cooking', 'medium_rare'], ['sin picante', 'spice', 'no_spice'],
  ['poco picante', 'spice', 'no_spice'], ['mucho picante', 'spice', 'extra_spicy'], ['salsa aparte', 'notes', 'sauce_on_side'], ['salsa apartee', 'notes', 'sauce_on_side'],
  ['aderezo aparte', 'notes', 'sauce_on_side'], ['sin hielo', 'remove', 'ice'], ['solo cebolla', 'add', 'onions'],
]) {
  const result = food(text);
  check(result, `captures ${text}`);
  if (key === 'cooking' || key === 'spice') check(result[key] === value, `${text} normalizes ${key}`);
  else if (value) check(result[key].includes(value), `${text} normalizes ${value}`);
  else check(result.notes.length >= 0, `${text} remains representable`);
}

// English preferences and natural phrases.
for (const [text, key, value] of [
  ['Without onions', 'remove', 'onions'], ['Without cheese', 'remove', 'cheese'], ['No tomatoes', 'remove', 'tomatoes'],
  ['No pickles', 'remove', 'pickles'], ['No ice', 'remove', 'ice'], ['No mayo', 'remove', 'mayo'],
  ['No ketchup', 'remove', 'ketchup'], ['Extra bacon', 'extra', 'bacon'], ['Extra sauce', 'extra', 'sauce'],
  ['Less spicy', 'spice', 'no_spice'], ['Extra spicy', 'spice', 'extra_spicy'], ['Medium rare', 'cooking', 'medium_rare'],
  ['Well done', 'cooking', 'well_done'], ['Rare', 'cooking', 'rare'], ['Sauce on the side', 'notes', 'sauce_on_side'],
  ['Could I get it without onions?', 'remove', 'onions'], ['Can you leave the sauce on the side?', 'notes', 'sauce_on_side'],
  ["I'd rather have no cheese.", 'remove', 'cheese'], ["I don't like cheese", 'remove', 'cheese'],
]) {
  const result = food(text);
  check(result, `captures ${text}`);
  if (key === 'cooking' || key === 'spice') check(result[key] === value, `${text} normalizes ${key}`);
  else check(result[key].includes(value), `${text} normalizes ${value}`);
}

// Last decision wins and does not duplicate.
let revised = food('Extra queso');
revised = food('Sin queso', revised);
check(revised.remove.includes('cheese') && !revised.extra.includes('cheese'), 'last cheese decision wins');
revised = food('Con cebolla'); revised = food('No, mejor sin cebolla', revised);
check(revised.remove.includes('onions') && !revised.add.includes('onions'), 'last onion decision wins');
revised = food('Extra sauce'); revised = food('Light sauce', revised);
check(!revised.extra.includes('sauce') && revised.notes.includes('light_sauce'), 'last sauce decision wins');
revised = food('Sin queso', revised); revised = food('Sin queso', revised);
check(revised.remove.filter(x => x === 'cheese').length === 1, 'duplicate preferences collapse');
check(CORE.foodPreferencesToSpecialRequests(food('without cheese'), 'en') === 'No cheese', 'English special requests stay in English');

check(CORE.extractBooking('cambiar hamburguesa por pizza', menu, null, 'es', restaurant).servicio === 'Pizza', 'last dish named wins');
const englishBooking = CORE.extractBooking('I want Classic Burger for 2 people on August 5 at 1 PM. My name is QA English', [{ nombre: 'Classic Burger' }], null, 'en', restaurant);
check(englishBooking.servicio === 'Classic Burger' && englishBooking.personas === '2' && englishBooking.hora === '1:00 PM' && englishBooking.nombre === 'QA English', 'English booking fields are extracted');
// CORE.pareceReserva() se eliminó en la ETAPA 2 (chat-core.js): quedó sin
// ningún caller real en widget.js ni asistente.html tras migrar la
// detección de intención inicial de AMBAS superficies a
// interpretation.intent (antes, solo widget.js lo tenía desde la ETAPA 1).
check(CORE.summaryFields(restaurant).includes('servicio'), 'restaurant summary includes dish');

for (const text of ['Soy alérgico al queso', 'Tengo intolerancia a la lactosa', 'Soy celíaco', 'Cross contamination', "I'm allergic to dairy", "I'm lactose intolerant", 'I have celiac disease', "I'm allergic to peanuts"]) {
  check(CORE.isFoodMedical(text, restaurant), `medical warning trigger: ${text}`);
}

const chatApi = readFileSync(new URL('../api/client-chat.js', import.meta.url), 'utf8');
check(!chatApi.includes('no puedes confirmarlo y que el equipo del restaurante'), 'old normal-preference rejection removed');
check(chatApi.includes('function restaurantNormalPreference'), 'normal restaurant preferences have a deterministic response');
check(chatApi.includes('I will note that preference'), 'English normal preference response is explicit');
check(chatApi.includes('I cannot guarantee the absence of allergens'), 'English medical disclaimer is explicit');
check(chatApi.includes('messages.length > 60'), 'chat accepts more than 40 messages');
const assistant = readFileSync(new URL('../asistente.html', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../widget.js', import.meta.url), 'utf8');
for (const source of [assistant, widget]) {
  check(source.includes('bookingData.foodPreferences'), 'frontend keeps normalized food preferences');
  check(source.includes("BOOKING_SESS"), 'frontend persists booking state');
  check(source.includes("What would you like to change?"), 'edit action preserves booking state');
}

console.log(`Food preference adversarial matrix passed: ${count} assertions`);
