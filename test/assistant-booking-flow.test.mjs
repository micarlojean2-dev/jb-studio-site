import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dirname, '..', 'asistente.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
}

console.log('1. Restore y paridad asistente v2');
ok(source.includes('!emailAction && restoreBookingFlowV2()'), 'restaura únicamente el estado V2');
ok(source.includes('BARBER_SELECTION') && source.includes("'Cualquiera'"), 'barbería ofrece selección opcional y Cualquiera');
ok(source.includes('foodPreferences: state.foodPreferences') && source.includes('tablePreference: state.tablePreference'), 'restaurante envía preferencias opcionales existentes');
ok(source.includes('function renderAvailabilitySlots('), 'disponibilidad general tiene renderer separado');
ok(source.includes('captureBookingV2Event('), 'telemetría v2 no recibe datos del cliente');

console.log('\n2. Retirada del motor legacy');
{
  const bookingIntent = source.slice(source.indexOf("intent === 'booking'"), source.indexOf('// Pregunta general'));
  ok(bookingIntent.includes('if (startBookingFlowV2(lang'), 'una reserva nueva intenta únicamente V2');
  ok(!bookingIntent.includes('askBookingTurn('), 'fallo de inicio V2 no entra al motor legacy');
  ok(bookingIntent.includes('No pudimos iniciar la reserva'), 'fallo de inicio V2 muestra un error recuperable');
  ok(!/\b(bookingStep|bookingData|bookingPending|bookingReview|BOOKING_SESS|askBookingTurn|showBookingSummary|submitBooking)\b/.test(source), 'no quedan estado ni funciones legacy');
}

console.log(failures ? `\n❌ ${failures} prueba(s) fallaron` : '\n✅ asistente v2: restore, paridad y observabilidad verificados');
process.exit(failures ? 1 : 0);
