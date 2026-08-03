// Mejora conversacional del chatbot (auditoría técnica): selector de idioma,
// catálogo completo, memoria de servicio, nombre parcial y confirmación
// final centralizada. Ejecución real: carga chat-core.js real como IIFE
// (mismo patrón que test/qa-confirmacion.test.mjs) y hace verificaciones
// estructurales reales sobre widget.js/asistente.html (regex sobre el
// código fuente real, no una reimplementación).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreSrc = readFileSync(join(root, 'chat-core.js'), 'utf8');
const win = {};
new Function('window', coreSrc)(win);
const CORE = win.JBChatCore;
const widget = readFileSync(join(root, 'widget.js'), 'utf8');
const asistente = readFileSync(join(root, 'asistente.html'), 'utf8');
const clientChat = readFileSync(join(root, 'api', 'client-chat.js'), 'utf8');

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.error('  ✗', msg); failures++; } };

console.log('1. Selector de idioma — aparece con es/en, no en monolingüe, sin depender de templateId');
{
  ok(CORE.hasLanguageChoice({ languages: ['es', 'en'] }) === true, 'sin templateId (legacy) con ambos idiomas: aparece');
  ok(CORE.hasLanguageChoice({ templateId: 'barber', languages: ['es', 'en'] }) === true, 'barbería con ambos idiomas: aparece');
  ok(CORE.hasLanguageChoice({ templateId: 'restaurant', languages: ['es', 'en'] }) === true, 'restaurante con ambos idiomas: aparece');
  ok(CORE.hasLanguageChoice({ templateId: 'spa', languages: ['es', 'en'] }) === true, 'spa con ambos idiomas: aparece');
  ok(CORE.hasLanguageChoice({ templateId: 'spa', languages: ['es'] }) === false, 'monolingüe (solo es): NO aparece');
  ok(CORE.hasLanguageChoice({ templateId: 'barber' }) === false, 'sin cfg.languages: NO aparece');
  const copy = CORE.languageChoiceCopy();
  ok(copy.prompt === 'Selecciona tu idioma / Choose your language', 'texto del prompt exacto');
  ok(copy.options.length === 2 && copy.options[0].label === '🇪🇸 Español' && copy.options[1].label === '🇺🇸 English', 'botones 🇪🇸 Español / 🇺🇸 English');

  for (const [name, source] of [['widget.js', widget], ['asistente.html', asistente]]) {
    ok(source.includes('CORE.hasLanguageChoice(cfg)'), `${name}: usa CORE.hasLanguageChoice(cfg), no templateId==='spa'`);
    ok(!/hasLanguageChoice\(\)\s*\{[^}]*templateId\s*===\s*'spa'/.test(source), `${name}: la comprobación real ya no exige templateId==='spa'`);
    ok(source.includes('showLanguageChoice'), `${name}: existe el flujo del selector`);
    ok(source.includes("sessionStorage.setItem(LANGUAGE_SESS"), `${name}: persiste la elección con namespace por clientId (LANGUAGE_SESS = SESS + '_language')`);
    ok(source.includes("LANGUAGE_SESS = SESS + '_language'"), `${name}: LANGUAGE_SESS incluye el clientId (vía SESS)`);
    // Regla 6: si ya existe, no se pregunta de nuevo.
    ok(/hasLanguageChoice\(\) && !storedLanguage\(\)\) showLanguageChoice\(\);/.test(source), `${name}: solo pregunta si NO hay idioma guardado`);
    // Regla 7: nunca se detecta después de elegido — ya no hay ninguna
    // detección automática activa en el flujo de envío de mensajes.
    ok(!/lockLanguage\(/.test(source), `${name}: no queda ninguna detección automática tras elegir`);
    // Regla 4: se manda al backend en cada llamada a /api/client-chat.
    const chatCalls = source.split("'/api/client-chat'").length - 1;
    const langInBody = (source.match(/language:\s*cfg\.language/g) || []).length;
    ok(chatCalls >= 1 && langInBody >= chatCalls, `${name}: envía language:cfg.language en las ${chatCalls} llamadas a /api/client-chat`);
  }
}

console.log('\n2. Selector de idioma — backend acepta el idioma elegido, no depende de templateId');
{
  ok(clientChat.includes('function hasLanguageChoice(client)'), 'api/client-chat.js: existe hasLanguageChoice(client)');
  ok(!/hasLanguageChoice\(client\)\s*\{\s*return[^}]*templateId/.test(clientChat), 'la función real ya no exige templateId dentro del cuerpo');
  ok(clientChat.includes('requestedLanguage === \'en\' || requestedLanguage === \'es\'') , 'languageForMessages() prioriza el idioma explícito del frontend');
  ok(clientChat.includes('const { clientId, messages, previewToken, booking, language } = req.body'), 'el handler lee req.body.language');
  ok(clientChat.includes('languageForMessages(client, messages, language)'), 'el idioma explícito se pasa a languageForMessages()');
}

console.log('\n3. Catálogo — todos los elementos, con o sin foto, mismo orden, sin duplicar lista textual');
{
  ok(CORE.catalogItems({ menu: [{ nombre: 'A' }, { nombre: 'B', imagen: 'x.jpg' }] }).length === 2, 'catalogItems() no filtra por imagen');
  ok(CORE.catalogItems({}).length === 0, 'catalogItems() sin menu -> []');
  ok(CORE.catalogIntro('es') === 'Aquí tienes nuestros servicios 😊', 'intro breve en español');
  ok(CORE.catalogIntro('en') === 'Here are our services 😊', 'intro breve en inglés');

  for (const [name, source] of [['widget.js', widget], ['asistente.html', asistente]]) {
    // La función que antes filtraba (renderServicesWithPhotos) ahora delega
    // en renderMenu(): un solo catálogo, sin lista filtrada divergente.
    ok(/function renderServicesWithPhotos\(\) \{\s*renderMenu\(\);\s*\}/.test(source), `${name}: renderServicesWithPhotos() delega en renderMenu() (ya no filtra por imagen)`);
    ok(!/\.filter\(function \(item\) \{ return item && item\.imagen; \}\)/.test(source), `${name}: no queda ningún .filter(item => item.imagen) para armar tarjetas`);
    ok(/function renderMenu\(\) \{\s*var items = Array\.isArray\(cfg\.menu\) \? cfg\.menu : \[\];/.test(source), `${name}: renderMenu() recorre cfg.menu completo, en su orden original`);
    ok(/if \(item\.imagen\) \{/.test(source) && /card\.classList\.add\('.*-card-no-image'\)/.test(source), `${name}: hay rama con imagen y placeholder sin imagen (misma tarjeta)`);
  }
  ok(clientChat.includes('CATÁLOGO:') && clientChat.includes('Nunca listes los servicios, precios o descripciones en tu texto'), 'api/client-chat.js: instruye NO listar el catálogo en texto (las tarjetas ya lo muestran)');
}

console.log('\n4. Frase incómoda de fotos eliminada / fotos generales vs servicio concreto');
{
  // Se ignoran los comentarios de línea: api/client-chat.js documenta la
  // frase a evitar EN UN COMENTARIO (para explicar el porqué del cambio),
  // eso no cuenta como "la frase sigue existiendo" — solo importa que no
  // esté en un texto real que el modelo pueda decir.
  const stripComments = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  for (const source of [widget, asistente, clientChat]) {
    ok(!/para que veas el espacio y c[oó]mo se vive la experiencia/i.test(stripComments(source)), 'no existe la frase incómoda original (fuera de comentarios)');
  }
  ok(CORE.generalPhotosIntro('es') === 'Aquí tienes algunas fotos 😊', 'intro breve de fotos generales (es)');
  ok(CORE.generalPhotosIntro('en') === 'Here are some photos 😊', 'intro breve de fotos generales (en)');
  ok(clientChat.includes('Here are some photos') && clientChat.includes('Aquí tienes algunas fotos'), 'el prompt sugiere la frase breve de fotos generales');
  ok(clientChat.includes('never invent a price or duration') && clientChat.includes('nunca inventes precio ni duración'), 'el prompt prohíbe inventar precio/duración para un servicio concreto');
}

console.log('\n5. Memoria de selectedService');
{
  ok(CORE.resolveServicio({ servicio: 'Corte' }, 'Manicure') === 'Corte', 'bookingData.servicio manda si ya existe');
  ok(CORE.resolveServicio({}, 'Masaje relajante') === 'Masaje relajante', 'sin servicio en bookingData, usa selectedService');
  ok(CORE.resolveServicio({}, '') === '', 'sin ninguno de los dos -> string vacío (nunca inventa uno)');

  for (const [name, source] of [['widget.js', widget], ['asistente.html', asistente]]) {
    ok(source.includes('var selectedService'), `${name}: existe el estado selectedService`);
    ok(source.includes('if (preExtraido.servicio) selectedService = preExtraido.servicio;'), `${name}: se fija al mencionarlo en chat libre`);
    ok(source.includes('bookingData.servicio = CORE.resolveServicio(bookingData, selectedService);'), `${name}: bookingData.servicio = bookingData.servicio || selectedService al iniciar`);
    ok(source.includes('if (yaVisto.servicio) selectedService = yaVisto.servicio;'), `${name}: un cambio explícito dentro del flujo también se recuerda`);
    ok(/selectedService = '';[\s\S]{0,40}\/\/ cancelar el flujo olvida el servicio recordado|selectedService = '';\s*\/\/ cancelar/.test(source), `${name}: cancelar el flujo olvida el servicio`);
    ok(/selectedService = '';/.test(source.slice(source.indexOf('reservationId: d.reservationId'))), `${name}: terminar la reserva con éxito olvida el servicio`);
    ok(source.includes('selectedService: selectedService'), `${name}: se persiste en sessionStorage junto al estado de reserva`);
  }
}

console.log('\n6. Nombre parcial y confirmación natural');
{
  ok(CORE.esNombreUnaPalabra('Mike') === true, '"Mike" es una sola palabra');
  ok(CORE.esNombreUnaPalabra('Mike Jean') === false, '"Mike Jean" no es una sola palabra');
  ok(CORE.esNombreUnaPalabra('') === false, 'vacío no cuenta');
  ok(CORE.nombreConfirmacionMensaje('Mike', 'es') === 'Te anoté como Mike 😊 ¿Ese es tu nombre completo o quieres agregar tu apellido?', 'mensaje exacto en español');
  ok(/noted you as Mike/.test(CORE.nombreConfirmacionMensaje('Mike', 'en')), 'mensaje en inglés reconoce el nombre');

  // Mensaje con fecha, hora, nombre, email y teléfono en una sola frase: no
  // se pierde ningún campo (extractBooking ya lo hacía; se confirma aquí).
  const cfg = { menu: [], businessHours: null };
  const extraido = CORE.extractBooking('miércoles a las 5pm, me llamo mike, correo mike@test.com, telefono 3105550142', cfg.menu, cfg.businessHours, 'es', cfg);
  ok(extraido.fecha === 'miércoles', 'conserva la fecha');
  ok(extraido.hora === '5:00 PM' || extraido.hora === '5:00PM' || /^5:00/.test(extraido.hora), `conserva la hora (${extraido.hora})`);
  ok(extraido.nombre === 'mike', 'conserva el nombre (una palabra)');
  ok(extraido.email === 'mike@test.com', 'conserva el email');
  ok(extraido.telefono && extraido.telefono.replace(/\D/g, '').length >= 7, 'conserva el teléfono');

  // bookingRequirements: nombre de una palabra sin confirmar cuenta como
  // pendiente (para poder preguntar), confirmado ya no.
  const base = { nombre: 'Mike', telefono: '3105550142', email: 'mike@test.com', fecha: 'miércoles', hora: '5:00 PM', servicio: 'Corte', specialRequests: '' };
  ok(CORE.bookingRequirements({ templateId: 'barber' }, base).includes('nombre'), 'nombre de una palabra sin confirmar: se vuelve a preguntar (sin perderlo)');
  ok(!CORE.bookingRequirements({ templateId: 'barber' }, Object.assign({}, base, { __nombreConfirmado: true })).includes('nombre'), 'confirmado ("sí"): ya no se pregunta');
  ok(!CORE.bookingRequirements({ templateId: 'barber' }, Object.assign({}, base, { nombre: 'Mike Jean Baptiste' })).includes('nombre'), 'nombre con apellido: nunca se exige confirmación');
  ok(CORE.bookingRequirements({ templateId: 'barber' }, Object.assign({}, base, { nombre: '' })).includes('nombre'), 'sin nombre: sigue faltando (comportamiento previo intacto)');

  for (const [name, source] of [['widget.js', widget], ['asistente.html', asistente]]) {
    ok(source.includes("bookingPending === 'nombre' && bookingData.nombre && CORE.esNombreUnaPalabra(bookingData.nombre)"), `${name}: pregunta natural para nombre de una palabra`);
    ok(source.includes('__nombreConfirmado = true'), `${name}: confirma sin exigir apellido`);
    ok(source.includes("bookingData.nombre = bookingData.nombre + ' ' + apellido"), `${name}: agregar apellido actualiza el nombre (nunca lo borra)`);
    ok(source.includes('if (!bookingData[k]) bookingData[k] = extraCampos[k];'), `${name}: otros campos capturados en la misma respuesta no se pierden`);
  }
}

console.log('\n7. Confirmación final según resultado real del email');
{
  ok(!CORE.mensajeReservaGuardada({ businessName: 'X' }, { email: { customer: { sent: false } } }, 'es').includes('Tu solicitud quedó registrada correctamente'), 'ya no existe la frase genérica vieja');
  const sentEs = CORE.mensajeReservaGuardada({ businessName: 'Spa Luna' }, { email: { customer: { sent: true } } }, 'es');
  ok(sentEs.includes('✅ Tu cita quedó confirmada.') && sentEs.includes('Te enviamos los detalles a tu correo') && sentEs.includes('Revisa también spam') && sentEs.includes('Gracias por reservar en Spa Luna'), 'caso email enviado (es): copy completo con businessName');
  const failEs = CORE.mensajeReservaGuardada({ businessName: 'Spa Luna' }, { email: { customer: { sent: false } } }, 'es');
  ok(failEs.includes('No pudimos enviar el correo') && !/te enviamos los detalles/i.test(failEs), 'caso email NO enviado (es): nunca afirma que se envió');
  const failNoEmailField = CORE.mensajeReservaGuardada({ businessName: 'Spa Luna' }, {}, 'es');
  ok(!/te enviamos los detalles/i.test(failNoEmailField), 'sin d.email en absoluto: tampoco afirma envío (nunca sent !== true)');
  const sentEn = CORE.mensajeReservaGuardada({ businessName: 'Luna Spa' }, { email: { customer: { sent: true } } }, 'en');
  ok(sentEn.includes('Your appointment is confirmed') && sentEn.includes('Luna Spa'), 'caso email enviado (en)');
  const failEn = CORE.mensajeReservaGuardada({ businessName: 'Luna Spa' }, { email: { customer: { sent: false } } }, 'en');
  ok(failEn.includes("couldn't send the email"), 'caso email NO enviado (en)');

  // Spa/barber -> "cita"/"appointment"; restaurant -> "reserva"/"reservation".
  ok(CORE.mensajeReservaGuardada({ templateId: 'barber' }, { email: { customer: { sent: true } } }, 'es').includes('Tu cita quedó confirmada'), 'barbería usa "cita"');
  ok(CORE.mensajeReservaGuardada({ templateId: 'restaurant' }, { email: { customer: { sent: true } } }, 'es').includes('Tu reserva quedó confirmada'), 'restaurante usa "reserva" (no rompe el lenguaje de mesas)');
  ok(CORE.mensajeReservaGuardada({ templateId: 'restaurant' }, { email: { customer: { sent: true } } }, 'en').includes('Your reservation is confirmed'), 'restaurante en inglés usa "reservation"');

  for (const [name, source] of [['widget.js', widget], ['asistente.html', asistente]]) {
    ok(!source.includes('Tu solicitud quedó registrada correctamente'), `${name}: ya no contiene la frase eliminada`);
    ok(!source.includes('Your request has been registered successfully'), `${name}: ya no contiene la versión en inglés de la frase eliminada`);
    ok(source.includes('CORE.mensajeReservaGuardada(cfg, d, lang)'), `${name}: usa el mensaje centralizado de chat-core.js`);
  }
}

console.log('\n8. Tono humano por plantilla (Objetivo 6) — el modelo no decide estado crítico');
{
  ok(clientChat.includes('Matiz de spa: calmado, cálido y relajante') || clientChat.includes('Spa flavor: calm, warm, and relaxing'), 'tono spa presente');
  ok(clientChat.includes('Matiz de barbería: cercano, seguro y casual') || clientChat.includes('Barbershop flavor: friendly, confident, and casual'), 'tono barbería presente');
  ok(clientChat.includes('Matiz de restaurante: cordial, apetitoso y dinámico') || clientChat.includes('Restaurant flavor: cordial, appetizing, and upbeat'), 'tono restaurante presente');
  ok(clientChat.includes('TONO:') || clientChat.includes('TONE:'), 'capa de tono compartida presente');
  // El precio sigue viniendo SIEMPRE de los datos reales, nunca del modelo:
  // ya cubierto por la regla de "nunca inventes precio ni duración" arriba.
  ok(!/bookingPending\s*=\s*data\.pedirle_al_modelo/.test(clientChat), 'el modelo no decide qué campo falta (bookingRequirements sigue siendo del frontend)');
}

console.log('');
if (failures) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('✅ Mejora conversacional del chatbot verificada (idioma, catálogo, memoria de servicio, nombre parcial, confirmación final, tono)');
