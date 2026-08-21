# Auditoria E2E real del chatbot

- URL: https://jbstudio.app/asistente.html?id=spa
- Ejecucion: 2026-08-13T20-42-59-958Z
- Casos aprobados: 11
- Casos fallidos: 2
- Errores de consola: 2
- Respuestas HTTP >=400: 2

## Casos
- FAIL case-1-normal-booking: Summary continue button did not appear (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-1-normal-booking-failed.png)
- FAIL case-2-named-service: Expected direct date selection after named service, found buttons: ✨ Ver servicios | 📅 Reservar | 💰 Precios | Masaje relajante | Masaje de piedras calientes | Facial hidratante | Exfoliación corporal | Manicura spa | Pedicura spa (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-2-named-service-failed.png)
- PASS case-3-language-1: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-3-language-1-passed.png)
- PASS case-3-language-2: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-3-language-2-passed.png)
- PASS case-3-language-3: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-3-language-3-passed.png)
- PASS case-4-incomplete-1: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-4-incomplete-1-passed.png)
- PASS case-4-incomplete-2: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-4-incomplete-2-passed.png)
- PASS case-5-unusual-1: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-5-unusual-1-passed.png)
- PASS case-5-unusual-2: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-5-unusual-2-passed.png)
- PASS case-5-unusual-3: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-5-unusual-3-passed.png)
- PASS case-5-unusual-4: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-5-unusual-4-passed.png)
- PASS case-6-invalid-details: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-6-invalid-details-passed.png)
- PASS case-7-duplicate-intent: sin error (/Users/mike/jb-studio-site/auditoria-e2e-produccion/2026-08-13T20-42-59-958Z/screenshots/case-7-duplicate-intent-passed.png)

## Hallazgos
- case-1-normal-booking: Summary continue button did not appear (asistente.html)
- case-2-named-service: Expected direct date selection after named service, found buttons: ✨ Ver servicios | 📅 Reservar | 💰 Precios | Masaje relajante | Masaje de piedras calientes | Facial hidratante | Exfoliación corporal | Manicura spa | Pedicura spa (chat-flow.js or api/reservations.js)

El JSON conserva transcript, botones usados, errores de consola y fallos HTTP por escenario.
