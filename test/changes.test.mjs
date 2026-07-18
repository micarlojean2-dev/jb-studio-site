// Pruebas de registrarCambio(): atómico, con reintento, sin fallo silencioso.
// Redis simulado (MULTI/EXEC) — no toca la red. Ejecutar: node test/changes.test.mjs
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'https://fake.local';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'fake-token';

const { registrarCambio } = await import('../lib/changes.js');

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); fallos++; } };

// Doble de Redis con multi()/exec() encadenable. `failFirst` hace que las N
// primeras llamadas a exec() lancen, para probar el reintento.
function fakeRedis(opts = {}) {
  const store = { lists: {}, pending: new Set(), execCalls: 0 };
  function multi() {
    const ops = [];
    const chain = {
      rpush(k, v) { ops.push(['rpush', k, v]); return chain; },
      ltrim(k) { ops.push(['ltrim', k]); return chain; },
      sadd(k, m) { ops.push(['sadd', k, m]); return chain; },
      async exec() {
        store.execCalls++;
        if (opts.failFirst && store.execCalls <= opts.failFirst) throw new Error(opts.errMsg || 'redis down');
        if (opts.errorEntry && store.execCalls <= (opts.errorEntryTimes || Infinity)) {
          return [{ error: 'WRONGTYPE' }, 'OK', 1];   // resultado con error, no lanza
        }
        for (const [op, k, v] of ops) {
          if (op === 'rpush') (store.lists[k] = store.lists[k] || []).push(v);
          if (op === 'sadd' && k === 'digest:pending') store.pending.add(v);
        }
        return ops.map(() => 1);
      },
    };
    return chain;
  }
  return { _store: store, multi };
}

console.log('1. Éxito: encola atómicamente y confirma');
{
  const redis = fakeRedis();
  const r = await registrarCambio('bella', { type: 'created', nombre: 'Mike' }, { redis });
  ok(r.ok === true, 'devuelve { ok: true }');
  ok(redis._store.lists['changes:bella'] && redis._store.lists['changes:bella'].length === 1, 'el evento entró en changes:bella');
  ok(redis._store.pending.has('bella'), 'bella entró en digest:pending');
  ok(redis._store.execCalls === 1, 'un solo EXEC (una ida a Redis)');
}

console.log('2. Fallo transitorio: reintenta y termina bien');
{
  const redis = fakeRedis({ failFirst: 1 });   // el 1er exec lanza, el 2º pasa
  const r = await registrarCambio('bella', { type: 'created', nombre: 'Mike' }, { redis });
  ok(r.ok === true, 'tras reintentar, devuelve { ok: true }');
  ok(redis._store.execCalls === 2, 'hizo exactamente un reintento');
  ok(redis._store.pending.has('bella'), 'bella quedó en digest:pending');
}

console.log('3. Fallo persistente: NO oculta, NO confirma en falso, NO lanza');
{
  const redis = fakeRedis({ failFirst: 99 });   // siempre lanza
  let threw = false, r;
  try { r = await registrarCambio('bella', { type: 'created', nombre: 'Mike' }, { redis }); }
  catch (e) { threw = true; }
  ok(threw === false, 'no lanza (la reserva puede seguir guardándose)');
  ok(r && r.ok === false, 'devuelve { ok: false } — sin confirmación falsa');
  ok(r && typeof r.error === 'string', 'incluye el mensaje de error');
  ok(!redis._store.pending.has('bella'), 'bella NO quedó en digest:pending');
  ok(redis._store.execCalls === 2, 'reintentó (2 intentos) antes de rendirse');
}

console.log('4. exec devuelve un error en el array: se trata como fallo, no como éxito');
{
  const redis = fakeRedis({ errorEntry: true });
  const r = await registrarCambio('bella', { type: 'created', nombre: 'Mike' }, { redis });
  ok(r.ok === false, 'un error dentro del resultado de EXEC no cuenta como éxito');
}

console.log('');
if (fallos) { console.error(`❌ ${fallos} aserción(es) fallaron`); process.exit(1); }
console.log('✅ registrarCambio verificado: atómico, con reintento, sin fallo silencioso');
