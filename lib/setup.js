/* JB Studio — qué le falta a un negocio para tomar reservas con criterio.
 *
 * Única fuente de verdad. Estaba copiada en reservations.js, client-chat.js y
 * client-config.js: tres copias del mismo criterio, que es exactamente el
 * patrón que ya provocó el bug del flag `unknown` (dos sanitizeBusinessHours
 * divergidos, uno borraba lo que el otro guardaba).
 *
 * Vive en lib/ y no en api/: el proyecto está en el límite de 12 funciones del
 * plan Hobby y un archivo en api/ contaría como una más.
 */

// Se calcula, no se guarda: un flag almacenado se queda obsoleto en cuanto
// alguien edita el cliente, y entonces miente justo cuando más importa.
export function faltaConfig(client) {
  const f = [];
  if (!client || typeof client !== 'object') return ['datos del negocio'];

  if (!client.timezone) f.push('zona horaria');

  const bh = client.businessHours;
  let diasAbiertos = 0;
  if (bh && typeof bh === 'object') {
    Object.keys(bh).forEach((d) => {
      const dia = bh[d];
      if (dia && dia.enabled !== false && !dia.unknown && Array.isArray(dia.ranges) && dia.ranges.length) diasAbiertos++;
    });
  }
  if (!bh) f.push('horario del negocio');
  else if (!diasAbiertos) f.push('días abiertos con horario');

  if (!Number.isFinite(client.minNoticeHours)) f.push('anticipación mínima');

  const menu = Array.isArray(client.menu) ? client.menu : [];
  if (!menu.length) f.push('servicios');
  else {
    // Restaurante: la duración por plato es opcional (una mesa no "dura" lo
    // que dura un plato) -- lo que el motor de disponibilidad necesita es
    // UNA duración de reserva a nivel de negocio (durationFor() en
    // api/reservations.js ya la usa como fallback cuando el plato no trae
    // la suya). Antes se exigía duración por plato para las 3 plantillas
    // por igual, así que un Restaurante creado válidamente (services sin
    // duración, permitido a propósito en api/clients.js) quedaba con
    // needsSetup:true de inmediato -- contradicción confirmada en auditoría.
    const id = client.templateId || (client.config && client.config.templateId);
    if (id === 'restaurant') {
      const reservationDuration = client.reservationDuration || (client.config && client.config.reservationDuration);
      if (!reservationDuration) f.push('duración de las reservas');
    } else if (menu.some((m) => !m.duracion)) {
      // Spa/Barbería: chequeo de PRESENCIA (no de formato) a propósito.
      // api/clients.js (missingTemplateFields, POST y PUT) ya rechaza con 400
      // cualquier duración inválida-pero-no-vacía ("60abc"/"pronto"/"0") al
      // escribir -- ese es el punto donde se cierra el riesgo real (auditoría,
      // "validación estricta de duraciones"). Este archivo se ejecuta también
      // en cada mensaje del chat para clientes YA EXISTENTES: si aquí también
      // fuera estricto, un cliente legado con una duración corrupta guardada
      // ANTES de esta corrección pasaría de "reservando con un bug silencioso
      // de solapamiento" a "needsSetup:true de un día para otro", sin que
      // ningún administrador tocara nada. Se deja documentado como riesgo
      // residual en vez de decidirlo en silencio.
      f.push('duración de los servicios');
    }
  }

  return f;
}

// Solo importa si el negocio realmente toma reservas. Un Básico no las tiene,
// así que no se le bloquea algo que no ofrece.
//
// El criterio debe ser el MISMO que featureOn() en el chat (!features ||
// features[k] !== false). Con el criterio estricto (=== true) los clientes
// legacy, que no tienen objeto features, quedaban fuera del bloqueo mientras
// el chat sí les ofrecía reservar.
export function necesitaSetup(client) {
  if (!client) return false;
  const reservas = !client.features || client.features.reservations !== false;
  if (!reservas) return false;
  return faltaConfig(client).length > 0;
}
