import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reservasHtmlPath = join(root, 'reservas.html');
const reservasHtml = readFileSync(reservasHtmlPath, 'utf8');

const dom = new JSDOM(reservasHtml, { runScripts: 'outside-only' });
const { window } = dom;
const { document } = window;

// Simular el JSON retornado por /api/client-status
const statusJson = {
  clientId: "barberia-trial-status",
  active: false,
  paymentStatus: "pending",
  plan: "pro",
  stripeCustomerId: "cus_V37K4XWSmaxyBa",
  stripeSubscriptionId: null,
  paidUntil: null,
  trial_end: "2026-08-17T21:50:27.867Z",
  trialDaysLeft: 7,
  isTrialing: true,
  hasPaymentMethod: false
};

// Inyectar el script de renderizado de banner
const tr = (k) => {
  const dict = {
    planTrialActive: 'Prueba gratuita activa',
    manageSubscription: 'Gestionar suscripción'
  };
  return dict[k] || k;
};

const esc = (s) => String(s || '');
const panelLanguage = 'es';

function renderPlanBannerFromData(d) {
  var icon  = document.getElementById('plan-icon');
  var title = document.getElementById('plan-title');
  var sub   = document.getElementById('plan-sub');
  var btnWrap = document.getElementById('portal-btn-wrap');
  var banner = document.getElementById('plan-banner');
  if (!banner) return;
  banner.style.display = 'flex';

  var s = d;
  var isTrialing = s.trial_end && s.paymentStatus !== 'paid' && s.paymentStatus !== 'failed' && s.paymentStatus !== 'cancelled';
  var trialDaysLeft = 0;
  if (s.trial_end) {
    trialDaysLeft = Math.ceil((new Date(s.trial_end) - Date.now()) / 86400000);
  }

  if (isTrialing && trialDaysLeft > 0) {
    banner.className = 'plan-banner trial';
    icon.textContent = '⏳';
    title.textContent = tr('planTrialActive');
    var daysLeftText = trialDaysLeft === 1
      ? (panelLanguage === 'en' ? '1 day of free trial remaining' : 'Queda 1 día de prueba gratuita')
      : (panelLanguage === 'en' ? trialDaysLeft + ' days of free trial remaining' : 'Quedan ' + trialDaysLeft + ' días de prueba gratuita');
    sub.textContent = daysLeftText;
    if (s.stripeCustomerId) {
      btnWrap.innerHTML = '<button class="plan-btn" id="portal-btn" onclick="openPortal()">' + esc(tr('manageSubscription')) + '</button>';
    } else {
      btnWrap.innerHTML = '';
    }
  }
}

renderPlanBannerFromData(statusJson);

console.log('=== VERIFICACIÓN DOM DE RESERVAS.HTML CON RESPUESTA DE API/CLIENT-STATUS ===\n');
console.log('Clase del Banner:', document.getElementById('plan-banner').className);
console.log('Icono:', document.getElementById('plan-icon').textContent);
console.log('Título:', document.getElementById('plan-title').textContent);
console.log('Subtítulo:', document.getElementById('plan-sub').textContent);
console.log('Botón HTML:', document.getElementById('portal-btn-wrap').innerHTML);
