// Panel de reservas (reservas.html): la tarjeta muestra siempre las peticiones
// especiales, con iconos, badge y fecha de creación. Se carga el HTML real en
// jsdom, se inyectan reservas y se llama a render(). Requiere jsdom.
// Ejecutar: node test/panel.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'reservas.html'), 'utf8');

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); fallos++; } };

// clientId sale de la ruta; sin token no hace fetch (jsdom no lo tiene guardado).
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://jbstudio.app/reservas/bella-luna-spa' });
const { window } = dom;
const doc = window.document;

// Mostrar el panel y renderizar con datos de prueba (sin red).
window.allData = [
  { nombre: 'Mike', servicio: 'Masaje Profundo', fecha: 'mañana', hora: '12:00 PM',
    telefono: '299982332', email: 'mike@x.com', estado: 'pendiente',
    notes: 'alérgico a los aceites', fechaSolicitud: new Date(Date.now() - 12 * 60000).toISOString() },
   { nombre: 'Ana', servicio: 'Uñas', fecha: 'hoy', hora: '10:00 AM',
     telefono: '555', email: 'ana@x.com', estado: 'pendiente',
     partySize: 3, tablePreference: 'Terraza', barberPreference: 'Luis',
     fechaSolicitud: new Date(Date.now() - 3 * 3600000).toISOString() },  // sin notes
];
window.activeFilter = 'proximas';
window.render();

const sheet = doc.getElementById('sheet');
const cards = sheet.querySelectorAll('.rcard');
const conNotas = [...cards].find((c) => c.textContent.includes('Mike'));
const sinNotas = [...cards].find((c) => c.textContent.includes('Ana'));

console.log('1. Estructura de tarjetas');
ok(cards.length === 2, 'se renderiza una tarjeta por reserva');
ok(conNotas && /👤|💆|📅|🕒|📞|✉️/.test(conNotas.textContent), 'la tarjeta usa los iconos de campo');

console.log('2. Panel MOSTRANDO peticiones especiales');
ok(conNotas && conNotas.querySelector('.rnotes'), 'la reserva con notas tiene bloque .rnotes');
ok(conNotas && conNotas.textContent.includes('Peticiones especiales') && conNotas.textContent.includes('alérgico a los aceites'), 'muestra el texto de la petición');

console.log('3. Panel SIN peticiones');
ok(sinNotas && sinNotas.querySelector('.rnotes'), 'la reserva sin peticiones conserva el bloque');
ok(sinNotas && sinNotas.textContent.includes('Sin peticiones especiales'), 'muestra el estado vacío canónico');

console.log('4. Badge y fecha de creación');
ok(conNotas && conNotas.querySelector('.estado.nueva'), 'badge Nueva (verde) para pendiente');
ok(conNotas && /Creada hace 12 minutos/.test(conNotas.textContent), 'muestra "Creada hace 12 minutos" con la fecha real');

console.log('5. Campos de restaurante y barbería');
ok(sinNotas && sinNotas.textContent.includes('Personas') && sinNotas.textContent.includes('3'), 'muestra personas/party size');
ok(sinNotas && sinNotas.textContent.includes('Terraza'), 'muestra preferencia de mesa');
ok(sinNotas && sinNotas.textContent.includes('Luis'), 'muestra preferencia de barbero');

console.log('6. Compatibilidad: reserva vieja sin campo notes no rompe');
{
  window.allData = [{ nombre: 'Viejo', servicio: 'X', fecha: 'ayer', hora: '9:00', estado: 'pendiente' }];
  window.render();
  const c = doc.getElementById('sheet').querySelector('.rcard');
  ok(c && c.textContent.includes('Sin peticiones especiales') && c.textContent.includes('Viejo'), 'renderiza sin notes (undefined) sin error');
}

console.log('7. Fecha legible y tiempo restante usan datos normalizados');
{
  const fixedNow = Date.UTC(2026, 10, 27, 23, 45);
  window.Date.now = () => fixedNow;
  {
    const fp = window.fechaPartes('2026-11-28');
    ok(fp && fp.weekday === 'SÁBADO' && fp.dayMonth === '28 NOVIEMBRE', `fechaISO se muestra en weekday/día+mes separados y en mayúsculas (${fp && fp.weekday} / ${fp && fp.dayMonth})`);
    ok(window.fechaPartes('no-es-una-fecha') === null, 'fechaPartes() devuelve null ante una fecha inválida (cardHTML cae a r.fecha)');
  }
  ok(window.tiempoRestante({ fechaISO: '2026-11-27', horaISO: '23:59', hora: '11:59 PM', timezone: 'UTC' }) === '⏳ En 14 minutos', 'muestra minutos para una reserva próxima');
  ok(window.tiempoRestante({ fechaISO: '2026-11-28', horaISO: '14:00', hora: '2:00 PM', timezone: 'UTC' }) === '⏳ Mañana a las 2:00 PM', 'muestra mañana con la hora guardada');
  ok(window.tiempoRestante({ fechaISO: '2026-12-01', horaISO: '10:00', hora: '10:00 AM', timezone: 'UTC' }) === '⏳ Faltan 4 días', 'muestra días para reservas futuras');
  ok(window.tiempoRestante({ fechaISO: '2026-11-27', horaISO: '23:00', timezone: 'UTC' }) === '', 'no muestra tiempo para una fecha pasada');
  ok(window.tiempoRestante({ fechaISO: '2026-11-28', horaISO: '14:00' }) === '', 'no usa la zona horaria del navegador como fallback');
}

console.log('8. La tarjeta solo muestra tiempo restante en estados próximos');
{
  window.allData = [
    { nombre: 'Confirmada', servicio: 'X', fecha: 'mañana', fechaISO: '2026-11-28', hora: '2:00 PM', horaISO: '14:00', timezone: 'UTC', estado: 'confirmada' },
    { nombre: 'Cancelada', servicio: 'X', fecha: 'mañana', fechaISO: '2026-11-28', hora: '2:00 PM', horaISO: '14:00', timezone: 'UTC', estado: 'cancelada' },
  ];
  window.activeFilter = 'proximas';
  window.render();
  const confirmed = [...doc.querySelectorAll('.rcard')].find((c) => c.textContent.includes('Confirmada'));
  ok(confirmed && confirmed.textContent.includes('⏳ Mañana a las 2:00 PM'), 'confirmed reservation shows its remaining time');
  window.activeFilter = 'canceladas';
  window.render();
  const cancelled = [...doc.querySelectorAll('.rcard')].find((c) => c.textContent.includes('Cancelada'));
  ok(cancelled && !cancelled.textContent.includes('⏳'), 'cancelled reservation does not show remaining time');
}

console.log('9. Selector y traducción del panel');
{
  ok(doc.getElementById('login-language') && doc.getElementById('panel-language'), 'hay selector accesible en login y cabecera');
  window.setPanelLanguage('en');
  ok(doc.getElementById('agenda-title').textContent === 'Your appointments', 'traduce encabezado estático al inglés');
  window.allData = [];
  window.activeFilter = 'proximas';
  window.render();
  ok(doc.getElementById('sheet').textContent.includes('No upcoming appointments.'), 'traduce estado vacío dinámico al inglés');
  window.setPanelLanguage('es');
}

console.log('');
if (fallos) { console.error(`❌ ${fallos} aserción(es) fallaron`); process.exit(1); }
console.log('✅ Panel de reservas verificado (peticiones especiales, iconos, badge, fecha)');
