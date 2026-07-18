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

  var FECHA_RE = new RegExp(
    '(pasado\\s+ma(ñ|n)ana|ma(ñ|n)ana|hoy|' +
    '(este|el|pr(ó|o)ximo)\\s+(lunes|martes|mi(é|e)rcoles|jueves|viernes|s(á|a)bado|domingo)|' +
    '(lunes|martes|mi(é|e)rcoles|jueves|viernes|s(á|a)bado|domingo)|' +
    '\\d{1,2}\\s+de\\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)|' +
    '\\d{1,2}[\\/\\-]\\d{1,2}(?:[\\/\\-]\\d{2,4})?|' +
    '\\d{4}-\\d{2}-\\d{2})', 'i');

  var HORA_RE = /(?:a\s+las\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i;

  var HORA_CTX = /(a\s+las|hrs?|horas?|:\d{2}|\ba\.?m\.?\b|\bp\.?m\.?\b)/i;

  var PERSONAS_RE = /(?:para|somos|seríamos|serian|ser[ií]amos)\s+(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b|\b(\d{1,3}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+personas?\b/i;

  var NUM_PAL = { un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10 };

  var EMAIL_RE2 = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

  var TEL_RE = /(\+?\d[\d\s().-]{6,}\d)/;

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

  var BOOKING_TRIGGERS = /reservar|agendar|cita|quiero ir|disponibilidad|appointment|reserva|hora libre|turno|quiero una cita/i;

  var INTENT_RE = /\b(quiero|quisiera|necesito|me\s+gustar[ií]a|puedo|ap[uú]ntame|ag[eé]ndame|d[ae]me)\b/i;

  var CORRECCION_RE = /(me\s+equivoqu[eé]|cambiar|corregir|est[aá]\s+mal|mejor|en realidad|prefiero)/i;

  var CAMPO_MENCIONADO = [
      [/hora|horario/i, 'hora'], [/fecha|d[ií]a/i, 'fecha'], [/personas?|somos/i, 'personas'],
      [/servicio/i, 'servicio'], [/correo|email/i, 'email'], [/tel[eé]fono|n[uú]mero/i, 'telefono'],
      [/nombre/i, 'nombre']
    ];

  var RESUMEN_ICONOS = {
      nombre: '👤', servicio: '✂️', fecha: '📅', hora: '⏰',
      personas: '👥', telefono: '📞', email: '✉️', nota: '📝'
    };

  var RESUMEN_LABEL = {
      es: { nombre: 'Nombre', servicio: 'Servicio', fecha: 'Fecha', hora: 'Hora',
            personas: 'Personas', telefono: 'Teléfono', email: 'Email', nota: 'Nota' },
      en: { nombre: 'Name', servicio: 'Service', fecha: 'Date', hora: 'Time',
            personas: 'People', telefono: 'Phone', email: 'Email', nota: 'Note' }
    };

  var BOOKING_STEPS = [
      { field: 'nombre',   ask: { es: '¿Cuál es tu nombre completo?',                           en: 'What is your full name?' } },
      { field: 'telefono', ask: { es: '¿Cuál es tu número de teléfono?',                        en: "What's your phone number?" } },
      { field: 'email',    ask: { es: '¿Cuál es tu email?',                                     en: "What's your email address?" } },
      { field: 'fecha',    ask: { es: '¿Qué fecha prefieres? (ej: 15 de julio)',                 en: 'What date do you prefer? (e.g. July 15)' } },
      { field: 'hora',     ask: { es: '¿A qué hora? (ej: 3:00 PM)',                             en: 'What time? (e.g. 3:00 PM)' } },
      { field: 'servicio', ask: { es: '¿Qué servicio te gustaría?',                                en: 'Which service would you like?' } },
      { field: 'personas', ask: { es: '¿Para cuántas personas sería? (escribe 1 si es solo para ti)', en: 'For how many people? (write 1 if it is just you)' } },
      { field: 'nota',     ask: { es: '¿Alguna nota adicional? (escribe "no" si no tienes ninguna)', en: 'Any additional notes? (write "no" if none)' } },
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

  function extractBooking(text, menu, businessHours) {
    var t = String(text || '');
    var out = {};

    // Servicio: solo nombres reales del catálogo. Nunca se inventa uno.
    if (Array.isArray(menu)) {
      var low = t.toLowerCase();
      var exacto = null, porPalabra = null;
      menu.forEach(function (m) {
        if (!m || !m.nombre) return;
        var n = String(m.nombre).toLowerCase();
        // El nombre completo en el texto gana siempre: "corte + barba" debe
        // ganar a "corte caballero", que solo coincide por la primera palabra.
        if (low.indexOf(n) !== -1) {
          if (!exacto || n.length > exacto.toLowerCase().length) exacto = m.nombre;
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

    var f = t.match(FECHA_RE);
    if (f) out.fecha = f[0].trim();

    if (HORA_CTX.test(t)) {
      var h = t.match(HORA_RE);
      if (h) {
        var hh = parseInt(h[1], 10);
        if (hh >= 0 && hh <= 23) {
          var r = resolverHora(hh, h[2], h[3], businessHours);
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

    // El nombre solo se toma si la persona lo marca ("soy Ana", "me llamo…").
    // Sin marcador, en texto libre se confunde con cualquier palabra.
    // "soy X" es ambiguo: "soy Ana" es un nombre, pero "soy alérgico a los
    // aceites" o "soy vegetariano" es un estado, no un nombre. Sin este filtro,
    // una preferencia dicha con "soy…" pisaba el nombre ya capturado. "me llamo"
    // y "mi nombre es" no son ambiguos y no necesitan el filtro.
    var nm = t.match(/\b(?:soy|me\s+llamo|mi\s+nombre\s+es)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})?)/i);
    if (nm) {
      var cand = nm[1].trim();
      var primera = cand.split(/\s+/)[0].toLowerCase();
      var noNombre = /^(que|quien|el|la|un|una|para|de|del|al[eé]rgic[oa]|vegetarian[oa]|vegan[oa]|celiac[oa]|diab[eé]tic[oa]|intolerante|nuev[oa]|client[ea]|puntual|flexible|mayor|menor|estudiante|jubilad[oa]|sensible|zurd[oa])$/i.test(primera);
      // "soy alérgico A los aceites", "soy vegetariano DE toda la vida": tras el
      // candidato viene un complemento -> es una descripción, no un nombre.
      var complemento = new RegExp('\\bsoy\\s+' + primera.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(a|al|de|con|sin|muy|desde|por)\\b', 'i').test(t);
      if (!noNombre && !complemento) out.nombre = cand;
    }

    var e = t.match(EMAIL_RE2);
    if (e) out.email = e[0];

    // Buscar el teléfono fuera del email: si no, los dígitos de "x1@y.com"
    // se colaban como número, o el email hacía perder el teléfono entero.
    var sinEmail = out.email ? t.replace(out.email, ' ') : t;
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

  function limpiarMarcadores(txt) {
      return limpiarMarkdown(String(txt || ''))
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
  function fusionarNotas(prev, nuevas) {
      var base = String(prev || '').split(/\s+·\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
      (nuevas || []).forEach(function (n) { var v = String(n || '').trim(); if (v && base.indexOf(v) === -1) base.push(v); });
      return base.join(' · ');
    }

  function valorValido(field, t) {
      if (field === 'email')    return EMAIL_RE2.test(t) || /^(no|ninguno|skip|omitir)$/i.test(t.trim());
      if (field === 'telefono') return t.replace(/\D/g, '').length >= 7;
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
    if (cfg.language === 'en') {
      return "Hi! 😊 I'm " + n + "'s assistant.\n\nI can help you with:\n\n" +
             '✨ Discover our services\n' +
             (puedeReservar ? '📅 Book an appointment\n' : '') +
             '💰 Check prices\n\n' +
             'What do you need?';
    }
    return '¡Hola! 😊 Soy el asistente de ' + n + '.\n\nPuedo ayudarte con:\n\n' +
           '✨ Conocer nuestros servicios\n' +
           (puedeReservar ? '📅 Reservar una cita\n' : '') +
           '💰 Consultar precios\n\n' +
           '¿Qué necesitas?';
  }

  function accionesRapidas(cfg, puedeReservar) {
    var en = cfg.language === 'en';
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
    fusionarNotas: fusionarNotas,
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
    estaAlFondo: estaAlFondo,
    irAlFondo: irAlFondo,
  };
})();
