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

// Forma canónica de un servicio: {id, nombre, precio, duracion, descripcion,
// imagen}. Allowlist deliberado — nunca copia campos extra que lleguen en
// el objeto de entrada, por seguridad (igual que antes de este helper).
export function sanitizeServiceList(rawList, limit) {
  if (!Array.isArray(rawList)) return [];
  return rawList.slice(0, limit).map(item => ({
    id:          sanitizeServiceId(item?.id),
    nombre:      String(item?.nombre      || '').slice(0, 80),
    precio:      String(item?.precio      || '').slice(0, 30),
    duracion:    String(item?.duracion    || '').slice(0, 30),
    descripcion: String(item?.descripcion || '').slice(0, 200),
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
