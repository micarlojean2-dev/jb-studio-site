// Verificación de contrato del fix de paymentStatus en stripe-webhook.js.
// Sigue el patrón del repo (ver test/create-checkout-trial.test.mjs): verifica
// el código fuente real, porque el handler usa Stripe por red (no testeable con
// un fake Redis simple). Protege el fix contra regresión.
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/stripe-webhook.js', import.meta.url), 'utf8');
let fallos = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.error('  ✗', msg); fallos++; }
}

console.log('\n1. customer.subscription.updated — trialing vs active:');
ok(
  source.includes("patch.paymentStatus     = sub.status === 'trialing' ? 'trialing' : 'paid';"),
  'trialing → paymentStatus "trialing"; active → "paid" (ternaria en subscription.updated)'
);
ok(
  source.includes("if (sub.status === 'active' || sub.status === 'trialing') {") &&
  source.includes("patch.paymentStatus     = sub.status === 'trialing' ? 'trialing' : 'paid';"),
  'la ternaria está dentro de la rama active/trialing'
);

console.log('\n2. invoice.paid — factura de trial vs renovación real:');
ok(
  source.includes("paymentStatus:         'paid',") &&
  source.includes("if (sub.status === 'trialing') patch.paymentStatus = 'trialing';"),
  'invoice.paid usa sub.status de la suscripción asociada para corregir a trialing'
);
ok(
  source.includes("const sub = await stripe.subscriptions.retrieve(subscriptionId);") &&
  source.includes("if (sub.status === 'trialing') patch.paymentStatus = 'trialing';"),
  'el retrieve de la suscripción ya existía y ahora se usa para decidir el paymentStatus'
);

console.log('\n3. No se tocó lo que no había que tocar:');
const noBreak = [
  /paymentStatus:\s*'paid',/,
  /paymentStatus\s*=\s*'past_due';/,
  /paymentStatus\s*=\s*'failed';/,
  /paymentStatus\s*=\s*'cancelled';/,
  /paymentStatus\s*=\s*'paused';/,
];
for (const re of noBreak) {
  ok(re.test(source), `se mantiene la rama con "${re.source}"`);
}

console.log(`\n${fallos === 0 ? '✅ Contrato del fix verificado' : `❌ ${fallos} fallo(s)`}`);
process.exit(fallos > 0 ? 1 : 0);
