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
  ok(CORE.catalogIntro({}, 'es') === 'Aquí tienes nuestros servicios 😊', 'intro breve en español');
  ok(CORE.catalogIntro({}, 'en') === 'Here are our services 😊', 'intro breve en inglés');

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
    // Decisión centralizada en chat-core.js (antes duplicada byte a byte en
    // ambos archivos, con el mismo bug en los dos). [auditoría — nombre corrupto]
    ok(source.includes('bookingData = CORE.confirmarNombreUnaPalabra(bookingData, t, extraCampos, lang);'), `${name}: usa la decisión compartida de chat-core.js`);
    ok(!/gmail its|CORE\.limpiarNombre\(t\)/.test(source.slice(source.indexOf("bookingPending === 'nombre' && bookingData.nombre && !bookingData.__nombreConfirmado"), source.indexOf("bookingPending === 'nombre' && bookingData.nombre && !bookingData.__nombreConfirmado") + 800)), `${name}: ya no reimplementa el apellido en el propio archivo`);
  }
}

console.log('\n6b. CORE.confirmarNombreUnaPalabra() — auditoría producción (mismo motor para widget.js y asistente.html)');
{
  const menu = [{ nombre: 'Masaje relajante' }];
  function run(nombre, t, lang) {
    var extra = CORE.extractBooking(t, menu, null, lang || 'es', {});
    return CORE.confirmarNombreUnaPalabra({ nombre: nombre }, t, extra, lang || 'es');
  }
  // Caso exacto reportado en producción: "Nombre: mike gmail its"
  let r = run('mike', 'gmail its mike@gmail.com', 'es');
  ok(r.nombre === 'mike', `nunca anexa "gmail its" como apellido (fue: ${JSON.stringify(r.nombre)})`);
  ok(r.email === 'mike@gmail.com', 'captura el correo del mismo mensaje');
  ok(r.__nombreConfirmado === true, 'queda confirmado (no vuelve a preguntar en bucle)');

  r = run('Mike', 'no', 'es');
  ok(r.nombre === 'Mike', `"no" nunca se anexa como apellido (fue: ${JSON.stringify(r.nombre)})`);
  r = run('Mike', 'not really', 'en');
  ok(r.nombre === 'Mike', 'negación en inglés tampoco se anexa');

  r = run('Mike', 'my phone is 3105550142', 'en');
  ok(r.nombre === 'Mike' && r.telefono, 'teléfono en el mismo mensaje: se captura, el nombre no se toca');

  r = run('Mike', 'test@example.com', 'es');
  ok(r.nombre === 'Mike' && r.email === 'test@example.com', 'correo suelto: conserva Mike y captura el correo');

  r = run('Mike', 'miércoles a las 5pm', 'es');
  ok(r.nombre === 'Mike' && r.fecha === 'miércoles' && r.hora, 'fecha/hora en el mismo mensaje: se capturan, el nombre no se toca');

  r = run('Mike', 'Masaje relajante', 'es');
  ok(r.nombre === 'Mike' && r.servicio === 'Masaje relajante', 'servicio nombrado: se captura, el nombre no se toca');

  r = run('Mike', 'Johnson', 'es');
  ok(r.nombre === 'Mike Johnson', 'un apellido real (sin marcador) sí se anexa');

  r = run('Mike', 'en realidad me llamo Miguel', 'es');
  ok(r.nombre === 'Miguel', `corrección explícita reemplaza el nombre (fue: ${JSON.stringify(r.nombre)})`);

  r = run('Mike', 'sí', 'es');
  ok(r.nombre === 'Mike' && r.__nombreConfirmado === true, 'confirmación explícita conserva el nombre tal cual');
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

console.log('\n9. Catálogo: introducción determinista, no depende del modelo (auditoría)');
{
  ok(CORE.catalogIntro({ templateId: 'restaurant' }, 'es') === 'Aquí tienes nuestro menú 😊', 'restaurante: intro específica del menú (es)');
  ok(CORE.catalogIntro({ templateId: 'restaurant' }, 'en').toLowerCase().includes('menu'), 'restaurante: intro específica del menú (en)');
  ok(CORE.looksLikeCatalogRestatement('Tenemos Masaje relajante y Facial hidratante disponibles hoy',
    [{ nombre: 'Masaje relajante' }, { nombre: 'Facial hidratante' }]) === true, 'detecta 2+ servicios nombrados como repetición del catálogo');
  ok(CORE.looksLikeCatalogRestatement('Claro, aceptamos tarjeta y efectivo',
    [{ nombre: 'Masaje relajante' }, { nombre: 'Facial hidratante' }]) === false, 'texto sin nombrar servicios: se conserva (no es duplicación)');

  for (const [name, source] of [['widget.js', widget], ['asistente.html', asistente]]) {
    ok(source.includes('CORE.catalogIntro(cfg, lang)'), `${name}: usa la intro determinista de chat-core.js`);
    ok(source.includes('CORE.looksLikeCatalogRestatement(cleanText, cfg.menu)'), `${name}: filtra el texto del modelo si repite el catálogo`);
    ok(source.includes('CORE.isCatalogIntroEcho(cleanText, cfg, lang)'), `${name}: filtra el texto del modelo si es un eco de la propia intro`);
    ok(/if \(showMenu && !showServicePhotos\) \{/.test(source), `${name}: la intro se muestra SIEMPRE que llegue [MOSTRAR_MENU] (no depende de que el modelo haya escrito algo)`);
    // No debe borrar texto útil: si el modelo NO repite el catálogo ni hace
    // eco de la intro, su texto se sigue mostrando junto a la intro.
    ok(/if \(cleanText && !CORE\.isCatalogIntroEcho\(cleanText, cfg, lang\) && !CORE\.looksLikeCatalogRestatement\(cleanText, cfg\.menu\)\) \{\s*addMsg\('bot', cleanText\);/.test(source),
      `${name}: el texto útil del modelo (que no repite el catálogo ni hace eco de la intro) NO se borra`);
  }
}

console.log('\n13. Catálogo: la intro determinista no se duplica cuando el modelo la repite (auditoría producción)');
{
  ok(CORE.isCatalogIntroEcho('Aquí tienes nuestros servicios 😊', { templateId: 'spa' }, 'es') === true,
    'eco exacto en español: detectado');
  ok(CORE.isCatalogIntroEcho('¡Aquí tienes nuestros servicios!  😊', { templateId: 'spa' }, 'es') === true,
    'eco con puntuación/espacios distintos: sigue siendo detectado (equivalencia, no solo igualdad byte a byte)');
  ok(CORE.isCatalogIntroEcho('Here are our services 😊', { templateId: 'spa' }, 'en') === true,
    'eco exacto en inglés: detectado');
  ok(CORE.isCatalogIntroEcho('Aquí tienes nuestro menú 😊', { templateId: 'restaurant' }, 'es') === true,
    'restaurante: eco de su propia intro de menú (es) detectado');
  ok(CORE.isCatalogIntroEcho("Here's our menu 😊", { templateId: 'restaurant' }, 'en') === true,
    'restaurante: eco de su propia intro de menú (en) detectado');
  ok(CORE.isCatalogIntroEcho('Claro, aquí lo tienes de nuevo 😊', { templateId: 'spa' }, 'es') === false,
    'texto distinto a la intro: NO se marca como eco (se conserva)');
  ok(CORE.isCatalogIntroEcho('', { templateId: 'spa' }, 'es') === false, 'texto vacío: no es un eco');
  // Restaurante no debe confundirse con la intro de spa/barbería ni viceversa.
  ok(CORE.isCatalogIntroEcho('Aquí tienes nuestros servicios 😊', { templateId: 'restaurant' }, 'es') === false,
    'restaurante: la frase genérica de spa/barbería NO se confunde con SU intro (comportamiento de restaurante intacto)');

  // Ejecución real del bloque exacto de widget.js/asistente.html que decide
  // qué se muestra, con CORE real y addMsg simulado — prueba end-to-end de
  // los 6 escenarios exigidos, no solo la función auxiliar aislada.
  function extractCatalogBlock(source) {
    const m = source.match(/var showMenu[\s\S]*?(?=\/\/ Pedir fotos ya no fuerza el catálogo completo:)/);
    if (!m) throw new Error('no se encontró el bloque de decisión del catálogo');
    return m[0];
  }

  function runCatalogScenario(source, cfg, lang, modelText, hasMenuMarker) {
    const blockSrc = extractCatalogBlock(source);
    const shown = [];
    const fn = new Function('d', 'cfg', 'lang', 'CORE', 'addMsg', `
      ${blockSrc}
      return shownTexts;
    `);
    const dText = (hasMenuMarker ? '[MOSTRAR_MENU]' : '') + modelText;
    return fn({ text: dText }, cfg, lang, CORE, (role, text) => shown.push(text));
  }

  const cfgSpa = { templateId: 'spa', menu: [{ nombre: 'Masaje relajante' }, { nombre: 'Facial hidratante' }] };
  const cfgRestaurant = { templateId: 'restaurant', menu: [{ nombre: 'Tacos al pastor' }, { nombre: 'Guacamole' }] };

  for (const [name, source] of [['widget.js', widget], ['asistente.html', asistente]]) {
    let shown;

    shown = runCatalogScenario(source, cfgSpa, 'es', 'Aquí tienes nuestros servicios 😊', true);
    ok(shown.length === 1, `${name}: modelo repite exactamente la intro (es) -> se muestra UNA sola vez (fue: ${JSON.stringify(shown)})`);

    shown = runCatalogScenario(source, cfgSpa, 'en', 'Here are our services 😊', true);
    ok(shown.length === 1, `${name}: modelo repite la variante inglesa -> se muestra UNA sola vez (fue: ${JSON.stringify(shown)})`);

    shown = runCatalogScenario(source, cfgRestaurant, 'es', 'Aquí tienes nuestro menú 😊', true);
    ok(shown.length === 1 && shown[0] === 'Aquí tienes nuestro menú 😊',
      `${name}: restaurante repite su propia intro de menú -> se muestra UNA sola vez (fue: ${JSON.stringify(shown)})`);

    shown = runCatalogScenario(source, cfgSpa, 'es', 'Claro, aquí lo tienes de nuevo 😊', true);
    ok(shown.length === 2 && shown[1] === 'Claro, aquí lo tienes de nuevo 😊',
      `${name}: "Claro, aquí lo tienes de nuevo" no es un eco -> se conserva junto a la intro (fue: ${JSON.stringify(shown)})`);

    shown = runCatalogScenario(source, cfgSpa, 'es', 'Recuerda que cerramos los domingos.', true);
    ok(shown.length === 2 && shown[1] === 'Recuerda que cerramos los domingos.',
      `${name}: información útil adicional del modelo -> se conserva (fue: ${JSON.stringify(shown)})`);

    shown = runCatalogScenario(source, cfgSpa, 'es', 'Tenemos Masaje relajante y Facial hidratante disponibles hoy', true);
    ok(shown.length === 1, `${name}: modelo enumera 2+ servicios reales -> se descarta la repetición del catálogo (fue: ${JSON.stringify(shown)})`);
  }
}

console.log('\n10. Prueba EXACTA del mensaje con nombre (auditoría)');
{
  const cfg = { menu: [{ nombre: 'Masaje relajante', precio: '40', duracion: '60' }], businessHours: null };
  const texto = 'miércoles a las 5pm,me llamo mike,micarlojean2@gmail.com 2067421261';
  const extraido = CORE.extractBooking(texto, cfg.menu, cfg.businessHours, 'es', cfg);
  ok(extraido.fecha === 'miércoles', `fecha: "miércoles" (fue: ${JSON.stringify(extraido.fecha)})`);
  ok(extraido.hora === '5:00 PM', `hora: "5:00 PM" (fue: ${JSON.stringify(extraido.hora)})`);
  ok(extraido.nombre === 'mike', `nombre: "mike" (fue: ${JSON.stringify(extraido.nombre)})`);
  ok(extraido.email === 'micarlojean2@gmail.com', `email: "micarlojean2@gmail.com" (fue: ${JSON.stringify(extraido.email)})`);
  ok(extraido.telefono && extraido.telefono.replace(/\D/g, '') === '2067421261', `teléfono: "2067421261" (fue: ${JSON.stringify(extraido.telefono)})`);
  ok(extraido.servicio === undefined, 'este mensaje no nombra ningún servicio (se espera que venga de selectedService, no inventado)');

  // Servicio previamente seleccionado: como el mensaje no lo repite,
  // bookingData.servicio debe caer al selectedService ya elegido antes.
  const bookingData = Object.assign({}, extraido);
  bookingData.servicio = CORE.resolveServicio(bookingData, 'Masaje relajante');
  ok(bookingData.servicio === 'Masaje relajante', 'conserva el servicio previamente seleccionado (selectedService) sin perder los demás campos');
  ok(bookingData.nombre === 'mike' && bookingData.fecha === 'miércoles' && bookingData.email === 'micarlojean2@gmail.com' && bookingData.telefono === '2067421261',
    'ningún campo se pierde al aplicar el respaldo de servicio');

  // Debe preguntar de forma natural si "Mike" es el nombre completo, SIN
  // borrar los demás datos ya capturados (bookingRequirements sigue
  // pidiendo "nombre" hasta que se confirme).
  ok(CORE.esNombreUnaPalabra(extraido.nombre) === true, '"mike" es una sola palabra: dispara la confirmación natural');
  const faltan = CORE.bookingRequirements({ templateId: 'barber' }, bookingData);
  ok(faltan.includes('nombre'), 'con el nombre sin confirmar, bookingRequirements() lo vuelve a pedir (no lo da por bueno en silencio)');
  ok(CORE.nombreConfirmacionMensaje('mike', 'es').includes('mike'), 'el mensaje de confirmación nombra exactamente lo capturado');
  bookingData.__nombreConfirmado = true;
  const faltanTrasConfirmar = CORE.bookingRequirements({ templateId: 'barber' }, bookingData);
  ok(!faltanTrasConfirmar.includes('nombre'), 'confirmado, ya no se vuelve a pedir');
  ok(bookingData.nombre === 'mike' && bookingData.fecha === 'miércoles' && bookingData.email === 'micarlojean2@gmail.com' && bookingData.telefono === '2067421261' && bookingData.servicio === 'Masaje relajante',
    'todos los datos siguen intactos después de confirmar el nombre');
}

console.log('\n11. d.emailWarning nunca decide "se envió al cliente" — solo d.email.customer.sent === true');
{
  const cfg = { businessName: 'Spa Luna' };
  const sentConWarning = CORE.mensajeReservaGuardada(cfg, {
    email: { customer: { sent: true }, owners: { sent: false, error: 'algo falló con el dueño' } },
    emailWarning: 'RESEND_API_KEY missing para uno de los destinatarios',
  }, 'es');
  ok(sentConWarning.includes('Te enviamos los detalles a tu correo'), 'customer.sent=true: SÍ dice que se enviaron los detalles, aunque exista un emailWarning general');
  ok(!sentConWarning.includes('No pudimos enviar'), 'customer.sent=true: no muestra el mensaje de fallo');

  const noEnviado = CORE.mensajeReservaGuardada(cfg, {
    email: { customer: { sent: false } },
    emailWarning: null,
  }, 'es');
  ok(!/te enviamos los detalles/i.test(noEnviado), 'customer.sent=false: NO afirma que se envió (aunque no haya ningún warning)');
  ok(noEnviado.includes('No pudimos enviar el correo'), 'customer.sent=false: usa el mensaje de fallo');

  const sinEmail = CORE.mensajeReservaGuardada(cfg, { emailWarning: 'RESEND_API_KEY missing' }, 'es');
  ok(!/te enviamos los detalles/i.test(sinEmail), 'sin d.email en absoluto (solo emailWarning): NO afirma que se envió');
  ok(sinEmail.includes('No pudimos enviar el correo'), 'sin d.email: usa el mensaje de fallo (el warning nunca es la fuente principal)');

  // d.emailWarning=truthy pero customer.sent=true igual debe afirmar envío
  // (el warning es del DUEÑO, no del cliente).
  ok(CORE.mensajeReservaGuardada(cfg, { email: { customer: { sent: true } }, emailWarning: 'owner email failed' }, 'en').includes('We sent the details'),
    'en inglés: mismo criterio, el warning no bloquea la afirmación cuando customer.sent===true');
}

console.log('\n12. Condición de carrera del selector de idioma (widget.js) — ejecución real de maybeShowInitialExperience()');
{
  // Se extrae el CUERPO REAL de maybeShowInitialExperience() de widget.js
  // (no se reimplementa) y se ejecuta con estado/DOM simulados, para poder
  // controlar exactamente CUÁNDO "resuelve" la configuración — algo que un
  // test estático (solo grep sobre el código) no puede probar.
  const start = widget.indexOf('function maybeShowInitialExperience()');
  const end = widget.indexOf("fab.addEventListener('click'");
  ok(start !== -1 && end !== -1, 'se encontró el cuerpo real de maybeShowInitialExperience() en widget.js');
  const fnSrc = widget.slice(start, end);

  function makeRun(overrides) {
    const state = Object.assign({
      greeted: false, initialExperienceShown: false, openRequested: false, configReady: false,
      cfg: { language: 'es' },
    }, overrides.state || {});
    const calls = { showLanguageChoice: 0, showGreetingNow: 0, showTyping: 0, hideTyping: 0 };
    const spies = {
      hasLanguageChoice: overrides.hasLanguageChoice || (() => false),
      storedLanguage: overrides.storedLanguage || (() => ''),
    };
    const fn = new Function('state', 'spies', 'calls', `
      var greeted = state.greeted;
      var initialExperienceShown = state.initialExperienceShown;
      var openRequested = state.openRequested;
      var configReady = state.configReady;
      var cfg = state.cfg;
      function hideTyping() { calls.hideTyping++; }
      function showTyping() { calls.showTyping++; }
      function hasLanguageChoice() { return spies.hasLanguageChoice(); }
      function storedLanguage() { return spies.storedLanguage(); }
      function showLanguageChoice() { calls.showLanguageChoice++; }
      function showGreetingNow() { calls.showGreetingNow++; }
      ${fnSrc}
      maybeShowInitialExperience();
      state.greeted = greeted;
      state.initialExperienceShown = initialExperienceShown;
    `);
    return function run() { fn(state, spies, calls); return { state, calls }; };
  }

  console.log('  A) abre antes de resolver config; luego llega config bilingüe -> selector, no saludo');
  {
    const overrides = { hasLanguageChoice: () => true, storedLanguage: () => '' };
    const run = makeRun(overrides);
    // 1) el usuario abre (openRequested=true) MIENTRAS la config sigue cargando
    run().state.openRequested = true;
    var r1 = run();
    ok(r1.calls.showLanguageChoice === 0 && r1.calls.showGreetingNow === 0, 'A: mientras carga, no muestra selector ni saludo');
    ok(r1.calls.showTyping >= 1, 'A: mientras carga, muestra el estado breve de "escribiendo"');
    ok(r1.state.greeted === false, 'A: greeted NUNCA se marca antes de decidir');
    // 2) llega la config (bilingüe)
    r1.state.configReady = true;
    var r2 = run();
    ok(r2.calls.showLanguageChoice === 1 && r2.calls.showGreetingNow === 0, 'A: al llegar la config bilingüe, muestra el selector (no el saludo)');
    ok(r2.state.greeted === true, 'A: greeted queda true recién después de decidir');
  }

  console.log('  B) abre antes de resolver config; luego llega config monolingüe -> un solo saludo');
  {
    const run = makeRun({ hasLanguageChoice: () => false, storedLanguage: () => '' });
    run().state.openRequested = true;
    var r1 = run();
    ok(r1.calls.showGreetingNow === 0 && r1.calls.showLanguageChoice === 0, 'B: mientras carga, tampoco saluda de una');
    r1.state.configReady = true;
    var r2 = run();
    ok(r2.calls.showGreetingNow === 1 && r2.calls.showLanguageChoice === 0, 'B: config monolingüe -> un solo saludo, sin selector');
  }

  console.log('  C) client-config falla -> fallback seguro, sin quedar bloqueado');
  {
    // Config "falla": no hay selector posible (cfg queda con sus valores por
    // defecto), pero configReady igual se marca true para no bloquear.
    const run = makeRun({ hasLanguageChoice: () => false, storedLanguage: () => '' });
    run().state.openRequested = true;
    run().state.configReady = true;   // el .catch()/d===null del fetch real marca configReady=true igual
    var r = run();
    ok(r.calls.showGreetingNow === 1, 'C: con la config caída, igual se muestra el saludo (fallback seguro)');
    ok(r.state.greeted === true, 'C: el widget no queda esperando para siempre');
  }

  console.log('  D) varios clics mientras carga y después -> nunca duplica selector ni saludo');
  {
    const run = makeRun({ hasLanguageChoice: () => true, storedLanguage: () => '' });
    var s;
    for (let i = 0; i < 4; i++) { s = run(); s.state.openRequested = true; }   // varios "clics" mientras carga
    ok(s.calls.showLanguageChoice === 0 && s.calls.showGreetingNow === 0, 'D: ningún clic durante la carga muestra nada todavía');
    s.state.configReady = true;
    for (let i = 0; i < 4; i++) s = run();   // varios "clics" después de que ya está lista
    ok(s.calls.showLanguageChoice === 1, 'D: el selector se muestra UNA sola vez pese a varios clics');
    ok(s.calls.showGreetingNow === 0, 'D: nunca aparece también el saludo duplicado');
  }

  console.log('  E) idioma ya guardado en sessionStorage -> no pregunta, saluda en ese idioma');
  {
    const run = makeRun({ hasLanguageChoice: () => true, storedLanguage: () => 'en' });
    run().state.openRequested = true;
    run().state.configReady = true;
    var r = run();
    ok(r.calls.showLanguageChoice === 0, 'E: no muestra el selector si ya hay idioma guardado');
    ok(r.calls.showGreetingNow === 1, 'E: saluda directamente');
    ok(r.state.cfg.language === 'en', 'E: usa el idioma guardado (en), no vuelve a preguntar ni detecta otro');
  }
}

console.log('');
if (failures) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('✅ Mejora conversacional del chatbot verificada (idioma, catálogo, memoria de servicio, nombre parcial, confirmación final, tono)');
