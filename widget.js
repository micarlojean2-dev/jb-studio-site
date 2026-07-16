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

  // Posición del botón flotante. Prioridad: data-position del <script> y, si
  // no viene, lo que tenga guardado el cliente. Los clientes antiguos no
  // tienen ninguno de los dos y siguen abajo a la derecha, como siempre.
  var position = me.getAttribute('data-position');
  if (position !== 'bottom-left' && position !== 'bottom-right') position = '';

  // El CSS se inyecta antes de que llegue la config, así que el lado inicial
  // sale del data-position del snippet. Si el snippet es antiguo y no lo trae,
  // applyPosition() lo corrige cuando la config del cliente ya está cargada.
  var SIDE_CSS = position === 'bottom-left' ? 'left' : 'right';

  // Token de vista previa del admin, si la página anfitriona lo trae. Solo lo
  // usa la página de demostración del panel; en el sitio real del cliente no
  // existe y el widget se comporta igual que siempre.
  var previewToken = (function () {
    try {
      var t = new URLSearchParams(window.location.search).get('preview') || '';
      return /^[a-f0-9]{64}$/.test(t) ? t : '';
    } catch (e) { return ''; }
  })();

  function applyPosition(side) {
    var els = [document.getElementById('jbw-fab'), document.getElementById('jbw-panel')];
    els.forEach(function (el) {
      if (!el) return;
      el.classList.toggle('jbw-left', side === 'left');
      el.classList.toggle('jbw-right', side !== 'left');
    });
  }

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

  // Halo del pulso: mismo color del negocio, translúcido. Si el color no es
  // un hex reconocible, caemos a un negro suave en vez de romper el CSS.
  function hexToRgba(hex, a) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
    if (!m) return 'rgba(0,0,0,' + a + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  // ── Inject CSS ───────────────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = [
    // --jbw-edge: separación al borde. Una sola variable para el botón y el
    // panel, para que ambos se muevan juntos y el móvil solo la redefina.
    '#jbw-fab,#jbw-panel{--jbw-edge:20px;',
      "font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}",
    '#jbw-fab{position:fixed;bottom:var(--jbw-edge);height:46px;',
    'border-radius:23px;border:none;cursor:pointer;display:flex;',
    'align-items:center;justify-content:center;gap:8px;padding:0 16px;',
    'box-shadow:0 4px 16px rgba(0,0,0,.18),0 1px 4px rgba(0,0,0,.12);z-index:2147483646;',
    'font-size:14.5px;font-weight:600;color:#fff;line-height:1;white-space:nowrap;',
    'letter-spacing:-0.01em;',
    'transition:transform .22s cubic-bezier(.22,1,.36,1),box-shadow .22s;}',
    '#jbw-fab.jbw-right{right:var(--jbw-edge);left:auto;}',
    '#jbw-fab.jbw-left{left:var(--jbw-edge);right:auto;}',
    '#jbw-fab:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.24),0 2px 6px rgba(0,0,0,.14);}',
    '#jbw-fab:active{transform:translateY(0);}',
    '#jbw-fab svg{flex-shrink:0;width:18px;height:18px;}',

    // Pulso suave cada 4s. Se detiene con el panel abierto y respeta a quien
    // pidio menos movimiento en el sistema.
    // Respiración muy leve cada 5s: se nota por el rabillo del ojo sin
    // reclamar atención. Un anillo expansivo resultaba agresivo.
    '@keyframes jbw-breathe{0%,90%,100%{box-shadow:0 4px 16px rgba(0,0,0,.18),0 1px 4px rgba(0,0,0,.12),0 0 0 0 var(--jbw-pulse);}',
    '95%{box-shadow:0 4px 16px rgba(0,0,0,.18),0 1px 4px rgba(0,0,0,.12),0 0 0 7px transparent;}}',
    '#jbw-fab.jbw-pulsing{animation:jbw-breathe 5s ease-out infinite;}',
    '@media(prefers-reduced-motion:reduce){#jbw-fab.jbw-pulsing{animation:none;}}',

    '#jbw-panel{position:fixed;bottom:78px;width:400px;height:600px;',
    'max-height:calc(100vh - 100px);',
    'border-radius:24px;background:#fff;z-index:2147483645;display:flex;',
    'flex-direction:column;overflow:hidden;',
    'box-shadow:0 24px 70px rgba(0,0,0,.20),0 8px 24px rgba(0,0,0,.10),0 0 0 1px rgba(0,0,0,.05);',
    'transform:scale(.96) translateY(12px);transform-origin:bottom right;',
    'opacity:0;pointer-events:none;',
    'transition:transform .26s cubic-bezier(.22,1,.36,1),opacity .2s ease;',
    'letter-spacing:-0.01em;}',
    '#jbw-panel.jbw-left{transform-origin:bottom left;}',
    '#jbw-panel.jbw-open{transform:scale(1) translateY(0);opacity:1;pointer-events:all;}',
    '#jbw-panel.jbw-right{right:var(--jbw-edge);left:auto;}',
    '#jbw-panel.jbw-left{left:var(--jbw-edge);right:auto;}',

    '#jbw-head{padding:18px 18px;display:flex;align-items:center;gap:12px;flex-shrink:0;}',
    '.jbw-hi{flex:1;min-width:0;}',
    '#jbw-close{width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;',
    'background:rgba(255,255,255,.20);color:#fff;display:flex;align-items:center;',
    'justify-content:center;flex-shrink:0;padding:0;transition:background .15s;}',
    '#jbw-close:hover{background:rgba(255,255,255,.34);}',
    '#jbw-av{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.20);',
    'display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;',
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);}',
    '.jbw-hi h4{margin:0;font-size:15.5px;font-weight:650;color:#fff;line-height:1.25;}',
    '.jbw-hi p{margin:3px 0 0;font-size:11.5px;color:rgba(255,255,255,.75);',
    'display:flex;align-items:center;gap:5px;font-weight:500;}',
    '.jbw-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;display:inline-block;}',

    '#jbw-msgs{flex:1;overflow-y:auto;padding:18px 16px;display:flex;',
    'flex-direction:column;gap:14px;background:#fafafa;}',
    '#jbw-msgs::-webkit-scrollbar{width:4px;}',
    '#jbw-msgs::-webkit-scrollbar-thumb{background:rgba(0,0,0,.14);border-radius:2px;}',

    '.jbw-r{display:flex;align-items:flex-end;gap:6px;}',
    '.jbw-r.jbw-u{justify-content:flex-end;}',
    '.jbw-b{max-width:80%;padding:11px 14px;border-radius:18px;font-size:14px;',
    'line-height:1.55;word-break:break-word;white-space:pre-wrap;',
    'animation:jbw-in .26s cubic-bezier(.22,1,.36,1);}',
    '@keyframes jbw-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}',
    '@media(prefers-reduced-motion:reduce){.jbw-b{animation:none;}}',
    '.jbw-r.jbw-bot .jbw-b{background:#fff;color:#16181d;',
    'border-radius:18px 18px 18px 5px;',
    'box-shadow:0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05);}',
    '.jbw-r.jbw-u .jbw-b{color:#fff;border-radius:18px 18px 5px 18px;',
    'box-shadow:0 2px 10px rgba(0,0,0,.10);}',
    '.jbw-ba{width:24px;height:24px;border-radius:50%;display:flex;',
    'align-items:center;justify-content:center;font-size:10px;flex-shrink:0;color:#fff;}',
    '.jbw-ty{background:#fff;color:#aaa;padding:9px 12px;',
    'border-radius:14px 14px 14px 3px;font-size:20px;letter-spacing:4px;',
    'box-shadow:0 1px 4px rgba(0,0,0,.09);}',

    '#jbw-foot{padding:12px 14px 16px;background:#fff;',
    'border-top:1px solid rgba(0,0,0,.06);display:flex;gap:9px;align-items:center;}',
    '#jbw-inp{flex:1;border:1.5px solid transparent;border-radius:22px;',
    'padding:11px 16px;font-size:14px;outline:none;background:#f2f3f5;',
    'color:#16181d;font-family:inherit;letter-spacing:-0.01em;',
    'transition:border-color .18s,background .18s,box-shadow .18s;}',
    '#jbw-inp:focus{border-color:rgba(0,0,0,.10);background:#fff;',
    'box-shadow:0 2px 10px rgba(0,0,0,.06);}',
    '#jbw-inp::placeholder{color:#a8acb3;}',
    '#jbw-inp:disabled{opacity:.5;cursor:not-allowed;}',
    '#jbw-snd{width:38px;height:38px;border-radius:50%;border:none;cursor:pointer;',
    'display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;',
    'transition:transform .15s,opacity .15s;}',
    '#jbw-snd:hover:not(:disabled){transform:scale(1.08);}',
    '#jbw-snd:disabled{opacity:.4;cursor:not-allowed;}',
    '#jbw-snd svg{width:15px;height:15px;}',
    // Cerrado, el botón sigue discreto. Abierto, el panel ocupa casi toda la
    // pantalla: en un móvil una tarjeta pequeña se lee mal.
    '@media(max-width:600px){',
      '#jbw-fab,#jbw-panel{--jbw-edge:16px;}',
      '#jbw-fab{height:46px;border-radius:23px;font-size:14.5px;padding:0 16px;}',
      '#jbw-fab svg{width:18px;height:18px;}',
      '#jbw-panel{width:94vw;max-width:94vw;height:86vh;max-height:86vh;bottom:74px;',
      'border-radius:22px;}',
    '}',

    '.jbw-cards-wrap{width:100%;overflow-x:auto;padding:4px 0 0;}',
    '.jbw-cards-wrap::-webkit-scrollbar{height:3px;}',
    '.jbw-cards-wrap::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:2px;}',
    '.jbw-cards{display:flex;gap:12px;padding:2px 4px 12px;}',
    '.jbw-card{flex:0 0 152px;background:#fff;border-radius:16px;overflow:hidden;',
    'box-shadow:0 1px 2px rgba(0,0,0,.05),0 6px 18px rgba(0,0,0,.06);',
    'transition:transform .2s cubic-bezier(.22,1,.36,1),box-shadow .2s;}',
    '.jbw-card:hover{transform:translateY(-3px);box-shadow:0 2px 4px rgba(0,0,0,.06),0 12px 28px rgba(0,0,0,.10);}',
    '.jbw-card-img{width:100%;height:92px;object-fit:cover;display:block;background:#f2f2f4;}',
    // Sin imagen real no inventamos un hueco gris: un icono sobre un degradado
    // suave del color del negocio se ve intencional, no roto.
    '.jbw-card-ph{width:100%;height:92px;display:flex;align-items:center;',
    'justify-content:center;font-size:26px;}',
    '.jbw-card-body{padding:11px 12px 13px;}',
    '.jbw-card-name{font-size:13px;font-weight:650;color:#16181d;line-height:1.3;margin-bottom:3px;}',
    '.jbw-card-price{font-size:13.5px;font-weight:700;margin-bottom:5px;}',
    '.jbw-card-desc{font-size:11px;color:#6b6f76;line-height:1.45;}',
  ].join('');
  document.head.appendChild(css);

  // ── Inject HTML ──────────────────────────────────────────────────────────
  var fab = document.createElement('button');
  fab.id = 'jbw-fab';
  fab.setAttribute('aria-label', 'Abrir chat');
  fab.className = 'jbw-pulsing ' + (SIDE_CSS === 'left' ? 'jbw-left' : 'jbw-right');
  fab.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="white" aria-hidden="true">' +
    '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
    '<span id="jbw-fab-label">Hola 👋</span>';

  var panel = document.createElement('div');
  panel.id = 'jbw-panel';
  panel.className = SIDE_CSS === 'left' ? 'jbw-left' : 'jbw-right';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat assistant');
  panel.innerHTML =
    '<div id="jbw-head">' +
      '<div id="jbw-av">✦</div>' +
      '<div class="jbw-hi">' +
        '<h4 id="jbw-name">Assistant</h4>' +
        '<p><span class="jbw-dot"></span> <span id="jbw-status">Online now</span></p>' +
      '</div>' +
      '<button id="jbw-close" aria-label="Cerrar chat">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/>' +
        '<line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
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
    // El halo del pulso usa el color del negocio, translúcido.
    fab.style.setProperty('--jbw-pulse', hexToRgba(c, 0.45));
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
    .then(function (d) {
      if (!d) return;
      Object.assign(cfg, d);
      paint();
      // Snippet antiguo sin data-position: respetamos lo guardado del cliente.
      if (!position && d.widgetPosition) {
        applyPosition(d.widgetPosition === 'bottom-left' ? 'left' : 'right');
      }
    })
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

  // Icono por palabra clave del servicio. No adivina de más: si no reconoce
  // nada, cae en un símbolo neutro y elegante en vez de un placeholder roto.
  var ICON_RULES = [
    [/masaj|spa|relaj|facial|belle|estét/i, '💆'],
    [/pelo|corte|barb|peluqu|cabello/i,     '✂️'],
    [/uña|manicur|pedicur/i,                '💅'],
    [/comida|men[uú]|plato|pizza|burger|caf[eé]|bebida|restaur/i, '🍽'],
    [/diente|dental|odont/i,                '🦷'],
    [/consulta|m[eé]dic|salud|terap/i,      '🩺'],
    [/clase|curso|taller|entren|gym|fitness/i, '🏋'],
    [/foto|video|estudio/i,                 '📸'],
    [/limpieza|hogar|lavad/i,               '🧼'],
    [/auto|coche|mec[aá]nic|taller/i,       '🚗'],
  ];

  function buildIcon(nombre) {
    var el = document.createElement('div');
    el.className = 'jbw-card-ph';
    var txt = String(nombre || '');
    var chosen = '✨';
    for (var i = 0; i < ICON_RULES.length; i++) {
      if (ICON_RULES[i][0].test(txt)) { chosen = ICON_RULES[i][1]; break; }
    }
    el.textContent = chosen;
    el.style.background = 'linear-gradient(135deg,' + hexToRgba(cfg.color, 0.13) + ',' + hexToRgba(cfg.color, 0.05) + ')';
    return el;
  }

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
        // Una imagen rota se ve peor que no tener imagen: la sustituimos por
        // el icono, igual que si el servicio nunca hubiera traído foto.
        img.onerror = function () {
          if (img.parentNode) img.parentNode.replaceChild(buildIcon(item.nombre), img);
        };
        card.appendChild(img);
      } else {
        card.appendChild(buildIcon(item.nombre));
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
      body: JSON.stringify(previewToken
        ? { clientId: clientId, messages: msgs, previewToken: previewToken }
        : { clientId: clientId, messages: msgs }),
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
  function setOpen(next) {
    open = next;
    panel.classList.toggle('jbw-open', open);
    fab.setAttribute('aria-expanded', String(open));
    // Sin pulso mientras el chat está abierto: ya no hay nada que anunciar.
    fab.classList.toggle('jbw-pulsing', !open);
  }

  document.getElementById('jbw-close').addEventListener('click', function () { setOpen(false); });

  fab.addEventListener('click', function () {
    setOpen(!open);

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
