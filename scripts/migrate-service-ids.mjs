#!/usr/bin/env node
// Migración de IDs estables para servicios — JB Studio.
// Uso:
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/migrate-service-ids.mjs [--yes]
//
// Por defecto corre en dry-run (no escribe nada, solo imprime qué haría).
// Para escribir de verdad hace falta pasar --yes explícitamente.
//
// Reglas (auditoría previa: scripts/audit-service-images.mjs):
// - Solo agrega el campo `id` donde falta o es inválido. Nunca toca
//   nombre/precio/duracion/descripcion/imagen, ni client-images:* (las
//   asociaciones Cloudinary no se tocan en absoluto).
// - Si client.services tiene datos, es la fuente: se regenera client.menu
//   como espejo exacto de client.services (mismo id/nombre/precio/
//   descripcion/imagen/duracion) — igual que hace api/clients.js en cada
//   POST/PUT normal.
// - Si client.services está vacío y client.menu tiene datos (cliente
//   legacy), solo se asigna id a los items de menu — NO se crea
//   client.services; convertir un legacy a la arquitectura services-first
//   es una decisión aparte, fuera de esta migración.
// - Un id ya válido (formato svc_...) nunca se regenera, se conserva tal
//   cual. Un cliente donde todos sus servicios ya tienen id se salta sin
//   escribir nada.
// - Por qué las asociaciones de imagen sobreviven sin tocarlas: hoy, un
//   servicio sin id tiene su imagen asociada por NOMBRE (linkedItemId =
//   nombre). api/client-config.js ya resuelve primero por id y cae a
//   nombre si no hay match. Esta migración nunca cambia nombres — solo
//   agrega id — así que ese fallback sigue encontrando la imagen igual
//   que antes, sin que haga falta tocar client-images:* para nada.

import { randomUUID } from 'node:crypto';

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const apply = process.argv.slice(2).includes('--yes');

if (!URL || !TOKEN) {
  console.error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN en el entorno.');
  process.exit(1);
}

const ALLOWED_COMMANDS = new Set(['GET', 'MGET', 'SCAN', 'SET']);
async function cmd(...cmdArgs) {
  const verb = String(cmdArgs[0] || '').toUpperCase();
  if (!ALLOWED_COMMANDS.has(verb)) {
    throw new Error(`[migrate] comando no permitido: ${verb}`);
  }
  if (verb === 'SET' && !apply) {
    // No debería poder pasar nunca (el código solo llama a SET dentro de
    // "if (apply)"), pero es una segunda barrera explícita por si algo
    // cambia más adelante y se rompe esa condición.
    throw new Error('[migrate] intento de SET sin --yes — abortando');
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

// Duplicado a propósito de sanitizeServiceId()/SERVICE_ID_RE en
// api/clients.js: ese archivo instancia Redis y Sentry al cargarse (efectos
// secundarios que no queremos arrastrar a un script de migración). Mismo
// patrón ya usado en el proyecto para duracionMin()/spaDurationMinutes().
const SERVICE_ID_RE = /^svc_[a-f0-9]{8,32}$/i;
function hasValidId(item) {
  return typeof item?.id === 'string' && SERVICE_ID_RE.test(item.id);
}
function newServiceId() {
  return `svc_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function deriveMenuFromServices(services) {
  return services.map((s) => ({
    id: s.id, nombre: s.nombre, precio: s.precio, descripcion: s.descripcion,
    imagen: s.imagen, duracion: s.duracion,
  }));
}

async function main() {
  const clientKeys = (await scanAll('client:*')).filter((k) => /^client:[a-z0-9-]+$/.test(k));
  console.log(`${apply ? 'EJECUCIÓN REAL' : 'DRY-RUN'} — ${clientKeys.length} cliente(s) encontrados.\n`);

  let clientesSinCambios = 0;
  let clientesConCambios = 0;
  let clientesLegacyTocados = 0;
  let serviciosMigrados = 0;

  for (const key of clientKeys) {
    const clientId = key.slice('client:'.length);
    const raw = await cmd('GET', key);
    if (!raw) continue;
    const client = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const services = Array.isArray(client.services) ? client.services : [];
    const menu = Array.isArray(client.menu) ? client.menu : [];
    const usingServices = services.length > 0;
    const items = usingServices ? services : menu;

    const faltantes = items.filter((it) => it && it.nombre && !hasValidId(it));
    if (!faltantes.length) { clientesSinCambios++; continue; }

    // Solo a los que no tienen id válido se les asigna uno nuevo; el resto
    // de campos viaja intacto (spread), incluido `imagen`.
    const itemsConId = items.map((it) => (
      it && it.nombre && !hasValidId(it) ? { ...it, id: newServiceId() } : it
    ));

    console.log(`- ${clientId} (${client.businessName || 's/nombre'}) [fuente: ${usingServices ? 'services' : 'menu legacy'}]`);
    console.log(`    antes:   ${JSON.stringify(items.map((it) => ({ nombre: it?.nombre, id: it?.id ?? null })))}`);
    console.log(`    después: ${JSON.stringify(itemsConId.map((it) => ({ nombre: it?.nombre, id: it?.id })))}`);

    const updatedClient = { ...client };
    if (usingServices) {
      updatedClient.services = itemsConId;
      updatedClient.menu = deriveMenuFromServices(itemsConId);
    } else {
      updatedClient.menu = itemsConId;
      clientesLegacyTocados++;
    }

    serviciosMigrados += faltantes.length;
    clientesConCambios++;

    if (apply) {
      await cmd('SET', key, JSON.stringify(updatedClient));
      console.log('    ✓ escrito');
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Clientes escaneados: ${clientKeys.length}`);
  console.log(`Clientes sin cambios (ya tenían todos sus ids): ${clientesSinCambios}`);
  console.log(`Clientes con servicios migrados: ${clientesConCambios} (de ellos, legacy solo-menu: ${clientesLegacyTocados})`);
  console.log(`Servicios que recibieron un id nuevo: ${serviciosMigrados}`);
  console.log(apply ? '\nEscritura real completada.' : '\nDRY-RUN: no se escribió nada. Ejecuta con --yes para aplicar.');
}

main().catch((err) => {
  console.error('Error en la migración:', err);
  process.exit(1);
});
