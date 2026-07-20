# Bella Luna Spa — Estado de la auditoría de producción

**Rama:** `qa/production-readiness` · **Última actualización:** ronda 1 (diagnóstico + primeras correcciones).
**Veredicto actual: NO LISTO — auditoría en curso** (faltan fases de E2E con escritura y modelo real).

## Hallazgos

### QA-01 — Fechas en formato US (MM/DD/AAAA) saltaban la validación de horario · **Alto** · CORREGIDO
- **Escenario que lo descubrió:** `qa-fechas.test.mjs` D9 (categoría D).
- **Esperado:** `07/24/2026` (24 de julio) coherente en frontend y backend; se valida contra el horario.
- **Real (antes):** el frontend capturaba `07/24/2026` (día en 2ª posición), pero `parseFechaISO` asumía siempre DD/MM → `07/24` con mes 24 es inválido → `fechaISO=''`. Con `fechaISO` vacío, `validarReserva` devuelve `{ok:true}` sin comprobar horario/anticipación, y el panel no puede ordenar la reserva.
- **Causa exacta:** `api/reservations.js` → `parseFechaISO`, rama numérica `dmy`: no desambiguaba día/mes como sí hace el frontend (`chat-core.js/extraerFecha`).
- **Corrección:** la rama numérica ahora desambigua igual que el frontend (nº > 12 fija su papel; ambos ≤ 12 → DD/MM).
- **Regresión:** `qa-fechas.test.mjs` D9 (4 aserciones) — falla sin el fix, pasa con él.
- **Estado:** ✅ corregido y verificado localmente. Pendiente de deploy + E2E real.

## Cubierto y verde (ronda 1)

- **Deterministas (Node):** fechas (D), horas (E), confirmación (H), seguridad/inyección/guardrails (K, L), notas/nombres/marcadores/dedup (F, G), regresiones históricas. `npm run test:unit` → verde.
- **E2E seguro (Playwright, 5 navegadores):** interfaz/responsive sin scroll horizontal (M), contrato de API 400/401/405 (J), panel protegido y sin fuga con token inválido (N), crons y endpoints temporales protegidos (K). 55 pruebas verdes.

## Pendiente (fases siguientes acordadas)

1. **E2E de reservas completas con escritura** sobre un **cliente de prueba dedicado** (`qa-e2e-test`): flujo entero, coherencia chat→API→Redis→panel, doble-envío/duplicados, "sí" vs botón, reconexión, rechazo por horario. Requiere sembrar el cliente de prueba.
2. **Conversaciones con el modelo real (~15-20)**: preguntas del negocio (A), estilos de cliente (B), prompt-injection (K), invención (L) — asserts estructurales.
3. **Notificaciones**: verificación de encolado + digest en *dry-run* (O).
4. **3 rondas completas consecutivas** sin críticos ni altos.
5. **Deploy del fix QA-01** a producción y re-verificación E2E.

## Categorías del plan vs. estado

| | Categoría | Estado |
|---|---|---|
| A | Preguntas del negocio | pendiente (modelo real) |
| B | Conversaciones naturales | pendiente (modelo real) |
| C | Reservas completas | pendiente (E2E con escritura) |
| D | Fechas | ✅ determinista + 1 bug corregido |
| E | Horas | ✅ determinista |
| F | Datos incompletos | parcial (lógica) · falta E2E |
| G | Cambios de opinión | ✅ determinista (extracción) |
| H | Confirmación | ✅ determinista · falta E2E de no-duplicado |
| I | Cancelaciones/reprogramación | pendiente (E2E) |
| J | Errores técnicos | parcial (contrato de API) |
| K | Seguridad | ✅ determinista + contrato |
| L | Información inventada | ✅ guardrails del prompt · falta modelo real |
| M | Interfaz/dispositivos | ✅ E2E 5 navegadores |
| N | Panel | ✅ auth/protección · falta E2E de acciones |
| O | Correos/notificaciones | pendiente (dry-run) |
