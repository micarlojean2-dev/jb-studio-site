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

const defaultRedis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Encola un cambio de forma ATÓMICA y devuelve si lo logró.
//
// Por qué atómico: antes eran tres llamadas sueltas (rpush + ltrim + sadd). Si
// el `sadd digest:pending` fallaba tras un `rpush` exitoso, el evento quedaba
// en `changes:` pero invisible para el resumen (que solo mira `digest:pending`)
// — una reserva guardada que nunca generaba aviso. Un MULTI/EXEC ejecuta las
// tres en un solo viaje a Redis: o entran todas, o ninguna. Además es más
// barato que tres round-trips.
//
// Nunca lanza: la reserva puede seguir guardándose. Pero devuelve {ok} para que
// el backend NO dé una confirmación falsa si el aviso no quedó encolado.
//
// `deps.redis` permite inyectar un doble en las pruebas; en producción usa el
// cliente real del módulo.
export async function registrarCambio(clientId, evento, deps) {
  const redis = (deps && deps.redis) || defaultRedis;
  const ev = JSON.stringify(Object.assign({ ts: Date.now() }, evento));
  const INTENTOS = 2;
  let ultimoError = null;

  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      const res = await redis.multi()
        .rpush(`changes:${clientId}`, ev)
        .ltrim(`changes:${clientId}`, -300, -1)   // acotado
        .sadd('digest:pending', clientId)
        .exec();

      // Algunos clientes devuelven el array de resultados en vez de lanzar;
      // si alguna operación trae error, se trata como fallo (no se oculta).
      if (Array.isArray(res)) {
        const err = res.find((r) => r && typeof r === 'object' && r.error);
        if (err) throw new Error(String(err.error));
      }
      return { ok: true };
    } catch (e) {
      ultimoError = e;
      // Log claro y SIN datos sensibles: solo el negocio y el mensaje. Nunca
      // el contenido del evento (nombre, teléfono).
      console.error(`[lib/changes] intento ${intento}/${INTENTOS}: no se pudo encolar el aviso de ${clientId}:`, e && e.message);
      if (intento < INTENTOS) await new Promise((r) => setTimeout(r, 150));
    }
  }
  return { ok: false, error: (ultimoError && ultimoError.message) || 'unknown' };
}
