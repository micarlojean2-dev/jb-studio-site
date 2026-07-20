// Los tres fallos que destapó la prueba E2E de la reserva:
//   1. Las notas dependían solo del marcador [NOTA:] de DeepSeek; si respondía
//      en prosa, la preferencia del cliente se perdía. Ahora se extrae también
//      de los mensajes del propio cliente (extractNotasUsuario).
//   2. El nombre se cortaba a dos palabras ("Prueba Fecha Playwright" ->
//      "Prueba Fecha"). Ahora acepta nombres completos con partículas.
//   3. Los marcadores internos ([MOSTRAR_MENU], [NOTA:]) se guardaban crudos en
//      sessionStorage y reaparecían al recargar. Ahora limpiarMarcadores es el
//      saneador central y también quita [NOTA:].
// chat-core.js es un IIFE que asigna window.JBChatCore; se carga con un window
// falso. Ejecutar: node test/fallos-e2e.test.mjs
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

const MENU = [{ nombre: 'Masaje Relajante' }];
const nombre = (t) => CORE.extractBooking(t, MENU, null, 'es').nombre;
const notasU = (t) => CORE.extractNotasUsuario(t);

// ── FALLO 1: NOTAS DESDE EL MENSAJE DEL USUARIO ────────────────────────────
console.log('FALLO 1 — Notas');

console.log(' 1. Nota enviada sola');
ok(notasU('prefiero una habitación silenciosa').join('|') === 'prefiero una habitación silenciosa',
   'captura la preferencia sola');

console.log(' 2. Nota + correo en el mismo mensaje');
{
  const t = 'Mi correo es prueba@example.com y prefiero una habitación silenciosa';
  ok(notasU(t).join('|') === 'prefiero una habitación silenciosa',
     'saca la nota sin el correo');
  ok(!notasU(t).join('|').includes('@'), 'el correo no entra en la nota');
  ok(CORE.extractBooking(t, MENU, null, 'es').email === 'prueba@example.com',
     'y el correo sigue capturándose como email');
}

console.log(' 3. Nota + teléfono en el mismo mensaje');
{
  const t = 'mi teléfono es 202-555-0199 y soy alérgico a los aceites';
  ok(notasU(t).join('|') === 'soy alérgico a los aceites', 'saca la nota sin el teléfono');
  ok(!/\d/.test(notasU(t).join('|')), 'no quedan dígitos del teléfono en la nota');
}

console.log(' 4. Dos notas en mensajes diferentes se acumulan');
{
  let acum;
  acum = CORE.fusionarNotas(acum, notasU('prefiero una habitación silenciosa'));
  acum = CORE.fusionarNotas(acum, notasU('también soy alérgica a los aceites con fragancia'));
  ok(acum === 'prefiero una habitación silenciosa · soy alérgica a los aceites con fragancia',
     'las dos notas quedan en orden y sin muletilla "también"');
}

console.log(' 5. Duplicado entre mensaje del usuario y [NOTA:]');
{
  const delUsuario = notasU('prefiero una habitación silenciosa');
  const delModelo  = CORE.extractNotas('Ok 😊 [NOTA: prefiero una habitación silenciosa]').notas;
  let acum = CORE.fusionarNotas(undefined, delUsuario);
  acum = CORE.fusionarNotas(acum, delModelo);
  ok(acum === 'prefiero una habitación silenciosa', 'no se duplica la misma nota de ambas fuentes');
}

console.log(' 5b. Duplicado que solo difiere en mayúsculas/puntuación');
{
  // Caso real de la E2E: el cliente escribe minúscula, DeepSeek reescribe con
  // mayúscula inicial y punto final en [NOTA:]. No deben coexistir.
  let acum = CORE.fusionarNotas(undefined, notasU('prefiero una habitación silenciosa'));
  acum = CORE.fusionarNotas(acum, CORE.extractNotas('😊 [NOTA: Prefiero una habitación silenciosa.]').notas);
  ok(acum === 'prefiero una habitación silenciosa',
     'colapsa "prefiero…" y "Prefiero….", conservando la primera');
  ok(acum.split(' · ').length === 1, 'queda una sola nota, sin duplicado');
}

console.log(' 6. Cortesías y genéricos no son nota');
['gracias', 'sí', 'perfecto', 'está bien', 'ok', 'quiero reservar un masaje', 'hola buenas']
  .forEach((t) => ok(notasU(t).length === 0, `"${t}" no se guarda como nota`));

console.log(' 7. Datos estructurados no terminan en notes');
['Mi teléfono es 202-555-0199', 'mi correo es ana@example.com', 'el 24 de julio', 'a las 5:00 PM', 'me llamo María José']
  .forEach((t) => ok(notasU(t).length === 0, `"${t}" no produce nota`));

console.log(' 8. La nota no desaparece al introducir otro dato después');
{
  // Simula el flujo real: la nota llega, luego el cliente da el teléfono.
  let notes;
  notes = CORE.fusionarNotas(notes, notasU('prefiero una habitación silenciosa'));
  const paso2 = notasU('mi teléfono es 202-555-0199');   // no aporta nota
  notes = CORE.fusionarNotas(notes, paso2);
  ok(notes === 'prefiero una habitación silenciosa', 'la nota sobrevive al mensaje del teléfono');
}

// ── FALLO 2: NOMBRES DE VARIAS PALABRAS ────────────────────────────────────
console.log('FALLO 2 — Nombres');

console.log(' 1. Una palabra');
ok(nombre('me llamo Ana') === 'Ana', '"Ana"');

console.log(' 2. Dos palabras');
ok(nombre('me llamo Ana Ruiz') === 'Ana Ruiz', '"Ana Ruiz"');

console.log(' 3. Tres palabras');
ok(nombre('me llamo Prueba Fecha Playwright') === 'Prueba Fecha Playwright',
   '"Prueba Fecha Playwright" se conserva exactamente');

console.log(' 4. Cuatro o más palabras');
ok(nombre('me llamo Ana María López García') === 'Ana María López García', '"Ana María López García"');

console.log(' 5. Nombre con "de la"');
ok(nombre('me llamo María José de la Cruz') === 'María José de la Cruz', '"María José de la Cruz"');
ok(nombre('me llamo Juan Carlos de la Cruz') === 'Juan Carlos de la Cruz', '"Juan Carlos de la Cruz"');
ok(nombre('me llamo José Luis del Valle') === 'José Luis del Valle', '"José Luis del Valle"');

console.log(' 6. Nombre con tildes y ñ');
ok(nombre('soy Begoña Muñoz') === 'Begoña Muñoz', '"Begoña Muñoz"');

console.log(' 7. "Soy alérgico" NO reemplaza el nombre');
ok(nombre('soy alérgico a los aceites') === undefined, '"soy alérgico…" no es nombre');
ok(nombre('soy vegetariano') === undefined, '"soy vegetariano" no es nombre');

console.log(' 8. Una nota junto al nombre no lo contamina');
ok(nombre('me llamo Ana y prefiero silencio') === 'Ana', 'corta en "y prefiero…"');

console.log(' 9. Teléfono/correo/notas posteriores no cambian el nombre');
{
  const pasos = [
    'me llamo María José de la Cruz',
    'mi teléfono es 202-555-0199',
    'mi correo es maria@example.com',
    'soy alérgica a los aceites',
  ];
  const cap = {};
  pasos.forEach((m) => { Object.assign(cap, CORE.extractBooking(m, MENU, null, 'es')); });
  ok(cap.nombre === 'María José de la Cruz', 'el nombre completo se conserva tras todos los pasos');
}

// ── FALLO 3: SANEADO DE MARCADORES ─────────────────────────────────────────
console.log('FALLO 3 — Marcadores');

console.log(' 1. [MOSTRAR_MENU] no queda en la burbuja');
ok(!/\[MOSTRAR_MENU\]/.test(CORE.limpiarMarcadores('¡Hola! 😊 [MOSTRAR_MENU]')),
   'se elimina [MOSTRAR_MENU]');

console.log(' 2. [NOTA:] nunca aparece tras sanear');
ok(!/\[NOTA/i.test(CORE.limpiarMarcadores('Anotado 😊\n[NOTA: prefiero silencio]')),
   'se elimina [NOTA: …]');

console.log(' 3. Cualquier marcador interno equivalente se elimina');
ok(CORE.limpiarMarcadores('texto [RESERVA_CONFIRMADA] fin') === 'texto fin',
   '[RESERVA_CONFIRMADA] se elimina');
ok(CORE.limpiarMarcadores('texto [LEAD_MINIMO] fin') === 'texto fin',
   '[LEAD_MINIMO] se elimina');

console.log(' 4. Corchetes legítimos en minúscula se respetan');
ok(CORE.limpiarMarcadores('elige tu color [opcional] aquí') === 'elige tu color [opcional] aquí',
   '"[opcional]" no se toca');
ok(CORE.limpiarMarcadores('nota [nota importante] visible') === 'nota [nota importante] visible',
   '"[nota importante]" (sin dos puntos) no se toca');

console.log(' 5. Simulación de persistencia: lo guardado ya viene limpio');
{
  // Lo que la app persiste es el resultado de limpiarMarcadores; al restaurar
  // se vuelve a sanear. Ninguna de las dos fases deja marcadores.
  const crudo = 'Perfecto 😊 aquí tienes el menú [MOSTRAR_MENU]';
  const persistido = CORE.limpiarMarcadores(crudo);
  ok(!/\[MOSTRAR_MENU\]/.test(persistido), 'lo persistido no lleva marcador');
  const restaurado = CORE.limpiarMarcadores(persistido);
  ok(!/\[MOSTRAR_MENU\]/.test(restaurado), 'un doble saneado (restaurar) sigue limpio');
  ok(restaurado === 'Perfecto 😊 aquí tienes el menú', 'el texto real se conserva');
}

console.log(' 6. Historial viejo con marcador crudo se limpia al restaurar');
{
  // Un mensaje guardado ANTES del fix conserva el marcador; al restaurarlo, la
  // app aplica limpiarMarcadores y no debe mostrarse.
  const viejo = 'Te muestro los servicios [MOSTRAR_MENU]';
  ok(CORE.limpiarMarcadores(viejo) === 'Te muestro los servicios',
     'el historial antiguo se sanea en la restauración');
}

console.log(fallos === 0 ? '\n✅ Todas las pruebas de los tres fallos pasan' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
