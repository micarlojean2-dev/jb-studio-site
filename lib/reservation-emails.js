import { Resend } from 'resend';
import { captureApiMessage } from './sentry.js';

const FROM = 'reservas@jbstudio.app';
const APP_URL = 'https://jbstudio.app';

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
  return `${APP_URL}/asistente/${encodeURIComponent(reservation.clientId)}?${params}`;
}

export function reservationEmailHtml(client, reservation, type) {
  const special = reservation.specialRequests || 'Sin peticiones especiales';
  const service = reservation.servicio || (reservation.partySize ? `${reservation.partySize} personas` : 'Reserva');
  const copy = type === 'cancelled'
    ? { title: 'Reserva cancelada', intro: 'fue cancelada.' }
    : type === 'rescheduled'
      ? { title: 'Reserva reprogramada', intro: 'fue reprogramada.' }
      : { title: 'Reserva confirmada', intro: 'está confirmada.' };
  const actions = type === 'cancelled' ? '' : `<p style="margin:20px 0 0"><a href="${esc(reservationActionUrl(reservation, 'cancel'))}" style="display:inline-block;background:#b23b3b;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:600">Cancelar</a> <a href="${esc(reservationActionUrl(reservation, 'reschedule'))}" style="display:inline-block;background:${esc(client.color || '#1a4a2e')};color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:600">Reagendar</a></p>`;
  const intro = type === 'cancelled'
    ? '<p style="font-size:15px;line-height:1.55">La reserva fue cancelada.</p>'
    : `<p style="font-size:15px;line-height:1.55">Tu reserva en <strong>${esc(client.businessName)}</strong> ${copy.intro}</p>`;
  return shell(`${intro}
    <p style="font-size:14px;line-height:1.7"><strong>${esc(service)}</strong><br>${esc(reservation.fecha)} · ${esc(reservation.hora)}${reservation.partySize ? `<br>${esc(reservation.partySize)} personas` : ''}<br><strong>Peticiones especiales:</strong> ${esc(special)}</p>${actions}`,
    copy.title, client.color || '#1a4a2e', client.businessName || 'Reserva');
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
  const subject = type === 'cancelled' ? `${client.businessName} - reserva cancelada`
    : type === 'rescheduled' ? `${client.businessName} - reserva reprogramada`
      : `${client.businessName} - reserva confirmada`;
  const details = reservationEmailHtml(client, reservation, type);
  const ownerIntro = type === 'cancelled'
    ? `La reserva de <strong>${esc(reservation.nombre)}</strong> fue cancelada.`
    : `<strong>${esc(reservation.nombre)}</strong>: ${esc(reservation.servicio || `${reservation.partySize || ''} personas`)}`;
  const ownerHtml = shell(`<p style="font-size:15px;line-height:1.55">${ownerIntro}</p><p>${esc(reservation.fecha)} · ${esc(reservation.hora)}</p><p><strong>Peticiones especiales:</strong> ${esc(reservation.specialRequests || 'Sin peticiones especiales')}</p>`, subject, client.color || '#1a4a2e', client.businessName || 'Reserva');

  if (reservation.email) {
    result.customer.attempted = true;
    try {
      const r = await resend.emails.send({ from: FROM, to: reservation.email, subject, html: details });
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
        const r = await resend.emails.send({ from: FROM, to, subject, html: ownerHtml });
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
