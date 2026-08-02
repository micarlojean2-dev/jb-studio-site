/* JB Studio — qué imágenes de un cliente están confirmadas y son públicas.
 *
 * Única fuente de verdad. Antes vivía duplicada como confirmedMedia()
 * (api/client-chat.js) y publicMedia() (api/client-config.js), cada una con
 * su propio criterio de validación (una exigía que la key de Redis
 * coincidiera con el publicId y que la URL fuera https; la otra no) — así el
 * modelo podía contar una foto que el widget nunca iba a poder pintar.
 *
 * Vive en lib/ y no en api/: el proyecto está en el límite de 12 funciones
 * del plan Hobby y un archivo en api/ contaría como una más.
 */

export function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : '';
  } catch (_) {
    return '';
  }
}

export function imageKeyBelongsTo(clientId, key, record) {
  const publicId = record && record.publicId;
  return typeof key === 'string'
    && key === `client-images:${clientId}:${publicId}`
    && typeof publicId === 'string'
    && publicId.startsWith(`clients/${clientId}/`);
}

// gallery: array de URLs (fotos generales). menu: array de {itemId, imageUrl}
// — itemId es lo que se guardó como linkedItemId al asociar la imagen: el id
// estable del servicio para asociaciones nuevas, o su nombre para las que se
// crearon antes de que los servicios tuvieran id.
export async function loadClientMedia(redis, clientId) {
  const keys = await redis.keys(`client-images:${clientId}:*`);
  if (!keys.length) return { gallery: [], menu: [] };
  const records = keys.length === 1 ? [await redis.get(keys[0])] : await redis.mget(...keys);
  const gallery = [];
  const menu = [];
  records.forEach((record, index) => {
    if (!record || record.confirmed !== true || !imageKeyBelongsTo(clientId, keys[index], record)) return;
    const imageUrl = safeImageUrl(record.imageUrl);
    if (!imageUrl) return;
    if (record.linkedType === 'gallery') gallery.push(imageUrl);
    // `service` era el tipo usado por la primera UI de imágenes. Se mantiene
    // por compatibilidad con asociaciones viejas guardadas con ese nombre.
    if ((record.linkedType === 'menu' || record.linkedType === 'service') && typeof record.linkedItemId === 'string') {
      menu.push({ itemId: record.linkedItemId, imageUrl });
    }
  });
  return { gallery, menu };
}
