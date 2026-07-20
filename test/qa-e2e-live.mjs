// QA E2E EN VIVO contra producción, SOLO sobre el cliente aislado qa-e2e-test.
// Crea reservas REALES (POST /api/reservations), las lee por el panel
// (reservations-list con panelToken), prueba doble-envío/idempotencia,
// cancelación, reprogramación (PUT estado) y aislamiento entre reservas.
// Todo se marca con el runId en el nombre para que el teardown lo identifique.
// NO es parte de npm test (requiere el cliente sembrado). Uso:
//   QA_RUNID=... QA_PANELTOKEN=... node test/qa-e2e-live.mjs
const BASE   = process.env.BASE || 'https://jbstudio.app';
const CLIENT = 'qa-e2e-test';
const RUNID  = process.env.QA_RUNID;
const TOKEN  = process.env.QA_PANELTOKEN;
if (!RUNID || !TOKEN) { console.error('Faltan QA_RUNID / QA_PANELTOKEN'); process.exit(2); }

let fallos = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fallos++; console.error('  ✗', m); } };
const nom = (label) => `${RUNID} ${label}`;   // el nombre lleva el runId (QA-E2E-...)

const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const list = async () => {
  const r = await fetch(`${BASE}/api/reservations-list?clientId=${CLIENT}&token=${encodeURIComponent(TOKEN)}`);
  return r.ok ? await r.json() : [];
};
const putEstado = async (key, estado) => {
  const r = await fetch(`${BASE}/api/reservations-list?clientId=${CLIENT}&token=${encodeURIComponent(TOKEN)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, estado }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const mine = (arr, label) => arr.filter(x => String(x.nombre || '') === nom(label));

async function main() {
  console.log(`\n=== E2E vivo · runId ${RUNID} ===`);

  // C1 — Reserva completa real (happy path) + coherencia API↔almacenamiento↔panel
  console.log('C1. Reserva completa real');
  const booking = { clientId: CLIENT, nombre: nom('Cliente Feliz'), telefono: '202-555-0100',
    email: `qa-feliz-${RUNID}@example.com`, servicio: 'Masaje Relajante', fecha: 'mañana',
    hora: '3:00 PM', notes: 'prefiero una habitación silenciosa' };
  const c1 = await post('/api/reservations', booking);
  ok(c1.status === 201 && c1.json?.ok === true, `alta → 201 ok (status ${c1.status})`);
  ok(c1.json?.status === 'pendiente', 'nace en estado pendiente (no confirmada)');
  ok(typeof c1.json?.reservationId === 'string', 'devuelve reservationId único');
  const l1 = await list();
  const r1 = mine(l1, 'Cliente Feliz')[0];
  ok(!!r1, 'aparece en el panel (reservations-list)');
  if (r1) {
    ok(r1.servicio === booking.servicio, 'panel: servicio coincide');
    ok(r1.hora === booking.hora, 'panel: hora coincide');
    ok(r1.fecha === booking.fecha, 'panel: fecha coincide con lo enviado');
    ok(r1.fechaISO && /^\d{4}-\d{2}-\d{2}$/.test(r1.fechaISO), `panel: fechaISO normalizada (${r1.fechaISO})`);
    ok(r1.notes === booking.notes, 'panel: nota conservada');
    ok(r1.estado === 'pendiente', 'panel: estado pendiente');
  }

  // J1 — Rechazo fuera de horario (06:00, antes de abrir a las 9)
  console.log('J1. Fuera de horario → rechazada, sin afirmar éxito');
  const fuera = await post('/api/reservations', { clientId: CLIENT, nombre: nom('Fuera Horario'),
    telefono: '202-555-0101', servicio: 'Masaje Relajante', fecha: 'mañana', hora: '6:00 AM' });
  ok(fuera.status === 200 && fuera.json?.ok === false, `06:00 → ok:false (motivo ${fuera.json?.motivo})`);
  const l2 = await list();
  const rf = mine(l2, 'Fuera Horario')[0];
  ok(rf && rf.estado === 'rechazada', 'se guarda como rechazada (no pendiente)');

  // DUP — Doble envío al MISMO hueco: la capacidad (1) impide una 2ª reserva viva
  console.log('DUP. Doble envío al mismo hueco → no duplica (capacidad)');
  const dupBody = { clientId: CLIENT, nombre: nom('Doble Envio'), telefono: '202-555-0102',
    servicio: 'Limpieza Facial', fecha: 'mañana', hora: '11:00 AM' };
  const d1 = await post('/api/reservations', dupBody);
  const d2 = await post('/api/reservations', dupBody);
  ok(d1.status === 201 && d1.json?.ok === true, 'primer envío → 201 creado');
  ok(d2.status === 200 && d2.json?.ok === false && d2.json?.motivo === 'sin_disponibilidad',
     `segundo envío idéntico → rechazado por capacidad (${d2.json?.motivo})`);
  const ldup = await list();
  const vivos = mine(ldup, 'Doble Envio').filter(x => x.estado === 'pendiente' || x.estado === 'confirmada');
  ok(vivos.length === 1, `solo 1 reserva VIVA para el hueco, sin duplicado (vivas: ${vivos.length})`);

  // I1 — Cancelación real
  console.log('I1. Cancelación');
  const cancelBody = { clientId: CLIENT, nombre: nom('Para Cancelar'), telefono: '202-555-0103',
    email: `qa-cancel-${RUNID}@example.com`, servicio: 'Masaje Relajante', fecha: 'mañana', hora: '1:00 PM' };
  await post('/api/reservations', cancelBody);
  const cancel = await post('/api/cancel-reservation', { clientId: CLIENT, contacto: cancelBody.email, fecha: 'mañana' });
  ok(cancel.status === 200 && cancel.json?.found === true, 'cancelación encontrada y aplicada');
  const l3 = await list();
  const rc = mine(l3, 'Para Cancelar')[0];
  ok(rc && rc.estado === 'cancelada', 'panel: queda cancelada');

  // I2 — Cancelar inexistente → found:false (no miente)
  console.log('I2. Cancelar inexistente');
  const noexiste = await post('/api/cancel-reservation', { clientId: CLIENT, contacto: `nadie-${RUNID}@example.com`, fecha: 'mañana' });
  ok(noexiste.status === 200 && noexiste.json?.found === false, 'inexistente → found:false');

  // I3 — Reprogramación = cancelar + reservar de nuevo (no hay reprogramación in situ)
  console.log('I3. Reprogramación (cancelar + nueva hora)');
  const rpEmail = `qa-rp-${RUNID}@example.com`;
  await post('/api/reservations', { clientId: CLIENT, nombre: nom('Reprograma'), telefono: '202-555-0106', email: rpEmail, servicio: 'Masaje Relajante', fecha: 'mañana', hora: '10:00 AM' });
  const rpCancel = await post('/api/cancel-reservation', { clientId: CLIENT, contacto: rpEmail, fecha: 'mañana' });
  ok(rpCancel.json?.found === true, 'reprogramación: se cancela la cita anterior');
  const rpNew = await post('/api/reservations', { clientId: CLIENT, nombre: nom('Reprograma'), telefono: '202-555-0106', email: rpEmail, servicio: 'Masaje Relajante', fecha: 'mañana', hora: '5:00 PM' });
  ok(rpNew.status === 201 && rpNew.json?.ok === true, 'reprogramación: se crea la nueva hora (5 PM)');

  // N1 — Acción de panel (confirmar) no afecta a otra reserva + PUT inválido
  console.log('N1. Confirmar en panel no toca otras reservas');
  const a = await post('/api/reservations', { clientId: CLIENT, nombre: nom('Panel A'), telefono: '202-555-0104', servicio: 'Masaje Relajante', fecha: 'mañana', hora: '6:00 PM' });
  const b = await post('/api/reservations', { clientId: CLIENT, nombre: nom('Panel B'), telefono: '202-555-0105', servicio: 'Masaje Relajante', fecha: 'mañana', hora: '7:00 PM' });
  const lab = await list();
  const ra = mine(lab, 'Panel A')[0], rb = mine(lab, 'Panel B')[0];
  ok(ra && rb, 'ambas reservas creadas');
  if (ra && rb) {
    const putA = await putEstado(ra._key, 'confirmada');
    ok(putA.status === 200, 'PUT estado=confirmada → 200');
    const lab2 = await list();
    const ra2 = lab2.find(x => x._key === ra._key), rb2 = lab2.find(x => x._key === rb._key);
    ok(ra2?.estado === 'confirmada', 'Panel A quedó confirmada');
    ok(rb2?.estado === 'pendiente', 'Panel B NO cambió (sigue pendiente)');
    // El panel solo permite estados válidos: 'reprogramada' se rechaza.
    const badPut = await putEstado(rb._key, 'reprogramada');
    ok(badPut.status === 400, 'PUT con estado no válido (reprogramada) → 400 (correcto)');
  }

  // SEG — el panel con token inválido no devuelve datos QA
  console.log('SEG. token inválido no filtra datos');
  const bad = await fetch(`${BASE}/api/reservations-list?clientId=${CLIENT}&token=malo-${RUNID}`);
  ok(bad.status === 401, 'token inválido → 401');

  console.log(fallos === 0 ? `\n✅ E2E vivo: ${pass} aserciones OK` : `\n❌ E2E vivo: ${fallos} fallo(s), ${pass} OK`);
  process.exit(fallos === 0 ? 0 : 1);
}
main().catch(e => { console.error('ERROR E2E:', e.message); process.exit(3); });
