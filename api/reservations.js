import { Redis }  from '@upstash/redis';
import { faltaConfig, necesitaSetup } from '../lib/setup.js';
import { registrarCambio } from '../lib/changes.js';
import { registrarActividad } from '../lib/activity.js';
import { destinatariosAviso, reservationActionUrl, reservationEmailHtml, resendMessageId, sendReservationEmails } from '../lib/reservation-emails.js';
import { Resend } from 'resend';
import { randomUUID, createHash } from 'node:crypto';
import { initSentry, captureApiException, captureApiMessage } from '../lib/sentry.js';

initSentry();

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

  if (/\bpasado\s+ma(ñ|n)ana\b|\bday\s+after\s+tomorrow\b/.test(txt)) return mk(addDays(base, 2));
  if (/\bhoy\b|\btoday\b/.test(txt)) return mk(base);
  if (/\bma(ñ|n)ana\b|\btomorrow\b/.test(txt)) return mk(addDays(base, 1));

  const DIAS = { domingo:0, lunes:1, martes:2, 'miercoles':3, 'miércoles':3, jueves:4, viernes:5, 'sabado':6, 'sábado':6,
                 sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  const MESES = { enero:0, febrero:1, marzo:2, abril:3, mayo:4, junio:5, julio:6, agosto:7,
                  septiembre:8, setiembre:8, octubre:9, noviembre:10, diciembre:11,
                  january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7,
                   september:8, october:9, november:10, december:11,
                   jan:0, feb:1, mar:2, apr:3, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11 };

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
    const a = +dmy[1], b = +dmy[2];
    let y = dmy[3] ? +dmy[3] : base.getUTCFullYear();
    if (y < 100) y += 2000;
    // Desambiguación día/mes coherente con el frontend (chat-core/extraerFecha):
    // un número > 12 fija su papel; si ambos son ≤ 12 se asume DD/MM (es). Sin
    // esto, "07/24/2026" (US, día en 2ª posición) no se normalizaba: fechaISO
    // quedaba '' y la reserva saltaba la validación de horario. [QA-01]
    let day = null, mon = null;
    if (a > 12 && b <= 12)       { day = a; mon = b - 1; }   // DD/MM
    else if (b > 12 && a <= 12)  { day = b; mon = a - 1; }   // MM/DD
    else if (a <= 12 && b <= 12) { day = a; mon = b - 1; }   // ambiguo → DD/MM
    if (day !== null && day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
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
  // El sufijo admite el formato tipográfico "a. m." / "p. m." (con espacio y
  // puntos), no solo "am"/"pm"/"a.m.": sin \s* entre las dos letras, "7:00 p. m."
  // no casaba el sufijo y se guardaba como 07:00 en vez de 19:00.
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = m[2] || '00';
  const suf = (m[3] || '').toLowerCase().replace(/[.\s]/g, '');
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

function reservationTemplate(client) {
  const id = client && (client.templateId || (client.config && client.config.templateId));
  return id === 'restaurant' || id === 'barber' ? id : '';
}

function configuredStaff(client) {
  const config = (client && client.config) || {};
  // `staff` is canonical for newly-created barber clients. Older records may
  // still use barbers or a nested config, so retain those only as fallbacks.
  const raw = Array.isArray(client?.staff) ? client.staff
    : (Array.isArray(client?.barbers) ? client.barbers
      : (Array.isArray(config.staff) ? config.staff : config.barbers));
  return Array.isArray(raw) ? raw.map((entry) => {
    if (typeof entry === 'string') return { name: entry };
    return entry || {};
  }).filter((entry) => entry.name || entry.id) : [];
}

function staffMatch(staff, preference) {
  const wanted = String(preference || '').trim().toLowerCase();
  if (!wanted) return null;
  return staff.find((entry) => String(entry.id || '').toLowerCase() === wanted ||
    String(entry.name || '').toLowerCase() === wanted) || null;
}

function contactMatches(a, b) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[\s\-().+]/g, '');
  return !!a && !!b && norm(a) === norm(b);
}

// Returns the key of an existing active reservation that is effectively the
// same booking (same day + time + contact), or null. Returning the key lets the
// caller answer with existingReservationId instead of a blind "duplicada".
function duplicateReservationKey(reservasConKey, reservation) {
  const sameDate = (r) => r.fechaISO && reservation.fechaISO
    ? r.fechaISO === reservation.fechaISO
    : String(r.fecha || '').trim().toLowerCase() === String(reservation.fecha || '').trim().toLowerCase();
  const hit = (reservasConKey || []).find((r) => activa(r) && sameDate(r) &&
    r.horaISO === reservation.horaISO &&
    (contactMatches(r.telefono, reservation.telefono) || contactMatches(r.email, reservation.email)));
  return hit ? hit._key : null;
}

// Stable fingerprint of a booking, used as the idempotency lock when the client
// does not supply its own key. Two identical confirmations (double-click, a
// retried POST after a lost response) map to the same lock and therefore to the
// same reservation. [BUG-4]
function idempotencyFingerprint(clientId, r) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[\s\-().+]/g, '');
  const sig = [clientId, norm(r.telefono), norm(r.email), r.fechaISO || r.fecha,
    r.horaISO || r.hora, String(r.servicio || '').toLowerCase().trim(),
    String(r.partySize || r.personas || '')].join('|');
  return createHash('sha256').update(sig).digest('hex').slice(0, 32);
}

// The idempotency lock stores 'pending' while a request is mid-flight, then the
// created reservation key. Concurrent losers poll briefly for that key so they
// can return the winner's reservation instead of erroring or duplicating.
async function waitForReservationKey(lockKey) {
  for (let i = 0; i < 10; i++) {
    const v = await redis.get(lockKey);
    if (typeof v === 'string' && v.startsWith('reservations:')) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// A completed idempotency lock normally remains for retry safety. Once its
// reservation is cancelled or rejected, it must no longer block the same slot.
async function releaseInactiveIdempotencyLock(store, lockKey) {
  const reservationKey = await store.get(lockKey);
  if (typeof reservationKey !== 'string' || !reservationKey.startsWith('reservations:')) return false;
  const existing = await store.get(reservationKey);
  if (!existing || activa(existing)) return false;
  await store.del(lockKey);
  return true;
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

function durationFor(client, servicio) {
  const item = (client.menu || []).find(m => m.nombre && servicio &&
    String(servicio).toLowerCase().indexOf(String(m.nombre).toLowerCase()) !== -1);
  return duracionMin(item && item.duracion) || duracionMin(client.reservationDuration ||
    ((client.config || {}).reservationDuration));
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

// Dos citas chocan si sus intervalos se pisan. Comparar solo la hora de inicio
// no basta: un corte de 60 min a las 16:00 y otro a las 16:30 se solapan media
// hora, y con un solo barbero eso es imposible.
function solapan(aIni, aDur, bIni, bDur) {
  const aFin = aIni + (aDur || 0);
  const bFin = bIni + (bDur || 0);
  if (aDur === 0 || bDur === 0) return aIni === bIni;   // sin duración: solo choque exacto
  return aIni < bFin && bIni < aFin;
}

// Una cita "viva" es la que aún ocupa un cupo: ni cancelada ni rechazada.
function activa(r) {
  return r && r.estado !== 'cancelada' && r.estado !== 'rechazada';
}

// Cuántas citas vivas se solapan con la que se pide.
function contarSolapes(reservas, fechaISO, iniMin, durMin, client) {
  let n = 0;
  for (const r of reservas) {
    if (!activa(r) || r.fechaISO !== fechaISO) continue;
    const ini = minutosDe(r.horaISO);
    if (ini === null) continue;                          // sin hora normalizada: no cuenta
    const dur = Number.isFinite(r.duracion) ? r.duracion : durationFor(client || {}, r.servicio);
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

  // Un barbero elegido debe existir y estar disponible. Sin una lista/configuración
  // de personal no se inventa una: la preferencia queda como dato para el dueño.
  const template = reservationTemplate(client);
  const preference = client.__reservationBarberPreference;
  const staff = configuredStaff(client);
  const selectedStaff = preference ? staffMatch(staff, preference) : null;
  if (template === 'barber' && preference && staff.length && !selectedStaff) {
    return { ok: false, motivo: 'barbero_no_disponible', mensaje: 'Ese barbero no está disponible.' };
  }
  const staffHours = selectedStaff && (selectedStaff.businessHours || selectedStaff.availability ||
    ((client.config || {}).staffAvailability || {})[selectedStaff.id || selectedStaff.name]);
  const staffRanges = rangosDelDia(staffHours, fechaISO);
  if (staffRanges && !staffRanges.length) {
    return { ok: false, motivo: 'barbero_no_disponible', mensaje: 'Ese barbero no trabaja ese día.' };
  }

  const bh = client.businessHours;
  let rangos = rangosDelDia(bh, fechaISO);
  if (rangos === null && staffRanges !== null) rangos = staffRanges;
  if (rangos === null) return { ok: true };              // sin horario fiable: no bloqueamos

  if (!rangos.length) {
    return { ok: false, motivo: 'dia_cerrado', mensaje: 'Ese día el negocio está cerrado.' };
  }

  const pedido = minutosDe(horaISO);
  if (pedido === null) return { ok: true };              // hora no normalizable: no bloqueamos

  // Duración: si el servicio no cabe antes del cierre, no vale.
  const dur = durationFor(client, servicio);

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

  // Starts are aligned with the business-defined booking interval rather than
  // an arbitrary frontend suggestion. This remains authoritative for curls,
  // email reschedules, and every chat surface.
  const interval = Number.isFinite(client.reservationIntervalMinutes) ? client.reservationIntervalMinutes : 15;
  if (interval > 0 && (pedido - dentro[0]) % interval !== 0) {
    return { ok: false, motivo: 'intervalo_invalido', mensaje: 'Ese horario no coincide con los intervalos de reserva disponibles.' };
  }

  if (staffRanges && staffRanges.length && !staffRanges.some(([a, b]) => pedido >= a && pedido + dur <= b)) {
    return { ok: false, motivo: 'barbero_no_disponible', mensaje: 'Ese barbero no está disponible a esa hora.' };
  }

  if (template === 'barber' && selectedStaff && Array.isArray(reservas)) {
    const ocupado = reservas.some((r) => activa(r) && r.fechaISO === fechaISO &&
      String(r.barberPreference || '').toLowerCase() === String(selectedStaff.name || selectedStaff.id).toLowerCase() &&
      solapan(pedido, dur, minutosDe(r.horaISO) || -1,
        Number.isFinite(r.duracion) ? r.duracion : durationFor(client, r.servicio)));
    if (ocupado) return { ok: false, motivo: 'barbero_no_disponible', mensaje: 'Ese barbero ya tiene una cita a esa hora.' };
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
    const ocupadas = contarSolapes(reservas, fechaISO, pedido, dur, client);
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
  const paso = Number.isFinite(client.reservationIntervalMinutes) ? client.reservationIntervalMinutes : 15;
  const limite = rango[1] - (dur || 0);
  for (let t = Math.ceil((desde + 1) / paso) * paso; t <= limite; t += paso) {
    if (contarSolapes(reservas, fechaISO, t, dur, client) < cap) return fmt(t);
  }
  return null;                                            // hoy no queda hueco
}

// ── Plantilla del resumen (fija, sin DeepSeek: más barata y predecible) ──────
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

const DIGEST_LABEL = { created: 'NUEVA', rescheduled: 'REPROGRAMADA', cancelled: 'CANCELADA' };
const DIGEST_ACCENT = { created: '#1a7a3e', rescheduled: '#8a5a00', cancelled: '#b23b3b' };

function digestBloque(ev) {
  const tipo = ev.type || 'created';
  const cabecera = `<div style="font-size:11px;font-weight:700;letter-spacing:.06em;color:${DIGEST_ACCENT[tipo] || '#555'}">${DIGEST_LABEL[tipo] || 'CAMBIO'}</div>`;
  let cuerpo = `<div style="font-size:15px;font-weight:600;color:#16181d;margin-top:3px">${esc(ev.nombre || '')}</div>`;
  if (ev.servicio) cuerpo += `<div style="font-size:13px;color:#6b6f76">${esc(ev.servicio)}</div>`;
  if (tipo === 'rescheduled') {
    cuerpo += `<div style="font-size:13px;color:#6b6f76;margin-top:2px">Antes: ${esc(ev.prevFecha || '')} ${esc(ev.prevHora || '')}</div>`;
    cuerpo += `<div style="font-size:13px;color:#16181d;font-weight:600">Ahora: ${esc(ev.fecha || '')} ${esc(ev.hora || '')}</div>`;
  } else {
    if (ev.fecha || ev.hora) cuerpo += `<div style="font-size:13px;color:#6b6f76;margin-top:2px">${esc(ev.fecha || '')}${ev.hora ? ' · ' + esc(ev.hora) : ''}</div>`;
  }
  if (tipo === 'created' && ev.telefono) cuerpo += `<div style="font-size:12px;color:#a8acb3;margin-top:4px">Tel: ${esc(ev.telefono)}</div>`;
  // Notas del cliente: solo si existen. Si no, no se muestra absolutamente nada.
  if (ev.notes && String(ev.notes).trim()) {
    cuerpo += `<div style="font-size:13px;color:#16181d;margin-top:8px;padding-top:8px;border-top:1px solid #f0f0f0">📝 <strong>Notas:</strong> ${esc(ev.notes)}</div>`;
  }
  return `<div style="border:1px solid #eaecef;border-radius:12px;padding:13px 15px;margin-bottom:10px">${cabecera}${cuerpo}</div>`;
}

function digestHtml(negocio, color, eventos, panelUrl) {
  const inner = `<p style="font-size:15px;color:#16181d;line-height:1.6;margin:0 0 16px">
      Estos son los cambios en tus citas de ${esc(negocio)}:
    </p>
    ${eventos.map(digestBloque).join('')}
    ${panelUrl ? `<div style="margin:18px 0 0">
      <a href="${esc(panelUrl)}" style="display:inline-block;background:${esc(color)};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:10px">Ver hoja completa de citas →</a>
    </div>` : ''}`;
  return shell(inner, `${eventos.length} cambio${eventos.length > 1 ? 's' : ''} en tus citas`, color, negocio);
}

// ── Resumen diario agrupado ──────────────────────────────────────────────────
// Un solo proceso global. Mira SOLO los negocios con cambios pendientes
// (digest:pending), nunca escanea todas las reservas. Un correo por negocio,
// solo si hubo cambios. Si Resend falla, los eventos quedan y se reintenta.
async function runDigest(dry, testDeps) {
  // testDeps permite inyectar redis/resend falsos en las pruebas unitarias.
  // En producción es undefined y se usan los clientes reales del módulo.
  const R = (testDeps && testDeps.redis) || redis;
  const apiKey = process.env.RESEND_API_KEY;
  const resend = (testDeps && testDeps.resend) || (apiKey && !dry ? new Resend(apiKey) : null);

  const pendientes = await R.smembers('digest:pending');
  if (!pendientes || !pendientes.length) return { ok: true, negocios: 0, enviados: 0, fallidos: 0, dry: !!dry };

  let enviados = 0, fallidos = 0, sinDestinatario = 0;
  const detalle = [];

  for (const cid of pendientes) {
    const raw = await R.lrange(`changes:${cid}`, 0, -1);
    const eventos = (raw || []).map((x) => { try { return typeof x === 'string' ? JSON.parse(x) : x; } catch (e) { return null; } }).filter(Boolean);
    if (!eventos.length) { await R.srem('digest:pending', cid); continue; }

    const client = await R.get(`client:${cid}`);
    if (!client) { await R.del(`changes:${cid}`); await R.srem('digest:pending', cid); continue; }
    // Si el dueño apagó el aviso por correo (feature de su plan) o no hay a
    // quién enviar, se limpia la cola para no acumular ni reintentar en vano.
    const avisaPorCorreo = !client.features || client.features.emailNotifications !== false;
    const recipients = avisaPorCorreo ? destinatariosAviso(client) : [];
    if (!recipients.length) {
      // En dry NO se toca nada (solo lectura): se reporta y se sigue. Fuera de
      // dry sí se limpia para no acumular ni reintentar en vano.
      if (dry) { detalle.push({ cid, recipients: 0, cambios: eventos.length, nota: 'sin destinatario' }); continue; }
      await R.del(`changes:${cid}`); await R.srem('digest:pending', cid);
      sinDestinatario++; continue;
    }

    const negocio = client.businessName || cid;
    const color = client.color || '#1a4a2e';
    const panelUrl = client.panelToken ? `https://jbstudio.app/reservas/${encodeURIComponent(cid)}#t=${encodeURIComponent(client.panelToken)}` : null;

    if (dry) { detalle.push({ cid, recipients: recipients.length, cambios: eventos.length }); continue; }

    try {
      const r = await resend.emails.send({
        from: FROM,
        to: recipients,                         // un solo correo a toda la lista
        subject: `${negocio} — ${eventos.length} cambio${eventos.length > 1 ? 's' : ''} en tus citas`,
        html: digestHtml(negocio, color, eventos, panelUrl),
      });
      if (r && r.error) throw new Error(r.error.message || 'resend error');
      // Éxito: se limpian SOLO los eventos incluidos y se quita de la cola.
      await R.del(`changes:${cid}`);
      await R.srem('digest:pending', cid);
      await R.set(`digest:sentAt:${cid}`, Date.now());
      enviados++;
    } catch (e) {
      // Falla: no se toca nada. Los eventos siguen en cola, se reintenta el
      // próximo ciclo. Sin duplicar (cada cambio se encoló una sola vez).
      console.error('[digest]', cid, e.message);
      captureApiException(e, { clientId: cid, feature: 'email_owner', route: '/api/reservations?cron=digest' });
      fallidos++;
    }
  }

  return { ok: true, negocios: pendientes.length, enviados, fallidos, sinDestinatario, dry: !!dry, detalle: dry ? detalle : undefined };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Resumen diario (Vercel Cron). Vive aquí y no en api/cron.js porque el
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
      captureApiException(err, { feature: 'redis', route: '/api/reservations?cron=audit' });
      return res.status(500).json({ error: 'Audit failed' });
    }
  }

  if (req.method === 'GET' && req.query?.cron === 'digest') {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      // ?dry=1 inspecciona la cola sin enviar ni borrar nada (para pruebas).
      const result = await runDigest(req.query?.dry === '1' || req.query?.dry === 'true');
      return res.status(200).json(result);
    } catch (err) {
      console.error('[api/reservations] digest:', err.message);
      captureApiException(err, { feature: 'email_owner', route: '/api/reservations?cron=digest' });
      return res.status(500).json({ error: 'Digest failed' });
    }
  }

  // Recuperación puntual de la cola (mantenimiento, protegida con CRON_SECRET).
  // Idempotente: si ya hay eventos en changes:{clientId}, solo reasegura que el
  // negocio esté en digest:pending (SET, sin duplicar). Si no hay eventos,
  // reconstruye UN evento 'created' de la reserva activa más reciente. Sirve
  // para reencolar avisos que se perdieron por un fallo anterior, sin tocar
  // reservas ni enviar correos.
  if (req.method === 'GET' && req.query?.cron === 'backfill') {
    const secret = process.env.CRON_SECRET;
    if (!secret || (req.headers.authorization || '') !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const cid = req.query?.clientId;
    if (!cid || !/^[a-z0-9-]+$/.test(cid)) return res.status(400).json({ error: 'Invalid clientId' });
    try {
      const existentes = await redis.lrange(`changes:${cid}`, 0, -1);
      if (existentes && existentes.length) {
        await redis.sadd('digest:pending', cid);   // idempotente: no duplica
        return res.status(200).json({ ok: true, action: 're-added', clientId: cid, eventos: existentes.length });
      }
      // changes vacío: reconstruir un único evento de la reserva viva más reciente.
      const keys = await redis.keys(`reservations:${cid}:*`);
      const items = keys.length ? (keys.length === 1 ? [await redis.get(keys[0])] : await redis.mget(...keys)) : [];
      let mejor = null, mejorKey = null, mejorTs = 0;
      keys.forEach((k, i) => {
        const r = items[i];
        if (!r || r.estado === 'cancelada' || r.estado === 'rechazada') return;
        const ts = parseInt(String(k).split(':').pop(), 10) || 0;
        if (ts > mejorTs) { mejor = r; mejorKey = k; mejorTs = ts; }
      });
      if (!mejor) return res.status(200).json({ ok: true, action: 'none', clientId: cid, reason: 'no active reservation' });
      const q = await registrarCambio(cid, {
        type: 'created', reservationId: mejorKey,
        nombre: mejor.nombre, servicio: mejor.servicio, fecha: mejor.fecha, hora: mejor.hora, telefono: mejor.telefono,
        notes: mejor.notes,
      });
      return res.status(q.ok ? 200 : 500).json({
        ok: q.ok, action: 'created-event', clientId: cid, queued: q.ok,
        reservation: { nombre: mejor.nombre, servicio: mejor.servicio, fecha: mejor.fecha, hora: mejor.hora },
      });
    } catch (err) {
      console.error('[api/reservations] backfill:', err.message);
      captureApiException(err, { clientId: cid, feature: 'redis', route: '/api/reservations?cron=backfill' });
      return res.status(500).json({ error: 'Backfill failed' });
    }
  }

  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(ip))
    return res.status(429).json({ error: 'Demasiadas solicitudes. Por favor espera antes de intentar de nuevo.' });

  const { clientId, nombre, telefono, email, contacto, fecha, hora, servicio, personas, partySize, tablePreference, barberPreference, nota, notes, specialRequests, foodPreferences, action, actionToken, idempotencyKey } = req.body || {};

  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });
  if (action !== 'reschedule' && (!nombre || !fecha || !hora))
    return res.status(400).json({ error: 'nombre, fecha and hora are required' });

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client)        return res.status(404).json({ error: 'Client not found' });
    if (!client.active) return res.status(403).json({ error: 'Client inactive' });

    // Reprogramming is intentionally handled by this existing endpoint so the
    // Hobby function limit stays unchanged. The random token from the email is
    // the authority; no browser session or contact information is trusted.
    if (action === 'reschedule') {
      if (!actionToken || !fecha || !hora) return res.status(400).json({ error: 'actionToken, fecha and hora are required' });
      const keys = await redis.keys(`reservations:${clientId}:*`);
      const items = keys.length ? (keys.length === 1 ? [await redis.get(keys[0])] : await redis.mget(...keys)) : [];
      const index = items.findIndex((item) => item && item.actionToken === actionToken);
      if (index < 0) return res.status(404).json({ error: 'Reservation not found' });
      const existing = items[index];
      if (!activa(existing)) return res.status(409).json({ error: 'Reservation is not active' });
      const candidate = {
        ...existing,
        fecha: String(fecha).slice(0, 60),
        fechaISO: parseFechaISO(fecha, nowEnZona(client.timezone)),
        hora: String(hora).slice(0, 30),
        horaISO: normalizeHora(hora),
      };
      // A modification may also change party size, table/dish and requests — all
      // authenticated by the same token. Fields not supplied keep their previous
      // value so a time-only change never wipes the customer's preferences.
      const modTemplate = reservationTemplate(client);
      const modPartySize = normalizePersonas(partySize === undefined ? personas : partySize);
      if (modPartySize) {
        candidate.personas = modPartySize;
        if (modTemplate === 'restaurant') candidate.partySize = modPartySize;
      }
      if (servicio) { candidate.servicio = String(servicio).slice(0, 200); candidate.duracion = durationFor(client, servicio); }
      if (tablePreference !== undefined && modTemplate === 'restaurant') candidate.tablePreference = String(tablePreference || '').slice(0, 200);
      if (specialRequests !== undefined && !/^(no|ninguna|ninguno|nope)$/i.test(String(specialRequests || '').trim())) {
        candidate.specialRequests = String(specialRequests || '').slice(0, 800);
      }
      if (foodPreferences && typeof foodPreferences === 'object' && modTemplate === 'restaurant') {
        candidate.foodPreferences = {
          remove: Array.isArray(foodPreferences.remove) ? foodPreferences.remove.slice(0, 20).map(x => String(x).slice(0, 40)) : [],
          add: Array.isArray(foodPreferences.add) ? foodPreferences.add.slice(0, 20).map(x => String(x).slice(0, 40)) : [],
          extra: Array.isArray(foodPreferences.extra) ? foodPreferences.extra.slice(0, 20).map(x => String(x).slice(0, 40)) : [],
          cooking: String(foodPreferences.cooking || '').slice(0, 40),
          spice: String(foodPreferences.spice || '').slice(0, 40),
          notes: Array.isArray(foodPreferences.notes) ? foodPreferences.notes.slice(0, 20).map(x => String(x).slice(0, 80)) : [],
        };
      }
      const otherReservations = items.filter((item, itemIndex) => item && itemIndex !== index);
      const checkedClient = { ...client, __reservationBarberPreference: candidate.barberPreference };
      const availability = validarReserva(checkedClient, candidate.fechaISO, candidate.horaISO, candidate.servicio, undefined, otherReservations);
      if (!availability.ok) return res.status(200).json({ ok: false, ...availability });
      candidate.estado = 'reprogramada';
      candidate.fechaAnterior = existing.fecha;
      candidate.horaAnterior = existing.hora;
      candidate.fechaReprogramacion = new Date().toISOString();
      await redis.set(keys[index], candidate);
      const activity = await registrarActividad(clientId, {
        type: 'rescheduled', cliente: candidate.nombre, servicio: candidate.servicio,
        fecha: candidate.fecha, hora: candidate.hora,
        prevFecha: existing.fecha, prevHora: existing.hora,
      });
      if (!activity.ok) console.error(`[api/reservations] actividad de reagendado no guardada: ${activity.error}`);
      const aviso = await registrarCambio(clientId, {
        type: 'rescheduled', reservationId: keys[index], nombre: candidate.nombre,
        servicio: candidate.servicio, fecha: candidate.fecha, hora: candidate.hora,
        prevFecha: existing.fecha, prevHora: existing.hora, notes: candidate.specialRequests,
      });
      const emailResult = await sendReservationEmails(client, candidate, 'rescheduled');
      return res.status(200).json({ ok: true, reservation: candidate, aviso: { encolado: aviso.ok }, email: emailResult, emailWarning: emailResult.warning || null });
    }

    const template = reservationTemplate(client);
    const phone = telefono || (contacto && !String(contacto).includes('@') ? contacto : '');
    const mail = email || (contacto && String(contacto).includes('@') ? contacto : '');
    if (template ? (!phone && !mail) : !phone) {
      return res.status(400).json({ error: template ? 'contact is required' : 'telefono is required' });
    }
    if (!mail) return res.status(400).json({ error: 'email is required for reservation confirmation' });
    const normalizedPartySize = normalizePersonas(partySize === undefined ? personas : partySize);
    if (template === 'restaurant' && !normalizedPartySize) {
      return res.status(400).json({ error: 'partySize is required for restaurant reservations' });
    }
    if (template === 'barber' && !servicio) {
      return res.status(400).json({ error: 'servicio is required for barber reservations' });
    }

    const ts  = Date.now();
    const key = `reservations:${clientId}:${ts}`;

    const reservation = {
      clientId,
      nombre:         String(nombre).slice(0, 120),
      telefono:       String(phone || '').slice(0, 30),
      email:          String(mail || '').slice(0, 120),
      fecha:          String(fecha).slice(0, 60),
      // Copia normalizada para poder consultar por día (recordatorios,
      // resumen, filtros). '' cuando el texto no permite deducirla sin riesgo.
      fechaISO:       parseFechaISO(fecha, nowEnZona(client.timezone)),
      horaISO:        normalizeHora(hora),
      timezone:       client.timezone || 'UTC',
      hora:           String(hora).slice(0, 30),
      servicio:       String(servicio || '').slice(0, 200),
      personas:       normalizedPartySize,
      partySize:      template === 'restaurant' ? normalizedPartySize : undefined,
      tablePreference: template === 'restaurant' ? String(tablePreference || '').slice(0, 200) : undefined,
      barberPreference: template === 'barber' ? String(barberPreference || '').slice(0, 120) : undefined,
      duracion:        durationFor(client, servicio),
      nota:           /^no$/i.test(String(nota || '').trim()) ? '' : String(nota || '').slice(0, 500),
      // Notas del cliente detectadas en la conversación (preferencias, avisos,
      // peticiones). Texto libre, opcional; vacío si el cliente no dijo nada.
      notes:          String(notes || '').slice(0, 800),
      // Canonical free-text request. `notes` is retained only for old records.
      specialRequests: /^(no|ninguna|ninguno|nope)$/i.test(String(specialRequests || '').trim()) ? '' : String(specialRequests || notes || nota || '').slice(0, 800),
      foodPreferences: template === 'restaurant' && foodPreferences && typeof foodPreferences === 'object' ? {
        remove: Array.isArray(foodPreferences.remove) ? foodPreferences.remove.slice(0, 20).map(x => String(x).slice(0, 40)) : [],
        add: Array.isArray(foodPreferences.add) ? foodPreferences.add.slice(0, 20).map(x => String(x).slice(0, 40)) : [],
        extra: Array.isArray(foodPreferences.extra) ? foodPreferences.extra.slice(0, 20).map(x => String(x).slice(0, 40)) : [],
        cooking: String(foodPreferences.cooking || '').slice(0, 40),
        spice: String(foodPreferences.spice || '').slice(0, 40),
        notes: Array.isArray(foodPreferences.notes) ? foodPreferences.notes.slice(0, 20).map(x => String(x).slice(0, 80)) : [],
      } : undefined,
      actionToken:    randomUUID(),
      estado:         'confirmada',
      fechaConfirmacion: new Date(ts).toISOString(),
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

    // ── Idempotency lock (atomic, race-proof) ────────────────────────────
    // A confirmation can arrive more than once: a double-click, a reload+click,
    // or the frontend retrying after a lost response. SET NX means exactly one
    // of N concurrent identical requests wins the lock; the rest return the
    // winner's reservation instead of creating a second one. The client may
    // pass its own idempotencyKey; otherwise a fingerprint of the booking is
    // used so even keyless double-clicks are covered. [BUG-4]
    const idemRaw = (typeof idempotencyKey === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))
      ? idempotencyKey : idempotencyFingerprint(clientId, reservation);
    const lockKey = `idempo:${clientId}:${idemRaw}`;
    let lockAcquired = false;
    try {
      await releaseInactiveIdempotencyLock(redis, lockKey);
      const got = await redis.set(lockKey, 'pending', { nx: true, ex: 900 });
      lockAcquired = got === 'OK' || got === true;
    } catch (e) {
      console.error('[api/reservations] idempotency lock error:', e.message);
      captureApiException(e, { clientId, feature: 'redis', route: '/api/reservations' });
      lockAcquired = true;   // Redis lock unavailable: fall through, do not block a real booking
    }
    if (!lockAcquired) {
      const existingKey = await waitForReservationKey(lockKey);
      if (existingKey) {
        const existing = await redis.get(existingKey);
        if (existing) {
          return res.status(200).json({
            ok: true, reservationCreated: false, duplicate: true,
            reservationId: existingKey, existingReservationId: existingKey,
            status: existing.estado, actionToken: existing.actionToken,
          });
        }
      }
      // Winner still in flight (rare): tell the client it is already being handled.
      return res.status(200).json({ ok: true, reservationCreated: false, duplicate: true,
        mensaje: 'Esta reserva ya se está procesando.' });
    }

    // Validación autoritativa: el navegador ya avisa, pero esta es la que
    // decide. Una cita fuera de horario no se acepta ni por curl.
    // Las reservas vivas hacen falta para capacidad, duplicados y la agenda de
    // un barbero elegido. Si Redis falla, conservamos el comportamiento previo:
    // no rechazamos una reserva real por una consulta auxiliar caída.
    let existentes = null;
    let existentesConKey = null;
    try {
      const ks = await redis.keys(`reservations:${clientId}:*`);
      const vals = ks.length ? (ks.length === 1 ? [await redis.get(ks[0])] : await redis.mget(...ks)) : [];
      existentesConKey = ks.map((k, i) => vals[i] ? { ...vals[i], _key: k } : null).filter(Boolean);
      existentes = existentesConKey;
    } catch (e) {
      console.error('[api/reservations] disponibilidad, no se pudo leer:', e.message);
      captureApiException(e, { clientId, feature: 'redis', route: '/api/reservations' });
      existentes = null;
    }

    // Prior active reservation with the same day+time+contact: a real duplicate
    // (a distinct earlier booking, not a retry). Return its id so the client can
    // offer to modify or cancel it instead of stacking another. Release the lock
    // so a genuinely different corrected booking can still go through.
    const dupKey = existentesConKey && duplicateReservationKey(existentesConKey, reservation);
    if (dupKey) {
      const dup = existentesConKey.find((r) => r._key === dupKey);
      await redis.del(lockKey).catch(() => {});
      return res.status(200).json({
        ok: false, reservationCreated: false, duplicate: true, motivo: 'duplicada',
        reservationId: dupKey, existingReservationId: dupKey,
        status: dup ? dup.estado : 'confirmada', actionToken: dup ? dup.actionToken : undefined,
        mensaje: 'Ya existe una reserva con estos datos.',
      });
    }
    const clientForValidation = { ...client, __reservationBarberPreference: reservation.barberPreference };
    const v = validarReserva(clientForValidation, reservation.fechaISO, reservation.horaISO, reservation.servicio, undefined, existentes);
    if (!v.ok) {
      // Se guarda igualmente como rechazada, con el motivo: al dueño le
      // interesa ver la demanda que se le escapa, no perderla en silencio.
      reservation.estado = 'rechazada';
      reservation.motivoRechazo = v.motivo;
      await redis.set(key, reservation);
      await redis.del(lockKey).catch(() => {});   // let a corrected retry proceed
      console.log(`[api/reservations] Rechazada ${key}: ${v.motivo}`);
      return res.status(200).json({
        ok: false, reservationCreated: false, motivo: v.motivo, mensaje: v.mensaje, alternativa: v.alternativa || null,
      });
    }

    // ── Guardar en Redis (operación primaria: la reserva no se pierde
    //    aunque falle un correo) ──────────────────────────────────────────
    await redis.set(key, reservation);
    // Record the created key in the lock so a later retry with the same key (or
    // a concurrent loser) resolves to THIS reservation instead of a new one.
    await redis.set(lockKey, key, { ex: 24 * 60 * 60 }).catch(() => {});
    console.log(`[api/reservations] Saved ${key}`);
    const activity = await registrarActividad(clientId, {
      type: 'created', cliente: reservation.nombre, servicio: reservation.servicio,
      fecha: reservation.fecha, hora: reservation.hora,
    });
    if (!activity.ok) console.error(`[api/reservations] actividad de creación no guardada: ${activity.error}`);

    const aviso = await registrarCambio(clientId, {
      type: 'created', reservationId: key,
      nombre: reservation.nombre, servicio: reservation.servicio,
      fecha: reservation.fecha, hora: reservation.hora, telefono: reservation.telefono,
      notes: reservation.specialRequests,
    });
    // A confirmed reservation is never rolled back if email fails; the outcome
    // is reported truthfully in `email` below (never faked as sent). [BUG-2]
    const emailResult = await sendReservationEmails(client, reservation, 'created');
    // La reserva ya está guardada; si el aviso no se encoló, se registra sin
    // ocultarlo y el backend lo reporta abajo (sin confirmación falsa).
    if (!aviso.ok) {
      console.error(`[api/reservations] reserva ${key} guardada pero el aviso NO quedó en cola:`, aviso.error);
      captureApiMessage('Reservation saved but change-notification enqueue failed',
        { clientId, feature: 'redis', route: '/api/reservations' });
    }

    return res.status(201).json({
      ok: true,
      reservationCreated: true,
      duplicate: false,
      reservationId: key,
      // Returned to the same client that just booked so it can modify (reschedule)
      // or cancel this reservation in-session by its token, without a new endpoint.
      actionToken: reservation.actionToken,
      status: reservation.estado,
      // Estado real del encolado del aviso: true = irá en el próximo resumen.
      aviso: { encolado: aviso.ok },
      // Truthful per-recipient email outcome with provider messageIds. When
      // RESEND_API_KEY is missing, email.configured=false and email.warning is set.
      email: emailResult,
      emailWarning: emailResult.warning || null,
    });

  } catch (err) {
    console.error('[api/reservations]', err.message);
    captureApiException(err, {
      clientId, feature: action === 'reschedule' ? 'reservation_update' : 'reservation_create',
      route: '/api/reservations',
    });
    return res.status(500).json({ error: 'Database error' });
  }
}

// Solo para pruebas unitarias (no se usa en producción).
export const __test = { runDigest, digestHtml, digestBloque, destinatariosAviso,
  parseFechaISO, normalizeHora, normalizePersonas, validarReserva, reservationTemplate,
  configuredStaff, duplicateReservationKey, idempotencyFingerprint, reservationActionUrl, reservationEmailHtml,
  sendReservationEmails, resendMessageId, releaseInactiveIdempotencyLock };
