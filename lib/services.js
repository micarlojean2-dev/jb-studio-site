/* JB Studio — saneado y generación de id de un servicio.
 *
 * Única fuente de verdad para el id estable de un servicio. Antes existía
 * una copia en api/clients.js y otra, SIN generación de id en absoluto, en
 * api/generate-client-config.js — el mismo patrón de divergencia que ya
 * causó el bug de client.services/client.menu desincronizados.
 *
 * Vive en lib/ y no en api/: el proyecto está en el límite de 12 funciones
 * del plan Hobby y un archivo en api/ contaría como una más.
 */
import { randomUUID } from 'node:crypto';

export const SERVICE_ID_RE = /^svc_[a-f0-9]{8,32}$/i;

export function isValidServiceId(raw) {
  return typeof raw === 'string' && SERVICE_ID_RE.test(raw);
}

export function createServiceId() {
  return `svc_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

// Preserva un id existente si ya es válido (editar un servicio no debe
// asignarle uno nuevo cada vez — eso rompería cualquier imagen ya asociada
// a él); si no hay uno válido, genera uno nuevo, una sola vez.
export function sanitizeServiceId(raw) {
  return isValidServiceId(raw) ? raw : createServiceId();
}

export function sanitizeServiceImage(raw) {
  const v = String(raw || '').slice(0, 500);
  if (/^data:/i.test(v)) return ''; // never persist local base64 blobs
  return v;
}

// Asegura ids únicos entre los items CON nombre de una lista: preserva
// cualquier id ya válido y sin colisión; genera uno nuevo — reintentando
// con el propio while si la regeneración también colisiona — para el que
// falte o esté repetido. Única fuente de esta regla: la reutilizan tanto
// sanitizeServiceList() como scripts/migrate-service-ids.mjs, para no
// duplicar el dedup en dos sitios.
//
// Los items SIN nombre no participan del dedup en absoluto: no reservan
// ids en seenIds y se devuelven tal cual (mismo objeto, .id sin tocar).
// Así un servicio que se va a descartar más adelante (sanitizeServiceList
// los filtra al final) nunca le "roba" el id a uno real por casualidad.
//
// generateId es inyectable solo para tests (verificar que el while
// reintenta ante una colisión regenerada); en producción siempre es
// createServiceId.
export function assignUniqueServiceIds(items, { generateId = createServiceId } = {}) {
  if (!Array.isArray(items)) return [];
  const seenIds = new Set();
  return items.map(item => {
    const nombre = String(item?.nombre || '');
    if (!nombre) return item;
    let id = sanitizeServiceId(item?.id);
    while (seenIds.has(id)) id = generateId();
    seenIds.add(id);
    return { ...item, id };
  });
}

// Forma canónica de un servicio: {id, nombre, precio, duracion, descripcion,
// descripcionLarga, imagen}. Allowlist deliberado — nunca copia campos extra que lleguen en
// el objeto de entrada, por seguridad (igual que antes de este helper).
export function sanitizeServiceList(rawList, limit) {
  if (!Array.isArray(rawList)) return [];
  const withUniqueIds = assignUniqueServiceIds(rawList.slice(0, limit));
  return withUniqueIds.map(item => ({
    id:          sanitizeServiceId(item?.id),
    nombre:      String(item?.nombre      || '').slice(0, 80),
    precio:      String(item?.precio      || '').slice(0, 30),
    duracion:    String(item?.duracion    || '').slice(0, 30),
    descripcion: String(item?.descripcion || '').slice(0, 200),
    descripcionLarga: String(item?.descripcionLarga || '').slice(0, 5000),
    imagen:      sanitizeServiceImage(item?.imagen),
  })).filter(item => item.nombre);
}

// Encuentra, dentro de una lista de servicios, el que corresponde al
// linkedItemId de una imagen asociada — primero por id (estable), y solo si
// no hay match cae a nombre (asociaciones hechas antes de que los servicios
// tuvieran id). Única fuente de este fallback: antes vivía duplicado, con
// pequeñas diferencias, en api/client-config.js y api/client-chat.js.
export function findServiceByLinkedItemId(items, linkedItemId) {
  if (!Array.isArray(items) || !linkedItemId) return undefined;
  const byId = items.find((item) => item && item.id && String(item.id) === linkedItemId);
  if (byId) return byId;
  return items.find((item) => item && item.nombre === linkedItemId);
}
