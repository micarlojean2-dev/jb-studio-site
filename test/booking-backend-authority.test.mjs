import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { __test } = await import('../api/reservations.js');
const { validarReserva } = __test;
const widget = readFileSync(join(root, 'widget.js'), 'utf8');
const assistant = readFileSync(join(root, 'asistente.html'), 'utf8');

const restaurant = {
  templateId: 'restaurant', timezone: 'America/Los_Angeles', minNoticeHours: 0, capacityPerSlot: 20,
  businessHours: {
    monday: { enabled: false, ranges: [] },
    tuesday: { enabled: true, ranges: [{ start: '11:00', end: '21:00' }] },
  },
  menu: [{ nombre: 'Hamburguesa Clásica', duracion: '30 min' }],
};

const closed = validarReserva(restaurant, '2026-07-21', '09:00', 'Hamburguesa Clásica', undefined, []);
assert.equal(closed.ok, false, '09:00 fuera de horario debe rechazarse');
assert.equal(closed.motivo, 'fuera_de_horario');
const open = validarReserva(restaurant, '2026-07-21', '12:00', 'Hamburguesa Clásica', undefined, []);
assert.equal(open.ok, true, 'un horario válido debe permitirse para un único POST');

for (const [name, source] of [['widget', widget], ['asistente', assistant]]) {
  assert.match(source, /if \(completo\) \{ showBookingSummary\(\); return; \}/,
    `${name}: no debe consultar ni mostrar texto del modelo al completar datos`);
  assert.match(source, /Revisando disponibilidad…/,
    `${name}: debe mostrar un estado neutral mientras espera el POST`);
  // Auditoría FASE 3: el texto de rechazo ya no está hardcodeado en
  // widget.js/asistente.html — CORE.motivoDisponibilidadMensaje() decide la
  // redacción por idioma/plantilla; el backend solo entrega `motivo`.
  assert.match(source, /CORE\.motivoDisponibilidadMensaje\(d\.motivo, cfg, lang, d\.alternativa\)/,
    `${name}: usa el mensaje de disponibilidad centralizado (no un texto fijo por motivo)`);
  assert.ok(source.includes('msgs = msgs.filter(function (m)') && source.includes('pendiente|confirmad[ao]|equipo.*revis'),
    `${name}: debe limpiar afirmaciones viejas del historial después del rechazo`);
}

assert.doesNotMatch(widget, /else \{\s*card\.appendChild\(buildIcon\(item\.nombre\)\);\s*\}/,
  'widget: una tarjeta sin imagen no muestra icono placeholder');
assert.doesNotMatch(assistant, /else \{\s*card\.appendChild\(buildIco\(item\.nombre\)\);\s*\}/,
  'asistente: una tarjeta sin imagen no muestra icono placeholder');
console.log('Booking backend authority and image-free cards verified');
