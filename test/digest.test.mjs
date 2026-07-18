// Pruebas del resumen diario (runDigest) y su plantilla.
// No toca Redis ni Resend reales: usa dobles en memoria. No crea reservas
// ni envía correos. Ejecutar: node test/digest.test.mjs
//
// El constructor de @upstash/redis exige url/token, así que se ponen valores
// ficticios ANTES de importar el módulo. Nunca se llama a la red porque
// runDigest recibe un Redis falso inyectado.
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'fake-token';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_fake';

const { __test } = await import('../api/reservations.js');
const { runDigest, digestHtml, digestBloque } = __test;

let fallos = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ✓', msg); }
  else { console.error('  ✗', msg); fallos++; }
}

// ── Dobles en memoria ────────────────────────────────────────────────────────
function fakeRedis(seed = {}) {
  const store = new Map();               // key -> value (array para listas)
  const pending = new Set(seed.pending || []);
  for (const [k, v] of Object.entries(seed.keys || {})) store.set(k, v);
  return {
    _store: store, _pending: pending,
    async smembers(k) { return k === 'digest:pending' ? [...pending] : []; },
    async lrange(k) { return (store.get(k) || []).slice(); },
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async del(k) { store.delete(k); },
    async srem(k, m) { if (k === 'digest:pending') pending.delete(m); },
    async set(k, v) { store.set(k, v); },
  };
}
function fakeResend(behavior = () => ({})) {
  const calls = [];
  return {
    calls,
    emails: { async send(args) { calls.push(args); return behavior(args); } },
  };
}
const ev = (o) => JSON.stringify(Object.assign({ ts: Date.now() }, o));
const clienteBase = (extra = {}) => Object.assign({
  businessName: 'Bella Luna Spa', color: '#7a4', panelToken: 'tok123',
  ownerEmail: 'due@na.com',
}, extra);

// ── 1. Nueva cita → un correo, cola limpiada ─────────────────────────────────
{
  console.log('1. Nueva cita');
  const redis = fakeRedis({
    pending: ['bella'],
    keys: {
      'client:bella': clienteBase(),
      'changes:bella': [ev({ type: 'created', nombre: 'Mike', servicio: 'Corte', fecha: '2026-07-20', hora: '16:00', telefono: '555' })],
    },
  });
  const resend = fakeResend();
  const r = await runDigest(false, { redis, resend });
  ok(r.enviados === 1 && r.fallidos === 0, 'envía 1 correo');
  ok(resend.calls.length === 1, 'una sola llamada a Resend');
  ok(!redis._store.has('changes:bella'), 'borra changes tras éxito');
  ok(!redis._pending.has('bella'), 'quita el negocio de digest:pending');
  ok(redis._store.has('digest:sentAt:bella'), 'marca sentAt');
}

// ── 2. Dos citas en 2h → un solo correo con las dos ──────────────────────────
{
  console.log('2. Dos citas → un correo');
  const redis = fakeRedis({
    pending: ['bella'],
    keys: {
      'client:bella': clienteBase(),
      'changes:bella': [
        ev({ type: 'created', nombre: 'Ana', servicio: 'Uñas', fecha: '2026-07-20', hora: '10:00' }),
        ev({ type: 'created', nombre: 'Luis', servicio: 'Corte', fecha: '2026-07-20', hora: '11:30' }),
      ],
    },
  });
  const resend = fakeResend();
  const r = await runDigest(false, { redis, resend });
  ok(r.enviados === 1 && resend.calls.length === 1, 'un solo correo para dos citas');
  ok(/2 cambios/.test(resend.calls[0].subject), 'el asunto dice "2 cambios"');
}

// ── 3. Reprogramación + cancelación en el mismo resumen ──────────────────────
{
  console.log('3. Reprogramación + cancelación juntas');
  const redis = fakeRedis({
    pending: ['bella'],
    keys: {
      'client:bella': clienteBase(),
      'changes:bella': [
        ev({ type: 'created', nombre: 'Ana', servicio: 'Uñas', fecha: '2026-07-20', hora: '10:00' }),
        ev({ type: 'rescheduled', nombre: 'Luis', servicio: 'Corte', prevFecha: '2026-07-20', prevHora: '11:00', fecha: '2026-07-21', hora: '09:00' }),
        ev({ type: 'cancelled', nombre: 'Sara', servicio: 'Masaje', fecha: '2026-07-22', hora: '15:00' }),
      ],
    },
  });
  const resend = fakeResend();
  const r = await runDigest(false, { redis, resend });
  const html = resend.calls[0].html;
  ok(r.enviados === 1, 'un solo correo');
  ok(html.includes('NUEVA') && html.includes('REPROGRAMADA') && html.includes('CANCELADA'), 'incluye los tres tipos');
  ok(html.includes('Antes:') && html.includes('Ahora:'), 'la reprogramación muestra antes/ahora');
}

// ── 4. Cero cambios → cero correos ───────────────────────────────────────────
{
  console.log('4. Cero cambios');
  const redis = fakeRedis({ pending: [] });
  const resend = fakeResend();
  const r = await runDigest(false, { redis, resend });
  ok(r.negocios === 0 && r.enviados === 0, 'no procesa negocios');
  ok(resend.calls.length === 0, 'no llama a Resend');
}

// ── 5. Fallo de Resend → los eventos permanecen ──────────────────────────────
{
  console.log('5. Fallo de Resend');
  const redis = fakeRedis({
    pending: ['bella'],
    keys: {
      'client:bella': clienteBase(),
      'changes:bella': [ev({ type: 'created', nombre: 'Mike', fecha: '2026-07-20', hora: '16:00' })],
    },
  });
  const resend = fakeResend(() => ({ error: { message: 'boom' } }));
  const r = await runDigest(false, { redis, resend });
  ok(r.fallidos === 1 && r.enviados === 0, 'cuenta el fallo');
  ok(redis._store.has('changes:bella'), 'NO borra changes tras fallo');
  ok(redis._pending.has('bella'), 'mantiene el negocio en la cola para reintentar');
  ok(!redis._store.has('digest:sentAt:bella'), 'no marca sentAt');
}

// ── 6. Varios correos (notificationEmails) → un solo resumen a todos ──────────
{
  console.log('6. Varios destinatarios → un resumen');
  const redis = fakeRedis({
    pending: ['bella'],
    keys: {
      'client:bella': clienteBase({ notificationEmails: ['a@x.com', 'b@x.com', 'a@x.com', 'C@x.com'] }),
      'changes:bella': [ev({ type: 'created', nombre: 'Mike', fecha: '2026-07-20', hora: '16:00' })],
    },
  });
  const resend = fakeResend();
  const r = await runDigest(false, { redis, resend });
  ok(r.enviados === 1 && resend.calls.length === 1, 'un solo correo');
  ok(Array.isArray(resend.calls[0].to) && resend.calls[0].to.length === 3, 'un "to" con los 3 correos (deduplicados)');
  ok(resend.calls[0].to.includes('c@x.com'), 'normaliza a minúsculas');
}

// ── 7. Modo dry → no envía, no borra ─────────────────────────────────────────
{
  console.log('7. Modo dry');
  const redis = fakeRedis({
    pending: ['bella'],
    keys: {
      'client:bella': clienteBase(),
      'changes:bella': [ev({ type: 'created', nombre: 'Mike', fecha: '2026-07-20', hora: '16:00' })],
    },
  });
  const resend = fakeResend();
  const r = await runDigest(true, { redis, resend });
  ok(r.dry === true && resend.calls.length === 0, 'no envía nada en dry');
  ok(redis._store.has('changes:bella') && redis._pending.has('bella'), 'no borra nada en dry');
  ok(r.detalle && r.detalle[0].cambios === 1 && r.detalle[0].recipients === 1, 'reporta detalle');
}

// ── 8. Sin destinatario → se limpia sin enviar ───────────────────────────────
{
  console.log('8. Cliente sin correo');
  const redis = fakeRedis({
    pending: ['bella'],
    keys: {
      'client:bella': { businessName: 'X' },   // sin ownerEmail ni notificationEmails
      'changes:bella': [ev({ type: 'created', nombre: 'Mike' })],
    },
  });
  const resend = fakeResend();
  const r = await runDigest(false, { redis, resend });
  ok(r.enviados === 0 && r.sinDestinatario === 1, 'no envía si no hay a quién');
  ok(!redis._store.has('changes:bella'), 'limpia para no reintentar en vano');
}

// ── 8b. emailNotifications apagado → no envía, limpia la cola ─────────────────
{
  console.log('8b. Aviso por correo apagado');
  const redis = fakeRedis({
    pending: ['bella'],
    keys: {
      'client:bella': clienteBase({ features: { emailNotifications: false } }),
      'changes:bella': [ev({ type: 'created', nombre: 'Mike' })],
    },
  });
  const resend = fakeResend();
  const r = await runDigest(false, { redis, resend });
  ok(r.enviados === 0 && resend.calls.length === 0, 'no envía si el dueño apagó el aviso');
  ok(!redis._store.has('changes:bella') && !redis._pending.has('bella'), 'limpia la cola igualmente');
}

// ── 8c. dry NO borra la cola aunque no haya destinatario (solo lectura) ──────
{
  console.log('8c. dry no destruye la cola sin destinatario');
  const redis = fakeRedis({
    pending: ['bella'],
    keys: {
      'client:bella': { businessName: 'X' },   // sin correo
      'changes:bella': [ev({ type: 'created', nombre: 'Mike' })],
    },
  });
  const resend = fakeResend();
  const r = await runDigest(true, { redis, resend });   // dry
  ok(redis._store.has('changes:bella') && redis._pending.has('bella'), 'en dry NO borra changes ni digest:pending');
  ok(r.detalle && r.detalle.some((d) => d.cid === 'bella' && d.recipients === 0), 'reporta el negocio con recipients: 0');
  ok(resend.calls.length === 0, 'no envía nada');
}

// ── 9. Plantilla: escapa HTML y pone el enlace al panel ──────────────────────
{
  console.log('9. Plantilla y escape');
  const html = digestHtml('Spa <b>', '#123', [{ type: 'created', nombre: 'A&B', fecha: '2026-07-20', hora: '10:00' }], 'https://jbstudio.app/reservas/bella#t=tok');
  ok(html.includes('Spa &lt;b&gt;'), 'escapa el nombre del negocio');
  ok(html.includes('A&amp;B'), 'escapa el nombre del cliente');
  ok(html.includes('href="https://jbstudio.app/reservas/bella#t=tok"'), 'incluye el enlace a la hoja');
  const bloque = digestBloque({ type: 'cancelled', nombre: 'Z', fecha: '2026-07-20', hora: '10:00' });
  ok(bloque.includes('CANCELADA'), 'etiqueta correcta por tipo');
}

// ── 10. Notas en el correo: se muestran solo si existen ──────────────────────
{
  console.log('10. Notas en el digest');
  const con = digestBloque({ type: 'created', nombre: 'Ana', servicio: 'Masaje', fecha: '2026-07-20', hora: '10:00', notes: 'alérgica a los aceites' });
  ok(con.includes('📝') && con.includes('alérgica a los aceites'), 'muestra las notas cuando existen');
  const sin = digestBloque({ type: 'created', nombre: 'Ana', servicio: 'Masaje', fecha: '2026-07-20', hora: '10:00' });
  ok(!sin.includes('📝') && !sin.includes('Notas'), 'oculta por completo la sección si no hay notas');
  const vacio = digestBloque({ type: 'created', nombre: 'Ana', fecha: '2026-07-20', hora: '10:00', notes: '   ' });
  ok(!vacio.includes('📝'), 'notas solo con espacios se tratan como vacías');
}

console.log('');
if (fallos) { console.error(`❌ ${fallos} aserción(es) fallaron`); process.exit(1); }
console.log('✅ Todas las pruebas del resumen pasaron');
