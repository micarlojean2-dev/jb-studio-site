#!/usr/bin/env node
// Auditoría de solo lectura — servicios e imágenes (JB Studio).
// Uso:
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/audit-service-images.mjs
//
// Este script NUNCA escribe. Los únicos comandos Redis permitidos son
// GET/MGET/SCAN (ver READ_ONLY_COMMANDS abajo) — cualquier otro comando
// lanza un error antes de llegar a la red, así que ni un bug en este mismo
// archivo puede terminar modificando datos.
//
// Reporta:
//   1. Servicios sin id válido (formato svc_...).
//   2. Nombres de servicio duplicados dentro de un mismo cliente.
//   3. URLs de imagen manuales guardadas en services/menu (sistema viejo,
//      paralelo al de Cloudinary+linkedItemId).
//   4. Registros client-images cuyo linkedItemId no corresponde a ningún
//      servicio actual del cliente (huérfanos).
//   5. Conflictos: más de una imagen activa asociada al mismo servicio.
//   6. (contexto adicional) Clientes que solo tienen menu, sin services —
//      relevante para decidir el alcance de una eventual migración.

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!URL || !TOKEN) {
  console.error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN en el entorno.');
  process.exit(1);
}

const READ_ONLY_COMMANDS = new Set(['GET', 'MGET', 'SCAN']);
async function cmd(...cmdArgs) {
  const verb = String(cmdArgs[0] || '').toUpperCase();
  if (!READ_ONLY_COMMANDS.has(verb)) {
    throw new Error(`[audit] comando bloqueado — este script es de solo lectura: ${verb}`);
  }
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

async function getMany(keys) {
  if (!keys.length) return [];
  const raw = keys.length === 1 ? [await cmd('GET', keys[0])] : await cmd('MGET', ...keys);
  return raw.map((r) => {
    if (!r) return null;
    try { return typeof r === 'string' ? JSON.parse(r) : r; } catch (e) { return null; }
  });
}

const SERVICE_ID_RE = /^svc_[a-f0-9]{8,32}$/i;
const normName = (s) => String(s || '').trim().toLowerCase();

function printSection(title, list, formatter) {
  console.log(`\n--- ${title} (${list.length}) ---`);
  if (!list.length) { console.log('  (ninguno)'); return; }
  list.forEach((item) => console.log(formatter(item)));
}

async function main() {
  const clientKeys = (await scanAll('client:*')).filter((k) => /^client:[a-z0-9-]+$/.test(k));
  const clients = await getMany(clientKeys);

  const findings = {
    sinId: [],
    duplicados: [],
    urlsManuales: [],
    huerfanas: [],
    conflictos: [],
    legacy: [],
  };

  let totalServicios = 0;
  let totalImagenes = 0;

  for (let i = 0; i < clientKeys.length; i++) {
    const clientId = clientKeys[i].slice('client:'.length);
    const client = clients[i];
    if (!client || typeof client !== 'object') continue;
    const nombreNegocio = client.businessName || '(sin nombre)';

    const services = Array.isArray(client.services) ? client.services : [];
    const menu = Array.isArray(client.menu) ? client.menu : [];
    const items = services.length ? services : menu;
    totalServicios += items.length;

    if (!services.length && menu.length) {
      findings.legacy.push({ clientId, nombreNegocio, items: menu.length });
    }

    items.forEach((item, idx) => {
      if (!item || !item.nombre) return;
      if (!SERVICE_ID_RE.test(String(item.id || ''))) {
        findings.sinId.push({ clientId, nombreNegocio, index: idx, nombre: item.nombre, id: item.id ?? null });
      }
      if (item.imagen && String(item.imagen).trim()) {
        findings.urlsManuales.push({
          clientId, nombreNegocio, servicio: item.nombre,
          imagen: item.imagen, fuente: services.length ? 'services' : 'menu',
        });
      }
    });

    const vistos = new Map();
    items.forEach((item) => {
      if (!item || !item.nombre) return;
      const key = normName(item.nombre);
      vistos.set(key, (vistos.get(key) || 0) + 1);
    });
    for (const [nombreNorm, count] of vistos) {
      if (count > 1) findings.duplicados.push({ clientId, nombreNegocio, nombre: nombreNorm, veces: count });
    }

    const imageKeys = await scanAll(`client-images:${clientId}:*`);
    if (!imageKeys.length) continue;
    const records = (await getMany(imageKeys)).filter(Boolean);
    totalImagenes += records.length;

    const conteoPorServicio = new Map();
    records.forEach((record) => {
      if (record.linkedType === 'gallery') return; // la galería general no tiene límite de 1
      if ((record.linkedType === 'menu' || record.linkedType === 'service') && record.linkedItemId) {
        const target = items.find((it) => it && (String(it.id) === record.linkedItemId || it.nombre === record.linkedItemId));
        if (!target) {
          findings.huerfanas.push({ clientId, nombreNegocio, publicId: record.publicId, linkedItemId: record.linkedItemId });
        } else {
          const k = String(target.id || target.nombre);
          conteoPorServicio.set(k, (conteoPorServicio.get(k) || 0) + 1);
        }
      }
    });
    for (const [itemKey, count] of conteoPorServicio) {
      if (count > 1) {
        const target = items.find((it) => String(it.id || it.nombre) === itemKey);
        findings.conflictos.push({ clientId, nombreNegocio, servicio: target?.nombre || itemKey, imagenes: count });
      }
    }
  }

  console.log('='.repeat(70));
  console.log('AUDITORÍA DE SERVICIOS E IMÁGENES — SOLO LECTURA');
  console.log('='.repeat(70));
  console.log(`Clientes escaneados: ${clientKeys.length}`);
  console.log(`Servicios escaneados: ${totalServicios}`);
  console.log(`Registros de imagen escaneados: ${totalImagenes}`);

  printSection('1. Servicios sin id válido', findings.sinId,
    (f) => `  - ${f.clientId} (${f.nombreNegocio}) → servicio #${f.index} "${f.nombre}" — id actual: ${JSON.stringify(f.id)}`);

  printSection('2. Nombres de servicio duplicados', findings.duplicados,
    (f) => `  - ${f.clientId} (${f.nombreNegocio}) → "${f.nombre}" aparece ${f.veces} veces`);

  printSection('3. URLs de imagen manuales (sistema viejo, en services/menu)', findings.urlsManuales,
    (f) => `  - ${f.clientId} (${f.nombreNegocio}) → "${f.servicio}" tiene imagen="${f.imagen}" guardada en client.${f.fuente}`);

  printSection('4. Imágenes huérfanas (linkedItemId sin servicio actual)', findings.huerfanas,
    (f) => `  - ${f.clientId} (${f.nombreNegocio}) → publicId ${f.publicId}, linkedItemId="${f.linkedItemId}" no coincide con ningún servicio`);

  printSection('5. Conflictos: más de 1 imagen activa por servicio', findings.conflictos,
    (f) => `  - ${f.clientId} (${f.nombreNegocio}) → "${f.servicio}" tiene ${f.imagenes} imágenes asociadas`);

  printSection('6. Clientes legacy (solo menu, sin services) — contexto para migración', findings.legacy,
    (f) => `  - ${f.clientId} (${f.nombreNegocio}) → ${f.items} item(s) en menu, services vacío`);

  console.log('\n' + '='.repeat(70));
  console.log('No se modificó ningún dato — este script solo usa GET/MGET/SCAN.');
}

main().catch((err) => {
  console.error('Error en la auditoría:', err);
  process.exit(1);
});
