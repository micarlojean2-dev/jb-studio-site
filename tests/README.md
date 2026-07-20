# Bella Luna Spa — Suite de auditoría de preparación para producción

Pruebas para verificar que el asistente, las reservas, el panel y las APIs
funcionan de verdad — no solo que la interfaz responde. Se comprueba la
**coherencia real** entre lo que dice el cliente, lo que captura el frontend, lo
que valida/guarda el backend y lo que muestra el panel.

## Comandos

```bash
npm run test:production-readiness   # TODO: unit determinista + E2E (5 navegadores)
npm run test:critical               # solo lo crítico (fechas, horas, confirmación, seguridad, contrato de API)
npm run test:unit                   # solo las pruebas deterministas de Node (rápidas, sin red)
npm run test:e2e                    # solo Playwright (escritorio x3 + móvil x2)
npm test                            # la suite base histórica (regresiones previas)
```

Reporte HTML de Playwright: `npx playwright show-report` (tras `test:e2e`).

## Estructura

### Deterministas (Node, sin red) — `test/*.mjs`
Cargan `chat-core.js` (frontend) y los normalizadores reales de
`api/reservations.js` (backend) y comprueban su lógica de forma reproducible.

| Archivo | Cubre | Categorías |
|---|---|---|
| `qa-fechas.test.mjs` | fechas: captura frontend ↔ `parseFechaISO` backend, NO corrupción, formatos US/EU, imposibles | D |
| `qa-horas.test.mjs` | horas: desambiguación AM/PM con horario, inválidas, coherencia 24h | E |
| `qa-confirmacion.test.mjs` | `esConfirmacion`: "sí" confirma, negativos/ambiguos nunca | H |
| `qa-seguridad.test.mjs` | saneado de marcadores, inyección no se captura, panel escapa HTML, guardrails del prompt | K, L |
| `fecha.test.mjs` | regresión del bug histórico "02-55" (teléfono ≠ fecha) | D |
| `fallos-e2e.test.mjs` | notas del cliente, nombres completos, marcadores, dedup | F, G |
| `notes / panel / digest / changes / admin-login` | notas, render del panel, digest, cola, login admin | N, O |

### E2E (Playwright) — `tests/e2e/*.spec.js`
Corren en 5 proyectos: `desktop-chromium`, `desktop-firefox`, `desktop-webkit`,
`mobile-android` (Pixel 5), `mobile-ios` (iPhone 13).

| Archivo | Cubre | Seguro para prod |
|---|---|---|
| `interface.spec.js` | carga, campo visible, sin scroll horizontal, saludo | ✅ solo lectura |
| `api-contract.spec.js` | 400/401/405, panel protegido, cron protegido, sin fuga de datos | ✅ no escribe |

Las pruebas marcadas `@critical` entran en `test:critical`.

## Datos de prueba seguros

- Las pruebas E2E actuales **no crean reservas** (solo lectura/contrato).
- El E2E de reservas completas (que sí escribe) usa un **cliente de prueba
  dedicado y aislado**, nunca el negocio real, con limpieza posterior (fase
  pendiente, ver `docs/QA-STATUS.md`).
- Nunca se usan correos reales en pruebas que envían; el digest se prueba en
  modo *dry-run* (sin enviar).

## Estado de la auditoría

Ver `docs/QA-STATUS.md` para el detalle de qué está probado, qué falta y los
hallazgos. **El sistema NO está declarado listo para producción**: la auditoría
completa (E2E de reservas escritas, conversaciones con el modelo real, 3 rondas
completas) está en curso.
