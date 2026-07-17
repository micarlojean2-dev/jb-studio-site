/* Cola de cambios por negocio para el resumen diario agrupado.
 *
 * Compartido entre api/reservations.js (alta) y api/cancel-reservation.js
 * (cancelación) para no duplicar la lógica. Vive en lib/ (no cuenta como
 * función serverless del plan Hobby).
 *
 * changes:{clientId}  -> LIST de eventos pequeños (nueva/reprogramada/cancelada)
 * digest:pending      -> SET de clientIds con cambios sin enviar (evita
 *                        escanear todas las reservas en el proceso diario)
 */
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Encola un cambio y marca el negocio como pendiente. Un fallo aquí no debe
// tumbar la operación principal (la reserva/cancelación ya está guardada);
// solo se perdería el aviso agrupado de ese cambio.
export async function registrarCambio(clientId, evento) {
  try {
    const ev = JSON.stringify(Object.assign({ ts: Date.now() }, evento));
    await redis.rpush(`changes:${clientId}`, ev);
    await redis.ltrim(`changes:${clientId}`, -300, -1);   // acotado
    await redis.sadd('digest:pending', clientId);
  } catch (e) {
    console.error('[lib/changes] registrarCambio:', e.message);
  }
}
