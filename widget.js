/* JB Studio Chat Widget — jbstudio.app/widget.js */
(function () {
  'use strict';

  // ── Read clientId from this script tag ──────────────────────────────────
  var me = document.currentScript;
  if (!me) return;
  var clientId;
  try { clientId = new URL(me.src).searchParams.get('id'); } catch (e) { return; }
  if (!clientId || !/^[a-z0-9-]+$/.test(clientId)) return;

  var API  = 'https://jbstudio.app';
  var SESS = 'jbw_' + clientId;

  // ── State ────────────────────────────────────────────────────────────────
  var cfg     = { businessName: 'Chat', color: '#1a4a2e', language: 'es', active: true };

  // Feature gating — legacy clients (no cfg.features at all) keep every
  // behavior enabled, exactly like before this was added. Only a client
  // created by the automatic wizard, with an explicit "false", turns a
  // behavior off. Keep this regex/gating pattern in sync with asistente.html
  // (no shared module in this vanilla codebase to dedupe against).
  function featureOn(key) {
    return !cfg.features || cfg.features[key] !== false;
  }
  var msgs    = [];
  var open    = false;
  var busy    = false;
  var greeted = false;

  // ── Booking flow state ───────────────────────────────────────────────────
  var bookingStep = 0;   // 0 = idle, 1–7 = collecting fields
  var bookingData = {};

  // ── Cancel flow state ────────────────────────────────────────────────────
  var cancelStep = 0;    // 0 = idle, 1 = asking contacto, 2 = asking fecha
  var cancelData = {};

  var CANCEL_TRIGGERS  = /\bcancel(ar)?\b|quiero cancelar/i;
  var BOOKING_TRIGGERS = /reservar|agendar|cita|quiero ir|disponibilidad|appointment|reserva|hora libre|turno|quiero una cita/i;

  var BOOKING_STEPS = [
    { field: 'nombre',   ask: { es: '¿Cuál es tu nombre completo?',                           en: 'What is your full name?' } },
    { field: 'telefono', ask: { es: '¿Cuál es tu número de teléfono?',                        en: "What's your phone number?" } },
    { field: 'email',    ask: { es: '¿Cuál es tu email?',                                     en: "What's your email address?" } },
    { field: 'fecha',    ask: { es: '¿Qué fecha prefieres? (ej: 15 de julio)',                 en: 'What date do you prefer? (e.g. July 15)' } },
    { field: 'hora',     ask: { es: '¿A qué hora? (ej: 3:00 PM)',                             en: 'What time? (e.g. 3:00 PM)' } },
    { field: 'servicio', ask: { es: '¿Qué servicio deseas o para cuántas personas?',           en: 'What service do you need, or how many people?' } },
    { field: 'nota',     ask: { es: '¿Alguna nota adicional? (escribe "no" si no tienes ninguna)', en: 'Any additional notes? (write "no" if none)' } },
  ];

  try { msgs = JSON.parse(sessionStorage.getItem(SESS) || '[]'); } catch (e) { msgs = []; }
  if (msgs.length) greeted = true;

  function save() {
    try { sessionStorage.setItem(SESS, JSON.stringify(msgs.slice(-40))); } catch (e) {}
  }

  // ── Inject CSS ───────────────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = [
    '#jbw-fab{position:fixed;bottom:24px;right:24px;width:60px;height:60px;',
    'border-radius:50%;border:none;cursor:pointer;display:flex;',
    'align-items:center;justify-content:center;padding:0;',
    'box-shadow:0 4px 24px rgba(0,0,0,0.28);z-index:2147483646;',
    'transition:transform .2s,box-shadow .2s;}',
    '#jbw-fab:hover{transform:scale(1.07);box-shadow:0 6px 32px rgba(0,0,0,.36);}',

    '#jbw-panel{position:fixed;bottom:100px;right:24px;width:360px;height:500px;',
    'border-radius:18px;background:#fff;z-index:2147483645;display:flex;',
    'flex-direction:column;overflow:hidden;',
    'box-shadow:0 16px 56px rgba(0,0,0,.22),0 0 0 1px rgba(0,0,0,.06);',
    'transform:scale(.92) translateY(16px);transform-origin:bottom right;',
    'opacity:0;pointer-events:none;',
    'transition:transform .22s cubic-bezier(.22,1,.36,1),opacity .22s ease;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;}',
    '#jbw-panel.jbw-open{transform:scale(1) translateY(0);opacity:1;pointer-events:all;}',

    '#jbw-head{padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;}',
    '#jbw-av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.22);',
    'display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}',
    '.jbw-hi h4{margin:0;font-size:14px;font-weight:600;color:#fff;line-height:1.2;}',
    '.jbw-hi p{margin:2px 0 0;font-size:11px;color:rgba(255,255,255,.78);',
    'display:flex;align-items:center;gap:4px;}',
    '.jbw-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;display:inline-block;}',

    '#jbw-msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;',
    'flex-direction:column;gap:10px;background:#f7f7f8;}',
    '#jbw-msgs::-webkit-scrollbar{width:4px;}',
    '#jbw-msgs::-webkit-scrollbar-thumb{background:rgba(0,0,0,.14);border-radius:2px;}',

    '.jbw-r{display:flex;align-items:flex-end;gap:6px;}',
    '.jbw-r.jbw-u{justify-content:flex-end;}',
    '.jbw-b{max-width:80%;padding:9px 12px;border-radius:14px;font-size:13.5px;',
    'line-height:1.5;word-break:break-word;}',
    '.jbw-r.jbw-bot .jbw-b{background:#fff;color:#1a1a1a;',
    'border-radius:14px 14px 14px 3px;box-shadow:0 1px 4px rgba(0,0,0,.09);}',
    '.jbw-r.jbw-u .jbw-b{color:#fff;border-radius:14px 14px 3px 14px;}',
    '.jbw-ba{width:24px;height:24px;border-radius:50%;display:flex;',
    'align-items:center;justify-content:center;font-size:10px;flex-shrink:0;color:#fff;}',
    '.jbw-ty{background:#fff;color:#aaa;padding:9px 12px;',
    'border-radius:14px 14px 14px 3px;font-size:20px;letter-spacing:4px;',
    'box-shadow:0 1px 4px rgba(0,0,0,.09);}',

    '#jbw-foot{padding:10px 12px 14px;background:#fff;',
    'border-top:1px solid rgba(0,0,0,.07);display:flex;gap:8px;align-items:center;}',
    '#jbw-inp{flex:1;border:1px solid rgba(0,0,0,.14);border-radius:22px;',
    'padding:9px 14px;font-size:13.5px;outline:none;background:#f5f5f5;',
    'color:#1a1a1a;font-family:inherit;transition:border-color .15s,background .15s;}',
    '#jbw-inp:focus{border-color:rgba(0,0,0,.28);background:#fff;}',
    '#jbw-inp::placeholder{color:#bbb;}',
    '#jbw-inp:disabled{opacity:.5;cursor:not-allowed;}',
    '#jbw-snd{width:38px;height:38px;border-radius:50%;border:none;cursor:pointer;',
    'display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;',
    'transition:transform .15s,opacity .15s;}',
    '#jbw-snd:hover:not(:disabled){transform:scale(1.08);}',
    '#jbw-snd:disabled{opacity:.4;cursor:not-allowed;}',
    '#jbw-snd svg{width:15px;height:15px;}',
    '@media(max-width:420px){#jbw-panel{width:calc(100vw - 16px);right:8px;bottom:92px;}}',

    '.jbw-cards-wrap{width:100%;overflow-x:auto;padding:4px 0 0;}',
    '.jbw-cards-wrap::-webkit-scrollbar{height:3px;}',
    '.jbw-cards-wrap::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:2px;}',
    '.jbw-cards{display:flex;gap:10px;padding:0 4px 10px;}',
    '.jbw-card{flex:0 0 138px;background:#fff;border-radius:12px;overflow:hidden;',
    'box-shadow:0 1px 8px rgba(0,0,0,.10);cursor:default;}',
    '.jbw-card-img{width:100%;height:88px;object-fit:cover;display:block;background:#eee;}',
    '.jbw-card-ph{width:100%;height:88px;background:#f0f0f0;display:flex;',
    'align-items:center;justify-content:center;font-size:26px;}',
    '.jbw-card-body{padding:8px 9px 10px;}',
    '.jbw-card-name{font-size:12px;font-weight:600;color:#1a1a1a;line-height:1.3;margin-bottom:2px;}',
    '.jbw-card-price{font-size:12.5px;font-weight:700;margin-bottom:4px;}',
    '.jbw-card-desc{font-size:10.5px;color:#666;line-height:1.4;}',
  ].join('');
  document.head.appendChild(css);

  // ── Inject HTML ──────────────────────────────────────────────────────────
  var fab = document.createElement('button');
  fab.id = 'jbw-fab';
  fab.setAttribute('aria-label', 'Open chat');
  fab.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="white" aria-hidden="true">' +
    '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';

  var panel = document.createElement('div');
  panel.id = 'jbw-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat assistant');
  panel.innerHTML =
    '<div id="jbw-head">' +
      '<div id="jbw-av">✦</div>' +
      '<div class="jbw-hi">' +
        '<h4 id="jbw-name">Assistant</h4>' +
        '<p><span class="jbw-dot"></span> <span id="jbw-status">Online now</span></p>' +
      '</div>' +
    '</div>' +
    '<div id="jbw-msgs"></div>' +
    '<div id="jbw-foot">' +
      '<input id="jbw-inp" type="text" placeholder="Type a message…" />' +
      '<button id="jbw-snd" disabled aria-label="Send">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="22" y1="2" x2="11" y2="13"/>' +
        '<polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
      '</button>' +
    '</div>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var msgsEl  = document.getElementById('jbw-msgs');
  var inp     = document.getElementById('jbw-inp');
  var snd     = document.getElementById('jbw-snd');
  var nameEl  = document.getElementById('jbw-name');
  var headEl  = document.getElementById('jbw-head');
  var statusEl = document.getElementById('jbw-status');

  // ── Apply color theme ────────────────────────────────────────────────────
  function paint() {
    var c = cfg.color;
    fab.style.background    = c;
    headEl.style.background = c;
    snd.style.background    = c;
    nameEl.textContent      = cfg.businessName || 'Assistant';
    inp.placeholder = cfg.language === 'en' ? 'Type a message…' : 'Escribe un mensaje…';
    statusEl.textContent = cfg.language === 'en' ? 'Online now' : 'En línea';
    // Update already-rendered user bubbles and bot avatars
    var ubs = msgsEl.querySelectorAll('.jbw-r.jbw-u .jbw-b');
    for (var i = 0; i < ubs.length; i++) ubs[i].style.background = c;
    var avs = msgsEl.querySelectorAll('.jbw-ba');
    for (var j = 0; j < avs.length; j++) avs[j].style.background = c;
  }

  // Apply defaults immediately, then fetch real config
  paint();
  fetch(API + '/api/client-config?id=' + encodeURIComponent(clientId))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d) { Object.assign(cfg, d); paint(); } })
    .catch(function () {});

  // ── Render helpers ───────────────────────────────────────────────────────
  function addMsg(role, text) {
    var row = document.createElement('div');
    row.className = 'jbw-r ' + (role === 'user' ? 'jbw-u' : 'jbw-bot');

    var bub = document.createElement('div');
    bub.className   = 'jbw-b';
    bub.textContent = text;

    if (role === 'bot') {
      var av = document.createElement('div');
      av.className   = 'jbw-ba';
      av.style.background = cfg.color;
      av.textContent = '✦';
      row.appendChild(av);
    } else {
      bub.style.background = cfg.color;
    }
    row.appendChild(bub);
    msgsEl.appendChild(row);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function showTyping() {
    var row = document.createElement('div');
    row.className = 'jbw-r jbw-bot';
    row.id = 'jbw-ty';
    var av = document.createElement('div');
    av.className = 'jbw-ba';
    av.style.background = cfg.color;
    av.textContent = '✦';
    var b = document.createElement('div');
    b.className = 'jbw-ty';
    b.textContent = '···';
    row.appendChild(av);
    row.appendChild(b);
    msgsEl.appendChild(row);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById('jbw-ty');
    if (el) el.remove();
  }

  // Render any saved messages from this session
  msgs.forEach(function (m) { addMsg(m.role === 'user' ? 'user' : 'bot', m.content); });

  // ── Render menu card carousel ─────────────────────────────────────────────
  function renderMenu() {
    var items = Array.isArray(cfg.menu) ? cfg.menu : [];
    if (!items.length) return;

    var wrap = document.createElement('div');
    wrap.className = 'jbw-cards-wrap';
    var row = document.createElement('div');
    row.className = 'jbw-cards';

    items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'jbw-card';

      if (item.imagen) {
        var img = document.createElement('img');
        img.className = 'jbw-card-img';
        img.src     = item.imagen;
        img.alt     = item.nombre || '';
        img.loading = 'lazy';
        img.onerror = function () {
          var ph = document.createElement('div');
          ph.className = 'jbw-card-ph';
          ph.textContent = '🖼';
          img.parentNode.replaceChild(ph, img);
        };
        card.appendChild(img);
      } else {
        var ph = document.createElement('div');
        ph.className = 'jbw-card-ph';
        ph.textContent = '🖼';
        card.appendChild(ph);
      }

      var body = document.createElement('div');
      body.className = 'jbw-card-body';

      if (item.nombre) {
        var name = document.createElement('div');
        name.className   = 'jbw-card-name';
        name.textContent = item.nombre;
        body.appendChild(name);
      }
      if (item.precio) {
        var price = document.createElement('div');
        price.className   = 'jbw-card-price';
        price.style.color = cfg.color;
        price.textContent = item.precio;
        body.appendChild(price);
      }
      if (item.descripcion) {
        var desc = document.createElement('div');
        desc.className   = 'jbw-card-desc';
        desc.textContent = item.descripcion;
        body.appendChild(desc);
      }

      card.appendChild(body);
      row.appendChild(card);
    });

    wrap.appendChild(row);
    msgsEl.appendChild(wrap);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  var CANCEL_STEPS = [
    { field: 'contacto', ask: { es: '¿Cuál es el email o teléfono con el que hiciste la reserva?', en: 'What email or phone number did you use to book?' } },
    { field: 'fecha',    ask: { es: '¿Cuál es la fecha de tu reserva? (ej: 15 de julio)',           en: 'What is the date of your reservation? (e.g. July 15)' } },
  ];

  // ── Submit cancel request to /api/cancel-reservation ────────────────────
  function submitCancellation() {
    var lang = cfg.language === 'en' ? 'en' : 'es';
    busy = true;
    inp.disabled = true;
    snd.disabled = true;
    showTyping();

    fetch(API + '/api/cancel-reservation', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clientId: clientId, contacto: cancelData.contacto, fecha: cancelData.fecha }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping();
        if (d.found) {
          addMsg('bot', lang === 'en'
            ? '✅ Your reservation has been cancelled. We hope to see you again soon!'
            : '✅ Tu reserva fue cancelada correctamente. ¡Esperamos verte pronto!');
        } else {
          addMsg('bot', lang === 'en'
            ? 'No reservation was found with those details. Please verify your email/phone and date, then try again.'
            : 'No encontramos una reserva con esos datos. Verifica el email/teléfono y la fecha e intenta de nuevo.');
        }
      })
      .catch(function () {
        hideTyping();
        addMsg('bot', lang === 'en'
          ? 'Connection error. Please try again.'
          : 'Error de conexión. Por favor intenta de nuevo.');
      })
      .finally(function () {
        cancelStep = 0;
        cancelData = {};
        busy = false;
        inp.disabled = false;
        snd.disabled = false;
        inp.focus();
      });
  }

  // ── Submit completed booking to /api/reservations ────────────────────────
  function submitBooking() {
    var lang = cfg.language === 'en' ? 'en' : 'es';
    busy = true;
    inp.disabled = true;
    snd.disabled = true;
    showTyping();

    fetch(API + '/api/reservations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(Object.assign({ clientId: clientId }, bookingData)),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping();
        if (d.ok) {
          addMsg('bot', lang === 'en'
            ? '✅ Your request has been received! The business will review availability and confirm with you soon.'
            : '✅ Tu solicitud fue recibida. El negocio revisará disponibilidad y te confirmará pronto.');
        } else {
          addMsg('bot', lang === 'en'
            ? 'There was an error saving your request. Please try again.'
            : 'Hubo un error al guardar tu solicitud. Por favor intenta de nuevo.');
        }
      })
      .catch(function () {
        hideTyping();
        addMsg('bot', lang === 'en'
          ? 'Connection error. Please try again.'
          : 'Error de conexión. Por favor intenta de nuevo.');
      })
      .finally(function () {
        bookingStep = 0;
        bookingData = {};
        busy = false;
        inp.disabled = false;
        snd.disabled = false;
        inp.focus();
      });
  }

  // ── Send message ─────────────────────────────────────────────────────────
  function send(text) {
    if (busy || !text.trim()) return;

    var t    = text.trim();
    var lang = cfg.language === 'en' ? 'en' : 'es';

    // ── Active cancel flow: collect next field ───────────────────────────
    if (cancelStep > 0) {
      if (/^(salir|exit)$/i.test(t)) {
        cancelStep = 0; cancelData = {};
        addMsg('user', t);
        addMsg('bot', lang === 'en'
          ? 'Process cancelled. Is there anything else I can help with?'
          : 'Proceso cancelado. ¿Hay algo más en lo que pueda ayudarte?');
        return;
      }
      var cstep = CANCEL_STEPS[cancelStep - 1];
      cancelData[cstep.field] = t;
      addMsg('user', t);
      cancelStep++;
      if (cancelStep <= CANCEL_STEPS.length) {
        addMsg('bot', CANCEL_STEPS[cancelStep - 1].ask[lang]);
      } else {
        submitCancellation();
      }
      return;
    }

    // ── Active booking flow: collect next field ──────────────────────────
    if (bookingStep > 0) {
      if (/^(cancelar|cancel|salir|exit)$/i.test(t)) {
        bookingStep = 0;
        bookingData = {};
        addMsg('user', t);
        addMsg('bot', lang === 'en'
          ? 'Reservation cancelled. Is there anything else I can help with?'
          : 'Reserva cancelada. ¿Hay algo más en lo que pueda ayudarte?');
        return;
      }
      var step = BOOKING_STEPS[bookingStep - 1];
      bookingData[step.field] = t;
      addMsg('user', t);
      bookingStep++;
      if (bookingStep <= BOOKING_STEPS.length) {
        addMsg('bot', BOOKING_STEPS[bookingStep - 1].ask[lang]);
      } else {
        submitBooking();
      }
      return;
    }

    // ── Cancel intent detected: start flow ──────────────────────────────
    if (featureOn('cancellation') && CANCEL_TRIGGERS.test(t)) {
      addMsg('user', t);
      cancelStep = 1;
      var cancelIntro = lang === 'en'
        ? '🗓️ I\'ll help you cancel your reservation. Write "exit" at any time to stop.\n\n'
        : '🗓️ Te ayudo a cancelar tu reserva. Escribe "salir" en cualquier momento para salir.\n\n';
      addMsg('bot', cancelIntro + CANCEL_STEPS[0].ask[lang]);
      return;
    }

    // ── Booking intent detected: start flow ──────────────────────────────
    if (featureOn('reservations') && BOOKING_TRIGGERS.test(t)) {
      addMsg('user', t);
      msgs.push({ role: 'user', content: t });
      save();
      bookingStep = 1;
      var intro = lang === 'en'
        ? '📅 Sure! I\'ll help you request an appointment. Write "cancel" at any time to stop.\n\n'
        : '📅 ¡Con gusto! Te ayudo a solicitar una cita. Escribe "cancelar" en cualquier momento para salir.\n\n';
      addMsg('bot', intro + BOOKING_STEPS[0].ask[lang]);
      return;
    }

    // ── Normal AI chat flow ──────────────────────────────────────────────
    busy = true;
    inp.disabled = true;
    snd.disabled = true;

    addMsg('user', text);
    msgs.push({ role: 'user', content: text });
    save();
    showTyping();

    fetch(API + '/api/client-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId, messages: msgs }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping();
        if (d.error === 'inactive') {
          addMsg('bot', d.message || (cfg.language === 'en'
            ? 'This service is temporarily unavailable.'
            : 'Este servicio no está disponible temporalmente.'));
        } else if (d.text) {
          var showMenu   = /\[MOSTRAR_MENU\]/.test(d.text);
          var cleanText  = d.text.replace(/\[MOSTRAR_MENU\]/g, '').trim();
          if (cleanText) addMsg('bot', cleanText);
          if (showMenu)  renderMenu();
          msgs.push({ role: 'assistant', content: d.text });
          save();
        } else {
          addMsg('bot', cfg.language === 'en'
            ? 'Something went wrong. Please try again.'
            : 'Algo salió mal. Por favor intenta de nuevo.');
        }
      })
      .catch(function () {
        hideTyping();
        addMsg('bot', cfg.language === 'en'
          ? 'Connection error. Please try again.'
          : 'Error de conexión. Por favor intenta de nuevo.');
      })
      .finally(function () {
        busy = false;
        inp.disabled = false;
        snd.disabled = false;
        inp.focus();
      });
  }

  // ── Toggle open / close ──────────────────────────────────────────────────
  fab.addEventListener('click', function () {
    open = !open;
    panel.classList.toggle('jbw-open', open);
    fab.setAttribute('aria-expanded', String(open));

    if (open) {
      if (!greeted) {
        greeted = true;
        var g = cfg.language === 'en'
          ? "Hi! 👋 How can I help you today?"
          : "¡Hola! 👋 ¿En qué puedo ayudarte hoy?";
        addMsg('bot', g);
        msgs.push({ role: 'assistant', content: g });
        save();
      }
      snd.disabled = false;
      setTimeout(function () { inp.focus(); }, 200);
    }
  });

  // ── Input events ─────────────────────────────────────────────────────────
  snd.addEventListener('click', function () {
    var t = inp.value.trim();
    inp.value = '';
    send(t);
  });

  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var t = inp.value.trim();
      inp.value = '';
      send(t);
    }
  });

})();
