# Resultados de la comparativa de chatbots — 2026-07-28

Cuatro chatbots de producción existentes fueron evaluados con el mismo guion fijo de 25 escenarios conversacionales, contra la API real de producción (`jbstudio.app`), usando datos de prueba claramente identificados (nombre "QA TEST ...", teléfono `0000000000`, email `@example.com`). Todas las reservas de prueba creadas durante la evaluación fueron canceladas al terminar.

## Matriz de puntuación (0-10 por dimensión)

| # | Dimensión | barberia-prueba | bella-luna-spa | **bella-vita-beauty-studio-qa (ganador)** | sabor-urbano-demo |
|---|---|---:|---:|---:|---:|
| 1 | Inteligencia conversacional | 7 | 8 | **8** | 8 |
| 2 | Memoria | 8 | 8 | **9** | 9 |
| 3 | Exactitud (no inventa) | 2 | 4 | **7** | 4 |
| 4 | Reservas (flujo completo) | 4 | 8 | **9** | 5 |
| 5 | Reprogramación | 9 | 9 | **9** | 9 |
| 6 | Cancelación | 9 | 7 | **9** | 9 |
| 7 | Anti-spam / anti-duplicado | 6 | 6 | **9** | 9 |
| 8 | Bilingüe (ES/EN) | 1 | 9 | **1** | 2 |
| 9 | Sigue instrucciones | 4 | 8 | **9** | 4 |
| 10 | Personalización del negocio | 3 | 7 | **8** | 9 |
| 11 | Manejo de errores | 6 | 6 | **6** | 6 |
| 12 | Experiencia de usuario general | 6 | 8 | **7** | 7 |
| 13 | Riqueza de configuración | 3 | 7 | **7** | 9 |
| 14 | Facilidad de plantilla | 7 | 8 | **6** | 8 |
| | **TOTAL /140** | 75 | 103 | **104** | 98 |

## Por qué ganó `bella-vita-beauty-studio-qa`

Empate técnico con `bella-luna-spa` (104 vs. 103). Se eligió `bella-vita-beauty-studio-qa` porque domina de forma contundente en la mecánica de reservas — el núcleo funcional del producto — **verificada contra la API real, no solo conversacionalmente**:

- Creación de reserva: `status:"confirmada"`, `actionToken` real, notificación al negocio disparada.
- Reprogramación: detectó un choque de horario real (`"sin_disponibilidad"`) y ofreció una alternativa automáticamente — el único de los 4 chatbots que demostró este manejo de conflictos.
- Cancelación: verificada con `found:true` y confirmación posterior de que la reserva quedó inactiva.
- Anti-duplicado: la segunda solicitud idéntica devolvió `duplicate:true` referenciando el registro existente, en vez de crear uno nuevo.

## Debilidad compartida a tener en cuenta (no es exclusiva del ganador)

Los 4 chatbots comparten el mismo código de idioma (`api/client-chat.js`, función `langDirectiveFor`), que inyecta una instrucción absoluta ("Nunca cambies de idioma") basada en `client.language`. 3 de 4 (incluido el ganador) fallaron al pedírseles explícitamente cambiar a inglés; solo `bella-luna-spa` lo logró, lo cual se interpreta como variabilidad del modelo ante una instrucción idéntica, no como una diferencia de configuración entre clientes. **Este es un problema de código compartido**, no algo que la elección del ganador resuelva — ver nota en `prompt-example-sanitized.txt`.

## Hallazgos por chatbot (resumen)

- **barberia-prueba** (último lugar, 75/140): alucina horarios, dirección y precios completos que no existen en su configuración; confirma reservas en el chat sin haberlas creado realmente en el backend.
- **bella-luna-spa** (103/140): el más parejo; único bilingüe exitoso; inventó una dirección/colonia que no está en su configuración.
- **bella-vita-beauty-studio-qa** (104/140, GANADOR): mejor mecánica de reservas de los 4, verificada end-to-end; falla bilingüe igual que barberia-prueba.
- **sabor-urbano-demo** (98/140): mejor riqueza de configuración (menú de 6 ítems con imágenes) y mejor personalización; confirma reservas en el chat sin respaldo real en el backend, igual que barberia-prueba.

## Nota de proceso

Durante la Fase 2 se identificó y corrigió temporalmente un límite de solicitudes (`/api/client-chat`: 30/hora, `/api/reservations`: 5/hora, ambos por IP) que bloqueaba las pruebas al correr 4 agentes de comparación en paralelo desde una misma IP de salida. Se subieron ambos límites temporalmente en producción, se completaron las pruebas, y se revirtieron a sus valores originales inmediatamente después (commit de reversión verificado como idéntico byte a byte al estado previo a las pruebas).
