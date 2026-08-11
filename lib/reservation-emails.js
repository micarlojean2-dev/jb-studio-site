import { Resend } from 'resend';
import { captureApiMessage } from './sentry.js';

const FROM = 'reservas@jbstudio.app';
const APP_URL = 'https://jbstudio.app';

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Idioma saneado ('es'/'en' únicamente) para un correo de reserva. Reservas
// guardadas antes de que `reservation.language` existiera caen al idioma del
// negocio — nunca se asume inglés ni se rompe con un valor ausente/raro.
// [auditoría — idioma del reagendado]
function emailLanguage(client, reservation) {
  const fromReservation = reservation && reservation.language;
  if (fromReservation === 'es' || fromReservation === 'en') return fromReservation;
  return (client && client.language === 'en') ? 'en' : 'es';
}

const L = {
  es: {
    footer: (color) => `Tu asistente de <a href="https://jbstudio.app" style="color:${esc(color)};text-decoration:none">JB Studio</a> preparó esto por ti.`,
    title: { confirmed: 'Reserva confirmada', cancelled: 'Reserva cancelada', rescheduled: 'Reserva reprogramada' },
    subject: { confirmed: 'reserva confirmada', cancelled: 'reserva cancelada', rescheduled: 'reserva reprogramada' },
    ownerSubjectPrefix: { confirmed: 'Tienes una nueva reserva', cancelled: 'Reserva cancelada', rescheduled: 'Reserva reprogramada' },
    customerIntro: { confirmed: 'está confirmada.', rescheduled: 'fue reprogramada.' },
    customerIntroLine: (businessName, tail) => `Tu reserva en <strong>${esc(businessName)}</strong> ${tail}`,
    cancelledIntro: 'La reserva fue cancelada.',
    ownerCancelledIntro: (nombre) => `La reserva de <strong>${esc(nombre)}</strong> fue cancelada.`,
    people: (n) => `${esc(n)} personas`,
    specialRequests: 'Peticiones especiales:',
    noSpecialRequests: 'Sin peticiones especiales',
    notProvided: 'No proporcionado',
    reservationFallback: 'Reserva',
    cancel: 'Cancelar',
    reschedule: 'Reagendar',
    viewDashboard: 'Ver en mi panel',
    phone: 'Teléfono:',
    email: 'Email:',
  },
  en: {
    footer: (color) => `Your <a href="https://jbstudio.app" style="color:${esc(color)};text-decoration:none">JB Studio</a> assistant prepared this for you.`,
    title: { confirmed: 'Reservation confirmed', cancelled: 'Reservation cancelled', rescheduled: 'Reservation rescheduled' },
    subject: { confirmed: 'reservation confirmed', cancelled: 'reservation cancelled', rescheduled: 'reservation rescheduled' },
    ownerSubjectPrefix: { confirmed: 'You have a new reservation', cancelled: 'Reservation cancelled', rescheduled: 'Reservation rescheduled' },
    customerIntro: { confirmed: 'is confirmed.', rescheduled: 'was rescheduled.' },
    customerIntroLine: (businessName, tail) => `Your reservation at <strong>${esc(businessName)}</strong> ${tail}`,
    cancelledIntro: 'The reservation was cancelled.',
    ownerCancelledIntro: (nombre) => `The reservation for <strong>${esc(nombre)}</strong> was cancelled.`,
    people: (n) => `${esc(n)} people`,
    specialRequests: 'Special requests:',
    noSpecialRequests: 'No special requests',
    notProvided: 'Not provided',
    reservationFallback: 'Reservation',
    cancel: 'Cancel',
    reschedule: 'Reschedule',
    viewDashboard: 'View in my dashboard',
    phone: 'Phone:',
    email: 'Email:',
  },
};

function shell(inner, titulo, color, kicker, lang) {
  const l = L[lang] || L.es;
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#eef0f3;padding:32px 16px;margin:0">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.10)">
  <div style="background:${esc(color)};padding:24px 28px">
    <p style="margin:0;color:rgba(255,255,255,.72);font-size:11px;letter-spacing:.08em;text-transform:uppercase">${esc(kicker)}</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:21px">${esc(titulo)}</h1>
  </div>
  <div style="padding:24px 28px">${inner}</div>
  <div style="padding:0 28px 22px">
    <p style="margin:0;font-size:11.5px;color:#a8acb3;border-top:1px solid #eee;padding-top:14px">
      ${l.footer(color)}
    </p>
  </div>
</div>
</body></html>`;
}

// El dueño recibe siempre los avisos; la lista adicional puede incluir al equipo.
export function destinatariosAviso(client) {
  const raw = [
    client && client.ownerEmail,
    ...(Array.isArray(client && client.notificationEmails) ? client.notificationEmails : []),
  ];
  const vistos = {};
  const out = [];
  raw.forEach((e) => {
    const v = String(e || '').trim().toLowerCase();
    if (v && !vistos[v]) { vistos[v] = 1; out.push(v); }
  });
  return out.slice(0, 10);
}

export function reservationActionUrl(reservation, action) {
  const params = new URLSearchParams({
    reservation: reservation.actionToken,
    action,
  });
  return `${APP_URL}/asistente/${encodeURIComponent(reservation.clientId)}#${params}`;
}

// El correo que recibe el CLIENTE va en el idioma en el que él reservó
// (reservation.language, con fallback al idioma del negocio) — nunca en el
// idioma por defecto del negocio si el cliente conversó en otro.
// [auditoría — idioma del reagendado]
export function reservationEmailHtml(client, reservation, type) {
  const lang = emailLanguage(client, reservation);
  const l = L[lang];
  const special = reservation.specialRequests || l.noSpecialRequests;
  const service = reservation.servicio || (reservation.partySize ? l.people(reservation.partySize) : l.reservationFallback);
  const titleKey = type === 'cancelled' ? 'cancelled' : type === 'rescheduled' ? 'rescheduled' : 'confirmed';
  const title = l.title[titleKey];
  const actions = type === 'cancelled' || !reservation.actionToken ? '' : `<p style="margin:20px 0 0"><a href="${esc(reservationActionUrl(reservation, 'cancel'))}" style="display:inline-block;background:#b23b3b;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:600">${l.cancel}</a> <a href="${esc(reservationActionUrl(reservation, 'reschedule'))}" style="display:inline-block;background:${esc(client.color || '#1a4a2e')};color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:600">${l.reschedule}</a></p>`;
  const intro = type === 'cancelled'
    ? `<p style="font-size:15px;line-height:1.55">${l.cancelledIntro}</p>`
    : `<p style="font-size:15px;line-height:1.55">${l.customerIntroLine(client.businessName, l.customerIntro[titleKey])}</p>`;
  return shell(`${intro}
    <p style="font-size:14px;line-height:1.7"><strong>${esc(service)}</strong><br>${esc(reservation.fecha)} · ${esc(reservation.hora)}${reservation.partySize ? `<br>${l.people(reservation.partySize)}` : ''}<br><strong>${l.specialRequests}</strong> ${esc(special)}</p>${actions}`,
    title, client.color || '#1a4a2e', client.businessName || l.reservationFallback, lang);
}

export function resendMessageId(r) {
  return (r && r.data && r.data.id) || (r && r.id) || null;
}

// Sends reservation emails and reports the actual provider result per recipient.
export async function sendReservationEmails(client, reservation, type, deps) {
  const result = {
    configured: !!process.env.RESEND_API_KEY,
    customer: { attempted: false, sent: false, messageId: null, error: null },
    owners:   { attempted: false, sent: false, messageIds: [], recipients: [], error: null },
    warning: null,
  };
  const resend = (deps && deps.resend) || (process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null);
  if (!resend) {
    result.warning = 'RESEND_API_KEY missing: confirmation email NOT sent';
    console.error(`[reservation-emails] EMAIL SKIPPED (RESEND_API_KEY missing) for ${reservation.clientId} — reservation saved, email not sent`);
    return result;
  }

  const recipients = destinatariosAviso(client);
  const titleKey = type === 'cancelled' ? 'cancelled' : type === 'rescheduled' ? 'rescheduled' : 'confirmed';

  // El cliente ve todo en SU idioma (reservation.language); el dueño ve todo
  // en el idioma del negocio (client.language) — un cliente que reservó en
  // inglés no debe cambiarle el idioma al aviso interno del dueño.
  // [auditoría — idioma del reagendado]
  const customerLang = emailLanguage(client, reservation);
  const ownerLang = emailLanguage(client, { language: client && client.language });
  const customerSubject = `${client.businessName} - ${L[customerLang].subject[titleKey]}`;
  const ownerSubject = type === 'cancelled'
    ? `${L[ownerLang].ownerSubjectPrefix.cancelled} - ${client.businessName}`
    : type === 'rescheduled'
    ? `${L[ownerLang].ownerSubjectPrefix.rescheduled} - ${client.businessName}`
    : `${L[ownerLang].ownerSubjectPrefix.confirmed} - ${client.businessName}`;

  const details = reservationEmailHtml(client, reservation, type);

  const lo = L[ownerLang];
  const serviceName = reservation.servicio || (reservation.partySize ? lo.people(reservation.partySize) : lo.reservationFallback);

  let ownerIntroText = '';
  if (type === 'cancelled') {
    ownerIntroText = ownerLang === 'en'
      ? `The reservation for <strong>${esc(reservation.nombre)}</strong> for <strong>${esc(serviceName)}</strong> on ${esc(reservation.fecha)} at ${esc(reservation.hora)} was cancelled.`
      : `La reserva de <strong>${esc(reservation.nombre)}</strong> para <strong>${esc(serviceName)}</strong> del ${esc(reservation.fecha)} a las ${esc(reservation.hora)} fue cancelada.`;
  } else if (type === 'rescheduled') {
    ownerIntroText = ownerLang === 'en'
      ? `The reservation for <strong>${esc(reservation.nombre)}</strong> for <strong>${esc(serviceName)}</strong> was rescheduled to <strong>${esc(reservation.fecha)}</strong> at <strong>${esc(reservation.hora)}</strong>.`
      : `La reserva de <strong>${esc(reservation.nombre)}</strong> para <strong>${esc(serviceName)}</strong> fue reagendada para el <strong>${esc(reservation.fecha)}</strong> a las <strong>${esc(reservation.hora)}</strong>.`;
  } else {
    ownerIntroText = ownerLang === 'en'
      ? `You have a new reservation from <strong>${esc(reservation.nombre)}</strong> for <strong>${esc(serviceName)}</strong> on <strong>${esc(reservation.fecha)}</strong> at <strong>${esc(reservation.hora)}</strong>.`
      : `Tienes una nueva reserva de <strong>${esc(reservation.nombre)}</strong> para <strong>${esc(serviceName)}</strong>, el <strong>${esc(reservation.fecha)}</strong> a las <strong>${esc(reservation.hora)}</strong>.`;
  }

  const ownerContactBox = `
    <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:12px;padding:16px;margin:20px 0">
      <p style="margin:0 0 8px;font-size:14px;color:#495057"><strong>${lo.phone}</strong> ${esc(reservation.telefono || lo.notProvided)}</p>
      <p style="margin:0 0 8px;font-size:14px;color:#495057"><strong>${lo.email}</strong> ${esc(reservation.email || lo.notProvided)}</p>
      <p style="margin:0;font-size:14px;color:#495057"><strong>${lo.specialRequests}</strong> ${esc(reservation.specialRequests || lo.noSpecialRequests)}</p>
    </div>
  `;

  const dashboardUrl = `${APP_URL}/reservas/${encodeURIComponent(client.id || reservation.clientId)}`;
  const ownerDashboardBtn = `
    <p style="margin:24px 0 8px;text-align:center">
      <a href="${esc(dashboardUrl)}" style="display:inline-block;background:${esc(client.color || '#1a4a2e')};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">${lo.viewDashboard}</a>
    </p>
  `;

  const ownerHtml = shell(`<p style="font-size:15px;line-height:1.6;color:#212529">${ownerIntroText}</p>${ownerContactBox}${ownerDashboardBtn}`,
    ownerSubject, client.color || '#1a4a2e', client.businessName || lo.reservationFallback, ownerLang);

  if (reservation.email) {
    result.customer.attempted = true;
    try {
      const r = await resend.emails.send({ from: FROM, to: reservation.email, subject: customerSubject, html: details });
      if (r && r.error) { result.customer.error = r.error.message || 'send failed'; }
      else { result.customer.sent = true; result.customer.messageId = resendMessageId(r); }
    } catch (e) { result.customer.error = e.message || 'send threw'; }
    if (result.customer.error) {
      console.error(`[reservation-emails] customer email failed for ${reservation.clientId}:`, result.customer.error);
      captureApiMessage(`Resend customer email failed: ${result.customer.error}`,
        { clientId: reservation.clientId, feature: 'email_customer', route: '/api/reservations' });
    }
  }

  if (recipients.length) {
    result.owners.attempted = true;
    result.owners.recipients = recipients;
    for (const to of recipients) {
      try {
        const r = await resend.emails.send({ from: FROM, to, subject: ownerSubject, html: ownerHtml });
        if (r && r.error) { result.owners.error = r.error.message || 'send failed'; }
        else { result.owners.sent = true; const id = resendMessageId(r); if (id) result.owners.messageIds.push(id); }
      } catch (e) { result.owners.error = e.message || 'send threw'; }
    }
    if (result.owners.error) {
      console.error(`[reservation-emails] owner email failed for ${reservation.clientId}:`, result.owners.error);
      captureApiMessage(`Resend owner email failed: ${result.owners.error}`,
        { clientId: reservation.clientId, feature: 'email_owner', route: '/api/reservations' });
    }
  }
  return result;
}

export const __test = { emailLanguage };
