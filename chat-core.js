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

  var FECHA_TEXTO_RE = new RegExp(
    '(pasado\\s+ma(?:ñ|n)ana|ma(?:ñ|n)ana|hoy|' +
    '(?:este|el|pr(?:ó|o)ximo)\\s+(?:lunes|martes|mi(?:é|e)rcoles|jueves|viernes|s(?:á|a)bado|domingo)|' +
    '(?:lunes|martes|mi(?:é|e)rcoles|jueves|viernes|s(?:á|a)bado|domingo)|' +
    '\\d{1,2}\\s+de\\s+(?:' + MES_NOM + ')(?:\\s+de\\s+\\d{4})?|' +
    '(?:' + MES_NOM + ')\\s+\\d{1,2}\\b)', 'i');

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

  var EMAIL_RE2 = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

  var TEL_RE = /(\+?\d[\d\s().-]{6,}\d)/;

  // Borra del texto todo lo que ya sabemos que NO es una fecha antes de
  // buscarla: correos, horas y secuencias largas de dígitos (teléfonos, IDs).
  // Sin esto, cualquier número de contacto puede aportar un falso día/mes.
  function enmascararNoFecha(s) {
    return String(s)
      .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, ' ')                       // correos
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

  var INTENT_RE = /\b(quiero|quisiera|necesito|me\s+gustar[ií]a|puedo|ap[uú]ntame|ag[eé]ndame|d[ae]me)\b/i;

  var CORRECCION_RE = /(me\s+equivoqu[eé]|cambiar|corregir|est[aá]\s+mal|mejor|en realidad|prefiero)/i;

  var CAMPO_MENCIONADO = [
      [/hora|horario/i, 'hora'], [/fecha|d[ií]a/i, 'fecha'], [/personas?|somos/i, 'personas'],
      [/servicio/i, 'servicio'], [/correo|email/i, 'email'], [/tel[eé]fono|n[uú]mero/i, 'telefono'],
      [/nombre/i, 'nombre'], [/mesa|terraza|ventana/i, 'tablePreference'],
      [/barbero|barbera|estilista/i, 'barberPreference']
    ];

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
  function limpiarNombre(cadena) {
    var toks = String(cadena || '').trim().split(/\s+/);
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
            personas: 'Personas', partySize: 'Personas', telefono: 'Teléfono', email: 'Email', contacto: 'Contacto', nota: 'Nota',
             tablePreference: 'Mesa', barberPreference: 'Barbero', specialRequests: 'Peticiones especiales' },
      en: { nombre: 'Name', servicio: 'Service', fecha: 'Date', hora: 'Time',
            personas: 'People', partySize: 'People', telefono: 'Phone', email: 'Email', contacto: 'Contact', note: 'Note',
             tablePreference: 'Table preference', barberPreference: 'Barber preference', specialRequests: 'Special requests' }
    };

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

  function bookingRequirements(cfg, data) {
    var template = templateId(cfg);
    var required = template === 'restaurant'
        ? ['nombre', 'contacto', 'email', 'fecha', 'hora', 'personas', 'specialRequests']
      : template === 'barber'
        ? ['nombre', 'contacto', 'email', 'fecha', 'hora', 'servicio', 'specialRequests']
        : ['nombre', 'telefono', 'email', 'fecha', 'hora', 'servicio', 'specialRequests'];
    return required.filter(function (field) {
      if (field === 'contacto') return !(data.telefono || data.email || data.contacto);
      if (field === 'specialRequests') return data.specialRequests === undefined;
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
      if (elegido) out.servicio = elegido;
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

    // Buscar el teléfono fuera del email: si no, los dígitos de "x1@y.com"
    // se colaban como número, o el email hacía perder el teléfono entero.
    // La fecha se excluye por lo mismo: "24-07-2026" tiene forma de teléfono
    // (8 dígitos y guiones) y si no se saca acaba guardada como número.
    var sinEmail = out.email ? t.replace(out.email, ' ') : t;
    if (out.fecha) sinEmail = sinEmail.replace(out.fecha, ' ');
    var tel = sinEmail.match(TEL_RE);
    if (tel && tel[0].replace(/\D/g, '').length >= 7) out.telefono = tel[0].trim();

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
      else if (nearLight.test(source) && entry[0] === 'sauce' && out.notes.indexOf('light_sauce') === -1) out.notes.push('light_sauce');
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

  function valorValido(field, t) {
      if (field === 'email')    return EMAIL_RE2.test(t) || /^(no|ninguno|skip|omitir)$/i.test(t.trim());
      if (field === 'telefono') return t.replace(/\D/g, '').length >= 7;
      if (field === 'contacto') return EMAIL_RE2.test(t) || t.replace(/\D/g, '').length >= 7;
      if (field === 'personas') return /\d|\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.test(t);
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
  var CONFIRMACIONES = /^(si|si todo correcto|si todo bien|si esta bien|si correcto|si confirma|si confirmar|si confirmo|si adelante|si dale|confirmar|confirma|confirma la cita|confirmo|confirmo la cita|todo correcto|todo bien|todo esta bien|esta bien|correcto|adelante|dale|de acuerdo|ok|okay|listo|perfecto|si por favor)$/;
  function esConfirmacion(t) {
    var s = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return false;
    if (/\b(cambiar|corregir|equivoq|mejor|otra|otro|modif|no |cancel)\b/.test(s)) return false;
    return CONFIRMACIONES.test(s);
  }

  return {
    esConfirmacion: esConfirmacion,
    BOOKING_STEPS: BOOKING_STEPS,
    CANCEL_STEPS: CANCEL_STEPS,
    RESUMEN_ICONOS: RESUMEN_ICONOS,
    RESUMEN_LABEL: RESUMEN_LABEL,
    CORRECCION_RE: CORRECCION_RE,
    CAMPO_MENCIONADO: CAMPO_MENCIONADO,
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
