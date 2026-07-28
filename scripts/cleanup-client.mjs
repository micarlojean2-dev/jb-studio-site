#!/usr/bin/env node
// Herramienta de borrado completo por cliente (JB Studio) — Fases 5/6/7.
// Uso:
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node cleanup-client.mjs <clientId> [--dry-run]
//
// Sin --dry-run, además requiere --yes para ejecutar cambios reales.
// Orden de operación (ver plan aprobado): pausar -> barrer reservas/imágenes/uso/changes/digest -> DEL client:{id} al final.

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const args = process.argv.slice(2);
const clientId = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const confirmed = args.includes('--yes');

if (!URL || !TOKEN) { console.error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.'); process.exit(1); }
if (!clientId || !/^[a-z0-9-]+$/.test(clientId)) { console.error('Uso: node cleanup-client.mjs <clientId> [--dry-run] [--yes]'); process.exit(1); }
if (!dryRun && !confirmed) { console.error('Falta --yes para ejecutar cambios reales (usa --dry-run para solo previsualizar).'); process.exit(1); }

async function cmd(...cmdArgs) {
  const path = cmdArgs.map(encodeURIComponent).join('/');
  const res = await fetch(`${URL}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const json = await res.json();
  if (json.error) throw new Error(`${cmdArgs.join(' ')} -> ${json.error}`);
  return json.result;
}

async function scanAll(pattern) {
  let cursor = '0';
  const found = [];
  do {
    const [next, batch] = await cmd('SCAN', cursor, 'MATCH', pattern, 'COUNT', '500');
    cursor = next;
    found.push(...batch);
  } while (cursor !== '0');
  return found;
}

async function delKeys(keys) {
  if (!keys.length) return 0;
  if (dryRun) return keys.length;
  // Upstash REST no soporta DEL de múltiples args vía path fácilmente con nombres raros; borramos uno a uno.
  for (const k of keys) await cmd('DEL', k);
  return keys.length;
}

async function main() {
  const raw = await cmd('GET', `client:${clientId}`);
  if (!raw) { console.error(`client:${clientId} no existe. Nada que hacer.`); process.exit(1); }
  const client = JSON.parse(raw);

  const [reservKeys, imgKeys, usageKeys] = await Promise.all([
    scanAll(`reservations:${clientId}:*`),
    scanAll(`client-images:${clientId}:*`),
    scanAll(`usage:${clientId}:*`),
  ]);
  const changesLen = Number(await cmd('LLEN', `changes:${clientId}`).catch(() => 0)) || 0;
  const inDigestPending = !!Number(await cmd('SISMEMBER', 'digest:pending', clientId).catch(() => 0));
  const hasDigestSentAt = !!Number(await cmd('EXISTS', `digest:sentAt:${clientId}`).catch(() => 0));

  console.log(`=== ${dryRun ? 'DRY-RUN' : 'EJECUCIÓN REAL'} para ${clientId} (${client.businessName || '(sin nombre)'}) ===`);
  console.log(JSON.stringify({
    reservationsToDelete: reservKeys.length,
    imagesToDelete: imgKeys.length,
    usageKeysToDelete: usageKeys.length,
    changesQueueLen: changesLen,
    inDigestPending,
    hasDigestSentAt,
  }, null, 2));

  if (imgKeys.length) {
    console.log(`AVISO: ${imgKeys.length} imagen(es) en Redis. Este script NO destruye los assets de Cloudinary (requiere CLOUDINARY_* creds, fuera de alcance de esta herramienta) — quedarán huérfanos en Cloudinary si no se limpian manualmente.`);
  }

  if (dryRun) {
    console.log('\nDRY-RUN: no se realizó ningún cambio.');
    return;
  }

  // 1. Pausar
  client.active = false;
  await cmd('SET', `client:${clientId}`, JSON.stringify(client));
  console.log('✓ Cliente pausado (active:false)');

  // 2. Barrer reservas
  const deletedReservations = await delKeys(reservKeys);
  console.log(`✓ Reservas borradas: ${deletedReservations}`);

  // 3. Barrer imágenes (solo Redis, ver aviso de Cloudinary arriba)
  const deletedImages = await delKeys(imgKeys);
  console.log(`✓ Claves de imágenes borradas: ${deletedImages}`);

  // 4. Barrer usage
  const deletedUsage = await delKeys(usageKeys);
  console.log(`✓ Claves de uso borradas: ${deletedUsage}`);

  // 5. changes + digest:pending (solo membresía) + digest:sentAt
  await cmd('DEL', `changes:${clientId}`);
  await cmd('SREM', 'digest:pending', clientId);
  await cmd('DEL', `digest:sentAt:${clientId}`);
  console.log('✓ changes / digest:pending (membresía) / digest:sentAt limpiados');

  // 6. DEL client:{id} AL FINAL
  await cmd('DEL', `client:${clientId}`);
  console.log(`✓ client:${clientId} eliminado`);

  // 7. Verificación: re-scan, confirmar cero
  const [verifyReserv, verifyImg, verifyUsage] = await Promise.all([
    scanAll(`reservations:${clientId}:*`),
    scanAll(`client-images:${clientId}:*`),
    scanAll(`usage:${clientId}:*`),
  ]);
  const verifyChanges = Number(await cmd('EXISTS', `changes:${clientId}`).catch(() => 0));
  const verifyDigestPending = Number(await cmd('SISMEMBER', 'digest:pending', clientId).catch(() => 0));
  const verifyDigestSentAt = Number(await cmd('EXISTS', `digest:sentAt:${clientId}`).catch(() => 0));
  const verifyClient = await cmd('EXISTS', `client:${clientId}`);

  const orphans = {
    reservations: verifyReserv.length,
    images: verifyImg.length,
    usage: verifyUsage.length,
    changes: verifyChanges,
    inDigestPending: verifyDigestPending,
    digestSentAt: verifyDigestSentAt,
    clientRecord: Number(verifyClient),
  };
  const totalOrphans = Object.values(orphans).reduce((a, b) => a + b, 0);
  console.log('\n=== VERIFICACIÓN FINAL ===');
  console.log(JSON.stringify(orphans, null, 2));
  console.log(totalOrphans === 0 ? '✓ CERO HUÉRFANOS' : `⚠ QUEDAN ${totalOrphans} CLAVE(S) SIN BORRAR`);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
