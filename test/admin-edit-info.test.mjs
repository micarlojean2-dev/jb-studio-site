// Modal "Editar información" del Admin (admin.html):
// - CAMBIO 1A: Plan e Idioma ya no se muestran ni se envían desde este modal
//   (pero client.plan/client.language siguen intactos en el resto del panel).
// - CAMBIO 1B: lista editable de client.notificationEmails[] (correos
//   adicionales, sin repetir al dueño, sin duplicados, máximo 9, formato
//   validado).
// Ejecución real: extrae el bloque de código real de admin.html (mismo
// patrón que test/service-ids.test.mjs con .svc-dup-btn) y lo ejecuta con
// new Function contra un DOM real (jsdom), nunca reimplementa la lógica.
// Ejecutar: node test/admin-edit-info.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'admin.html'), 'utf8');

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('  ✓', message);
  else { console.error('  ✗', message); failures++; }
};

// ── Extrae el bloque real EMAIL_RE_EDIT..leerEditExtraEmails()+listener ────
const startMarker = 'const EMAIL_RE_EDIT';
const endMarker = "document.getElementById('e-extra-email-add').addEventListener('click', () => {";
const endMarkerEnd = html.indexOf('\n    });\n', html.indexOf(endMarker)) + '\n    });\n'.length;
const start = html.indexOf(startMarker);
ok(start !== -1, 'se encontró el bloque real de correos adicionales en admin.html');
const emailModuleSrc = html.slice(start, endMarkerEnd);

function loadEmailModule(doc) {
  const fn = new Function('document', `
    ${emailModuleSrc}
    return { editExtraEmailRow, renderEditExtraEmails, leerEditExtraEmails, EMAIL_RE_EDIT, MAX_EXTRA_EMAILS };
  `);
  return fn(doc);
}

function makeDom() {
  const dom = new JSDOM(`<!DOCTYPE html><body>
    <input id="e-email" type="email">
    <div id="e-extra-emails"></div>
    <button id="e-extra-email-add" type="button"></button>
  </body>`);
  return dom.window.document;
}

console.log('1. renderEditExtraEmails() / editExtraEmailRow() — construye filas reales');
{
  const doc = makeDom();
  const mod = loadEmailModule(doc);
  mod.renderEditExtraEmails(['empleado1@negocio.com', 'empleado2@negocio.com']);
  const rows = doc.querySelectorAll('#e-extra-emails .setup-email-row');
  ok(rows.length === 2, 'crea una fila por correo');
  ok(rows[0].querySelector('.setup-email-inp').value === 'empleado1@negocio.com', 'primera fila con el valor correcto');
  ok(rows[1].querySelector('.setup-email-del').textContent === 'Eliminar', 'cada fila tiene botón Eliminar');
  rows[1].querySelector('.setup-email-del').click();
  ok(doc.querySelectorAll('#e-extra-emails .setup-email-row').length === 1, 'Eliminar quita la fila del DOM (real, no solo el valor)');
}

console.log('\n2. + Agregar correo — respeta el máximo de 9');
{
  const doc = makeDom();
  const mod = loadEmailModule(doc);
  mod.renderEditExtraEmails([]);
  for (let i = 0; i < 12; i++) doc.getElementById('e-extra-email-add').click();
  ok(doc.querySelectorAll('#e-extra-emails .setup-email-row').length === 9, 'nunca deja agregar más de 9 filas, aunque se haga clic 12 veces');
}

console.log('\n3. leerEditExtraEmails() — limpia espacios, minúsculas, sin duplicados');
{
  const doc = makeDom();
  const mod = loadEmailModule(doc);
  doc.getElementById('e-email').value = 'owner@negocio.com';
  mod.renderEditExtraEmails(['  Empleado1@Negocio.com  ', 'empleado1@negocio.com', 'EMPLEADO2@negocio.com']);
  const r = mod.leerEditExtraEmails();
  ok(!r.invalido, 'no marca inválido con correos válidos');
  ok(r.emails.length === 2, 'elimina el duplicado (mismo correo con espacios/mayúsculas distintas)');
  ok(r.emails.includes('empleado1@negocio.com') && r.emails.includes('empleado2@negocio.com'), 'todos en minúsculas y sin espacios');
}

console.log('\n4. leerEditExtraEmails() — impide repetir el correo del dueño');
{
  const doc = makeDom();
  const mod = loadEmailModule(doc);
  doc.getElementById('e-email').value = '  Owner@Negocio.com ';
  mod.renderEditExtraEmails(['owner@negocio.com', 'OWNER@NEGOCIO.COM', 'empleado@negocio.com']);
  const r = mod.leerEditExtraEmails();
  ok(!r.invalido, 'no marca inválido');
  ok(r.emails.length === 1 && r.emails[0] === 'empleado@negocio.com', 'descarta toda coincidencia con el correo del dueño (case/espacios incluidos)');
}

console.log('\n5. leerEditExtraEmails() — valida formato y avisa con invalido:true');
{
  const doc = makeDom();
  const mod = loadEmailModule(doc);
  doc.getElementById('e-email').value = 'owner@negocio.com';
  mod.renderEditExtraEmails(['no-es-un-correo', 'empleado@negocio.com']);
  const r = mod.leerEditExtraEmails();
  ok(r.invalido === true, 'marca invalido:true si hay un formato incorrecto (para mostrar el error claro)');
}

console.log('\n6. leerEditExtraEmails() — máximo 9 en el resultado final, filas vacías se ignoran');
{
  const doc = makeDom();
  const mod = loadEmailModule(doc);
  doc.getElementById('e-email').value = 'owner@negocio.com';
  const doce = Array.from({ length: 12 }, (_, i) => `empleado${i}@negocio.com`);
  mod.renderEditExtraEmails(doce.concat(['', '   ']));
  const r = mod.leerEditExtraEmails();
  ok(!r.invalido, 'las filas vacías no cuentan como inválidas');
  ok(r.emails.length === 9, 'nunca devuelve más de 9 correos adicionales');
}

console.log('\n7. Compatibilidad: cliente sin notificationEmails funciona igual que []');
{
  const doc = makeDom();
  const mod = loadEmailModule(doc);
  // Reproduce exactamente la lógica real de seed dentro de openEditModal()
  // (misma fórmula, extraída del archivo real más abajo).
  const seedStart = html.indexOf('const ownerEmailNorm = String(c.ownerEmail');
  const seedEnd = html.indexOf("document.getElementById('e-extra-email-err').style.display = 'none';", seedStart);
  ok(seedStart !== -1 && seedEnd !== -1, 'se encontró el bloque real de seed en openEditModal()');
  const seedSrc = html.slice(seedStart, seedEnd);
  const seedFn = new Function('c', 'renderEditExtraEmails', `${seedSrc}`);

  doc.getElementById('e-email').value = 'owner@negocio.com';
  const clienteViejo = { id: 'x', ownerEmail: 'owner@negocio.com' }; // sin notificationEmails
  seedFn(clienteViejo, mod.renderEditExtraEmails);
  ok(doc.querySelectorAll('#e-extra-emails .setup-email-row').length === 0, 'cliente legacy sin notificationEmails no rompe: lista vacía');
}

console.log('\n8. Cliente con varios correos carga correctamente (y no repite al dueño si estaba guardado)');
{
  const doc = makeDom();
  const mod = loadEmailModule(doc);
  const seedStart = html.indexOf('const ownerEmailNorm = String(c.ownerEmail');
  const seedEnd = html.indexOf("document.getElementById('e-extra-email-err').style.display = 'none';", seedStart);
  const seedSrc = html.slice(seedStart, seedEnd);
  const seedFn = new Function('c', 'renderEditExtraEmails', `${seedSrc}`);

  doc.getElementById('e-email').value = 'owner@negocio.com';
  const cliente = { id: 'x', ownerEmail: 'owner@negocio.com', notificationEmails: ['owner@negocio.com', 'empleado1@negocio.com', 'empleado2@negocio.com'] };
  seedFn(cliente, mod.renderEditExtraEmails);
  const rows = [...doc.querySelectorAll('#e-extra-emails .setup-email-inp')].map((i) => i.value);
  ok(rows.length === 2 && !rows.includes('owner@negocio.com'), 'carga los correos adicionales sin repetir el que coincide con el dueño (legacy)');
  ok(rows.includes('empleado1@negocio.com') && rows.includes('empleado2@negocio.com'), 'ambos correos adicionales presentes');
}

console.log('\n9. Ya no existe ningún acceso JS a #e-plan / #e-lang');
{
  ok(!/\be-plan\b/.test(html), 'ninguna referencia a e-plan en todo el archivo');
  ok(!/\be-lang\b/.test(html), 'ninguna referencia a e-lang en todo el archivo');
  ok(!/id="e-plan"/.test(html) && !/id="e-lang"/.test(html), 'los <select> Plan/Idioma ya no existen en el HTML del modal');
}

console.log('\n10. El listener de guardar ya no envía plan/language, pero sí notificationEmails');
{
  const saveListenerMatch = html.match(/editSaveBtn\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n    \}\);/);
  ok(!!saveListenerMatch, 'se encontró el listener real de "Guardar cambios"');
  const body = saveListenerMatch[1];
  ok(!/body\.plan\s*=/.test(body), 'no envía body.plan');
  ok(!/body\.language\s*=/.test(body), 'no envía body.language');
  ok(/body\.notificationEmails\s*=\s*extraEmails\.emails/.test(body), 'envía body.notificationEmails con la lista leída de la UI');
}

console.log('\n11. client.plan / client.language / Stripe / features / billing siguen intactos en el resto del panel');
{
  ok(/c\.plan\b/.test(html), 'client.plan se sigue leyendo/mostrando en otras partes del panel (tabla, pagos)');
  ok(/PLAN_LABELS\[c\.plan\]/.test(html), 'la tabla de clientes y "Administrar pago" siguen mostrando el plan real');
  ok(/pago-info-plan|ct-pay-action/.test(html), 'el flujo de pagos/Stripe sigue presente sin tocar');
}

console.log('');
if (failures) { console.error(`\n${failures} fallo(s)`); process.exit(1); }
console.log('✅ Modal "Editar información" verificado (correos adicionales + Plan/Idioma eliminados de la UI)');
