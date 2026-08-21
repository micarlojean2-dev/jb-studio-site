# jb-studio-site — reglas de proyecto (Claude Code)

Estas reglas se suman a las instrucciones globales de `~/.claude/CLAUDE.md`. No las repiten — solo añaden lo específico de este proyecto (SaaS multi-tenant de chatbots para spas/barberías/restaurantes).

## Flujo obligatorio antes de tocar código

Ciclo permanente para cualquier cambio en este repo:

**DIAGNOSTICAR → MOSTRAR CÓDIGO/ESTRUCTURA REAL EN EL CHAT → EXPLICAR CAUSA Y OPCIONES → DETENTE → RECIBIR APROBACIÓN → MODIFICAR → PROBAR → LIMPIAR CÓDIGO REEMPLAZADO → MOSTRAR EVIDENCIA → PRODUCCIÓN SOLO SI SE AUTORIZA.**

Nunca cambies código a ciegas, incluso en cambios que parezcan pequeños.

### 1) Inspección previa (solo lo relevante al cambio pedido)

Según aplique: repositorio, rama/HEAD, último commit, `origin/main`, `git status`, commit realmente desplegado en producción (Vercel), archivos/funciones/callers/dependencias involucrados, el flujo completo de principio a fin, estado frontend/backend, estructura de Redis relevante (lectura), endpoints/APIs, configuración por negocio (`client:*`), proveedor/modelo de IA activo, variables de entorno relevantes (solo nombres, nunca valores), y lo que aporten los MCPs conectados (Sentry, Better Stack, Vercel, Upstash, GitHub, Chrome/Playwright) sin esperar a que se pidan por nombre.

### 2) Entrega de evidencia directamente en el chat

Nunca en artifact ni pestaña nueva salvo que se pida explícitamente — debe poder copiarse tal cual. Incluye: archivos y funciones exactas, fragmentos pequeños de código real, cómo se conectan las piezas, qué datos viajan entre ellas, qué componente tiene autoridad sobre cada acción, qué código viejo/duplicado/legacy existe, y qué podría romperse si se modifica esa parte.

### 3) Alto obligatorio

Tras el diagnóstico, DETENTE. No modifiques, no comitees, no hagas push ni deploy hasta recibir la instrucción concreta aprobada.

### 4) Al implementar lo ya aprobado

Reverifica que el código no cambió desde el diagnóstico. Crea backup si corresponde. Modifica solo lo necesario. Reutiliza código existente cuando sea correcto. Elimina el código reemplazado si ya no tiene callers — sin legacy, TODOs ni fallbacks "por si acaso".

### 5) Evidencia posterior

Archivos modificados, BEFORE/AFTER de los fragmentos relevantes, código eliminado, callers/referencias revisados, tests ejecutados con resultado exacto, `git diff --stat`, riesgos restantes.

Si se autoriza producción: verificar el commit real, push, deployment, estado READY, confirmar que producción apunta exactamente al commit correcto, smoke tests, y revisar Sentry/Vercel/Better Stack si aplica.
