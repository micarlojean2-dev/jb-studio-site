/* JB Studio — motor de conversación compartido.
 *
 * Única fuente de verdad de la lógica del chat. La usan asistente.html (la
 * página del asistente) y widget.js (el widget embebido en la web del
 * cliente). Antes cada uno tenía su copia: los mismos bugs había que
 * arreglarlos dos veces, y algunos se arreglaron solo en uno.
 *
 * Aquí vive lo que NO depende del DOM: extracción de datos, resolución de
 * horas, intención, limpieza de respuestas, validación de campos e iconos.
 * El pintado (clases a-* frente a jbw-*) sigue en cada archivo: son diseños
 * distintos y unificarlos cambiaría el aspecto, que es justo lo que no se
 * quiere tocar.
 *
 * No usar clases ni IDs aquí dentro.
 */
window.JBChatCore = (function () {
  'use strict';

  // ── Fechas ───────────────────────────────────────────────────────────────
  // Antes había un solo patrón que mezclaba fechas en palabras y numéricas, y
  // el trozo numérico (\d{1,2}[\/-]\d{1,2}) no llevaba \b ni validación: dentro
  // del teléfono "202-555-0147" encontraba "02-55" y lo guardaba como fecha,
  // pisando el "24 de julio" que el cliente había dicho antes.
  //
  // Ahora van separados: las fechas en palabras nunca son ambiguas; las
  // numéricas se anclan con \b, se validan por rango y se desambigua día/mes
  // con el idioma del negocio (07/08 es 7 de agosto en España y 8 de julio en
  // EE.UU.). Lo que se guarda sigue siendo el texto literal del cliente, así
  // que "mañana" y las reservas antiguas siguen funcionando igual.
  var MES_NOM = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';

  var MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
                agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12,
                january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8,
                september:9, october:10, november:11, december:12, jan:1, feb:2, mar:3,
                apr:4, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };

  // Incluye relativos y días de la semana en español E inglés: sin el inglés,
  // "this Friday"/"tomorrow" no se capturaban como fecha y una reserva en inglés
  // no podía completarse nunca (el flujo se quedaba pidiendo la fecha). El
  // backend (parseFechaISO) ya normaliza estos mismos términos en inglés.
  // "Dentro de dos semanas" / "en 3 días" / "next week" nunca coincidían: el
  // cliente lo daba por dicho, el flujo seguía preguntando otros campos como
  // si esa fecha ya estuviera guardada (el modelo la "confirmaba" en su
  // respuesta sin que quedara capturada de verdad) y terminaba atascado
  // pidiendo la fecha de nuevo al final, como si nunca la hubiera dado.
  // [BUG-FECHA-RELATIVA]
  var NUM_TXT_RE = '\\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten|a';
  var FECHA_TEXTO_RE = new RegExp(
    '(pasado\\s+ma(?:ñ|n)ana|ma(?:ñ|n)ana|hoy|' +
    'day\\s+after\\s+tomorrow|tomorrow|today|' +
    '(?:este|el|pr(?:ó|o)ximo|this|next)\\s+(?:lunes|martes|mi(?:é|e)rcoles|jueves|viernes|s(?:á|a)bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|' +
    '(?:lunes|martes|mi(?:é|e)rcoles|jueves|viernes|s(?:á|a)bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|' +
    '\\d{1,2}\\s+de\\s+(?:' + MES_NOM + ')(?:\\s+de\\s+\\d{4})?|' +
    '(?:' + MES_NOM + ')\\s+\\d{1,2}\\b|' +
    '(?:dentro\\s+de|en)\\s+(?:' + NUM_TXT_RE + ')\\s+(?:d[ií]as?|semanas?|mes(?:es)?)|' +
    'in\\s+(?:' + NUM_TXT_RE + ')\\s+(?:days?|weeks?|months?)|' +
    '(?:la\\s+)?(?:pr(?:ó|o)xima\\s+semana|semana\\s+que\\s+viene)|next\\s+week|' +
    '(?:el\\s+)?(?:pr(?:ó|o)ximo\\s+mes|mes\\s+que\\s+viene)|next\\s+month)', 'i');

  var FECHA_ISO_RE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;

  var FECHA_NUM_RE = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/;

  // Una fecha numérica que ocupa todo el fragmento: sirve para no confundir
  // "24-07-2026" con un teléfono al enmascarar.
  var FECHA_NUM_SOLA_RE = /^(?:\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{4}-\d{1,2}-\d{1,2})$/;

  var DIAS_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  function diaValido(d, m) {
    return m >= 1 && m <= 12 && d >= 1 && d <= DIAS_MES[m - 1];
  }

  // Una cita se pide para ahora, no para 1998 ni para el siglo que viene.
  function anioRazonable(y) {
    var actual = new Date().getFullYear();
    return y >= actual - 1 && y <= actual + 10;
  }

  // A bare number may be a party size. Match it only when it carries AM/PM,
  // unless it follows "a las", which is explicit time context.
  var HORA_RE = /(?:(?:a\s+las|at)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?|\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b)/i;

  var HORA_CTX = /(a\s+las|\bat\b|hrs?|horas?|:\d{2}|\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b)/i;

  var PERSONAS_RE = /(?:para|somos|seríamos|serian|ser[ií]amos|for)\s+(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b|\b(\d{1,3}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:personas?|people|ppl)\b/i;

  var NUM_PAL = { un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10 };

  var EMAIL_RE2 = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i;

  var TEL_RE = /(\+?\d[\d\s().-]{6,}\d)/;

  // Borra del texto todo lo que ya sabemos que NO es una fecha antes de
  // buscarla: correos, horas y secuencias largas de dígitos (teléfonos, IDs).
  // Sin esto, cualquier número de contacto puede aportar un falso día/mes.
  function enmascararNoFecha(s) {
    return String(s)
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, ' ') // correos
      .replace(/\b\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?/gi, ' ')         // horas 4:00 PM
      .replace(/\b\d{5,}\b/g, ' ')                                        // IDs largos
      .replace(/\+?\d[\d\s().-]{6,}\d/g, function (m) {
        // "24-07-2026" también encaja en la forma de un teléfono: si el
        // fragmento entero es una fecha numérica, se conserva.
        return FECHA_NUM_SOLA_RE.test(m.trim()) ? m : ' ';
      });
  }

  // Devuelve el texto literal de la fecha que dijo el cliente, o '' si lo que
  // hay no es una fecha válida. Nunca convierte ni normaliza: guardar "24 de
  // julio" tal cual es lo que mantiene compatibles las reservas antiguas.
  function extraerFecha(texto, lang) {
    var t = enmascararNoFecha(texto);

    var iso = t.match(FECHA_ISO_RE);
    if (iso) {
      var y = +iso[1], im = +iso[2], id = +iso[3];
      return (anioRazonable(y) && diaValido(id, im)) ? iso[0] : '';
    }

    var tx = t.match(FECHA_TEXTO_RE);
    if (tx) {
      var bruto = tx[0].trim();
      // "24 de julio" / "julio 24": el día tiene que existir en ese mes.
      var dm = bruto.match(/^(\d{1,2})\s+de\s+/i) || bruto.match(/\s+(\d{1,2})$/);
      if (dm) {
        var nomMes = (bruto.toLowerCase().match(new RegExp(MES_NOM, 'i')) || [])[0];
        var mes = MESES[nomMes];
        if (mes && !diaValido(+dm[1], mes)) return '';
      }
      return bruto;
    }

    var nu = t.match(FECHA_NUM_RE);
    if (nu) {
      var a = +nu[1], b = +nu[2], anio = nu[3] ? +nu[3] : null;
      if (anio !== null) {
        if (anio < 100) anio += 2000;
        if (!anioRazonable(anio)) return '';
      }
      var dia = null, m = null;
      if (a > 12 && b <= 12)      { dia = a; m = b; }   // 24/07 -> solo cabe día primero
      else if (b > 12 && a <= 12) { dia = b; m = a; }   // 07/24 -> solo cabe mes primero
      else if (a <= 12 && b <= 12) {
        // Genuinamente ambiguo (07/08). Se resuelve con el idioma del negocio;
        // si no hay ninguno configurado no adivinamos: al no capturar fecha, el
        // flujo la vuelve a preguntar en vez de inventar un día.
        if (lang === 'en')  { m = a; dia = b; }
        else if (lang)      { dia = a; m = b; }
        else return '';
      }
      if (dia === null || !diaValido(dia, m)) return '';
      return nu[0].trim();
    }

    return '';
  }

  var ICON_RULES = [
      [/masaj|spa|relaj|facial|belle|est[eé]t/i, '💆'],
      [/pelo|corte|barb|peluqu|cabello|afeit/i,  '✂️'],
      [/u[ñn]a|manicur|pedicur/i,                '💅'],
      [/comida|men[uú]|plato|pizza|burger|caf[eé]|bebida|restaur/i, '🍽'],
      [/diente|dental|odont/i,                   '🦷'],
      [/consulta|m[eé]dic|salud|terap/i,         '🩺'],
      [/clase|curso|taller|entren|gym|fitness/i, '🏋'],
      [/foto|video|estudio/i,                    '📸'],
      [/limpieza|hogar|lavad/i,                  '🧼'],
      [/auto|coche|mec[aá]nic/i,                 '🚗'],
    ];

  var MARCADOR_RE = /\[[A-Z_]{3,}\]/g;

  var BOOKING_TRIGGERS = /reservar|agendar|cita|quiero ir|disponibilidad|appointment|reserve|reservation|book(?:ing)?|table|reserva|hora libre|turno|quiero una cita/i;

  // Intención de modificar una reserva activa. Coincidencia por raíz, SIN \b
  // final: en modo ASCII de JS, `\bmodific\b` no casa "modificar" (c→a no es
  // frontera), así que "quiero modificar" no entraba en modo modificar. [BUG-MODIFY]
  var MODIFY_TRIGGERS = /(modific|modify|c[aá]mbi|reprogram|reagenda|mover|mueve|otra hora|otro d[ií]a|otra fecha|change|reschedul|move)/i;

  // Spanish-only before: "I want a manicure on Sunday" named a real service
  // and date but never matched, so pareceReserva() fell through to free chat
  // instead of the structured booking flow. [BUG-INTENT-EN]
  var INTENT_RE = /\b(quiero|quisiera|necesito|me\s+gustar[ií]a|puedo|ap[uú]ntame|ag[eé]ndame|d[ae]me|i\s+want|i\s?'?d\s+like|i\s+need|can\s+i|book\s+me)\b/i;

  var CORRECCION_RE = /(me\s+equivoqu[eé]|cambiar|corregir|est[aá]\s+mal|incorrect[oa]|(?:lo\s+)?puse\s+mal|mejor|en realidad|prefiero)/i;

  // Preguntar el precio/duración de un servicio no es elegirlo: sin esto,
  // "cuánto cuesta el tratamiento facial" durante una reserva de Manicura
  // cambiaba el servicio en curso solo por nombrar el otro. [BUG-PRECIO-SERVICIO]
  var PRICE_QUESTION_RE = /cu[aá]nto\s+(?:cuesta|vale|sale|dura)|qu[eé]\s+precio|price|how\s+much|how\s+long/i;

  var CAMPO_MENCIONADO = [
      [/hora|horario/i, 'hora'], [/fecha|d[ií]a/i, 'fecha'], [/personas?|somos/i, 'personas'],
      [/servicio/i, 'servicio'], [/correo|email/i, 'email'], [/tel[eé]fono|n[uú]mero/i, 'telefono'],
      [/nombre/i, 'nombre'], [/mesa|terraza|ventana/i, 'tablePreference'],
      [/barbero|barbera|estilista/i, 'barberPreference']
    ];

  // A correction without its new value must clear the named field, even after
  // every required field has already been captured.
  function campoCorreccion(text) {
    if (!CORRECCION_RE.test(String(text || ''))) return '';
    for (var i = 0; i < CAMPO_MENCIONADO.length; i++) {
      if (CAMPO_MENCIONADO[i][0].test(text)) return CAMPO_MENCIONADO[i][1];
    }
    return '';
  }

  // ── Nombre completo ────────────────────────────────────────────────────────
  // Partículas que van EN medio de un nombre ("de la Cruz", "del Valle"): se
  // conservan solo si van seguidas de otra palabra de nombre, nunca al final.
  var NOMBRE_PARTICULA = /^(?:de|del|la|las|los|y|e|da|do|dos|van|von|di|van der)$/i;

  // Una palabra de nombre: letras (con tildes/ñ), apóstrofos y guiones internos.
  var NOMBRE_PALABRA = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’.\-]*$/;

  // Palabras que cortan el nombre: verbos y conectores que abren otra idea. Sin
  // esto, "me llamo Ana y prefiero silencio" capturaría "Ana y prefiero".
  var NOMBRE_STOP = /^(?:prefiero|prefieres|necesito|necesita|soy|somos|tengo|tienes|quiero|quieres|quisiera|deseo|pero|porque|para|con|sin|mi|my|me|te|se|es|son|is|gracias|hola|buenas|el|un|una|que|y|además|tambi[eé]n|luego|despu[eé]s|ahora|tel|cel|whatsapp|email|correo|tel[eé]fono|phone)$/i;

  // Reconstruye el nombre a partir del texto que sigue a "me llamo/soy/mi
  // nombre es". Camina palabra a palabra: acepta nombres y partículas, y se
  // detiene en la primera palabra que no forma parte de un nombre. Devuelve ''
  // si no queda nada válido.
  // Separa por espacios Y comas: un mensaje pegado tipo "me llamo mike,mi
  // correo es x@y.com" (típico al pegar varios datos seguidos, sin espacio
  // después de la coma) dejaba "mike,x@y.com" como un solo token, que no
  // pasaba NOMBRE_PALABRA (comas/@ no permitidos) y el nombre completo se
  // perdía. [Objetivo 5 — auditoría, prueba exacta del nombre]
  function limpiarNombre(cadena) {
    var toks = String(cadena || '').trim().split(/[\s,]+/);
    var out = [];
    for (var i = 0; i < toks.length && out.length < 7; i++) {
      var w = toks[i].replace(/[.,;:!?]+$/, '');
      if (!w) break;
      var low = w.toLowerCase();
      if (NOMBRE_PARTICULA.test(low)) {
        var sig = (toks[i + 1] || '').replace(/[.,;:!?]+$/, '');
        // Partícula solo si tras ella viene otra palabra de nombre "de verdad".
        if (sig && NOMBRE_PALABRA.test(sig) && !NOMBRE_STOP.test(sig.toLowerCase())) {
          out.push(low);
          continue;
        }
        break;
      }
      if (NOMBRE_STOP.test(low) || !NOMBRE_PALABRA.test(w) || w.length < 2) break;
      out.push(w);
    }
    while (out.length && NOMBRE_PARTICULA.test(out[out.length - 1])) out.pop();
    return out.join(' ');
  }

  // ── Notas del cliente extraídas de SUS propios mensajes ────────────────────
  // Respaldo de [NOTA:]: si DeepSeek responde en prosa sin emitir el marcador,
  // la preferencia se perdía. Aquí se captura de forma conservadora desde lo que
  // el cliente escribe, sin ninguna llamada extra al modelo. Solo se toman
  // frases con una intención clara de preferencia/restricción; nunca datos
  // estructurados ni cortesías.
  var NOTA_USER_TRIGGER = /(soy\s+al[eé]rgic|tengo\s+alergia|al[eé]rgic[oa]\s+a|prefiero|prefer[ií]a|quisiera\s+(?:una?\s+)?(?:habitaci[oó]n|sala|cuarto)|necesito\s+(?:una?\s+)?(?:habitaci[oó]n|sala|cuarto|silencio|silla|ayuda|espacio|ambiente)|evit[ea]n?\b|sin\s+fragancia|con\s+poca\s+luz|poca\s+luz|habitaci[oó]n\s+silenciosa|ambiente\s+(?:silencioso|tranquilo)|movilidad\s+reducida|silla\s+de\s+ruedas|es\s+mi\s+cumplea[nñ]os|(?:voy|estoy)\s+embarazad|no\s+puedo\s+con|me\s+molesta)/i;

  // Cortesías/genéricos que NUNCA son nota, aunque cuelen por casualidad.
  var NOTA_USER_GENERICO = /^(?:s[ií]|no|ok(?:ay)?|vale|gracias|perfecto|genial|est[aá]\s+bien|de\s+acuerdo|correcto|listo|claro|buenas?|hola|adi[oó]s)[\s.!]*$/i;
  var FOOD_PREFERENCE_TRIGGER = /\b(?:sin|without|no|hold|leave\s+out|don\s+t\s+like|extra|more|less|m[aá]s|poc[ao]|poquit[ao]|little|light|mucho|very|doble|double|con|with|ponle|add|on\s+the\s+side|apart\w*|side|solo|only|bien\s+cocid[ao]|muy\s+cocid[ao]|t[eé]rmino\s+medio|medium\s+rare|well\s+done|rare|cambiar\s+papas|swap)\b/i;
  var FOOD_MEDICAL_TRIGGER = /al[eé]rg|allerg|intoleran|intolerant|cel[ií]ac|celiac|no\s+puedo\s+consumir|cannot\s+(?:eat|have|consume)|contaminaci[oó]n|contamination|reacci[oó]n\s+al[eé]rgica|lactos|dairy/i;

  function limpiarFraseNota(frag) {
    return String(frag || '')
      // Sin datos estructurados dentro de la nota (req.: nada de correo/tel/id).
      .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, ' ')
      .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ')
      .replace(/\b\d{5,}\b/g, ' ')
      // Muletillas de arranque que no aportan a la preferencia.
      .replace(/^(?:y|e|ah+|oye|pues|mira|bueno|adem[aá]s|tambi[eé]n|por\s+cierto|una\s+cosa|otra\s+cosa|eh+)[,\s]+/i, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,;.]+|[\s,;.]+$/g, '')
      .trim();
  }

  function extractNotasUsuario(text, cfg) {
    var t = String(text || '');
    // Trocear en cláusulas por puntuación fuerte, saltos y la conjunción " y ",
    // para separar "mi correo es x@y.com Y prefiero silencio" en dos ideas.
    var clausulas = t.split(/[.;\n]+|\s+\by\b\s+/i);
    var notas = [];
    clausulas.forEach(function (c) {
      var frag = c.trim();
      if (!frag) return;
      var foodPreference = templateId(cfg) === 'restaurant' && FOOD_PREFERENCE_TRIGGER.test(frag);
      var foodMedical = templateId(cfg) === 'restaurant' && FOOD_MEDICAL_TRIGGER.test(frag);
      if (!NOTA_USER_TRIGGER.test(frag) && !foodPreference && !foodMedical) return;
      // "necesito reservar", "quiero una cita": intención de reserva, no nota.
      if (BOOKING_TRIGGERS.test(frag) && !foodPreference && !foodMedical) return;
      var nota = limpiarFraseNota(frag);
      if (nota.length < 3) return;
      if (NOTA_USER_GENERICO.test(nota)) return;
      if (notas.indexOf(nota) === -1) notas.push(nota);
    });
    return notas;
  }

  var RESUMEN_ICONOS = {
      nombre: '👤', servicio: '✂️', fecha: '📅', hora: '⏰',
      personas: '👥', partySize: '👥', telefono: '📞', email: '✉️', contacto: '📞', nota: '📝',
      tablePreference: '🪑', barberPreference: '✂️', specialRequests: '📝'
    };

  var RESUMEN_LABEL = {
      es: { nombre: 'Nombre', servicio: 'Servicio', fecha: 'Fecha', hora: 'Hora',
            personas: 'Personas', partySize: 'Personas', telefono: 'Teléfono', email: 'Correo', contacto: 'Contacto', nota: 'Nota',
             tablePreference: 'Mesa', barberPreference: 'Barbero', specialRequests: 'Peticiones especiales' },
      en: { nombre: 'Name', servicio: 'Service', fecha: 'Date', hora: 'Time',
            personas: 'People', partySize: 'People', telefono: 'Phone', email: 'Email', contacto: 'Contact', nota: 'Note',
             tablePreference: 'Table preference', barberPreference: 'Barber preference', specialRequests: 'Special requests' }
    };

  // Deterministic, template-aware label for a summary field. Critical for i18n:
  // the customer-facing summary must never rely on the model for its labels, and
  // a restaurant's dish is "Platillo/Dish", not "Servicio/Service".
  function summaryLabel(cfg, field, lang) {
    var l = (lang === 'en') ? 'en' : 'es';
    if (field === 'servicio' && templateId(cfg) === 'restaurant') return l === 'en' ? 'Dish' : 'Platillo';
    return (RESUMEN_LABEL[l] && RESUMEN_LABEL[l][field]) || field;
  }

  // ── Reserva activa: lógica y textos compartidos (asistente.html + widget.js) ─
  // Se extraen aquí para que ambas superficies usen EXACTAMENTE lo mismo y no
  // vuelvan a divergir. La parte de DOM (botones, addMsg, fetch) vive en cada
  // superficie; lo determinista (idioma, escalado, resumen, update) vive aquí.
  function genIdempotencyKey() {
    return 'ik' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function reservaResumen(r, lang) {
    r = r || {};
    var en = lang === 'en';
    var partes = [];
    if (r.fecha) partes.push(r.fecha);
    if (r.hora) partes.push(r.hora);
    var base = partes.join(' · ');
    if (r.personas) base += en ? (', ' + r.personas + ' people') : (', ' + r.personas + ' personas');
    return base;
  }

  // Escalado determinista del intento de duplicar: mensaje + nuevo estado.
  function duplicateAttemptState(activeReservation, dupAttempts, spamUntil, now, lang) {
    var en = lang === 'en';
    var nextAttempts = dupAttempts + 1;
    var text, nextSpam = spamUntil;
    if (now < spamUntil || nextAttempts >= 3) {
      nextSpam = now + 60000;
      text = en ? 'To avoid duplicate reservations, please modify or cancel your current one first. 🙏'
                : 'Para evitar reservas duplicadas, primero modifica o cancela tu reserva actual. 🙏';
    } else if (nextAttempts === 1) {
      text = (en ? 'You already have an active reservation for ' : 'Ya tienes una reserva activa para ') +
        reservaResumen(activeReservation, lang) +
        (en ? '. Would you like to modify or cancel it?' : '. ¿Quieres modificarla o cancelarla?');
    } else {
      text = en ? 'To avoid duplicate reservations, please modify or cancel your current one first.'
                : 'Para evitar reservas duplicadas, primero debes modificar o cancelar tu reserva actual.';
    }
    return { text: text, attempts: nextAttempts, spamUntil: nextSpam };
  }

  // Construye el update de modificación desde el texto libre del cliente.
  function buildModifyUpdate(text, cfg, activeReservation) {
    var lang = cfg && cfg.language === 'en' ? 'en' : 'es';
    var upd = extractBooking(text, cfg.menu, cfg.businessHours, cfg.language, cfg);
    delete upd.__horaAmbigua;
    var food = applyFoodPreferences(activeReservation && activeReservation.foodPreferences, text, cfg);
    var update = {};
    if (upd.fecha) update.fecha = upd.fecha;
    if (upd.hora) update.hora = upd.hora;
    if (upd.personas || upd.partySize) update.partySize = upd.personas || upd.partySize;
    if (upd.servicio) update.servicio = upd.servicio;
    if (food) { update.foodPreferences = food; update.specialRequests = foodPreferencesToSpecialRequests(food, lang); }
    return update;
  }

  // Todos los textos de las acciones de reserva, en el idioma del negocio. El
  // modelo no participa: estos textos son fijos y bilingües. [i18n determinista]
  function reservaTextos(lang) {
    var en = lang === 'en';
    return {
      modify: en ? '✏️ Modify' : '✏️ Modificar',
      cancel: en ? '❌ Cancel' : '❌ Cancelar',
      keep: en ? '✅ Keep it' : '✅ Mantener',
      keepMsg: en ? 'No problem — your reservation stays as it is. 😊' : 'Perfecto, tu reserva sigue igual. 😊',
      askChange: en ? 'What would you like to change? Tell me the new date, time, number of people or a preference (e.g. "no onions"). Your other details stay the same.'
                    : '¿Qué quieres cambiar? Dime la nueva fecha, hora, número de personas o una preferencia (por ejemplo "sin cebolla"). Tus demás datos se conservan.',
      noChange: en ? 'No changes made.' : 'No se hizo ningún cambio.',
      needChange: en ? 'Tell me the new date, time, number of people or preference.' : 'Dime la nueva fecha, hora, número de personas o preferencia.',
      cancelled: en ? '✅ Your reservation has been cancelled. You can make a new one whenever you like.' : '✅ Tu reserva fue cancelada. Puedes hacer una nueva cuando quieras.',
      cancelFail: en ? 'I could not cancel it. Please try again.' : 'No pude cancelarla. Inténtalo de nuevo.',
      modifyDone: en ? '✅ Done. Your reservation is now: ' : '✅ Listo. Tu reserva quedó: ',
      modifyUnavail: en ? 'That change is not available: ' : 'Ese cambio no está disponible: ',
      modifyFail: en ? 'I could not modify it. Please try again.' : 'No pude modificarla. Inténtalo de nuevo.',
      closest: en ? ' Closest time: ' : ' Hora más cercana: ',
      notFound: en ? 'I could not find your reservation.' : 'No encontré tu reserva.',
      duplicateActive: en ? 'You already had this reservation — it is still active. ✅' : 'Ya tenías esta reserva registrada, sigue activa. ✅',
      netFail: en ? "Sorry, that didn't go through 😅" : 'Uy, no se envió 😅',
    };
  }

  var BOOKING_STEPS = [
      { field: 'nombre',   ask: { es: '¿Cuál es tu nombre completo?',                           en: 'What is your full name?' } },
      { field: 'telefono', ask: { es: '¿Cuál es tu número de teléfono?',                        en: "What's your phone number?" } },
      { field: 'email',    ask: { es: '¿Cuál es tu email?',                                     en: "What's your email address?" } },
      { field: 'fecha',    ask: { es: '¿Qué fecha prefieres? (ej: 15 de julio)',                 en: 'What date do you prefer? (e.g. July 15)' } },
      { field: 'hora',     ask: { es: '¿A qué hora? (ej: 3:00 PM)',                             en: 'What time? (e.g. 3:00 PM)' } },
      { field: 'servicio', ask: { es: '¿Qué servicio te gustaría?',                                en: 'Which service would you like?' } },
      { field: 'personas', ask: { es: '¿Para cuántas personas sería? (escribe 1 si es solo para ti)', en: 'For how many people? (write 1 if it is just you)' } },
      { field: 'specialRequests', ask: { es: '¿Tienes alguna petición especial? Escribe "No" si no tienes ninguna.', en: 'Do you have any special requests? Write "No" if none.' } },
    ];

  var CANCEL_STEPS = [
      { field: 'contacto', ask: { es: '¿Cuál es el email o teléfono con el que hiciste la reserva?', en: 'What email or phone number did you use to book?' } },
      { field: 'fecha',    ask: { es: '¿Cuál es la fecha de tu reserva? (ej: 15 de julio)',           en: 'What is the date of your reservation? (e.g. July 15)' } },
    ];

  function horasAbiertas(businessHours) {
    var set = {};
    if (!businessHours) return null;
    var vacio = true;
    Object.keys(businessHours).forEach(function (d) {
      var day = businessHours[d];
      if (!day || day.enabled === false || day.unknown) return;
      (day.ranges || []).forEach(function (r) {
        var a = parseInt(String(r.start || '').split(':')[0], 10);
        var b = parseInt(String(r.end || '').split(':')[0], 10);
        if (isNaN(a) || isNaN(b)) return;
        for (var h = a; h <= b; h++) { set[h] = true; vacio = false; }
      });
    });
    return vacio ? null : set;
  }

  function resolverHora(n, minutos, sufijo, businessHours) {
    var mm = minutos ? ':' + minutos : ':00';
    if (sufijo) {                                   // ya lo dijo la persona
      var s = sufijo.toUpperCase().replace(/\./g, '');
      return { hora: n + mm + ' ' + s };
    }
    if (n >= 13 && n <= 23) return { hora: n + mm };  // formato 24h, sin duda
    if (n === 0) return { hora: '12' + mm + ' AM' };
    if (n === 12) return { hora: '12' + mm + ' PM' };

    var abiertas = horasAbiertas(businessHours);
    if (!abiertas) return { ambigua: n, mm: mm };     // sin horario: preguntar
    var am = !!abiertas[n], pm = !!abiertas[n + 12];
    if (pm && !am) return { hora: n + mm + ' PM' };
    if (am && !pm) return { hora: n + mm + ' AM' };
    return { ambigua: n, mm: mm };                    // ambas o ninguna: preguntar
  }

  function templateId(cfg) {
    var id = cfg && (cfg.templateId || (cfg.config && cfg.config.templateId));
    return id === 'restaurant' || id === 'barber' ? id : '';
  }

  function configuredStaff(cfg) {
    var config = (cfg && cfg.config) || {};
    var staff = cfg && (cfg.staff || cfg.barbers) || config.staff || config.barbers;
    return Array.isArray(staff) ? staff : [];
  }

  // Orden fijo: primero lo que define LA CITA (qué, cuándo), después los
  // datos de contacto de quien la pide. Antes se pedía nombre/teléfono/correo
  // antes que servicio/fecha/hora, así que alguien que ya había dicho
  // "quiero reservar el masaje el viernes" volvía a que le preguntaran su
  // nombre antes de seguir con lo que ya había dicho — se sentía como que el
  // asistente "olvidaba" lo que acababa de escribir. [BUG-ORDEN-RESERVA]
  function bookingRequirements(cfg, data) {
    var template = templateId(cfg);
    var required = template === 'restaurant'
        ? ['fecha', 'hora', 'personas', 'nombre', 'contacto', 'email', 'specialRequests']
      : template === 'barber'
        ? ['servicio', 'fecha', 'hora', 'nombre', 'contacto', 'email', 'specialRequests']
        : ['servicio', 'fecha', 'hora', 'nombre', 'telefono', 'email', 'specialRequests'];
    return required.filter(function (field) {
      if (field === 'contacto') return !(data.telefono || data.email || data.contacto);
      if (field === 'specialRequests') return data.specialRequests === undefined;
      // Nombre de una sola palabra: se pide confirmación natural antes de
      // darlo por completo, sin perderlo (sigue en data.nombre) ni volver a
      // preguntarlo desde cero. [Objetivo 5]
      if (field === 'nombre') {
        if (!data.nombre) return true;
        return esNombreUnaPalabra(data.nombre) && data.__nombreConfirmado !== true;
      }
      return !data[field];
    });
  }

  function summaryFields(cfg) {
    var template = templateId(cfg);
    if (template === 'restaurant') return ['nombre', 'servicio', 'personas', 'fecha', 'hora', 'tablePreference', 'telefono', 'email', 'specialRequests'];
    if (template === 'barber') return ['nombre', 'servicio', 'fecha', 'hora', 'barberPreference', 'telefono', 'email', 'specialRequests'];
    return ['nombre', 'servicio', 'fecha', 'hora', 'personas', 'telefono', 'email', 'specialRequests'];
  }

  function extractBooking(text, menu, businessHours, lang, cfg) {
    var t = String(text || '');
    var out = {};

    // Servicio: solo nombres reales del catálogo. Nunca se inventa uno.
    if (Array.isArray(menu)) {
      var low = t.toLowerCase();
      var exacto = null, exactoIndex = -1, porPalabra = null;
      menu.forEach(function (m) {
        if (!m || !m.nombre) return;
        var n = String(m.nombre).toLowerCase();
        // El nombre completo en el texto gana siempre: "corte + barba" debe
        // ganar a "corte caballero", que solo coincide por la primera palabra.
      if (low.indexOf(n) !== -1) {
        var matchIndex = low.lastIndexOf(n);
        // The last named menu item wins: "hamburguesa, mejor pizza" means pizza.
        if (!exacto || matchIndex > exactoIndex || (matchIndex === exactoIndex && n.length > exacto.toLowerCase().length)) { exacto = m.nombre; exactoIndex = matchIndex; }
          return;
        }
        var head = n.split(/\s+/)[0].replace(/[^a-záéíóúñ]/gi, '');
        if (head.length >= 4 && new RegExp('\\b' + head, 'i').test(low)) {
          if (!porPalabra) porPalabra = m.nombre;
        }
      });
      var elegido = exacto || porPalabra;
      if (elegido && !PRICE_QUESTION_RE.test(t)) out.servicio = elegido;
    }

    var f = extraerFecha(t, lang);
    if (f) out.fecha = f;

    if (HORA_CTX.test(t)) {
      var h = t.match(HORA_RE);
      if (h) {
        var hh = parseInt(h[1] || h[4], 10);
        if (hh >= 0 && hh <= 23) {
          var r = resolverHora(hh, h[2] || h[5], h[3] || h[6], businessHours);
          if (r && r.hora) out.hora = r.hora;
          else if (r && r.ambigua) out.__horaAmbigua = { n: r.ambigua, mm: r.mm };
        }
      }
    }

    var p = t.match(PERSONAS_RE);
    if (p) {
      var raw = (p[1] || p[2] || '').toLowerCase();
      var n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NUM_PAL[raw];
      if (n >= 1 && n <= 200) out.personas = String(n);
    }

    if (templateId(cfg) === 'restaurant') {
      var mesa = t.match(/\b(mesa\s+(?:junto|cerca|al lado|en|para)\s+[^,.;!?]{2,80}|terraza|ventana|interior|exterior)\b/i);
      if (mesa) out.tablePreference = mesa[1].trim();
    }
    if (templateId(cfg) === 'barber') {
      var lowText = t.toLowerCase();
      configuredStaff(cfg).some(function (entry) {
        var name = typeof entry === 'string' ? entry : (entry.name || entry.id || '');
        if (!name) return false;
        var escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp('\\b(?:con|barbero|barbera|estilista)\\s+' + escaped + '\\b', 'i').test(lowText)) {
          out.barberPreference = name;
          return true;
        }
        return false;
      });
    }

    // El nombre solo se toma si la persona lo marca ("soy Ana", "me llamo…").
    // Sin marcador, en texto libre se confunde con cualquier palabra.
    // "soy X" es ambiguo: "soy Ana" es un nombre, pero "soy alérgico a los
    // aceites" o "soy vegetariano" es un estado, no un nombre. Sin este filtro,
    // una preferencia dicha con "soy…" pisaba el nombre ya capturado. "me llamo"
    // y "mi nombre es" no son ambiguos y no necesitan el filtro.
    // Antes solo se capturaban dos palabras, así que "Prueba Fecha Playwright" o
    // "María José de la Cruz" se guardaban a medias. Ahora se toma la secuencia
    // completa de palabras de nombre, conservando partículas (de, del, la, y…) y
    // cortando en cuanto aparece algo que no es nombre (un verbo, una nota…).
    var nm = t.match(/\b(?:soy|me\s+llamo|mi\s+nombre\s+es|my\s+name\s+is|i\s+am)\s+(.+)/i);
    if (nm) {
      var primera = nm[1].trim().split(/\s+/)[0].toLowerCase().replace(/[.,;:]+$/, '');
      var noNombre = /^(que|quien|el|la|un|una|para|de|del|al[eé]rgic[oa]|allergic|vegetarian[oa]?|vegan[oa]?|celiac[oa]?|diab[eé]tic[oa]|intolerante|intolerant|nuev[oa]|client[ea]|puntual|flexible|mayor|menor|estudiante|jubilad[oa]|sensible|zurd[oa])$/i.test(primera);
      // "soy alérgico A los aceites", "soy vegetariano DE toda la vida": tras el
      // candidato viene un complemento -> es una descripción, no un nombre.
      var complemento = new RegExp('\\bsoy\\s+' + primera.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(a|al|de|con|sin|muy|desde|por)\\b', 'i').test(t);
      if (!noNombre && !complemento) {
        var nombre = limpiarNombre(nm[1]);
        if (nombre) out.nombre = nombre;
      }
    }

    var e = t.match(EMAIL_RE2);
    if (e) out.email = e[0];

    // A pasted intake often begins with "Ana, ana@example.com". Require its
    // comma separator so prose such as "mi correo es ana@example.com" is not
    // mistaken for a name.
    var beforeEmailRaw = out.email ? t.slice(0, t.indexOf(out.email)) : '';
    var pastedName = beforeEmailRaw.match(/(?:^|[.;]\s*)([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ' -]{0,79})\s*,\s*$/);
    if (!out.nombre && pastedName) {
      out.nombre = pastedName[1].trim();
    }

    // Buscar el teléfono fuera del email: si no, los dígitos de "x1@y.com"
    // se colaban como número, o el email hacía perder el teléfono entero.
    // La fecha se excluye por lo mismo: "24-07-2026" tiene forma de teléfono
    // (8 dígitos y guiones) y si no se saca acaba guardada como número.
    var sinEmail = out.email ? t.replace(out.email, ' ') : t;
    if (out.fecha) sinEmail = sinEmail.replace(out.fecha, ' ');
    var tel = sinEmail.match(TEL_RE);
    if (tel && tel[0].replace(/\D/g, '').length >= 7) out.telefono = tel[0].trim();

    // Si el cliente ya dice "no tengo petición especial" mientras contesta
    // OTRO dato pendiente (ej. el teléfono), esto lo captura igual que el
    // resto de campos de este mensaje. Sin esto, el campo pendiente actual se
    // guardaba pero la petición especial adelantada se perdía y el asistente
    // volvía a preguntarla como si nunca la hubiera dicho. [BUG-MEMORIA-ADELANTADA]
    if (NO_SPECIAL_MENTION_RE.test(t)) out.specialRequests = '';

    return out;
  }

  function limpiarMarkdown(t) {
      return t
        .replace(/```[a-z]*\n?/gi, '')          // vallas de código
        .replace(/\*\*(.+?)\*\*/g, '$1')       // **negrita**
        .replace(/__(.+?)__/g, '$1')            // __negrita__
        .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1$2')  // *cursiva*, sin tocar 2*3
        .replace(/(^|[\s(])_(?!\s)([^_\n]+?)_(?=[\s).,;:!?]|$)/g, '$1$2')      // _cursiva_
        .replace(/`([^`\n]+)`/g, '$1')          // `código`
        .replace(/^#{1,6}\s+/gm, '')            // ### títulos
        .replace(/^\s*[-*+]\s+/gm, '• ')        // viñetas markdown -> punto
        .replace(/^\s*>\s?/gm, '');             // citas
    }

  // Saneado central del texto del asistente. Es la ÚNICA función que decide qué
  // se ve: se usa antes de renderizar, antes de persistir en sessionStorage y al
  // restaurar historial viejo. Quita markdown y TODOS los marcadores internos
  // ([MOSTRAR_MENU], [RESERVA_CONFIRMADA]…) y también [NOTA: ...], que lleva
  // minúsculas y dos puntos y por eso no encajaba en MARCADOR_RE. Los corchetes
  // normales en minúscula ("[opcional]") no se tocan: MARCADOR_RE exige MAYÚS y
  // NOTA_RE exige el prefijo "NOTA:".
  function limpiarMarcadores(txt) {
      return limpiarMarkdown(String(txt || ''))
        .replace(NOTA_RE, '')
        .replace(MARCADOR_RE, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

  // Notas del cliente: DeepSeek, durante el flujo de reserva, marca las frases
  // importantes que el cliente dice espontáneamente con [NOTA: ...]. Aquí se
  // extraen (sin llamada extra al modelo) y se quitan del texto visible. Solo se
  // conserva lo que el cliente dijo; el modelo tiene prohibido inventar.
  var NOTA_RE = /\[NOTA:\s*([^\]]{1,300})\]/gi;

  function extractNotas(text) {
      var t = String(text || '');
      var notas = [];
      var m;
      NOTA_RE.lastIndex = 0;
      while ((m = NOTA_RE.exec(t)) !== null) {
        var v = m[1].trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
        if (v && notas.indexOf(v) === -1) notas.push(v);
      }
      var limpio = t.replace(NOTA_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      return { notas: notas, limpio: limpio };
    }

  // Acumula notas nuevas en la nota existente, sin duplicar, como un solo texto.
  // El de-dup compara en forma normalizada (minúsculas, espacios colapsados, sin
  // puntuación final): así "prefiero una habitación silenciosa" (del cliente) y
  // "Prefiero una habitación silenciosa." (reescrita por DeepSeek en [NOTA:]) no
  // entran las dos. Se conserva la primera aparición, con su texto original.
  function normNota(s) {
      return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?¿¡]+$/, '').trim();
    }
  function fusionarNotas(prev, nuevas) {
      var base = String(prev || '').split(/\s+·\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
      var vistos = {};
      base.forEach(function (b) { vistos[normNota(b)] = true; });
      (nuevas || []).forEach(function (n) {
        var v = String(n || '').trim();
        var k = normNota(v);
        if (v && k && !vistos[k]) { vistos[k] = true; base.push(v); }
      });
      return base.join(' · ');
    }

  function isFoodMedical(text, cfg) {
    return templateId(cfg) === 'restaurant' && FOOD_MEDICAL_TRIGGER.test(String(text || ''));
  }

  function emptyFoodPreferences() {
    return { remove: [], add: [], extra: [], cooking: '', spice: '', notes: [] };
  }

  function hasWord(text, words) {
    return words.some(function (word) { return new RegExp('(?:^|\\s)' + word + '(?:$|\\s|[.,;!?])', 'i').test(text); });
  }

  // Normalized food preferences are the source of truth. The rendered text is
  // derived later, so a customer's latest decision replaces its earlier one.
  function applyFoodPreferences(previous, text, cfg) {
    if (templateId(cfg) !== 'restaurant') return null;
    var source = String(text || '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-záéíóúüñ\s-]/gi, ' ');
    if (!FOOD_PREFERENCE_TRIGGER.test(source)) return null;
    var out = previous && typeof previous === 'object' ? {
      remove: (previous.remove || []).slice(), add: (previous.add || []).slice(), extra: (previous.extra || []).slice(),
      cooking: previous.cooking || '', spice: previous.spice || '', notes: (previous.notes || []).slice(),
    } : emptyFoodPreferences();
    var ingredients = [
      ['cheese', ['queso', 'keso', 'qeso', 'cheese']], ['onions', ['cebolla', 'cebollas', 'seboya', 'onion', 'onions']],
      ['tomatoes', ['tomate', 'tomates', 'tomato', 'tomatoes']], ['pickles', ['pepinillo', 'pepinillos', 'pickle', 'pickles']],
      ['mayo', ['mayonesa', 'mayo']], ['mustard', ['mostaza', 'mustard']], ['ketchup', ['catsup', 'ketchup']],
      ['ice', ['hielo', 'ice']], ['bacon', ['tocino', 'bacon']], ['meat', ['carne', 'meat']], ['sauce', ['salsa', 'sauce']],
    ];
    function removeFrom(list, item) { return list.filter(function (x) { return x !== item; }); }
    function setIngredient(item, mode) {
      out.remove = removeFrom(out.remove, item); out.add = removeFrom(out.add, item); out.extra = removeFrom(out.extra, item);
      if (mode === 'remove') out.remove.push(item);
      if (mode === 'add') out.add.push(item);
      if (mode === 'extra') out.extra.push(item);
    }
    ingredients.forEach(function (entry) {
      if (!hasWord(source, entry[1])) return;
      var escaped = entry[1].join('|');
      var nearRemove = new RegExp('(?:sin|without|no|hold|leave\\s+out|quitar)\\s+(?:the\\s+)?(?:' + escaped + ')', 'i');
      var nearExtra = new RegExp('(?:extra|more|m[aá]s|doble|double)\\s+(?:' + escaped + ')', 'i');
      var nearLight = new RegExp('(?:poc[ao]|poquit[ao]|little|light)\\s+(?:' + escaped + ')', 'i');
      var nearAdd = new RegExp('(?:con|with|add|ponle|d[eé]jale)\\s+(?:the\\s+)?(?:' + escaped + ')', 'i');
      if (nearRemove.test(source) || (/(?:no\s+me\s+gusta|don\s+t\s+like)/i.test(source) && entry[0] === 'cheese')) setIngredient(entry[0], 'remove');
      else if (nearExtra.test(source)) setIngredient(entry[0], 'extra');
      else if (nearAdd.test(source) || (/(?:solo|only)\s+/i.test(source) && entry[0] === 'onions')) setIngredient(entry[0], 'add');
      else if (nearLight.test(source) && entry[0] === 'sauce') {
        out.extra = removeFrom(out.extra, 'sauce');
        out.notes = out.notes.filter(function (x) { return x !== 'sauce_on_side'; });
        if (out.notes.indexOf('light_sauce') === -1) out.notes.push('light_sauce');
      }
    });
    if (/(salsa|sauce|aderezo|dressing).{0,20}(apart\w*|on the side)|(?:apart\w*|on the side).{0,20}(salsa|sauce|aderezo|dressing)/i.test(source)) {
      if (out.notes.indexOf('sauce_on_side') === -1) out.notes.push('sauce_on_side');
    }
    if (/(bien|muy)\s+cocid|well\s+done/i.test(source)) out.cooking = 'well_done';
    else if (/t[eé]rmino\s+medio|medium\s+rare/i.test(source)) out.cooking = 'medium_rare';
    else if (/\brare\b|poco\s+cocid/i.test(source)) out.cooking = 'rare';
    if (/(sin|no|less|poco|poca|light).{0,12}(?:picante|spicy)|not\s+spicy/i.test(source)) out.spice = 'no_spice';
    else if (/(mucho|extra|more|very).{0,12}(?:picante|spicy)|extra\s+spicy/i.test(source)) out.spice = 'extra_spicy';
    if (/cambiar\s+papas\s+por\s+ensalada|swap\s+(?:fries|potatoes)\s+(?:for|with)\s+salad/i.test(source) && out.notes.indexOf('swap_fries_salad') === -1) out.notes.push('swap_fries_salad');
    return out;
  }

  function foodPreferencesToSpecialRequests(food, lang) {
    if (!food) return '';
    var en = lang === 'en';
    var names = en ? { cheese: 'cheese', onions: 'onions', tomatoes: 'tomatoes', pickles: 'pickles', mayo: 'mayo', mustard: 'mustard', ketchup: 'ketchup', ice: 'ice', bacon: 'bacon', meat: 'meat', sauce: 'sauce' } : { cheese: 'queso', onions: 'cebolla', tomatoes: 'tomate', pickles: 'pepinillos', mayo: 'mayonesa', mustard: 'mostaza', ketchup: 'ketchup', ice: 'hielo', bacon: 'tocino', meat: 'carne', sauce: 'salsa' };
    var lines = [];
    (food.remove || []).forEach(function (x) { lines.push((en ? 'No ' : 'Sin ') + (names[x] || x)); });
    (food.add || []).forEach(function (x) { lines.push((en ? 'With ' : 'Con ') + (names[x] || x)); });
    (food.extra || []).forEach(function (x) { lines.push('Extra ' + (names[x] || x)); });
    if (food.cooking) lines.push((en ? { well_done: 'Well done', medium_rare: 'Medium rare', rare: 'Rare' } : { well_done: 'Bien cocida', medium_rare: 'Término medio', rare: 'Poco cocida' })[food.cooking]);
    if (food.spice) lines.push(food.spice === 'no_spice' ? (en ? 'Less spicy' : 'Sin picante') : (en ? 'Extra spicy' : 'Extra picante'));
    (food.notes || []).forEach(function (x) { lines.push((en ? { sauce_on_side: 'Sauce on the side', light_sauce: 'Light sauce', swap_fries_salad: 'Swap fries for salad' } : { sauce_on_side: 'Salsa aparte', light_sauce: 'Poca salsa', swap_fries_salad: 'Cambiar papas por ensalada' })[x] || x); });
    return lines.filter(Boolean).join(' · ');
  }

  // "No tengo ninguna petición especial, por cierto mi correo es X" debe
  // limpiarse a '' igual que un "no" aislado — antes solo se reconocía el
  // "no" exacto y sin nada más alrededor, así que una respuesta real mezclada
  // con un dato repetido quedaba guardada como una frase larga y desordenada
  // en vez de vacía. [BUG-MEMORIA-REPETIDA]
  // "No tengo" (sin "ninguna") y "no tengo petición especial" (sin "ninguna")
  // no se reconocían: un cliente que contestaba así se quedaba con esa frase
  // guardada tal cual como su "petición especial" en vez de quedar vacía. [BUG-SIN-PETICION-TENGO]
  var SIN_PETICION_RE = /^(no|ninguna|ninguno|no\s+tengo)$|\bno\s+tengo\s+(?:ning|petici[oó]n(?:es)?\s+especial(?:es)?)|\bsin\s+petici[oó]n(?:es)?\s+especial(?:es)?\b|\bninguna\s+petici[oó]n\s+especial(?:es)?\b/i;
  function esSinPeticionEspecial(t) {
    return SIN_PETICION_RE.test(String(t || '').trim());
  }

  // A diferencia de SIN_PETICION_RE (que solo aplica cuando specialRequests es
  // el campo pendiente de ESTE turno), esta variante solo reconoce las formas
  // largas e inequívocas ("no tengo petición especial", "sin petición
  // especial") para poder capturarlas de un mensaje que responde OTRA
  // pregunta a la vez (ej. "mi teléfono es X y no tengo petición especial").
  // Las formas cortas ("no", "no tengo") quedan fuera a propósito: un "no"
  // suelto en cualquier punto de la conversación no siempre habla de la
  // petición especial. [BUG-MEMORIA-ADELANTADA]
  var NO_SPECIAL_MENTION_RE = /\bno\s+tengo\s+petici[oó]n(?:es)?\s+especial(?:es)?\b|\bsin\s+petici[oó]n(?:es)?\s+especial(?:es)?\b|\bninguna\s+petici[oó]n\s+especial(?:es)?\b/i;

  function valorValido(field, t) {
      if (field === 'email')    return EMAIL_RE2.test(t) || /^(no|ninguno|skip|omitir)$/i.test(t.trim());
      if (field === 'telefono') return t.replace(/\D/g, '').length >= 7;
      if (field === 'contacto') return EMAIL_RE2.test(t) || t.replace(/\D/g, '').length >= 7;
      if (field === 'personas') return /\d|\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.test(t);
      if (field === 'nombre') {
        // Una pregunta, una confirmación ("sí, todo correcto") o un "no" aislado
        // no son un nombre real: sin esto, se guardaban tal cual como el
        // "Nombre" del cliente cuando esos textos llegaban con "nombre" como
        // campo pendiente. [BUG-NOMBRE-PENDIENTE]
         var s = String(t || '').trim();
         if (!s || /[?¿]/.test(s)) return false;
         if (/^(no|ninguno|ninguna)$/i.test(s)) return false;
         if (PRICE_QUESTION_RE.test(s) || esConfirmacion(s)) return false;
         if (/^(?:ya\s+te\s+lo\s+dije|eso\s+mismo|te\s+dije\s+antes|como\s+te\s+dije)$/i.test(s)) return false;
         return /^[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ' -]{0,79}$/.test(s);
      }
      return true;
    }

  function pareceReserva(t, extraido) {
      if (BOOKING_TRIGGERS.test(t)) return true;
      if (!INTENT_RE.test(t)) return false;
      return !!(extraido.servicio && (extraido.fecha || extraido.hora));
    }

  function isPopular(item) {
      return item.popular === true || item.destacado === true ||
             /^(popular|destacado|favorito)$/i.test(String(item.etiqueta || '').trim());
    }

  // ── Copys del catálogo (tarjetas de servicio + galería general) ───────────
  // Única fuente para el texto que widget.js y asistente.html renderizan;
  // evita que las dos copias del DOM diverjan en el wording (como pasó con
  // CORRECCION_RE). [BLOQUE-1-GALERIA]
  function galleryHeading(lang) {
    return lang === 'en' ? 'Business gallery' : 'Galería del negocio';
  }

  function bookServiceLabel(lang) {
    return lang === 'en' ? 'Book this service' : 'Reservar este servicio';
  }

  function bookServiceMessage(nombre, lang, isRestaurant) {
    var en = lang === 'en';
    var nom = nombre || (isRestaurant ? (en ? 'this dish' : 'este plato') : (en ? 'this service' : 'este servicio'));
    if (en) return (isRestaurant ? 'I want to book this dish: ' : 'I want to book: ') + nom;
    return (isRestaurant ? 'Quiero reservar este plato: ' : 'Quiero reservar: ') + nom;
  }

  // Pregunta de "petición especial" del paso de reserva. Vivía duplicada en
  // widget.js y asistente.html; el branch de barbería y el general (belleza)
  // nunca tuvieron versión en inglés, así que un cliente en inglés recibía la
  // pregunta en español seguida solo de la frase final traducida — un mensaje
  // mezclando los dos idiomas. [BUG-BOOKING-LANG]
  function specialRequestsQuestion(templateId, lang) {
    var en = lang === 'en';
    var ask = templateId === 'restaurant'
      ? (en ? 'Do you have any allergy, intolerance, table preference, or special request?' : '¿Tienes alguna alergia, intolerancia, preferencia de mesa o petición especial?')
      : templateId === 'barber'
        ? (en ? 'Do you have any style, design, sensitivity, or special request?' : '¿Tienes alguna preferencia de estilo, diseño, sensibilidad o petición especial?')
        : (en ? 'Do you have any sensitivity, allergy, pregnancy, injury, or special request?' : '¿Tienes alguna sensibilidad, alergia, embarazo, lesión o petición especial?');
    return ask + (en ? ' Write "No" if you do not have one.' : ' Escribe "No" si no tienes ninguna.');
  }

  function iconFor(nombre) {
      var t = String(nombre || '');
      for (var i = 0; i < ICON_RULES.length; i++) {
        if (ICON_RULES[i][0].test(t)) return ICON_RULES[i][1];
      }
      return '✨';
    }

  function hexToRgba(hex, a) {
      var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
      if (!m) return 'rgba(26,74,46,' + a + ')';
      return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
    }
  // Devuelve el primer campo sin rellenar, o -1 si ya está todo.
  function nextMissingIndex(bookingData) {
    for (var i = 0; i < BOOKING_STEPS.length; i++) {
      var f = BOOKING_STEPS[i].field;
      if (bookingData[f]) continue;
      // personas y nota son opcionales: se auto-llenan y no bloquean el flujo
      if (f === 'personas') { bookingData[f] = '1'; continue; }
      if (f === 'nota')     { bookingData[f] = '';  continue; }
      return i;
    }
    return -1;
  }

  function askConProgreso(i, lang) {
    var etiqueta = (lang === 'en' ? 'Step ' : 'Paso ') + (i + 1) + '/' + BOOKING_STEPS.length;
    return etiqueta + '\n' + BOOKING_STEPS[i].ask[lang];
  }

  function resumenDeLoCapturado(data, lang) {
    var L = RESUMEN_LABEL[lang];
    return ['nombre', 'servicio', 'fecha', 'hora', 'personas', 'telefono', 'email']
      .filter(function (k) { return data[k]; })
      .map(function (k) { return RESUMEN_ICONOS[k] + ' ' + L[k] + ': ' + data[k]; })
      .join('\n');
  }

  function lineasResumen(data, lang) {
    var L = RESUMEN_LABEL[lang];
    return ['nombre', 'servicio', 'fecha', 'hora', 'personas', 'telefono', 'email']
      .filter(function (k) { return data[k]; })
      .map(function (k) { return RESUMEN_ICONOS[k] + ' ' + L[k] + ': ' + data[k]; });
  }

  // Saludo y acciones rápidas: el texto es común; los botones los pinta cada
  // superficie con sus clases.
  function greeting(cfg, puedeReservar) {
    var n = cfg.businessName || (cfg.language === 'en' ? 'this business' : 'este negocio');
    var restaurant = templateId(cfg) === 'restaurant';
    if (cfg.language === 'en') {
      if (restaurant) return "Hi! 😊 I'm " + n + "'s assistant.\n\nI can help you with:\n\n🍽️ Explore the menu\n" + (puedeReservar ? '📅 Reserve a table\n' : '') + '💰 Check prices\n\nWhat would you like?';
      return "Hi! 😊 I'm " + n + "'s assistant.\n\nI can help you with:\n\n" +
             '✨ Discover our services\n' +
             (puedeReservar ? '📅 Book an appointment\n' : '') +
             '💰 Check prices\n\n' +
             'What do you need?';
    }
    if (restaurant) return '¡Hola! 😊 Soy el asistente de ' + n + '.\n\nPuedo ayudarte con:\n\n🍽️ Conocer el menú\n' + (puedeReservar ? '📅 Reservar una mesa\n' : '') + '💰 Consultar precios\n\n¿Qué te gustaría ver?';
    return '¡Hola! 😊 Soy el asistente de ' + n + '.\n\nPuedo ayudarte con:\n\n' +
           '✨ Conocer nuestros servicios\n' +
           (puedeReservar ? '📅 Reservar una cita\n' : '') +
           '💰 Consultar precios\n\n' +
           '¿Qué necesitas?';
  }

  function accionesRapidas(cfg, puedeReservar) {
    var en = cfg.language === 'en';
    if (templateId(cfg) === 'restaurant') {
      var menu = [{ label: en ? '🍽️ See menu' : '🍽️ Ver menú', msg: en ? 'I want to see the menu' : 'Quiero ver el menú' }];
      if (puedeReservar) menu.push({ label: en ? '📅 Reserve table' : '📅 Reservar mesa', msg: en ? 'I want to reserve a table' : 'Quiero reservar una mesa' });
      menu.push({ label: en ? '💰 Prices' : '💰 Precios', msg: en ? 'What are the menu prices?' : '¿Cuáles son los precios del menú?' });
      return menu;
    }
    var a = [{ label: en ? '✨ See services' : '✨ Ver servicios',
               msg: en ? 'I want to see the services' : 'Quiero ver los servicios' }];
    if (puedeReservar) {
      a.push({ label: en ? '📅 Book' : '📅 Reservar',
               msg: en ? 'I want to book an appointment' : 'Quiero reservar una cita' });
    }
    a.push({ label: en ? '💰 Prices' : '💰 Precios',
             msg: en ? 'What are your prices?' : '¿Cuáles son los precios?' });
    return a;
  }

  // Un negocio sin configurar no puede tomar reservas: el servidor las
  // rechazaría. Mismo criterio permisivo que el servidor para los clientes
  // legacy, que no tienen objeto features.
  function featureOn(cfg, key) {
    if ((key === 'reservations' || key === 'cancellation') && cfg.needsSetup === true) return false;
    return !cfg.features || cfg.features[key] !== false;
  }

  // ¿Estás leyendo arriba? Entonces no te movemos.
  function estaAlFondo(el) {
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function irAlFondo(el, forzar) {
    if (!el) return;
    if (forzar || estaAlFondo(el)) el.scrollTop = el.scrollHeight;
  }

  // ¿El mensaje es una confirmación natural del resumen ("sí", "todo
  // correcto", "confirmar")? Se normaliza (sin acentos ni puntuación) y se
  // rechaza si hay señales de cambio, para que "sí, mejor a la 1" NO confirme.
  // "todo está correcto" (con "está", no solo "correcto"/"bien") no se
  // reconocía: caía al mismo camino que un dato nuevo, lo que dejaba el
  // resumen sin responder con el aviso de "toca el botón" — en su lugar volvía
  // a mostrar el resumen entero. [BUG-CONFIRMACION-VARIANTE]
  var CONFIRMACIONES = /^(si|si todo correcto|si todo bien|si esta bien|si correcto|si confirma|si confirmar|si confirmo|si adelante|si dale|confirmar|confirma|confirma la cita|confirmame la cita|confirmo|confirmo la cita|quiero confirmar|hazla|todo correcto|todo esta correcto|todo bien|todo esta bien|esta bien|esta correcto|correcto|adelante|dale|de acuerdo|ok|okay|listo|perfecto|si por favor)$/;
  var CONFIRMACIONES_EN = /^(yes|yes confirm|yes confirm it|yes confirm my appointment|confirm|confirm it|confirm my appointment|i confirm|please confirm|go ahead|that is correct|everything is correct|everything looks good|looks good|all good|correct|okay|ok|sure)$/;
  function esConfirmacion(t, lang) {
    var s = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return false;
    if (/\b(cambiar|corregir|equivoq|mejor|otra|otro|modif|no |cancel)\b/.test(s)) return false;
    return CONFIRMACIONES.test(s) || (lang === 'en' && CONFIRMACIONES_EN.test(s));
  }

  // ── Selector inicial de idioma (compartido: nunca depende de templateId) ──
  // Antes solo se ofrecía cuando templateId==='spa'; cualquier otro negocio
  // (barbería, restaurante) con cfg.languages: ['es','en'] configurado nunca
  // mostraba el selector. La única condición real es que el negocio haya
  // declarado ambos idiomas — el resto (frontend, botones, booking, errores,
  // /api/client-chat) ya sigue a cfg.language una vez que este queda fijado.
  function hasLanguageChoice(cfg) {
    return !!(cfg && Array.isArray(cfg.languages) &&
      cfg.languages.indexOf('es') !== -1 && cfg.languages.indexOf('en') !== -1);
  }

  function languageChoiceCopy() {
    return {
      prompt: 'Selecciona tu idioma / Choose your language',
      options: [
        { lang: 'es', label: '🇪🇸 Español' },
        { lang: 'en', label: '🇺🇸 English' },
      ],
    };
  }

  // ── Memoria del servicio elegido ─────────────────────────────────────────
  // Un servicio mencionado en chat libre, elegido en una tarjeta o tomado del
  // catálogo se recuerda aunque el cliente no esté todavía en modo reserva:
  // al iniciar una, se usa como respaldo si el mensaje que la dispara no
  // vuelve a nombrar el servicio. No se lee del historial del modelo — es el
  // frontend quien decide y persiste este estado.
  function resolveServicio(bookingData, selectedService) {
    return (bookingData && bookingData.servicio) || selectedService || '';
  }

  // ── Nombre de una sola palabra: confirmación natural ────────────────────
  // "Mike" no se descarta ni se vuelve a preguntar desde cero: se conserva y
  // se pregunta, en un tono natural, si es el nombre completo.
  function esNombreUnaPalabra(nombre) {
    var s = String(nombre || '').trim();
    return !!s && s.indexOf(' ') === -1;
  }

  function nombreConfirmacionMensaje(nombre, lang) {
    var en = lang === 'en';
    return en
      ? 'I noted you as ' + nombre + ' 😊 Is that your full name, or would you like to add your last name?'
      : 'Te anoté como ' + nombre + ' 😊 ¿Ese es tu nombre completo o quieres agregar tu apellido?';
  }

  // ── Mensaje final de reserva confirmada (única fuente: nunca se redacta
  // por separado en widget.js/asistente.html) ─────────────────────────────
  // NUNCA afirma que el correo llegó al cliente salvo que el backend lo
  // confirme con d.email.customer.sent === true — d.emailWarning no decide
  // esto por sí solo (puede referirse al aviso del dueño, no al del cliente).
  function citaLabel(cfg, lang) {
    var en = lang === 'en';
    if (templateId(cfg) === 'restaurant') return en ? 'reservation' : 'reserva';
    return en ? 'appointment' : 'cita';
  }

  function mensajeReservaGuardada(cfg, d, lang) {
    var en = lang === 'en';
    var name = (cfg && cfg.businessName) || (en ? 'this business' : 'este negocio');
    var label = citaLabel(cfg, lang);
    var emailSent = !!(d && d.email && d.email.customer && d.email.customer.sent === true);
    if (emailSent) {
      return en
        ? '✅ Your ' + label + ' is confirmed.\n\nWe sent the details to your email.\nPlease also check spam, just in case.\n\nThanks for booking with ' + name + ' 😊'
        : '✅ Tu ' + label + ' quedó confirmada.\n\nTe enviamos los detalles a tu correo.\nRevisa también spam por si acaso.\n\nGracias por reservar en ' + name + ' 😊';
    }
    return en
      ? "✅ Your " + label + " is confirmed.\n\nWe couldn't send the email.\nPlease save these details or contact the business.\n\nThanks for booking with " + name + '.'
      : '✅ Tu ' + label + ' quedó confirmada.\n\nNo pudimos enviar el correo.\nGuarda estos datos o contacta al negocio.\n\nGracias por reservar en ' + name + '.';
  }

  // ── Catálogo: única fuente de qué se renderiza. Nunca filtrar por imagen:
  // un servicio sin foto se muestra igual, con placeholder — el pintado real
  // (con o sin <img>) sigue en cada superficie, esto solo fija la lista y el
  // orden (el mismo de cfg.menu, sin reordenar). ──────────────────────────
  function catalogItems(cfg) {
    return Array.isArray(cfg && cfg.menu) ? cfg.menu : [];
  }

  // Introducción del catálogo: SIEMPRE construida por código, nunca se
  // confía en que el modelo haya obedecido la instrucción de ser breve.
  // widget.js/asistente.html la muestran de forma determinista apenas llega
  // [MOSTRAR_MENU], antes de renderMenu(). [Objetivo 2]
  function catalogIntro(cfg, lang) {
    var en = lang === 'en';
    if (templateId(cfg) === 'restaurant') return en ? "Here's our menu 😊" : 'Aquí tienes nuestro menú 😊';
    return en ? 'Here are our services 😊' : 'Aquí tienes nuestros servicios 😊';
  }

  // ¿El texto libre del modelo repite el catálogo en prosa (2+ servicios
  // reales nombrados)? Heurística determinista y testeable: si es así, se
  // descarta esa parte del texto porque las tarjetas ya lo muestran; si no,
  // se conserva (puede traer una respuesta útil además del catálogo).
  // [Objetivo 2]
  function looksLikeCatalogRestatement(text, menu) {
    if (!text || !Array.isArray(menu) || menu.length < 2) return false;
    var low = String(text).toLowerCase();
    var hits = 0;
    for (var i = 0; i < menu.length; i++) {
      var nombre = menu[i] && menu[i].nombre;
      if (nombre && low.indexOf(String(nombre).toLowerCase()) !== -1) hits++;
      if (hits >= 2) return true;
    }
    return false;
  }

  // Normaliza para comparar "es la misma frase" sin que rompan diferencias
  // triviales de mayúsculas, espacios o el emoji final (minúsculas, se
  // quitan signos/emoji, se colapsan espacios). [auditoría — intro duplicada]
  function normalizeIntroText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ¿El texto libre del modelo es (esencialmente) la misma frase que ya
  // vamos a mostrar como introducción determinista? Si el modelo repite
  // "Aquí tienes nuestros servicios 😊" (o su variante en inglés/restaurante)
  // con distinta puntuación o mayúsculas, sigue siendo un eco de la intro y
  // no debe mostrarse una segunda vez. [auditoría — intro duplicada]
  function isCatalogIntroEcho(text, cfg, lang) {
    var norm = normalizeIntroText(text);
    if (!norm) return false;
    return norm === normalizeIntroText(catalogIntro(cfg, lang));
  }

  function generalPhotosIntro(lang) {
    return lang === 'en' ? 'Here are some photos 😊' : 'Aquí tienes algunas fotos 😊';
  }

  // Deterministic, deliberately conservative detector for the official Spa's
  // first customer message. Ambiguous text retains the Spanish default.
  function detectarIdioma(texto) {
    var s = String(texto || '').toLowerCase().trim();
    if (!s) return 'es';
    var ingles = /\b(?:hello|hi|please|thanks?|thank you|i(?: m| am| want| would| need| have| can)|appointment|book(?:ing)?|cancel|service|today|tomorrow|for|with|the|and)\b/i;
    var espanol = /[áéíóúñ¿¡]|\b(?:hola|buenas|gracias|quiero|quisiera|necesito|cita|reservar|cancelar|servicio|hoy|mañana|para|con|el|la|y)\b/i;
    return ingles.test(s) && !espanol.test(s) ? 'en' : 'es';
  }

  return {
    esConfirmacion: esConfirmacion,
    detectarIdioma: detectarIdioma,
    hasLanguageChoice: hasLanguageChoice,
    languageChoiceCopy: languageChoiceCopy,
    resolveServicio: resolveServicio,
    esNombreUnaPalabra: esNombreUnaPalabra,
    nombreConfirmacionMensaje: nombreConfirmacionMensaje,
    mensajeReservaGuardada: mensajeReservaGuardada,
    citaLabel: citaLabel,
    catalogItems: catalogItems,
    catalogIntro: catalogIntro,
    looksLikeCatalogRestatement: looksLikeCatalogRestatement,
    isCatalogIntroEcho: isCatalogIntroEcho,
    generalPhotosIntro: generalPhotosIntro,
    limpiarNombre: limpiarNombre,
    esSinPeticionEspecial: esSinPeticionEspecial,
    BOOKING_STEPS: BOOKING_STEPS,
    CANCEL_STEPS: CANCEL_STEPS,
    RESUMEN_ICONOS: RESUMEN_ICONOS,
    RESUMEN_LABEL: RESUMEN_LABEL,
    summaryLabel: summaryLabel,
    genIdempotencyKey: genIdempotencyKey,
    reservaResumen: reservaResumen,
    duplicateAttemptState: duplicateAttemptState,
    buildModifyUpdate: buildModifyUpdate,
    reservaTextos: reservaTextos,
    CORRECCION_RE: CORRECCION_RE,
    MODIFY_TRIGGERS: MODIFY_TRIGGERS,
    CAMPO_MENCIONADO: CAMPO_MENCIONADO,
    campoCorreccion: campoCorreccion,
    extractBooking: extractBooking,
    resolverHora: resolverHora,
    horasAbiertas: horasAbiertas,
    limpiarMarcadores: limpiarMarcadores,
    limpiarMarkdown: limpiarMarkdown,
    extractNotas: extractNotas,
    extractNotasUsuario: extractNotasUsuario,
    fusionarNotas: fusionarNotas,
    isFoodMedical: isFoodMedical,
    applyFoodPreferences: applyFoodPreferences,
    foodPreferencesToSpecialRequests: foodPreferencesToSpecialRequests,
    valorValido: valorValido,
    pareceReserva: pareceReserva,
    isPopular: isPopular,
    galleryHeading: galleryHeading,
    bookServiceLabel: bookServiceLabel,
    bookServiceMessage: bookServiceMessage,
    specialRequestsQuestion: specialRequestsQuestion,
    iconFor: iconFor,
    hexToRgba: hexToRgba,
    nextMissingIndex: nextMissingIndex,
    askConProgreso: askConProgreso,
    resumenDeLoCapturado: resumenDeLoCapturado,
    lineasResumen: lineasResumen,
    greeting: greeting,
    accionesRapidas: accionesRapidas,
    featureOn: featureOn,
    templateId: templateId,
    bookingRequirements: bookingRequirements,
    summaryFields: summaryFields,
    estaAlFondo: estaAlFondo,
    irAlFondo: irAlFondo,
  };
})();
