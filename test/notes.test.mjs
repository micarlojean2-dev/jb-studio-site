// Captura de notas del cliente: extractNotas() saca las frases marcadas con
// [NOTA: ...] de la respuesta de DeepSeek y las quita del texto visible; nunca
// inventa. fusionarNotas() acumula sin duplicar. chat-core.js es un IIFE que
// asigna window.JBChatCore, así que se carga con un window falso.
// Ejecutar: node test/notes.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'chat-core.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const CORE = win.JBChatCore;

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); fallos++; } };

console.log('1. Reserva CON nota: se extrae y se quita del texto visible');
{
  const reply = '¡Anotado! Usaremos productos sin aceite 😊 ¿Para qué fecha?\n[NOTA: soy alérgico a los aceites]';
  const nx = CORE.extractNotas(reply);
  ok(nx.notas.length === 1 && nx.notas[0] === 'soy alérgico a los aceites', 'captura la frase del cliente');
  ok(!/\[NOTA:/.test(nx.limpio), 'el marcador no queda en el texto visible');
  ok(nx.limpio.includes('productos sin aceite'), 'conserva el mensaje real');
}

console.log('2. Reserva SIN nota: no captura nada');
{
  const nx = CORE.extractNotas('¡Perfecto! ¿A qué hora te viene bien? 😊');
  ok(nx.notas.length === 0, 'notas queda vacío');
  ok(nx.limpio === '¡Perfecto! ¿A qué hora te viene bien? 😊', 'el texto no cambia');
}

console.log('3. Varias notas en la misma respuesta');
{
  const reply = 'Perfecto 😊\n[NOTA: voy con mi esposa]\n[NOTA: necesito estacionamiento]';
  const nx = CORE.extractNotas(reply);
  ok(nx.notas.length === 2, 'captura las dos');
  ok(nx.notas[0] === 'voy con mi esposa' && nx.notas[1] === 'necesito estacionamiento', 'en orden y literales');
}

console.log('4. Comillas alrededor de la nota se limpian');
{
  const nx = CORE.extractNotas('Ok [NOTA: "quiero la sala privada"]');
  ok(nx.notas[0] === 'quiero la sala privada', 'sin comillas envolventes');
}

console.log('5. fusionarNotas acumula sin duplicar');
{
  const a = CORE.fusionarNotas('', ['soy alérgico a los aceites']);
  ok(a === 'soy alérgico a los aceites', 'primera nota');
  const b = CORE.fusionarNotas(a, ['no quiero música']);
  ok(b === 'soy alérgico a los aceites · no quiero música', 'agrega la segunda');
  const c = CORE.fusionarNotas(b, ['no quiero música']);
  ok(c === b, 'no duplica una nota repetida');
}

console.log('6. No inventa: sin marcador, aunque el cliente insinúe algo, notas vacío');
{
  // extractNotas SOLO lee marcadores explícitos; no deduce del texto libre.
  const nx = CORE.extractNotas('Creo que prefiero por la tarde pero no estoy seguro');
  ok(nx.notas.length === 0, 'sin marcador no hay nota (no se deduce)');
}

console.log('7. "soy <preferencia>" NO se toma como nombre (no pisa el nombre real)');
{
  const a = CORE.extractBooking('Soy alérgico a los aceites y prefiero una habitación silenciosa', [], null);
  ok(!a.nombre, 'no captura nombre de "soy alérgico a los aceites"');
  const b = CORE.extractBooking('Soy vegetariano', [], null);
  ok(!b.nombre, 'no captura nombre de "soy vegetariano"');
  const c = CORE.extractBooking('Soy NotaTest', [], null);
  ok(c.nombre === 'NotaTest', '"Soy NotaTest" sí captura el nombre');
  const d = CORE.extractBooking('soy Ana', [], null);
  ok(d.nombre === 'Ana', '"soy Ana" sí captura el nombre');
}

console.log('');
if (fallos) { console.error(`❌ ${fallos} aserción(es) fallaron`); process.exit(1); }
console.log('✅ Captura de notas verificada');
