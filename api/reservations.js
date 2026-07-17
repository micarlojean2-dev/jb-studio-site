import { Redis }  from '@upstash/redis';
import { faltaConfig, necesitaSetup } from '../lib/setup.js';
import { registrarCambio } from '../lib/changes.js';
import { Resend } from 'resend';

const redis  = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const FROM = 'reservas@jbstudio.app';

// ── Rate limit: 5 reservas/IP/hora ──────────────────────────────────────────
const ipStore = new Map();
const HOUR_MS = 60 * 60 * 1000;
const RPH     = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  if (!ipStore.has(ip)) ipStore.set(ip, { count: 0, ts: now });
  const d = ipStore.get(ip);
  if (now - d.ts > HOUR_MS) { d.count = 0; d.ts = now; }
  return ++d.count <= RPH;
}

// ── Email helpers ────────────────────────────────────────────────────────────

// Normaliza la fecha de la cita a ISO (YYYY-MM-DD) desde el texto libre del
// chat. Conservador a propósito: ante la duda devuelve '' en vez de adivinar.
// Un recordatorio enviado el día equivocado es peor que no enviarlo.
function rollYear(d, base, y, mon, day) {
  const mk = (x) => x.toISOString().slice(0, 10);
  const diasPasados = Math.floor((base - d) / 86400000);
  if (diasPasados > 30) {                    // muy atrás: se refiere al año que viene
    const next = new Date(Date.UTC(y + 1, mon, day));
    return next.getUTCDate() === day ? mk(next) : '';
  }
  if (diasPasados > 0) return '';            // pasó hace poco: ambiguo, no adivinamos
  return d.getUTCDate() === day ? mk(d) : '';
}

// "hoy" y "mañana" dependen de dónde está el negocio: a las 23:00 en México
// el servidor (UTC) ya va por el día siguiente y la cita se guardaba con un
// día de más.
function nowEnZona(tz) {
  try {
    const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return new Date(iso + 'T12:00:00Z');   // mediodía: inmune a horarios de verano
  } catch (e) {
    return new Date();
  }
}

function parseFechaISO(raw, now) {
  const txt = String(raw || '').toLowerCase().trim();
  if (!txt) return '';
  const base = now ? new Date(now) : new Date();
  const mk = (d) => d.toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

  if (/\bpasado\s+ma(ñ|n)ana\b/.test(txt)) return mk(addDays(base, 2));
  if (/\bhoy\b|\btoday\b/.test(txt)) return mk(base);
  if (/\bma(ñ|n)ana\b|\btomorrow\b/.test(txt)) return mk(addDays(base, 1));

  const DIAS = { domingo:0, lunes:1, martes:2, 'miercoles':3, 'miércoles':3, jueves:4, viernes:5, 'sabado':6, 'sábado':6,
                 sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  const MESES = { enero:0, febrero:1, marzo:2, abril:3, mayo:4, junio:5, julio:6, agosto:7,
                  septiembre:8, setiembre:8, octubre:9, noviembre:10, diciembre:11,
                  january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7,
                  september:8, october:9, november:10, december:11 };

  // "15 de julio" / "july 15" / "18 julio"
  const dm = txt.match(/\b(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)/);
  if (dm && MESES[dm[2]] !== undefined) {
    const day = parseInt(dm[1], 10), mon = MESES[dm[2]];
    if (day >= 1 && day <= 31) {
      let y = base.getUTCFullYear();
      let d = new Date(Date.UTC(y, mon, day));
      const r = rollYear(d, base, y, mon, day);
      if (r) return r;
    }
  }
  const md = txt.match(/\b([a-záéíóú]+)\s+(\d{1,2})\b/);
  if (md && MESES[md[1]] !== undefined) {
    const day = parseInt(md[2], 10), mon = MESES[md[1]];
    if (day >= 1 && day <= 31) {
      let y = base.getUTCFullYear();
      let d = new Date(Date.UTC(y, mon, day));
      const r = rollYear(d, base, y, mon, day);
      if (r) return r;
    }
  }

  // "este sábado" / "el viernes" / "sábado"
  for (const name in DIAS) {
    if (new RegExp('\\b' + name + '\\b').test(txt)) {
      const target = DIAS[name];
      let delta = (target - base.getUTCDay() + 7) % 7;
      if (delta === 0) delta = 7;                       // "el sábado" dicho un sábado = el próximo
      if (/\bpróximo\b|\bproximo\b|\bnext\b/.test(txt) && delta < 7) delta += 7;
      return mk(addDays(base, delta));
    }
  }

  // "2026-07-18" / "18/07" / "18-07-2026"
  const iso = txt.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const dmy = txt.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmy) {
    const day = +dmy[1], mon = +dmy[2] - 1;
    let y = dmy[3] ? +dmy[3] : base.getUTCFullYear();
    if (y < 100) y += 2000;
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
      const d = new Date(Date.UTC(y, mon, day));
      if (d.getUTCDate() === day) return mk(d);
    }
  }
  return '';
}

// El chat entrega texto libre ("2", "dos", "para 4 personas"). Guardamos un
// entero cuando se puede deducir; si no, lo dejamos vacío en vez de inventar.
// Hora normalizada a 24h para poder comparar y ordenar. Se guarda junto a la
// que escribió la persona, que es la que se le enseña.
function normalizeHora(v) {
  const t = String(v || '').trim();
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2] || '00';
  const suf = (m[3] || '').toLowerCase().replace(/\./g, '');
  if (suf === 'pm' && h < 12) h += 12;
  if (suf === 'am' && h === 12) h = 0;
  if (h < 0 || h > 23) return '';
  return String(h).padStart(2, '0') + ':' + min;
}

function normalizePersonas(v) {
  if (v === undefined || v === null || v === '') return '';
  const raw = String(v).trim();
  const digits = raw.match(/\d{1,3}/);
  if (digits) {
    const n = parseInt(digits[0], 10);
    return n >= 1 && n <= 200 ? n : '';
  }
  const words = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
                  siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3,
                  four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  for (const w in words) {
    if (new RegExp('\\b' + w + '\\b', 'i').test(raw)) return words[w];
  }
  return '';
}

function ownerHtml(r, businessName, color, panelUrl) {
  const boton = panelUrl ? `<div style="margin:22px 0 4px">
      <a href="${esc(panelUrl)}" style="display:inline-block;background:${esc(color)};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:10px">
        Ver y confirmar en tu panel →
      </a>
    </div>
    <p style="font-size:12px;color:#a8acb3;margin:6px 0 0">Desde tu panel puedes confirmar, rechazar o cancelar esta cita.</p>` : '';
  const inner = `<p style="font-size:15px;color:#16181d;line-height:1.6;margin:0 0 18px">
      Tu asistente acaba de recibir una solicitud de reserva.
    </p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee">
      ${fila('Cliente',  r.nombre,   color)}
      ${fila('Servicio', r.servicio, color)}
      ${fila('Fecha',    r.fecha,    color)}
      ${fila('Hora',     r.hora,     color)}
      ${fila('Personas', r.personas, color)}
      ${fila('Teléfono', r.telefono, color)}
      ${fila('Email',    r.email,    color)}
      ${fila('Nota',     r.nota,     color)}
      ${fila('Estado',   'Pendiente', color)}
    </table>
    ${boton}
    <p style="font-size:12.5px;color:#8a8f96;margin:18px 0 0">
      Recibida el ${esc(new Date(r.fechaSolicitud).toLocaleString('es'))}.
    </p>`;
  return shell(inner, 'Nueva reserva recibida 📅', color, businessName);
}

function clientHtml(r, businessName, lang, color) {
  const es = lang !== 'en';
  const inner = es
    ? `<p style="font-size:15px;color:#16181d;line-height:1.6;margin:0 0 4px">Hola <strong>${esc(r.nombre)}</strong> 😊</p>
       <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 18px">
         Recibimos tu solicitud en <strong>${esc(businessName)}</strong>. Revisamos disponibilidad y te confirmamos muy pronto.
       </p>
       <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee">
         ${fila('Servicio', r.servicio, color)}
         ${fila('Fecha',    r.fecha,    color)}
         ${fila('Hora',     r.hora,     color)}
         ${fila('Personas', r.personas, color)}
       </table>
       <p style="font-size:15px;color:#333;margin:20px 0 0">Te esperamos ✨</p>`
    : `<p style="font-size:15px;color:#16181d;line-height:1.6;margin:0 0 4px">Hi <strong>${esc(r.nombre)}</strong> 😊</p>
       <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 18px">
         We received your request at <strong>${esc(businessName)}</strong>. We'll check availability and confirm shortly.
       </p>
       <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee">
         ${fila('Service',  r.servicio, color)}
         ${fila('Date',     r.fecha,    color)}
         ${fila('Time',     r.hora,     color)}
         ${fila('People',   r.personas, color)}
       </table>
       <p style="font-size:15px;color:#333;margin:20px 0 0">See you soon ✨</p>`;
  return shell(inner, es ? 'Solicitud recibida ✨' : 'Request received ✨', color, businessName);
}

// Validación de reservas. Vive en el servidor a propósito: la del navegador
// es cortesía (para responder bonito), pero cualquiera puede saltársela con
// un curl. Esta es la que decide.
const DIAS_ORDEN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function minutosDe(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fmt(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const suf = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + suf;
}

// "60 minutos", "1 hora", "45 min", "1h 30". Si no se entiende -> 0 (no se
// aplica la regla en vez de inventar una duración).
function duracionMin(txt) {
  const t = String(txt || '').toLowerCase();
  if (!t) return 0;
  const hm = t.match(/(\d+)\s*h(?:ora)?s?\s*(\d+)?/);
  if (hm) return (+hm[1]) * 60 + (hm[2] ? +hm[2] : 0);
  const m = t.match(/(\d+)\s*m/);
  if (m) return +m[1];
  const solo = t.match(/^(\d+)$/);
  return solo ? +solo[1] : 0;
}

function rangosDelDia(businessHours, fechaISO) {
  if (!businessHours || !fechaISO) return null;          // sin datos: no se valida
  const dow = new Date(fechaISO + 'T12:00:00Z').getUTCDay();
  const dia = businessHours[DIAS_ORDEN[dow]];
  if (!dia) return null;
  if (dia.unknown) return null;                          // horario no especificado
  if (dia.enabled === false) return [];                  // cerrado ese día
  const out = [];
  (dia.ranges || []).forEach(r => {
    const a = minutosDe(r.start), b = minutosDe(r.end);
    if (a !== null && b !== null && b > a) out.push([a, b]);
  });
  return out.length ? out : [];
}

// Destinatarios de los avisos de reserva del negocio. Prefiere la lista
// notificationEmails (Fase 3); si no existe, cae en ownerEmail (compatibilidad
// con los clientes antiguos). Normaliza y quita duplicados.
function destinatariosAviso(client) {
  const lista = Array.isArray(client && client.notificationEmails) ? client.notificationEmails : null;
  const raw = (lista && lista.length) ? lista : (client && client.ownerEmail ? [client.ownerEmail] : []);
  const vistos = {};
  const out = [];
  raw.forEach((e) => {
    const v = String(e || '').trim().toLowerCase();
    if (v && !vistos[v]) { vistos[v] = 1; out.push(v); }
  });
  return out.slice(0, 10);
}

// Dos citas chocan si sus intervalos se pisan. Comparar solo la hora de inicio
// no basta: un corte de 60 min a las 16:00 y otro a las 16:30 se solapan media
// hora, y con un solo barbero eso es imposible.
function solapan(aIni, aDur, bIni, bDur) {
  const aFin = aIni + (aDur || 0);
  const bFin = bIni + (bDur || 0);
  if (aDur === 0 || bDur === 0) return aIni === bIni;   // sin duración: solo choque exacto
  return aIni < bFin && bIni < aFin;
}

// Cuántas citas vivas se solapan con la que se pide.
function contarSolapes(reservas, fechaISO, iniMin, durMin, menu) {
  let n = 0;
  for (const r of reservas) {
    if (!activa(r) || r.fechaISO !== fechaISO) continue;
    const ini = minutosDe(r.horaISO);
    if (ini === null) continue;                          // sin hora normalizada: no cuenta
    const item = (menu || []).find(m => m.nombre && r.servicio &&
      String(r.servicio).toLowerCase().indexOf(String(m.nombre).toLowerCase()) !== -1);
    const dur = duracionMin(item && item.duracion);
    if (solapan(iniMin, durMin, ini, dur)) n++;
  }
  return n;
}

function validarReserva(client, fechaISO, horaISO, servicio, ahoraMs, reservas) {
  // Feriados: fechas sueltas en las que el negocio no abre aunque sea un día
  // laborable de su horario semanal.
  const feriados = Array.isArray(client.holidays) ? client.holidays : [];
  if (fechaISO && feriados.indexOf(fechaISO) !== -1) {
    return { ok: false, motivo: 'feriado', mensaje: 'Ese día no abrimos.' };
  }

  const bh = client.businessHours;
  const rangos = rangosDelDia(bh, fechaISO);
  if (rangos === null) return { ok: true };              // sin horario fiable: no bloqueamos

  if (!rangos.length) {
    return { ok: false, motivo: 'dia_cerrado', mensaje: 'Ese día el negocio está cerrado.' };
  }

  const pedido = minutosDe(horaISO);
  if (pedido === null) return { ok: true };              // hora no normalizable: no bloqueamos

  // Duración: si el servicio no cabe antes del cierre, no vale.
  const item = (client.menu || []).find(m => m.nombre && servicio &&
    String(servicio).toLowerCase().indexOf(String(m.nombre).toLowerCase()) !== -1);
  const dur = duracionMin(item && item.duracion);

  let dentro = null;
  for (const [a, b] of rangos) {
    if (pedido >= a && pedido <= b) { dentro = [a, b]; break; }
  }
  if (!dentro) {
    const primero = rangos[0];
    return {
      ok: false,
      motivo: 'fuera_de_horario',
      mensaje: 'En ese horario ya estamos cerrados.',
      alternativa: pedido < primero[0] ? fmt(primero[0]) : null,
    };
  }
  if (dur > 0 && pedido + dur > dentro[1]) {
    return {
      ok: false,
      motivo: 'no_cabe_antes_del_cierre',
      mensaje: 'Este servicio necesita más tiempo del que queda disponible ese día.',
      alternativa: dentro[1] - dur >= dentro[0] ? fmt(dentro[1] - dur) : null,
    };
  }

  // Anticipación mínima, medida en la zona del negocio.
  const notice = Number.isFinite(client.minNoticeHours) ? client.minNoticeHours : 0;
  if (notice > 0) {
    const tz = client.timezone || 'UTC';
    const ahora = ahoraMs ? new Date(ahoraMs) : new Date();
    const hoyISO = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
    if (fechaISO === hoyISO) {
      const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(ahora);
      const ahoraMin = minutosDe(hhmm);
      if (ahoraMin !== null && pedido - ahoraMin < notice * 60) {
        return {
          ok: false,
          motivo: 'poca_anticipacion',
          mensaje: 'Necesitamos al menos ' + notice + (notice === 1 ? ' hora' : ' horas') + ' de anticipación para preparar tu cita.',
          alternativa: ahoraMin + notice * 60 <= dentro[1] ? fmt(ahoraMin + notice * 60) : null,
        };
      }
    }
  }
  // Capacidad: cuántas citas simultáneas admite el negocio (barberos, cabinas,
  // mesas). Sin este control, dos clientes reservan el mismo hueco y ambos
  // aparecen en la puerta.
  const cap = Number.isFinite(client.capacityPerSlot) ? client.capacityPerSlot : null;
  if (cap !== null && cap >= 1 && Array.isArray(reservas)) {
    const ocupadas = contarSolapes(reservas, fechaISO, pedido, dur, client.menu);
    if (ocupadas >= cap) {
      return {
        ok: false,
        motivo: 'sin_disponibilidad',
        mensaje: cap === 1
          ? 'Ese horario ya está ocupado.'
          : 'Ya no nos quedan huecos a esa hora.',
        alternativa: proximoHueco(client, fechaISO, pedido, dur, dentro, reservas),
      };
    }
  }

  return { ok: true };
}

// Primer inicio, a partir del pedido, en el que caben el servicio y la
// capacidad. Se avanza de 15 en 15 minutos: proponer "16:07" sería absurdo.
function proximoHueco(client, fechaISO, desde, dur, rango, reservas) {
  const cap = Number.isFinite(client.capacityPerSlot) ? client.capacityPerSlot : 1;
  const paso = 15;
  const limite = rango[1] - (dur || 0);
  for (let t = Math.ceil((desde + 1) / paso) * paso; t <= limite; t += paso) {
    if (contarSolapes(reservas, fechaISO, t, dur, client.menu) < cap) return fmt(t);
  }
  return null;                                            // hoy no queda hueco
}

// ── Plantillas del proceso diario ───────────────────────────────────────────
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function shell(inner, titulo, color, kicker) {
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#eef0f3;padding:32px 16px;margin:0">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.10)">
  <div style="background:${esc(color)};padding:24px 28px">
    <p style="margin:0;color:rgba(255,255,255,.72);font-size:11px;letter-spacing:.08em;text-transform:uppercase">${esc(kicker)}</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:21px">${esc(titulo)}</h1>
  </div>
  <div style="padding:24px 28px">${inner}</div>
  <div style="padding:0 28px 22px">
    <p style="margin:0;font-size:11.5px;color:#a8acb3;border-top:1px solid #eee;padding-top:14px">
      Tu asistente de <a href="https://jbstudio.app" style="color:${esc(color)};text-decoration:none">JB Studio</a> preparó esto por ti.
    </p>
  </div>
</div>
</body></html>`;
}

function citaCard(r, color) {
  return `<div style="border:1px solid #eaecef;border-radius:12px;padding:14px 16px;margin-bottom:10px">
    <div style="font-size:17px;font-weight:700;color:${esc(color)}">${esc(r.hora)}</div>
    <div style="font-size:15px;font-weight:600;color:#16181d;margin-top:2px">${esc(r.nombre)}</div>
    ${r.servicio ? `<div style="font-size:13px;color:#6b6f76;margin-top:2px">${esc(r.servicio)}</div>` : ''}
    ${r.personas ? `<div style="font-size:13px;color:#6b6f76;margin-top:2px">${esc(r.personas)} persona${r.personas > 1 ? 's' : ''}</div>` : ''}
    ${r.telefono ? `<div style="font-size:12px;color:#a8acb3;margin-top:6px">${esc(r.telefono)}</div>` : ''}
  </div>`;
}

function dailySummaryHtml(citas, negocio, color) {
  // Ordenadas por hora para que se lean como una agenda, no como una lista.
  const ord = citas.slice().sort((a, b) => String(a.hora).localeCompare(String(b.hora), 'es', { numeric: true }));
  const inner = `<p style="font-size:15px;color:#16181d;line-height:1.6;margin:0 0 16px">
      Estas son tus citas de hoy en <strong>${esc(negocio)}</strong>:
    </p>
    ${ord.map((r) => citaCard(r, color)).join('')}
    <p style="font-size:12.5px;color:#8a8f96;margin:14px 0 0">
      ${ord.length} cita${ord.length > 1 ? 's' : ''} en total.
    </p>`;
  return shell(inner, 'Buenos días ☀️', color, negocio);
}

function fila(label, val, color) {
  if (!val) return '';
  return `<tr>
    <td style="padding:8px 0;color:#8a8f96;font-size:13px;width:110px;vertical-align:top">${esc(label)}</td>
    <td style="padding:8px 0;color:#16181d;font-size:14px;font-weight:600">${esc(val)}</td>
  </tr>`;
}

function reminderClientHtml(r, negocio, color) {
  const inner = `<p style="font-size:15px;color:#16181d;line-height:1.6;margin:0 0 4px">Hola <strong>${esc(r.nombre)}</strong> 👋</p>
    <p style="font-size:15px;color:#333;line-height:1.6;margin:0 0 18px">
      Te recordamos que <strong>mañana</strong> tienes tu cita en ${esc(negocio)}.
    </p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee">
      ${fila('Servicio', r.servicio, color)}
      ${fila('Fecha',    r.fecha,    color)}
      ${fila('Hora',     r.hora,     color)}
      ${fila('Personas', r.personas, color)}
    </table>
    <p style="font-size:15px;color:#333;margin:20px 0 0">Te esperamos ✨</p>`;
  return shell(inner, 'Recordatorio de tu cita 😊', color, negocio);
}

function reminderOwnerHtml(r, negocio, color) {
  const inner = `<p style="font-size:15px;color:#16181d;line-height:1.6;margin:0 0 18px">
      Mañana tienes esta cita agendada:
    </p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee">
      ${fila('Cliente',  r.nombre,   color)}
      ${fila('Servicio', r.servicio, color)}
      ${fila('Fecha',    r.fecha,    color)}
      ${fila('Hora',     r.hora,     color)}
      ${fila('Personas', r.personas, color)}
      ${fila('Contacto', r.email || r.telefono, color)}
    </table>`;
  return shell(inner, 'Cita próxima', color, negocio);
}

// ── Proceso diario: resumen al dueño + recordatorios de mañana ───────────────
// Una sola pasada al día (límite del plan Hobby), así que el recordatorio de
// "24 horas antes" es en realidad "el día antes": suficiente para que no se
// pierda una cita, y honesto sobre lo que hace.

function isoEnZona(tz, days) {
  const base = nowEnZona(tz);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function activa(r) {
  return r && r.estado !== 'cancelada' && r.estado !== 'rechazada';
}

async function runDailyJob() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: 'RESEND_API_KEY not configured' };
  const resend = new Resend(apiKey);

  const keys = await redis.keys('reservations:*');
  if (!keys.length) return { ok: true, resumenes: 0, recordatorios: 0, reservas: 0 };

  const items = keys.length === 1 ? [await redis.get(keys[0])] : await redis.mget(...keys);
  const rows = [];
  keys.forEach((k, i) => { if (items[i]) rows.push({ key: k, r: items[i] }); });

  // Agrupar por cliente para mandar un solo correo por negocio.
  const porCliente = {};
  rows.forEach(({ key, r }) => {
    const cid = r.clientId;
    if (!cid) return;
    (porCliente[cid] = porCliente[cid] || []).push({ key, r });
  });

  let resumenes = 0, recordatorios = 0;
  const dias = {};

  for (const cid of Object.keys(porCliente)) {
    const client = await redis.get(`client:${cid}`);
    if (!client || !client.active) continue;              // impagos fuera

    // "Hoy" y "mañana" son los del negocio, no los del servidor: si el cron
    // corre a las 13:00 UTC, en Tokio ya es de noche y en México aún es de
    // madrugada. Con UTC, medio mundo recibía el resumen del día equivocado.
    const hoy    = isoEnZona(client.timezone, 0);
    const manana = isoEnZona(client.timezone, 1);
    dias[cid] = { hoy, manana, tz: client.timezone || 'UTC' };
    const notifica = !client.features || client.features.emailNotifications !== false;
    const nombreNegocio = client.businessName || 'tu negocio';
    const color = client.color || '#1a4a2e';

    const deHoy    = porCliente[cid].filter(x => x.r.fechaISO === hoy    && activa(x.r)).map(x => x.r);
    const deManana = porCliente[cid].filter(x => x.r.fechaISO === manana && activa(x.r));

    // 1) Resumen de hoy al dueño. Si no hay citas no se manda nada: un correo
    //    vacío cada mañana es ruido y acaba en la papelera.
    if (notifica && client.ownerEmail && deHoy.length) {
      try {
        await resend.emails.send({
          from: FROM, to: client.ownerEmail,
          subject: `Buenos días ☀️ Tus citas de hoy (${deHoy.length})`,
          html: dailySummaryHtml(deHoy, nombreNegocio, color),
        });
        resumenes++;
      } catch (e) { console.error('[cron] resumen', cid, e.message); }
    }

    // 2) Recordatorios de mañana.
    for (const { key, r } of deManana) {
      if (r.recordatorioEnviado === manana) continue;      // ya avisado: no repetir
      let enviado = false;

      if (r.email) {
        try {
          await resend.emails.send({
            from: FROM, to: r.email,
            subject: 'Recordatorio de tu cita 😊',
            html: reminderClientHtml(r, nombreNegocio, color),
          });
          enviado = true;
        } catch (e) { console.error('[cron] recordatorio cliente', key, e.message); }
      }

      if (notifica && client.ownerEmail) {
        try {
          await resend.emails.send({
            from: FROM, to: client.ownerEmail,
            subject: `Cita próxima: ${r.nombre} — ${r.hora}`,
            html: reminderOwnerHtml(r, nombreNegocio, color),
          });
          enviado = true;
        } catch (e) { console.error('[cron] recordatorio dueño', key, e.message); }
      }

      if (enviado) {
        try {
          await redis.set(key, Object.assign({}, r, { recordatorioEnviado: manana }));
          recordatorios++;
        } catch (e) { console.error('[cron] marcar', key, e.message); }
      }
    }
  }

  return { ok: true, resumenes, recordatorios, reservas: rows.length, porNegocio: dias };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Proceso diario (Vercel Cron). Vive aquí y no en api/cron.js porque el
  // proyecto está en el límite de 12 funciones del plan Hobby.
  // Auditoría de clientes. Protegida con el mismo secreto del cron y de solo
  // lectura: no toca ningún dato. Sirve para ver de un vistazo qué negocios no
  // pueden tomar reservas y por qué, sin tener que abrir el panel.
  if (req.method === 'GET' && req.query?.cron === 'audit') {
    const secret = process.env.CRON_SECRET;
    if (!secret || (req.headers.authorization || '') !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const keys = await redis.keys('client:*');
      const items = keys.length ? (keys.length === 1 ? [await redis.get(keys[0])] : await redis.mget(...keys)) : [];
      const clientes = [];
      keys.forEach((k, i) => {
        const c = items[i];
        if (!c) return;
        const menu = Array.isArray(c.menu) ? c.menu : [];
        clientes.push({
          id: k.replace('client:', ''),
          negocio: c.businessName || null,
          plan: c.plan || null,
          active: c.active === true,
          paymentStatus: c.paymentStatus || null,
          reservasEnPlan: !c.features || c.features.reservations !== false,
          timezone: c.timezone || null,
          minNoticeHours: Number.isFinite(c.minNoticeHours) ? c.minNoticeHours : null,
          capacityPerSlot: Number.isFinite(c.capacityPerSlot) ? c.capacityPerSlot : null,
          holidays: Array.isArray(c.holidays) ? c.holidays.length : null,
          businessHours: !!c.businessHours,
          servicios: menu.length,
          sinDuracion: menu.filter((m) => !m.duracion).map((m) => m.nombre),
          ownerEmail: c.ownerEmail ? 'sí' : 'NO',
          needsSetup: necesitaSetup(c),
          falta: faltaConfig(c),
        });
      });
      clientes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return res.status(200).json({
        ok: true,
        total: clientes.length,
        listosParaReservar: clientes.filter((c) => c.active && !c.needsSetup).length,
        clientes,
      });
    } catch (err) {
      console.error('[api/reservations] audit:', err.message);
      return res.status(500).json({ error: 'Audit failed' });
    }
  }

  if (req.method === 'GET' && req.query?.cron === 'daily') {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const result = await runDailyJob();
      return res.status(200).json(result);
    } catch (err) {
      console.error('[api/reservations] cron:', err.message);
      return res.status(500).json({ error: 'Cron failed' });
    }
  }

  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: 'Demasiadas solicitudes. Por favor espera antes de intentar de nuevo.' });

  const { clientId, nombre, telefono, email, fecha, hora, servicio, personas, nota } = req.body || {};

  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });
  if (!nombre || !telefono || !fecha || !hora)
    return res.status(400).json({ error: 'nombre, telefono, fecha and hora are required' });

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client)        return res.status(404).json({ error: 'Client not found' });
    if (!client.active) return res.status(403).json({ error: 'Client inactive' });

    const ts  = Date.now();
    const key = `reservations:${clientId}:${ts}`;

    const reservation = {
      clientId,
      nombre:         String(nombre).slice(0, 120),
      telefono:       String(telefono).slice(0, 30),
      email:          String(email || '').slice(0, 120),
      fecha:          String(fecha).slice(0, 60),
      // Copia normalizada para poder consultar por día (recordatorios,
      // resumen, filtros). '' cuando el texto no permite deducirla sin riesgo.
      fechaISO:       parseFechaISO(fecha, nowEnZona(client.timezone)),
      horaISO:        normalizeHora(hora),
      timezone:       client.timezone || 'UTC',
      hora:           String(hora).slice(0, 30),
      servicio:       String(servicio || '').slice(0, 200),
      personas:       normalizePersonas(personas),
      nota:           /^no$/i.test(String(nota || '').trim()) ? '' : String(nota || '').slice(0, 500),
      estado:         'pendiente',
      fechaSolicitud: new Date(ts).toISOString(),
    };

    // Sin configuración no se puede decidir si una cita es válida. Aceptarla
    // sería peor: el dueño acabaría con citas a horas imposibles.
    if (necesitaSetup(client)) {
      return res.status(200).json({
        ok: false,
        motivo: 'needs_setup',
        // Al cliente no se le habla de configuración: se le da una salida.
        mensaje: 'No puedo confirmar citas en este momento, pero puedo ayudarte con información del negocio.',
      });
    }

    // Validación autoritativa: el navegador ya avisa, pero esta es la que
    // decide. Una cita fuera de horario no se acepta ni por curl.
    // Las reservas vivas del cliente hacen falta para contar solapes. Solo se
    // leen si hay capacidad configurada: si no, es un viaje a Redis inútil.
    let existentes = null;
    if (Number.isFinite(client.capacityPerSlot) && client.capacityPerSlot >= 1) {
      try {
        const ks = await redis.keys(`reservations:${clientId}:*`);
        existentes = ks.length ? (ks.length === 1 ? [await redis.get(ks[0])] : await redis.mget(...ks)) : [];
        existentes = existentes.filter(Boolean);
      } catch (e) {
        // Si no se pueden leer, no se inventa disponibilidad: se deja pasar y
        // el dueño lo ve en el panel. Bloquear por un fallo de lectura sería
        // rechazar clientes reales por un problema nuestro.
        console.error('[api/reservations] capacidad, no se pudo leer:', e.message);
        existentes = null;
      }
    }

    const v = validarReserva(client, reservation.fechaISO, reservation.horaISO, reservation.servicio, undefined, existentes);
    if (!v.ok) {
      // Se guarda igualmente como rechazada, con el motivo: al dueño le
      // interesa ver la demanda que se le escapa, no perderla en silencio.
      reservation.estado = 'rechazada';
      reservation.motivoRechazo = v.motivo;
      await redis.set(key, reservation);
      console.log(`[api/reservations] Rechazada ${key}: ${v.motivo}`);
      return res.status(200).json({
        ok: false, motivo: v.motivo, mensaje: v.mensaje, alternativa: v.alternativa || null,
      });
    }

    // ── Guardar en Redis (operación primaria: la reserva no se pierde
    //    aunque falle un correo) ──────────────────────────────────────────
    await redis.set(key, reservation);
    console.log(`[api/reservations] Saved ${key}`);

    // ── Sin correos inmediatos (Fase D). La cita ya está en la hoja del
    //    dueño al instante; el aviso va en el resumen diario agrupado, y solo
    //    si hubo cambios. Aquí solo se encola un evento diminuto (Fase B). ──
    await registrarCambio(clientId, {
      type: 'created', reservationId: key,
      nombre: reservation.nombre, servicio: reservation.servicio,
      fecha: reservation.fecha, hora: reservation.hora, telefono: reservation.telefono,
    });

    return res.status(201).json({
      ok: true,
      reservationCreated: true,
      reservationId: key,
      status: reservation.estado,   // 'pendiente'
      // No hay envío inmediato: el aviso al dueño va en el resumen diario.
      notifications: { owner: { attempted: false, sent: false, count: 0 }, customer: { attempted: false, sent: false } },
    });

  } catch (err) {
    console.error('[api/reservations]', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
}
