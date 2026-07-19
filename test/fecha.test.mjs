// Extracción de fecha en extractBooking(). El bug original: el patrón numérico
// no llevaba \b ni validación de rango, así que dentro del teléfono
// "202-555-0147" encontraba "02-55" y lo guardaba como fecha, pisando el
// "24 de julio" que el cliente había dicho antes.
// chat-core.js es un IIFE que asigna window.JBChatCore, así que se carga con un
// window falso.
// Ejecutar: node test/fecha.test.mjs
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
// `fecha` fija el idioma español (el caso normal). Para probar el caso "sin
// idioma configurado" hay que llamar a extractBooking directamente, porque un
// valor por defecto aquí se tragaría el undefined que queremos comprobar.
const fecha = (t) => CORE.extractBooking(t, MENU, null, 'es').fecha;
const fechaLang = (t, lang) => CORE.extractBooking(t, MENU, null, lang).fecha;

// Año futuro estable: los tests no deben caducar al cambiar de año.
const ANIO = new Date().getFullYear() + 1;

console.log('1. El bug reportado: teléfono que contiene "02-55"');
{
  ok(fecha('Mi teléfono es 202-555-0147') === undefined,
     'un teléfono solo NO produce fecha');
  ok(fecha('Mi teléfono es 202-555-0147') !== '02-55',
     'nunca captura "02-55" del teléfono');

  // El caso real de producción: la fecha se dijo antes, el teléfono después.
  const conv = ['Me vendría bien el 24 de julio', 'Mi teléfono es 202-555-0147'];
  let capturado = {};
  conv.forEach((m) => { Object.assign(capturado, CORE.extractBooking(m, MENU, null, 'es')); });
  ok(capturado.fecha === '24 de julio',
     '"24 de julio" + teléfono 202-555-0147 -> la fecha sigue siendo "24 de julio"');
  ok(capturado.telefono === '202-555-0147', 'el teléfono se captura igual que antes');
}

console.log('2. Formatos numéricos ambiguos rechazados');
{
  ok(fecha('02-55') === undefined, '"02-55" suelto es rechazado (día 55 no existe)');
  ok(fecha('el 45/13') === undefined, '"45/13" rechazado (mes 13 no existe)');
  ok(fecha('31/02') === undefined, '"31/02" rechazado (febrero no tiene 31)');
  ok(fecha('99 de julio') === undefined, '"99 de julio" rechazado');
  ok(fecha('0/0') === undefined, '"0/0" rechazado');
}

console.log('3. Formatos numéricos válidos aceptados');
{
  ok(fecha(`24/07/${ANIO}`) === `24/07/${ANIO}`, `24/07/${ANIO} aceptado (día primero)`);
  ok(fecha(`07/24/${ANIO}`) === `07/24/${ANIO}`, `07/24/${ANIO} aceptado (mes primero, día > 12)`);
  ok(fecha(`24-07-${ANIO}`) === `24-07-${ANIO}`, `24-07-${ANIO} aceptado`);
  ok(fecha(`07-24-${ANIO}`) === `07-24-${ANIO}`, `07-24-${ANIO} aceptado`);
  ok(fecha('24/07') === '24/07', '24/07 sin año aceptado');
  ok(fecha('07/24') === '07/24', '07/24 sin año aceptado');
  ok(fecha(`${ANIO}-07-24`) === `${ANIO}-07-24`, 'formato ISO aceptado');
}

console.log('4. Ambigüedad día/mes resuelta por idioma del negocio');
{
  ok(fechaLang('07/08', 'es') === '07/08', 'con idioma es: 07/08 se acepta (7 de agosto)');
  ok(fechaLang('07/08', 'en') === '07/08', 'con idioma en: 07/08 se acepta (8 de julio)');
  ok(fechaLang('07/08', undefined) === undefined,
     'sin idioma configurado: no adivina, no captura (el flujo repregunta)');
}

console.log('5. Fechas en palabras (compatibilidad con reservas antiguas)');
{
  ok(fecha('mañana') === 'mañana', '"mañana" sigue funcionando');
  ok(fecha('manana a las 5') === 'manana', '"manana" sin ñ sigue funcionando');
  ok(fecha('pasado mañana') === 'pasado mañana', '"pasado mañana" funciona');
  ok(fecha('hoy si puede ser') === 'hoy', '"hoy" funciona');
  // El artículo "el" nunca formó parte de la captura, ni antes ni ahora.
  ok(fecha('el próximo viernes') === 'próximo viernes', '"el próximo viernes" funciona');
  ok(fecha('este lunes') === 'este lunes', '"este lunes" funciona');
  ok(fecha('Me vendría bien el 24 de julio') === '24 de julio', '"24 de julio" funciona');
  ok(fecha('julio 24 me viene bien') === 'julio 24', '"julio 24" funciona');
  ok(fecha('24 de julio de ' + ANIO) === '24 de julio de ' + ANIO, '"24 de julio de AAAA" funciona');
  ok(fecha('el 1 de septiembre') === '1 de septiembre', 'mes de nombre largo funciona');
}

console.log('6. Otros campos no se confunden con fecha');
{
  ok(fecha('a las 4:00 PM') === undefined, 'una hora "4:00 PM" no se lee como fecha');
  ok(fecha('a las 16:30') === undefined, 'una hora "16:30" no se lee como fecha');
  ok(fecha('mi correo es ana2-15@ejemplo.com') === undefined,
     'un correo con números no se lee como fecha');
  ok(fecha('mi referencia es 1784477444793') === undefined,
     'un ID largo no se lee como fecha');
  ok(fecha('llámame al +34 612-34-5678') === undefined,
     'un teléfono internacional no se lee como fecha');
}

console.log('7. La fecha no cambia cuando después llegan teléfono, correo o notas');
{
  const pasos = [
    'quiero un masaje relajante el 24 de julio',
    'a las 4:00 PM',
    'me llamo Prueba Playwright',
    'mi teléfono es 202-555-0147',
    'mi correo es prueba-playwright@example.com',
    'soy alérgico a los aceites con fragancia',
    'prefiero una habitación silenciosa',
  ];
  const cap = {};
  pasos.forEach((m) => { Object.assign(cap, CORE.extractBooking(m, MENU, null, 'es')); });
  ok(cap.fecha === '24 de julio', 'la fecha sobrevive a todos los pasos posteriores');
  ok(cap.nombre === 'Prueba Playwright', 'el nombre se conserva (no lo pisa "soy alérgico")');
  ok(cap.telefono === '202-555-0147', 'el teléfono se conserva');
  ok(cap.email === 'prueba-playwright@example.com', 'el correo se conserva');
  ok(cap.servicio === 'Masaje Relajante', 'el servicio se conserva');
}

console.log('8. Una fecha numérica no se guarda como teléfono');
{
  const r = CORE.extractBooking(`quiero cita el 24-07-${ANIO}`, MENU, null, 'es');
  ok(r.fecha === `24-07-${ANIO}`, `24-07-${ANIO} se captura como fecha`);
  ok(r.telefono === undefined, `24-07-${ANIO} NO se captura como teléfono`);
}

console.log('9. La fecha más reciente gana');
{
  const cap = {};
  ['el 24 de julio', 'mejor el 25 de julio'].forEach((m) => {
    Object.assign(cap, CORE.extractBooking(m, MENU, null, 'es'));
  });
  ok(cap.fecha === '25 de julio', 'una corrección de fecha sustituye a la anterior');
}

console.log(fallos === 0 ? '\n✅ Todas las pruebas de fecha pasan' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
