// Verificación de contrato del fix: bookingFlowRecover/widgetFlowRecover deben
// mostrar un mensaje explicativo ANTES de cada redirección del flujo (nunca
// redirigir en silencio). También confirma que el rate limit 429 (shape
// { error, message }) queda cubierto.
import { readFileSync } from 'node:fs';

const asistente = readFileSync(new URL('../asistente.html', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../widget.js', import.meta.url), 'utf8');
let fallos = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.error('  ✗', msg); fallos++; }
}

// El mensaje se construye leyendo result.mensaje || result.message (cubre el 429).
for (const [nombre, src] of [['asistente.html', asistente], ['widget.js', widget]]) {
  console.log(`\n${nombre}:`);
  ok(/(result\.mensaje \|\| result\.message)/.test(src), 'lee result.mensaje o result.message (cubre el shape del 429)');
  ok(/function explicar\(\)/.test(src), 'define explicar() con fallback genérico');
  ok(/Ese horario ya no está disponible\. Por favor elige otro\./.test(src), 'fallback genérico en español presente');
  ok(/That time is no longer available\. Please choose another one\./.test(src), 'fallback genérico en inglés presente');
  // Cada dispatch de recuperación debe estar precedido por explicar().
  const blocks = src.match(/if \(motivo === 'servicio_invalido'\)\{?[\s\S]*?explicar\(\);[\s\S]*?EDIT_SERVICE/s);
  ok(blocks, 'servicio_invalido → explicar() + EDIT_SERVICE');
  const fechaBlocks = src.match(/if \(motivo === 'fecha_invalida' \|\| motivo === 'dia_cerrado' \|\| motivo === 'feriado'\)\{?[\s\S]*?explicar\(\);[\s\S]*?EDIT_DATE/s);
  ok(fechaBlocks, 'fecha_invalida/dia_cerrado/feriado → explicar() + EDIT_DATE');
  // El fallback final debe llamar explicar() antes de EDIT_TIME.
  const fallbackOk = /explicar\(\);[\s\S]*?EDIT_TIME/.test(src) || /explicar\(\);[\s\S]*?dispatch\(\{ type: (window\.JBChatFlow\.|FLOW\.)EVENTS\.EDIT_TIME/s.test(src);
  ok(fallbackOk, 'fallback genérico → explicar() + EDIT_TIME');
}

console.log(`\n${fallos === 0 ? '✅ bookingFlowRecover/widgetFlowRecover explican antes de redirigir' : `❌ ${fallos} fallo(s)`}`);
process.exit(fallos > 0 ? 1 : 0);
