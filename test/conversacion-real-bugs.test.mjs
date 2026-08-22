// Tests para 3 bugs encontrados en la prueba conversacional real:
// 1. serviceQuestionContext matchea nombres parciales ("fade premium" → Fade Master Premium).
// 2. formatTime12h convierte HH:MM a h:mm AM/PM (usado en el resumen).
// 3. La regla anti-invención del prompt cubre datos operativos generales (no solo precio/horario).
import assert from 'node:assert/strict';

process.env.UPSTASH_REDIS_REST_URL ||= 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'fake-token';

const mod = await import('../api/client-chat.js');
const { serviceQuestionContext, buildSystemPrompt, to12h } = mod.__test;
const coreSource = (await import('node:fs')).readFileSync(new URL('../chat-core.js', import.meta.url), 'utf8');

const client = {
  services: [
    { nombre: 'Corte QA', precio: '20000', duracion: '60 min' },
    { nombre: 'Fade Master Premium', precio: '25', duracion: '60 min', descripcionLarga: 'Degradado de alta precisión.' },
    { nombre: 'Corte + Barba Combo', precio: '35', duracion: '15 min' },
  ],
};

console.log('1. serviceQuestionContext — nombre completo y parcial:');
{
  const full = serviceQuestionContext(client, [{ role: 'user', content: '¿a cuánto está el fade master premium?' }]);
  assert.equal(full && full.serviceCardName, 'Fade Master Premium', 'nombre completo matchea');
  console.log('  ✓ nombre completo matchea');

  const partial = serviceQuestionContext(client, [{ role: 'user', content: '¿a cuánto está el fade premium?' }]);
  assert.equal(partial && partial.serviceCardName, 'Fade Master Premium', '"fade premium" (sin "master") matchea Fade Master Premium');
  console.log('  ✓ "fade premium" matchea Fade Master Premium (umbral de mayoría)');

  const partial2 = serviceQuestionContext(client, [{ role: 'user', content: 'que precio tiene el master premium?' }]);
  assert.equal(partial2 && partial2.serviceCardName, 'Fade Master Premium', '"master premium" matchea');
  console.log('  ✓ "master premium" matchea');

  const comboPartial = serviceQuestionContext(client, [{ role: 'user', content: 'cuanto es el combo barba?' }]);
  assert.equal(comboPartial && comboPartial.serviceCardName, 'Corte + Barba Combo', '"combo barba" matchea Corte + Barba Combo');
  console.log('  ✓ "combo barba" matchea');
}

console.log('\n2. Sin falsos positivos:');
{
  const none = serviceQuestionContext(client, [{ role: 'user', content: '¿qué hora es?' }]);
  assert.equal(none, null, 'pregunta sin relación a servicios → null');
  console.log('  ✓ sin relación → null');

  const overlap = serviceQuestionContext(client, [{ role: 'user', content: '¿hacen corte?' }]);
  // "corte" no es palabra distintiva de "Corte QA" (es nombre genérico? no — es la 1ª palabra
  // del nombre). "corte" tiene 5 letras, no está en genericWords, así que es distintiva de
  // "Corte QA" (1 palabra) y de "Corte + Barba Combo". Con 1 palabra distintiva, <2 → no matchea.
  assert.equal(overlap, null, '"corte" solo (1 palabra distintiva) no matchea ningún servicio');
  console.log('  ✓ "corte" suelto no matchea (evita falsos positivos)');
}

console.log('\n3. formatTime12h — casos borde:');
{
  const casos = [
    ['00:00', '12:00 AM'], ['12:00', '12:00 PM'], ['23:30', '11:30 PM'],
    ['09:05', '9:05 AM'], ['14:30', '2:30 PM'], ['00:30', '12:30 AM'],
  ];
  for (const [input, esperado] of casos) {
    assert.equal(to12h(input), esperado, `to12h("${input}")`);
  }
  console.log('  ✓ to12h cubre los casos borde');

  const core = {};
  new Function('window', coreSource)(core);
  assert.equal(typeof core.JBChatCore.formatTime12h, 'function', 'chat-core.js exporta formatTime12h');
  assert.equal(core.JBChatCore.formatTime12h('14:30'), '2:30 PM', 'formatTime12h convierte 14:30 → 2:30 PM');
  assert.equal(core.JBChatCore.formatTime12h('09:05'), '9:05 AM', 'formatTime12h convierte 09:05 → 9:05 AM');
  assert.equal(core.JBChatCore.formatTime12h('10:47'), '10:47 AM', 'formatTime12h convierte 10:47 → 10:47 AM');
  console.log('  ✓ formatTime12h disponible en CORE y funciona');
}

console.log('\n4. Prompt anti-invención cubre datos operativos generales:');
{
  // El prompt base de barberia-fc incluye la sección LÍMITES con la regla
  // anti-invención; buildSystemPrompt la conserva y le agrega el contexto.
  const basePrompt = 'IDENTIDAD\nEres el asistente virtual de una barberia.\nLÍMITES\n';
  const promptEs = await buildSystemPrompt(basePrompt, client, null, 'es');
  assert.match(promptEs, /Cualquier dato operativo del negocio — precios, horarios, servicios, disponibilidad, métodos de pago, políticas, ubicación, o cualquier otro detalle/, 'ES: la regla cubre métodos de pago y otros detalles');
  const promptEn = await buildSystemPrompt(basePrompt, client, null, 'en');
  assert.match(promptEn, /Any operational detail about the business — prices, hours, services, availability, payment methods, policies, location, or any other detail/, 'EN: la regla cubre métodos de pago y otros detalles');
  console.log('  ✓ ES y EN amplían la regla a datos operativos generales');
}

console.log('\n✅ Tests de los 3 bugs de la conversación real');
