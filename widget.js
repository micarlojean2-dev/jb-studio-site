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
  var CORE, RESUMEN_ICONOS, RESUMEN_LABEL, BOOKING_STEPS, CANCEL_STEPS, CORRECCION_RE, CAMPO_MENCIONADO;
  var SESS = 'jbw_' + clientId;

  // El motor compartido vive en jbstudio.app, el mismo origen del que este
  // widget ya depende para /api/client-config y /api/client-chat: no añade
  // un punto de fallo nuevo. Si no carga, no pintamos nada — mejor ausente
  // que a medias.
  if (window.JBChatCore) { arrancar(); }
  else {
    var _core = document.createElement('script');
    _core.src = API + '/chat-core.js';
    _core.onload = arrancar;
    _core.onerror = function () { /* sin motor no hay widget */ };
    document.head.appendChild(_core);
  }

  function arrancar() {
    CORE = window.JBChatCore;
    if (!CORE) return;
    RESUMEN_ICONOS = CORE.RESUMEN_ICONOS;
    RESUMEN_LABEL  = CORE.RESUMEN_LABEL;
    BOOKING_STEPS  = CORE.BOOKING_STEPS;
    CANCEL_STEPS   = CORE.CANCEL_STEPS;
    CORRECCION_RE  = CORE.CORRECCION_RE;
    CAMPO_MENCIONADO = CORE.CAMPO_MENCIONADO;
    iniciar();
  }

  function iniciar() {

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
  function featureOn(key) { return CORE.featureOn(cfg, key); }
  var msgs    = [];
  var open    = false;
  var busy    = false;
  var greeted = false;

  // ── Booking flow state ───────────────────────────────────────────────────
  var bookingStep = 0;   // 0 = idle, >0 = en modo reserva (DeepSeek conduce)
  var bookingPending = null;   // campo que DeepSeek está pidiendo ahora
  var bookingReview = false;   // el resumen final está a la vista, esperando confirmación
  var submitting = false;      // evita envíos duplicados de la reserva
  var bookingData = {};

  // ── Cancel flow state ────────────────────────────────────────────────────
  var cancelStep = 0;    // 0 = idle, 1 = asking contacto, 2 = asking fecha
  var cancelData = {};

  // ── Active reservation state (misma lógica que asistente.html) ───────────
  var RESERVA_SESS = SESS + '_reserva';
  var activeReservation = null;
  var dupAttempts = 0;
  var spamUntil = 0;
  var modifyMode = false;
  try { activeReservation = JSON.parse(sessionStorage.getItem(RESERVA_SESS) || 'null'); } catch (e) {}
  function saveReserva() { try {
    if (activeReservation) sessionStorage.setItem(RESERVA_SESS, JSON.stringify(activeReservation));
    else sessionStorage.removeItem(RESERVA_SESS);
  } catch (e) {} }
  var MODIFY_TRIGGERS = CORE.MODIFY_TRIGGERS;   // raíz compartida (arreglo del \b que fallaba con "modificar")

  var CANCEL_TRIGGERS  = /\bcancel(ar)?\b|quiero cancelar/i;
  var BOOKING_TRIGGERS = /reservar|agendar|cita|quiero ir|disponibilidad|appointment|reserva|hora libre|turno|quiero una cita/i;

  try { msgs = JSON.parse(sessionStorage.getItem(SESS) || '[]'); } catch (e) { msgs = []; }
  var BOOKING_SESS = SESS + '_booking';
  try {
    var restoredBooking = JSON.parse(sessionStorage.getItem(BOOKING_SESS) || 'null');
    if (restoredBooking && typeof restoredBooking === 'object') {
      bookingStep = restoredBooking.bookingStep || 0;
      bookingData = restoredBooking.bookingData || {};
      bookingPending = restoredBooking.bookingPending || null;
      bookingReview = !!restoredBooking.bookingReview;
      horaPendiente = restoredBooking.horaPendiente || null;
    }
  } catch (e) {}
  if (msgs.length) greeted = true;

  function save() {
    try {
      sessionStorage.setItem(SESS, JSON.stringify(msgs.slice(-60)));
      if (bookingStep) sessionStorage.setItem(BOOKING_SESS, JSON.stringify({ bookingStep: bookingStep, bookingData: bookingData, bookingPending: bookingPending, bookingReview: bookingReview, horaPendiente: horaPendiente, language: cfg.language }));
      else sessionStorage.removeItem(BOOKING_SESS);
    } catch (e) {}
  }

  // Halo del pulso: mismo color del negocio, translúcido. Si el color no es
  // un hex reconocible, caemos a un negro suave en vez de romper el CSS.
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

    '.jbw-cards-wrap{width:100%;padding:2px 0 0;}',
    '.jbw-cards{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:0 0 4px;}',
    '.jbw-card{display:flex;flex-direction:column;align-items:center;text-align:center;',
    'gap:2px;width:100%;font-family:inherit;cursor:pointer;background:#fff;',
    'border:1.5px solid rgba(0,0,0,.06);border-radius:18px;padding:16px 12px 14px;',
    'min-height:124px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 14px rgba(0,0,0,.05);',
    'transition:transform .18s cubic-bezier(.22,1,.36,1),box-shadow .18s,border-color .18s;',
    'opacity:0;animation:jbw-card-in .34s cubic-bezier(.22,1,.36,1) forwards;}',
    '@keyframes jbw-card-in{from{opacity:0;transform:translateY(10px) scale(.97);}to{opacity:1;transform:none;}}',
    '.jbw-card:hover{transform:translateY(-3px);border-color:rgba(0,0,0,.10);',
    'box-shadow:0 2px 4px rgba(0,0,0,.05),0 12px 28px rgba(0,0,0,.10);}',
    '.jbw-card:active{transform:translateY(-1px) scale(.97);}',
    '.jbw-card-ico{width:52px;height:52px;border-radius:15px;margin-bottom:8px;',
    'display:flex;align-items:center;justify-content:center;font-size:25px;}',
    '.jbw-card-img{width:52px;height:52px;border-radius:15px;object-fit:cover;',
    'margin-bottom:8px;display:block;background:#f2f2f4;}',
    '.jbw-card-no-image{justify-content:center;min-height:100px;padding:18px 12px;}',
    '.jbw-gallery{width:100%;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:4px 0;}',
    '.jbw-gallery img{width:100%;aspect-ratio:1.35;object-fit:cover;border-radius:12px;background:#f2f2f4;}',
    '.jbw-gallery-more{border:0;background:none;color:var(--jbw-color,#1a4a2e);font:inherit;font-size:13px;font-weight:700;cursor:pointer;padding:6px 0;}',
    '.jbw-card-name{font-size:13px;font-weight:650;line-height:1.3;color:#16181d;}',
    '.jbw-card-price{font-size:14.5px;font-weight:700;margin-top:4px;}',
    '.jbw-card-badge{font-size:10px;font-weight:600;margin-top:5px;padding:3px 8px;',
    'border-radius:20px;background:#fff5e0;color:#8a5a00;}',
    '.jbw-card-desc{font-size:11px;color:#6b6f76;line-height:1.4;margin-top:6px;}',
    '.jbw-quick{display:flex;flex-wrap:wrap;gap:7px;padding:2px 0 2px 34px;}',
    '.jbw-quick-btn{font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;',
    'background:#fff;border:1.5px solid rgba(0,0,0,.08);border-radius:20px;padding:8px 13px;',
    'color:#16181d;min-height:36px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 3px 10px rgba(0,0,0,.04);',
    'transition:transform .16s cubic-bezier(.22,1,.36,1),box-shadow .16s,border-color .16s;',
    'opacity:0;animation:jbw-card-in .3s cubic-bezier(.22,1,.36,1) forwards;}',
    '.jbw-quick-btn:hover{transform:translateY(-2px);border-color:rgba(0,0,0,.14);',
    'box-shadow:0 2px 4px rgba(0,0,0,.05),0 8px 20px rgba(0,0,0,.08);}',
    '.jbw-quick-btn:active{transform:translateY(0) scale(.98);}',
    '@media(prefers-reduced-motion:reduce){.jbw-quick-btn{animation:none;opacity:1;}}',
    '@media(prefers-reduced-motion:reduce){.jbw-card{animation:none;opacity:1;}}',

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
  function greeting() {
    return CORE.greeting(cfg, featureOn('reservations'));
  }

  function renderQuickActions() {
    var acciones = CORE.accionesRapidas(cfg, featureOn('reservations'));

    var wrap = document.createElement('div');
    wrap.className = 'jbw-quick';
    acciones.forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'jbw-quick-btn';
      b.textContent = a.label;
      b.style.animationDelay = (i * 60) + 'ms';
      b.addEventListener('click', function () {
        if (inp.disabled) return;
        wrap.remove();
        send(a.msg);
      });
      wrap.appendChild(b);
    });
    msgsEl.appendChild(wrap);
    CORE.irAlFondo(msgsEl, );
  }

  function paint() {
    var c = cfg.color;
    fab.style.background    = c;
    // El halo del pulso usa el color del negocio, translúcido.
    fab.style.setProperty('--jbw-pulse', CORE.hexToRgba(c, 0.45));
    headEl.style.background = c;
    snd.style.background    = c;
    nameEl.textContent      = cfg.businessName || 'Assistant';
    inp.placeholder = cfg.language === 'en' ? 'Type a message…' : 'Escribe un mensaje…';
    snd.setAttribute('aria-label', cfg.language === 'en' ? 'Send' : 'Enviar');
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
    CORE.irAlFondo(msgsEl, role === 'user');   // tu propio mensaje siempre te lleva abajo
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
    CORE.irAlFondo(msgsEl, );
  }

  function hideTyping() {
    var el = document.getElementById('jbw-ty');
    if (el) el.remove();
  }

  // Render any saved messages from this session. Historial viejo puede tener
  // marcadores crudos guardados antes de este fix: se sanea al restaurar.
  msgs.forEach(function (m) {
    var esBot = m.role !== 'user';
    addMsg(esBot ? 'bot' : 'user', esBot ? CORE.limpiarMarcadores(m.content) : m.content);
  });

  // El icono lo elige el motor; aquí solo se pinta con las clases del widget.
  function buildIcon(nombre) {
    var el = document.createElement('div');
    el.className = 'jbw-card-ico';
    el.textContent = CORE.iconFor(nombre);
    el.style.background = CORE.hexToRgba(cfg.color, 0.12);
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

    items.forEach(function (item, idx) {
      var card = document.createElement('button');
      card.className = 'jbw-card';
      card.type = 'button';
      card.style.animationDelay = (idx * 55) + 'ms';

      if (item.imagen) {
        var img = document.createElement('img');
        img.className = 'jbw-card-img';
        img.src = item.imagen;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function () {
          if (img.parentNode) img.parentNode.replaceChild(buildIcon(item.nombre), img);
        };
        card.appendChild(img);
      } else {
        card.classList.add('jbw-card-no-image');
      }

      var name = document.createElement('div');
      name.className = 'jbw-card-name';
      name.textContent = item.nombre || 'Servicio';
      card.appendChild(name);

      if (item.precio) {
        var price = document.createElement('div');
        price.className = 'jbw-card-price';
        price.style.color = cfg.color;
        price.textContent = item.precio;
        card.appendChild(price);
      }

      if (CORE.isPopular(item)) {
        var badge = document.createElement('div');
        badge.className = 'jbw-card-badge';
        badge.textContent = '⭐ Popular';
        card.appendChild(badge);
      }

      if (item.descripcion) {
        var desc = document.createElement('div');
        desc.className = 'jbw-card-desc';
        desc.textContent = item.descripcion;
        card.appendChild(desc);
      }

      card.addEventListener('click', function () {
        if (inp.disabled) return;
        var restaurant = cfg.templateId === 'restaurant';
        var nom = item.nombre || (restaurant ? 'este plato' : 'este servicio');
        send(cfg.language === 'en'
          ? (restaurant ? 'I am interested in this menu item: ' : 'I am interested in the service: ') + nom
          : (restaurant ? 'Me interesa este plato: ' : 'Me interesa el servicio: ') + nom);
      });

      row.appendChild(card);
    });

    wrap.appendChild(row);
    msgsEl.appendChild(wrap);
    CORE.irAlFondo(msgsEl, );
  }

  function renderGallery() {
    var images = cfg.media && Array.isArray(cfg.media.gallery) ? cfg.media.gallery : [];
    if (!images.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'jbw-cards-wrap';
    var grid = document.createElement('div');
    grid.className = 'jbw-gallery';
    var shown = 4;
    function appendImages(limit) {
      images.slice(grid.children.length, limit).forEach(function (url) {
        var image = document.createElement('img');
        image.src = url;
        image.alt = cfg.language === 'en' ? 'Gallery image' : 'Imagen de galería';
        image.loading = 'lazy';
        grid.appendChild(image);
      });
    }
    appendImages(shown);
    wrap.appendChild(grid);
    if (images.length > shown) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'jbw-gallery-more';
      more.textContent = cfg.language === 'en' ? 'See more photos' : 'Ver más fotos';
      more.addEventListener('click', function () {
        appendImages(images.length);
        more.remove();
        CORE.irAlFondo(msgsEl, );
      });
      wrap.appendChild(more);
    }
    msgsEl.appendChild(wrap);
    CORE.irAlFondo(msgsEl, );
  }

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
          ? "Sorry, that didn't go through 😅 Mind trying again?"
          : 'Uy, no me llegó tu mensaje 😅 ¿Lo intentas otra vez?');
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
// Extrae datos de reserva de un mensaje libre. Solo captura lo inequívoco:
// ante la duda no rellena, para que el flujo pregunte. Un campo inventado se
// convierte en una cita a la hora equivocada.
var FECHA_RE = new RegExp(
  '(pasado\\s+ma(ñ|n)ana|ma(ñ|n)ana|hoy|' +
  '(este|el|pr(ó|o)ximo)\\s+(lunes|martes|mi(é|e)rcoles|jueves|viernes|s(á|a)bado|domingo)|' +
  '(lunes|martes|mi(é|e)rcoles|jueves|viernes|s(á|a)bado|domingo)|' +
  '\\d{1,2}\\s+de\\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)|' +
  '\\d{1,2}[\\/\\-]\\d{1,2}(?:[\\/\\-]\\d{2,4})?|' +
  '\\d{4}-\\d{2}-\\d{2})', 'i');

// "3pm", "15:00", "3:30 pm", "a las 4". No inventamos AM/PM: si no lo dicen,
// se guarda la hora tal cual y el resumen la enseña antes de confirmar.
var HORA_RE = /(?:a\s+las\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i;
var HORA_CTX = /(a\s+las|hrs?|horas?|:\d{2}|\ba\.?m\.?\b|\bp\.?m\.?\b)/i;

var PERSONAS_RE = /(?:para|somos|seríamos|serian|ser[ií]amos)\s+(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b|\b(\d{1,3}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+personas?\b/i;
var NUM_PAL = { un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10 };

var EMAIL_RE2 = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
var TEL_RE = /(\+?\d[\d\s().-]{6,}\d)/;

// "las 4" puede ser las 04:00 o las 16:00. Se decide con el horario real del
// negocio: si solo una de las dos cae dentro, esa es. Si ambas o ninguna
// encajan, se pregunta en vez de adivinar.
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

// Devuelve { hora } resuelta, { ambigua: n } si hay que preguntar, o null.
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

  // El modelo emite marcadores internos ([MOSTRAR_MENU], [RESERVA_CONFIRMADA],
  // [LEAD_MINIMO]…). Antes solo se quitaba [MOSTRAR_MENU] y el resto se
  // pintaba tal cual: al confirmar una reserva el visitante veía
  // "[RESERVA_CONFIRMADA]" en pantalla. Se limpian todos por patrón, así que
  // un marcador nuevo tampoco se escapará.

  // El prompt pide texto plano, pero el modelo se escapa y manda **negritas**
  // o ### títulos de vez en cuando. Aquí se limpian: en una burbuja de chat
  // los asteriscos se ven como un error, no como énfasis.
  // Solo bajamos solos si ya estabas abajo. Si subiste a releer algo, un
  // mensaje nuevo ya no te arrastra: era imposible leer el historial mientras
  // el bot escribía.
function extractBooking(text, menu) {
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
        var r = resolverHora(hh, h[2], h[3], cfg.businessHours);
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
  var nm = t.match(/\b(?:soy|me\s+llamo|mi\s+nombre\s+es)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})?)/i);
  if (nm) {
    var cand = nm[1].trim();
    if (!/^(que|quien|el|la|un|una|para|de|del)$/i.test(cand.split(/\s+/)[0])) out.nombre = cand;
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

  // Siguiente campo sin rellenar. El flujo deja de ser una cola fija: si el
  // cliente ya dijo servicio y fecha, esos pasos no se preguntan.
  // "Hola quiero corte mañana a las 4" no dice "reservar" ni "cita", así que
  // BOOKING_TRIGGERS no lo pillaba. Si hay intención + un servicio real + día
  // u hora, es una reserva. Se exige la palabra de intención a propósito:
  // "¿cuánto cuesta el corte mañana?" es una pregunta de precio, no una cita.

  // El paso pregunta un campo concreto, pero la persona puede responder otra
  // cosa ("Somos 3 personas" cuando se pedía el email). Sin esto, esa frase se
  // guardaba como email y el cliente nunca recibía su confirmación.
  // Primer campo sin rellenar, o -1 si ya está todo. `nota` no necesita trato
  // especial: ya es el último paso de la lista.
  // Cuando la hora podría ser AM o PM y el horario no lo aclara, se pregunta
  // en vez de decidir por el cliente. Una cita a las 4 AM no la quiere nadie.
   var horaPendiente = horaPendiente || null;

  function preguntarHoraAmbigua(amb, lang) {
    horaPendiente = amb;
    addMsg('bot', lang === 'en'
      ? 'Quick one 😊 do you mean ' + amb.n + ' in the afternoon or ' + amb.n + ' in the morning?'
      : 'Una cosita 😊 ¿te refieres a las ' + amb.n + ' de la tarde o a las ' + amb.n + ' de la mañana?');
  }

  function resolverHoraPendiente(t, lang) {
    if (!horaPendiente) return false;
    var esPM = /tarde|noche|pm|p\.m|afternoon|evening/i.test(t);
    var esAM = /ma(ñ|n)ana|madrugada|am|a\.m|morning/i.test(t);
    if (!esPM && !esAM) {
      addMsg('bot', lang === 'en' ? 'Sorry, morning or afternoon? 😊' : 'Perdona, ¿de la mañana o de la tarde? 😊');
      return true;
    }
    bookingData.hora = horaPendiente.n + horaPendiente.mm + (esPM ? ' PM' : ' AM');
    var amb = horaPendiente; horaPendiente = null;
    addMsg('bot', (lang === 'en' ? 'Got it 😊 ' : 'Perfecto 😊 ') + '⏰ ' + bookingData.hora);
    seguirDesdeLoQueFalta(lang);
    return true;
  }

   var BARE_OK = { nombre: 1, telefono: 1, email: 1, contacto: 1, specialRequests: 1 };
  function bookingFaltan() {
    return CORE.bookingRequirements(cfg, bookingData);
  }
  function bookingCaptured() {
    var out = {};
    CORE.summaryFields(cfg).concat(['contacto']).forEach(function (k) {
      if (bookingData[k]) out[k] = bookingData[k];
    });
    return out;
  }

  function recordFoodRequest(text, lang) {
    var food = CORE.applyFoodPreferences(bookingData.foodPreferences, text, cfg);
    if (food) {
      bookingData.foodPreferences = food;
      bookingData.specialRequests = CORE.foodPreferencesToSpecialRequests(food, lang);
    }
    if (CORE.isFoodMedical(text, cfg)) {
      addMsg('bot', lang === 'en'
        ? 'Thanks for telling us. I will note this dietary restriction for the restaurant. However, I cannot guarantee the absence of allergens or cross-contamination; the restaurant must confirm it directly.'
        : 'Gracias por avisarnos. Anotaré tu restricción alimentaria para que el restaurante la vea. Sin embargo, no puedo garantizar la ausencia de alérgenos o contaminación cruzada; el restaurante deberá confirmarlo directamente.');
    }
  }

  // Cada turno de la reserva lo redacta DeepSeek con el estado estructurado.
  // El frontend sigue siendo dueño del estado y la validación; el modelo nunca
  // confirma ni inventa disponibilidad.
  function askBookingTurn(lang) {
    var faltan = bookingFaltan();
    var completo = faltan.length === 0;
    bookingPending = completo ? null : faltan[0];
    // The model never speaks for a complete booking; only the POST decides it.
    if (completo) { showBookingSummary(); return; }
    if (bookingPending === 'specialRequests') {
      var requestQuestion = cfg.templateId === 'restaurant'
        ? (lang === 'en' ? 'Do you have any allergy, intolerance, table preference, or special request?' : '¿Tienes alguna alergia, intolerancia, preferencia de mesa o petición especial?')
        : cfg.templateId === 'barber'
          ? '¿Tienes alguna preferencia de estilo, diseño, sensibilidad o petición especial?'
          : '¿Tienes alguna sensibilidad, alergia, embarazo, lesión o petición especial?';
      addMsg('bot', requestQuestion + (lang === 'en' ? ' Write "No" if you do not have one.' : ' Escribe "No" si no tienes ninguna.'));
      return;
    }
    busy = true; inp.disabled = true; snd.disabled = true;
    showTyping();
    var body = { clientId: clientId, messages: msgs, booking: { captured: bookingCaptured(), faltan: faltan } };
    if (previewToken) body.previewToken = previewToken;
    fetch(API + '/api/client-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping();
        var raw = (d && d.text) || '';
        // Notas: el modelo marca lo importante con [NOTA: ...] en esta misma
        // respuesta. Se acumula en bookingData.notes y se quita del texto (y del
        // historial) para que ni el cliente ni el modelo vuelvan a verlo.
        var nx = CORE.extractNotas(raw);
        if (nx.notas.length) bookingData.notes = CORE.fusionarNotas(bookingData.notes, nx.notas);
        var txt = raw ? CORE.limpiarMarcadores(nx.limpio) : '';
        if (!txt) txt = (lang === 'en' ? 'Could you share your ' : '¿Me compartes tu ') + faltan[0] + '?';
        addMsg('bot', txt);
        // Se persiste el texto ya saneado (lo mismo que se mostró): así ni el
        // cliente ni DeepSeek vuelven a ver marcadores al recargar el historial.
        msgs.push({ role: 'assistant', content: txt });
        save();
      })
      .catch(function () {
        hideTyping();
        addMsg('bot', lang === 'en' ? "Sorry, that didn't go through 😅 Mind trying again?" : 'Uy, no me llegó tu mensaje 😅 ¿Lo intentas otra vez?');
      })
      .finally(function () { busy = false; inp.disabled = false; snd.disabled = false; inp.focus(); });
  }

  function seguirDesdeLoQueFalta(lang) { askBookingTurn(lang); }


  // Revisar antes de guardar: un dedazo en el teléfono o la fecha se corrige
  // aquí, no cuando el dueño intenta llamar y el número no existe.
  function showBookingSummary() {
    var lang = cfg.language === 'en' ? 'en' : 'es';
    var lineas = CORE.summaryFields(cfg).concat(['contacto'])
      .filter(function (k) { return bookingData[k]; })
      .map(function (k) { return RESUMEN_ICONOS[k] + ' ' + CORE.summaryLabel(cfg, k, lang) + ': ' + bookingData[k]; });

    var quien = bookingData.nombre ? ' ' + String(bookingData.nombre).split(/\s+/)[0] : '';
    addMsg('bot', (lang === 'en'
        ? 'Perfect' + quien + ' 😊 let\'s check everything before confirming:\n\n'
        : 'Perfecto' + quien + ' 😊 revisemos que todo esté correcto antes de confirmar:\n\n') +
      lineas.join('\n') + (lang === 'en' ? '\n\nAll good? 😄' : '\n\n¿Todo correcto? 😄'));

    var wrap = document.createElement('div');
    wrap.className = 'jbw-quick';
    [{ label: lang === 'en' ? '✅ Yes, confirm it' : '✅ Sí, confirmar cita', ok: true },
     { label: lang === 'en' ? '✏️ I want to change something' : '✏️ Quiero cambiar algo', ok: false }
    ].forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'jbw-quick-btn';
      b.textContent = a.label;
      b.style.animationDelay = (i * 60) + 'ms';
      b.addEventListener('click', function () {
        wrap.remove();
        addMsg('user', a.label);
        if (a.ok) { submitBooking(); return; }
        bookingStep = 1;
        bookingPending = null;
        bookingReview = false;
        addMsg('bot', lang === 'en' ? 'What would you like to change? Your other reservation details will stay the same.' : '¿Qué quieres cambiar? Tus demás datos de reserva se conservarán.');
      });
      wrap.appendChild(b);
    });
    msgsEl.appendChild(wrap);
    CORE.irAlFondo(msgsEl, );
    bookingReview = true;   // el cliente puede confirmar por botón o por texto
  }

  function submitBooking() {
    if (submitting) return;        // evita envíos duplicados
    submitting = true;
    bookingReview = false;
    var lang = cfg.language === 'en' ? 'en' : 'es';
    if (!bookingData.idempotencyKey) bookingData.idempotencyKey = CORE.genIdempotencyKey();
    busy = true; inp.disabled = true; snd.disabled = true;
    addMsg('bot', lang === 'en' ? 'Checking availability…' : 'Revisando disponibilidad…');
    fetch(API + '/api/reservations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(Object.assign({ clientId: clientId }, bookingData)),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok === false && d.motivo) {
          var msg = d.motivo === 'fuera_de_horario'
            ? (lang === 'en' ? 'That time is not available. Please tell me another time and I will check it 😊' : 'Esa hora no está disponible. Dime otra hora y revisaré la disponibilidad 😊')
            : (lang === 'en' ? 'Sorry 😊 ' : 'Uy 😊 ') + (d.mensaje || '');
          if (d.alternativa) {
            msg += (lang === 'en' ? ' The first slot I can offer is ' : ' El horario más cercano que te puedo ofrecer es ') + d.alternativa + '.';
            msg += (lang === 'en' ? ' Want me to book that one?' : ' ¿Te lo agendo?');
          } else {
            msg += (lang === 'en' ? ' Tell me another day or time and I\'ll check 😊' : ' Dime otro día u hora y lo miro 😊');
          }
          addMsg('bot', msg);
          msgs = msgs.filter(function (m) { return m.role !== 'assistant' || !/pendiente|confirmad[ao]|equipo.*revis/i.test(m.content); });
          save();
          delete bookingData.hora;
          bookingStep = 1;
          return;
        }
        if (d && d.ok) {   // éxito: creada nueva o reconocida idempotente (duplicate)
          activeReservation = {
            reservationId: d.reservationId || (activeReservation && activeReservation.reservationId) || null,
            actionToken: d.actionToken || (activeReservation && activeReservation.actionToken) || null,
            fecha: bookingData.fecha, hora: bookingData.hora,
            personas: bookingData.partySize || bookingData.personas || '',
            servicio: bookingData.servicio || '', specialRequests: bookingData.specialRequests || '',
            estado: d.status || 'confirmada', confirmedAt: Date.now(), language: lang,
          };
          saveReserva();
          addMsg('bot', d.duplicate ? CORE.reservaTextos(lang).duplicateActive : mensajeReservaGuardada(d, lang));
          if (d.duplicate) offerReservationActions(lang);
          bookingStep = 0; bookingData = {}; bookingPending = null; dupAttempts = 0;
          save();   // limpia BOOKING_SESS: sin esto una recarga reanudaría una reserva fantasma
          return;
        }
        addMsg('bot', lang === 'en'
          ? "We couldn't save your request 😕 Your details are still here — want to try again?"
          : 'No pudimos guardar tu solicitud 😕 Tus datos siguen aquí, ¿lo intentamos de nuevo?');
        showBookingSummary();
      })
      .catch(function () {
        addMsg('bot', lang === 'en'
          ? "Sorry, that didn't go through 😅 Your details are still here — try again?"
          : 'Uy, no se envió 😅 Tus datos siguen aquí, ¿lo intentamos otra vez?');
        showBookingSummary();
      })
      .finally(function () {
        submitting = false;
        busy = false; inp.disabled = false; snd.disabled = false; inp.focus();
      });
  }

  // Mensaje final según lo que confirmó el backend. La cita SIEMPRE nace
  // pendiente: nunca "confirmada". Cubre los casos A/B/C del requisito.
  function mensajeReservaGuardada(d, lang) {
    var en = lang === 'en';
    return en ? 'Your request has been registered successfully.' : 'Tu solicitud quedó registrada correctamente.';
  }

  // ── Reserva activa: acciones (idénticas a asistente.html vía chat-core) ──
  function offerReservationActions(lang) {
    var T = CORE.reservaTextos(lang);
    var wrap = document.createElement('div');
    wrap.className = 'jbw-quick';
    [{ label: T.modify, act: 'modify' }, { label: T.cancel, act: 'cancel' }, { label: T.keep, act: 'keep' }
    ].forEach(function (o, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'jbw-quick-btn'; b.textContent = o.label; b.style.animationDelay = (i * 60) + 'ms';
      b.addEventListener('click', function () { wrap.remove(); addMsg('user', o.label); handleReservationAction(o.act, lang); });
      wrap.appendChild(b);
    });
    msgsEl.appendChild(wrap); CORE.irAlFondo(msgsEl, );
  }

  function handleReservationAction(act, lang) {
    if (!activeReservation) return;
    var T = CORE.reservaTextos(lang);
    if (act === 'keep') { addMsg('bot', T.keepMsg); return; }
    if (act === 'cancel') { submitActiveCancel(lang); return; }
    modifyMode = true;
    addMsg('bot', T.askChange);
  }

  function submitActiveCancel(lang) {
    var T = CORE.reservaTextos(lang);
    if (!activeReservation || !activeReservation.actionToken) { addMsg('bot', T.notFound); return; }
    busy = true; inp.disabled = true; snd.disabled = true; showTyping();
    fetch(API + '/api/cancel-reservation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId, actionToken: activeReservation.actionToken }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      hideTyping();
      if (d.found || d.ok) {
        addMsg('bot', T.cancelled);
        activeReservation = null; dupAttempts = 0; spamUntil = 0; modifyMode = false; saveReserva();
      } else addMsg('bot', T.cancelFail);
    }).catch(function () { hideTyping(); addMsg('bot', T.netFail); })
    .finally(function () { busy = false; inp.disabled = false; snd.disabled = false; inp.focus(); });
  }

  function submitModify(update, lang) {
    var T = CORE.reservaTextos(lang);
    if (!activeReservation || !activeReservation.actionToken) { addMsg('bot', T.notFound); modifyMode = false; return; }
    var body = {
      clientId: clientId, action: 'reschedule', actionToken: activeReservation.actionToken,
      fecha: update.fecha || activeReservation.fecha, hora: update.hora || activeReservation.hora,
    };
    if (update.partySize || update.personas) body.partySize = update.partySize || update.personas;
    if (update.specialRequests) body.specialRequests = update.specialRequests;
    if (update.foodPreferences) body.foodPreferences = update.foodPreferences;
    if (update.servicio) body.servicio = update.servicio;
    busy = true; inp.disabled = true; snd.disabled = true; showTyping();
    fetch(API + '/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (d) {
        hideTyping();
        if (d.ok && d.reservation) {
          activeReservation.fecha = d.reservation.fecha; activeReservation.hora = d.reservation.hora;
          activeReservation.personas = d.reservation.partySize || d.reservation.personas || activeReservation.personas;
          activeReservation.servicio = d.reservation.servicio || activeReservation.servicio;
          activeReservation.specialRequests = d.reservation.specialRequests || activeReservation.specialRequests;
          activeReservation.estado = d.reservation.estado || activeReservation.estado;
          saveReserva();
          addMsg('bot', T.modifyDone + CORE.reservaResumen(activeReservation, lang));
        } else if (d.ok === false && d.motivo) {
          addMsg('bot', T.modifyUnavail + (d.mensaje || '') + (d.alternativa ? (T.closest + d.alternativa) : ''));
        } else addMsg('bot', T.modifyFail);
      }).catch(function () { hideTyping(); addMsg('bot', T.netFail); })
      .finally(function () { modifyMode = false; busy = false; inp.disabled = false; snd.disabled = false; inp.focus(); });
  }

  function handleDuplicateAttempt(lang) {
    var s = CORE.duplicateAttemptState(activeReservation, dupAttempts, spamUntil, Date.now(), lang);
    dupAttempts = s.attempts; spamUntil = s.spamUntil;
    addMsg('bot', s.text);
    offerReservationActions(lang);
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

    // Modo modificar: el siguiente mensaje trae el cambio para la reserva activa.
    if (modifyMode) {
      addMsg('user', t);
      if (/^(cancelar|cancel|salir|exit)$/i.test(t)) { modifyMode = false; addMsg('bot', CORE.reservaTextos(lang).noChange); return; }
      var updW = CORE.buildModifyUpdate(t, cfg, activeReservation);
      if (!Object.keys(updW).length) { addMsg('bot', CORE.reservaTextos(lang).needChange); return; }
      submitModify(updW, lang);
      return;
    }

    // Con una reserva ya activa, un nuevo intento de reservar no crea otra:
    // se ofrece modificar o cancelar. [BUG-4/5]
    if (activeReservation && bookingStep === 0 && featureOn('reservations')) {
      var preARW = CORE.extractBooking(t, cfg.menu, cfg.businessHours, cfg.language, cfg);
      var looksNewW = CORE.pareceReserva(t, preARW) || BOOKING_TRIGGERS.test(t);
      if (CANCEL_TRIGGERS.test(t)) { addMsg('user', t); submitActiveCancel(lang); return; }
      if (MODIFY_TRIGGERS.test(t)) { addMsg('user', t); handleReservationAction('modify', lang); return; }
      if (looksNewW) { addMsg('user', t); handleDuplicateAttempt(lang); return; }
    }

    // ── Active booking flow: collect next field ──────────────────────────
    if (bookingStep > 0) {
      if (/^(cancelar|cancel|salir|exit)$/i.test(t)) {
        bookingStep = 0;
        bookingData = {};
        bookingReview = false;
        addMsg('user', t);
        addMsg('bot', lang === 'en'
          ? 'Reservation cancelled. Is there anything else I can help with?'
          : 'Reserva cancelada. ¿Hay algo más en lo que pueda ayudarte?');
        return;
      }
      // Confirmación por texto en el resumen final → crea la reserva de verdad.
      if (bookingReview && CORE.esConfirmacion(t)) {
        addMsg('user', t);
        submitBooking();
        return;
      }
      bookingReview = false;
      addMsg('user', t);
      msgs.push({ role: 'user', content: t });
      if (resolverHoraPendiente(t, lang)) return;

      var yaVisto = CORE.extractBooking(t, cfg.menu, cfg.businessHours, cfg.language, cfg);
      var amb = yaVisto.__horaAmbigua; if (amb) delete yaVisto.__horaAmbigua;
      var traidos = Object.keys(yaVisto);
      traidos.forEach(function (k) { bookingData[k] = yaVisto[k]; });

      // Preferencias que el cliente dice en su propio mensaje ("prefiero una
      // habitación silenciosa"), sin depender de que DeepSeek emita [NOTA:].
        var notasU = CORE.extractNotasUsuario(t, cfg);
       if (notasU.length) bookingData.notes = CORE.fusionarNotas(bookingData.notes, notasU);
       recordFoodRequest(t, lang);

      if (!traidos.length && CORRECCION_RE.test(t)) {
        for (var ci = 0; ci < CAMPO_MENCIONADO.length; ci++) {
          if (CAMPO_MENCIONADO[ci][0].test(t)) { delete bookingData[CAMPO_MENCIONADO[ci][1]]; break; }
        }
      } else if (!traidos.length && bookingPending && BARE_OK[bookingPending] &&
                 !bookingData[bookingPending] && CORE.valorValido(bookingPending, t)) {
         bookingData[bookingPending] = bookingPending === 'specialRequests' && /^(no|ninguna|ninguno)$/i.test(t.trim()) ? '' : t;
      }

       if (amb) { preguntarHoraAmbigua(amb, lang); return; }
       save();
       askBookingTurn(lang);
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
    var preExtraido = featureOn('reservations') ? CORE.extractBooking(t, cfg.menu, cfg.businessHours, cfg.language, cfg) : {};
    if (featureOn('reservations') && CORE.pareceReserva(t, preExtraido)) {
      addMsg('user', t);
      msgs.push({ role: 'user', content: t });
      save();
      bookingStep = 1;          // en modo reserva; DeepSeek conduce
      bookingData = {};

      var ambigua = preExtraido.__horaAmbigua;
      delete preExtraido.__horaAmbigua;
      Object.keys(preExtraido).forEach(function (k) { bookingData[k] = preExtraido[k]; });

        var notasIni = CORE.extractNotasUsuario(t, cfg);
       if (notasIni.length) bookingData.notes = CORE.fusionarNotas(bookingData.notes, notasIni);
       recordFoodRequest(t, lang);

       if (ambigua) { preguntarHoraAmbigua(ambigua, lang); return; }
       save();
       askBookingTurn(lang);
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
            ? 'This assistant is temporarily out of service. Please contact the business directly.'
            : 'Este asistente se encuentra temporalmente fuera de servicio. Comunícate directamente con el negocio.'));
        } else if (d.text) {
          var showMenu   = /\[MOSTRAR_MENU\]/.test(d.text);
          var cleanText  = CORE.limpiarMarcadores(d.text);
          if (cleanText) addMsg('bot', cleanText);
          if (showMenu) { renderMenu(); renderGallery(); }
          // La acción interna (mostrar menú) ya se extrajo de d.text; al
          // historial va solo el texto limpio, nunca el marcador crudo.
          msgs.push({ role: 'assistant', content: cleanText });
          save();
        } else {
          addMsg('bot', cfg.language === 'en'
            ? "Sorry, I didn't catch that 😅 Could you say it again?"
            : 'Perdona, no te entendí bien 😅 ¿Me lo repites?');
        }
      })
      .catch(function () {
        hideTyping();
        addMsg('bot', cfg.language === 'en'
          ? "Sorry, that didn't go through 😅 Mind trying again?"
          : 'Uy, no me llegó tu mensaje 😅 ¿Lo intentas otra vez?');
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
        var g = greeting();
        addMsg('bot', g);
        msgs.push({ role: 'assistant', content: g });
        save();
        renderQuickActions();
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

  }   // fin de iniciar()
})();
