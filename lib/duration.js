/* JB Studio — única fuente de verdad para interpretar y validar una
 * duración (de un servicio o de una reserva), para cualquier plantilla.
 *
 * Antes existían dos copias idénticas de esta gramática: spaDurationMinutes()
 * en api/clients.js y duracionMin() en api/reservations.js -- exactamente el
 * patrón de divergencia que este proyecto ya evita en otros lados (ver el
 * comentario de lib/setup.js sobre las tres copias de faltaConfig). admin.html
 * mantiene una copia deliberada porque no puede importar módulos server-side
 * sin build step -- se documenta ahí mismo, igual que faltaConfigCliente().
 *
 * Vive en lib/ y no en api/: el proyecto está en el límite de 12 funciones
 * del plan Hobby y un archivo en api/ contaría como una más.
 */

// "60", "60 minutos", "1 hora", "45 min", "1h 30". Si no se entiende -> 0
// (nunca se inventa una duración). Cada patrón está anclado con ^...$: sin
// anclar, /(\d+)\s*m/ encontraría "60 m" dentro de texto basura arbitrario
// ("60 min despues de la cita") y lo aceptaría igual.
export function parseDurationMinutes(txt) {
  const t = String(txt || '').trim().toLowerCase();
  if (!t) return 0;
  let m = t.match(/^(\d+)$/);
  if (m) return +m[1];
  m = t.match(/^(\d+)\s*(?:min|mins|minuto|minutos)$/);
  if (m) return +m[1];
  m = t.match(/^(\d+)\s*(?:h|hora|horas)$/);
  if (m) return (+m[1]) * 60;
  m = t.match(/^(\d+)\s*(?:h|hora|horas)\s+(\d+)$/);
  if (m) return (+m[1]) * 60 + (+m[2]);
  return 0;
}

// Rango válido para cualquier duración real (servicio o reserva): al menos
// un minuto, como mucho un día completo. parseDurationMinutes() devuelve 0
// tanto para "" como para texto ilegible -- 0 nunca es una duración real,
// así que 0 siempre cae fuera de este rango.
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 1440;

export function isValidDurationMinutes(txt) {
  const n = parseDurationMinutes(txt);
  return n >= MIN_DURATION_MINUTES && n <= MAX_DURATION_MINUTES;
}
