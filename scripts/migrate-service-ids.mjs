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
//   legacy), se promueve SIEMPRE por completo a la arquitectura
//   services-first: client.services = menu con ids, client.menu = espejo
//   derivado de esos mismos ids — igual que produciría un PUT normal con
//   `menu` como entrada (ver api/clients.js). Esto se escribe aunque el
//   menu ya tuviera ids válidos: falta crear client.services, y eso por sí
//   solo ya es un cambio a persistir.
// - Un id ya válido y único (formato svc_..., no repetido dentro del
//   mismo array) nunca se regenera, se conserva tal cual. Si dos servicios
//   del mismo cliente comparten el mismo id (dato corrupto ya persistido),
//   el primero lo conserva y el resto se regenera.
// - Un cliente NO legacy (ya tiene client.services) donde todos los ids ya
//   son válidos y únicos se salta sin escribir nada.
// - Por qué las asociaciones de imagen sobreviven sin tocarlas: hoy, un
//   servicio sin id tiene su imagen asociada por NOMBRE (linkedItemId =
//   nombre). api/client-config.js ya resuelve primero por id y cae a
//   nombre si no hay match. Esta migración nunca cambia nombres — solo
//   agrega id — así que ese fallback sigue encontrando la imagen igual
//   que antes, sin que haga falta tocar client-images:* para nada.

import { assignUniqueServiceIds } from '../lib/services.js';

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const apply = process.argv.slice(2).includes('--yes');

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

function deriveMenuFromServices(services) {
  return services.map((s) => ({
    id: s.id, nombre: s.nombre, precio: s.precio, descripcion: s.descripcion,
    imagen: s.imagen, duracion: s.duracion,
  }));
}

// Lógica pura, sin red: dado un client tal cual viene de Redis, decide si
// hace falta escribir algo y devuelve el client ya migrado. Legacy
// (services vacío, menu con datos) y no-legacy terminan en el mismo sitio:
// services + menu poblados, mismos ids en ambos — igual que produce un PUT
// normal en api/clients.js. Exportada para poder testearla sin mockear HTTP.
//
// El dedup de ids (faltantes o duplicados) lo hace assignUniqueServiceIds
// de lib/services.js — misma función que usa sanitizeServiceList(), para
// no mantener esa lógica por duplicado aquí.
export function migrateClient(client) {
  const services = Array.isArray(client.services) ? client.services : [];
  const menu = Array.isArray(client.menu) ? client.menu : [];
  const usingServices = services.length > 0;
  const wasLegacy = !usingServices;
  const items = usingServices ? services : menu;

  const itemsConId = assignUniqueServiceIds(items);
  const cambiados = itemsConId.filter((it, i) => it.id !== items[i].id);

  // "changed" es true si al menos un id se asignó/regeneró, O si el
  // cliente es legacy: promover menu -> services es en sí mismo un cambio
  // que hay que persistir, aunque los ids ya fueran válidos y únicos.
  const changed = wasLegacy || cambiados.length > 0;
  if (!changed) {
    return { changed: false, wasLegacy, faltantesCount: 0, updatedClient: client, items, itemsConId: items };
  }

  const updatedClient = { ...client, services: itemsConId, menu: deriveMenuFromServices(itemsConId) };

  return { changed: true, wasLegacy, faltantesCount: cambiados.length, updatedClient, items, itemsConId };
}

async function main() {
  if (!URL || !TOKEN) {
    console.error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN en el entorno.');
    process.exit(1);
  }

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

    const { changed, wasLegacy, faltantesCount, updatedClient, items, itemsConId } = migrateClient(client);
    if (!changed) { clientesSinCambios++; continue; }

    console.log(`- ${clientId} (${client.businessName || 's/nombre'}) [fuente: ${wasLegacy ? 'menu legacy' : 'services'}]`);
    console.log(`    antes:   ${JSON.stringify(items.map((it) => ({ nombre: it?.nombre, id: it?.id ?? null })))}`);
    console.log(`    después: ${JSON.stringify(itemsConId.map((it) => ({ nombre: it?.nombre, id: it?.id })))}`);
    if (wasLegacy) console.log('    (cliente legacy promovido a services + menu derivado)');

    serviciosMigrados += faltantesCount;
    clientesConCambios++;
    if (wasLegacy) clientesLegacyTocados++;

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

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error('Error en la migración:', err);
    process.exit(1);
  });
}
