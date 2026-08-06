// Deterministic coverage for the additive restaurant/barber reservation rules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { __test } from '../api/reservations.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'chat-core.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const CORE = win.JBChatCore;
  const { validarReserva, configuredStaff, duplicateReservationKey, reservationTemplate } = __test;
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
};

const hours = {
  monday: { enabled: true, ranges: [{ start: '09:00', end: '19:00' }] },
};

console.log('1. Shared chat requirements and extraction');
{
  const restaurant = { templateId: 'restaurant' };
  const barber = { templateId: 'barber', staff: [{ id: 'ana', name: 'Ana' }] };
  // Orden: primero lo que define la cita (servicio/personas, fecha, hora),
  // después los datos de contacto de quien la pide. [BUG-ORDEN-RESERVA]
  ok(CORE.bookingRequirements(restaurant, {}).join(',') === 'fecha,hora,personas,nombre,contacto,email,specialRequests',
    'restaurant requires special requests before review');
  ok(CORE.bookingRequirements(barber, {}).join(',') === 'servicio,fecha,hora,nombre,contacto,email,specialRequests',
    'barber requires special requests before review');
  ok(CORE.bookingRequirements({}, {}).join(',') === 'servicio,fecha,hora,nombre,telefono,email,specialRequests',
    'legacy Spa/Bella also requires special requests');
  const table = CORE.extractBooking('Somos 4, mesa junto a la ventana', [], hours, 'es', restaurant);
  ok(table.personas === '4' && table.tablePreference === 'mesa junto a la ventana',
    'restaurant extracts party size and table preference');
  const cut = CORE.extractBooking('Quiero corte con Ana', [{ nombre: 'Corte' }], hours, 'es', barber);
  ok(cut.servicio === 'Corte' && cut.barberPreference === 'Ana', 'barber extracts configured preference');
  ok(CORE.CAMPO_MENCIONADO.some(([re, field]) => field === 'barberPreference' && re.test('cambiar barbero')),
    'barber preference can be cleared during a pre-submit change');

  // Regression: answering the CURRENT pending field (e.g. teléfono) and
  // pre-answering specialRequests in the same message must capture both —
  // before, the extra "no tengo petición especial" was silently dropped and
  // the assistant asked the special-request question again as if the
  // customer had never answered it. [BUG-MEMORIA-ADELANTADA]
  const spa = {};
  const withPhone = CORE.extractBooking('Mi teléfono es 2067421261 y no tengo petición especial.', [], hours, 'es', spa);
  ok(withPhone.telefono === '2067421261' && withPhone.specialRequests === '',
    'phone + pre-answered specialRequests are both captured from one message');
  const onlyPhone = CORE.extractBooking('Mi teléfono es 2067421261', [], hours, 'es', spa);
  ok(onlyPhone.telefono === '2067421261' && onlyPhone.specialRequests === undefined,
    'specialRequests is left undefined when not mentioned');

  // esSinPeticionEspecial must also recognize "no tengo" (without "ninguna")
  // as a standalone reply, and "no tengo petición especial" as an embedded
  // phrase — both used to fall through and get stored as literal text.
  ok(CORE.esSinPeticionEspecial('No tengo') === true, '"No tengo" alone means no special request');
  ok(CORE.esSinPeticionEspecial('no tengo petición especial') === true,
    '"no tengo petición especial" (without "ninguna") means no special request');
}

console.log('2. Server-side persona validation');
{
  const restaurant = { templateId: 'restaurant', businessHours: hours, menu: [], capacityPerSlot: 2, reservationDuration: '60 min' };
  const barber = {
    templateId: 'barber', businessHours: hours, menu: [{ nombre: 'Corte', duracion: '60 min' }],
    staff: [{ id: 'ana', name: 'Ana', businessHours: hours }], capacityPerSlot: 2,
  };
  ok(reservationTemplate({ config: { templateId: 'restaurant' } }) === 'restaurant',
    'template id can come from client config');
  ok(validarReserva({ ...barber, __reservationBarberPreference: 'Nadie' }, '2026-07-20', '10:00', 'Corte', 0, []).motivo === 'barbero_no_disponible',
    'unknown configured barber preference is rejected');
  const canonical = { ...barber, staff: [{ id: 'ana', name: 'Ana', businessHours: hours }], barbers: [{ id: 'luis', name: 'Luis' }] };
  ok(configuredStaff(canonical)[0].name === 'Ana' && configuredStaff({ templateId: 'barber', barbers: [{ name: 'Luis' }] })[0].name === 'Luis',
    'client.staff tiene prioridad y los registros legacy barbers siguen funcionando');
  const unavailable = { ...barber, staff: [{ id: 'ana', name: 'Ana', businessHours: { monday: { enabled: false, ranges: [] } } }], __reservationBarberPreference: 'Ana' };
  ok(validarReserva(unavailable, '2026-07-20', '10:00', 'Corte', 0, []).motivo === 'barbero_no_disponible',
    'el barbero existente se rechaza cuando no esta disponible');
  const occupied = [{ estado: 'pendiente', fechaISO: '2026-07-20', horaISO: '10:00', servicio: 'Corte', barberPreference: 'Ana' }];
  ok(validarReserva({ ...barber, __reservationBarberPreference: 'Ana' }, '2026-07-20', '10:30', 'Corte', 0, occupied).motivo === 'barbero_no_disponible',
    'same barber cannot be double-booked during the service duration');
  const same = { fechaISO: '2026-07-20', horaISO: '10:00', telefono: '+1 555 0100', email: '' };
  ok(duplicateReservationKey([{ ...same, estado: 'pendiente', telefono: '15550100' }], same) !== null,
    'same active contact/date/time is a duplicate');
  ok(duplicateReservationKey([{ ...same, estado: 'cancelada' }], same) === null, 'cancelled reservation may be booked again');
  ok(validarReserva(restaurant, '2026-07-20', '10:00', '', 0, []).ok,
    'restaurant does not require a Spa service for availability validation');
  const timedRestaurant = { ...restaurant, capacityPerSlot: 1, reservationDuration: '60 min' };
  ok(validarReserva(timedRestaurant, '2026-07-20', '10:30', '', 0,
    [{ estado: 'pendiente', fechaISO: '2026-07-20', horaISO: '10:00', duracion: 60 }]).motivo === 'sin_disponibilidad',
  'configured restaurant duration participates in capacity overlap checks');
  ok(validarReserva({ ...restaurant, reservationIntervalMinutes: 30 }, '2026-07-20', '10:15', '', 0, []).motivo === 'intervalo_invalido',
    'backend rejects starts outside the configured reservation interval');
  const spa = {
    templateId: 'spa', businessHours: hours,
    menu: [{ nombre: 'Facial', duracion: '60 min' }], capacityPerSlot: 1, bufferMinutes: 15,
  };
  const spaExisting = [{ estado: 'confirmada', fechaISO: '2026-07-20', horaISO: '10:00', servicio: 'Facial', duracion: 60 }];
  ok(validarReserva(spa, '2026-07-20', '11:00', 'Facial', 0, spaExisting).motivo === 'sin_disponibilidad',
    'Spa: 60 min más 15 min de preparación bloquea los siguientes 75 minutos');
  ok(validarReserva(spa, '2026-07-20', '11:15', 'Facial', 0, spaExisting).ok,
    'Spa: la siguiente cita queda disponible al terminar los 75 minutos');
  const spaThreeSlots = [...spaExisting, ...spaExisting, ...spaExisting];
  ok(validarReserva({ ...spa, capacityPerSlot: 3 }, '2026-07-20', '10:00', 'Facial', 0, spaThreeSlots).motivo === 'sin_disponibilidad',
    'Spa: capacidad 3 permite tres citas simultáneas y rechaza la cuarta');
  ok(validarReserva({ ...spa, templateId: undefined, bufferMinutes: undefined }, '2026-07-20', '11:00', 'Facial', 0, spaExisting).ok,
    'clientes antiguos sin buffer conservan ocupación de solo 60 minutos');
  const spaClosing = {
    ...spa, businessHours: { monday: { enabled: true, ranges: [{ start: '10:00', end: '17:00' }] } }, bufferMinutes: 30,
  };
  ok(validarReserva(spaClosing, '2026-07-20', '15:30', 'Facial', 0, []).ok &&
    validarReserva(spaClosing, '2026-07-20', '15:45', 'Facial', 0, []).motivo === 'no_cabe_antes_del_cierre',
    'Spa: servicio más preparación debe terminar antes del cierre');
}

console.log('3. Booking summary renders visibly and never duplicates its buttons');
{
  // Regression, found by physically scrolling the real chat: the summary
  // text can grow the container past what the passive "smart scroll" (which
  // only follows if you're already within 80px of the bottom) considers
  // "already at the bottom", so the confirm/change buttons rendered
  // completely below the fold — visible in the DOM, invisible to the
  // customer. And if the customer's reply wasn't recognized as either a
  // clear confirmation or a clear correction (e.g. "todo está correcto"
  // before CONFIRMACIONES was widened), the flow re-called
  // showBookingSummary() with the FIRST button pair still on screen,
  // stacking a second, confusing pair. [BUG-SCROLL-GALERIA] [BUG-RESUMEN-DUPLICADO]
  for (const file of ['asistente.html', 'widget.js']) {
    const source = readFileSync(join(root, file), 'utf8');
    const summaryFn = source.match(/function showBookingSummary\(\)[\s\S]*?\n  \}/)[0];
    ok(/irAlFondo\(msgsEl, true\)/.test(summaryFn),
      `${file} showBookingSummary() forces the real confirm button into view`);
    ok(/resumenBotones/.test(summaryFn) && /resumenBotones\.remove\(\)/.test(summaryFn),
      `${file} showBookingSummary() removes a stale button pair before showing a new one`);
  }
}

console.log('4. Active-reservation duplicate-attempt buttons never leak to free chat');
{
  // Regression, found live: after a duplicate booking attempt shows the
  // Modificar/Cancelar/Mantener buttons, a customer who types anything else
  // instead of tapping one fell straight through to the open-ended chat
  // model. With no idea a reservation was already pending a decision, the
  // model improvised its own fake "confirm with sí" loop ("¿Todo correcto?
  // Si me dices que sí, lo proceso") that can never create a real
  // reservation — exactly the invented-explanation failure mode.
  // [BUG-DUPLICADO-CHAT-LIBRE]
  for (const file of ['asistente.html', 'widget.js']) {
    const source = readFileSync(join(root, file), 'utf8');
    ok(/var dupPending = false;/.test(source), `${file} declares a dupPending gate`);
    ok(/dupPending = true;/.test(source), `${file} handleDuplicateAttempt() sets dupPending`);
    ok(/if \(dupPending\) \{/.test(source),
      `${file} refuses to fall through to free chat while dupPending is set`);
    const actionsFn = source.match(/function offerReservationActions\(lang\)[\s\S]*?\n  \}/)[0];
    ok(/irAlFondo\(msgsEl, true\)/.test(actionsFn),
      `${file} offerReservationActions() forces the real action buttons into view`);
    ok(/accionesBotones/.test(actionsFn) && /accionesBotones\.remove\(\)/.test(actionsFn),
      `${file} offerReservationActions() removes a stale button set before showing a new one`);
  }
}

if (failures) process.exit(1);
console.log('✅ Persona reservation rules verified');
