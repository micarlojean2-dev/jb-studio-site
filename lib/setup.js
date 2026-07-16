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
  else if (menu.some((m) => !m.duracion)) f.push('duración de los servicios');

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
