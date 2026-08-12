# Diagnóstico y Estado del Chatbot JB Studio

Documentación técnica y diagnóstico actualizado del chatbot conversacional del repositorio `jb-studio-site`. Registra la arquitectura actual, la simplificación del proveedor de IA hacia OpenAI (`gpt-4o-mini`), la extracción de datos con validación determinista y la tubería de recuperación de JSON estructurado con reintento.

---

## Índice

- [Inventario de archivos](#inventario-de-archivos)
- [1. Selección de proveedor e integración de IA (`api/client-chat.js`)](#1-selección-de-proveedor-e-integración-de-ia-apiclient-chatjs)
- [2. Estructura del intérprete y utilidades (`lib/message-interpreter.js`)](#2-estructura-del-intérprete-y-utilidades-libmessage-interpreterjs)
- [3. Pruebas unitarias y cobertura (`test/message-interpreter.test.mjs`)](#3-pruebas-unitarias-y-cobertura-testmessage-interpretertestmjs)
- [4. Integración en frontend (`widget.js` / `asistente.html`)](#4-integración-en-frontend-widgetjs--asistentehtml)
- [5. Backend de autoridad y reservación (`api/reservations.js` / `chat-core.js`)](#5-backend-de-autoridad-y-reservación-apireservationsjs--chat-corejs)
- [6. Cambios recientes (registro)](#6-cambios-recientes-registro)
- [7. Panel admin — creación de cliente nuevo](#7-panel-admin--creación-de-cliente-nuevo)

---

## Inventario de archivos

| Archivo | Líneas | Última Modificación (Git Commit) |
|---|---|---|
| `api/client-chat.js` | 984 | 2026-08-12 15:53 (`d960a22`) |
| `lib/message-interpreter.js` | 253 | 2026-08-12 15:53 (`d960a22`) |
| `test/message-interpreter.test.mjs` | 269 | 2026-08-12 15:53 (`d960a22`) |
| `widget.js` | 1777 | 2026-08-12 10:09 (`c51297c`) |
| `asistente.html` | 1777 | 2026-08-12 10:09 (`c51297c`) |
| `chat-core.js` | 1563 | 2026-08-12 10:09 (`c51297c`) |
| `api/reservations.js` | 1421 | 2026-08-11 09:51 (`36b39f0`) |

---

## 1. Selección de proveedor e integración de IA (`api/client-chat.js`)

El chatbot utiliza **OpenAI (`gpt-4o-mini`)** de forma exclusiva en producción. Se removieron completamente los proveedores alternativos no utilizados (Anthropic/Claude y DeepSeek), consolidando el manejo de credenciales y llamadas HTTP en `callOpenAI()`.

### Código real actual de proveedor y modelo:

```javascript
    40	// ── Provider config (OpenAI gpt-4o-mini) ──────────────────────────────────
    41	function getProvider() {
    42	  return 'openai';
    43	}
    44	
    45	function getModel() {
    46	  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
    47	}
```

### Código real actual de `callOpenAI()`:

```javascript
   547	// ── OpenAI call (GPT-4o-mini) ──────────────────────────────────────────────
   548	async function callOpenAI(messages, systemPrompt, maxTokens, responseFormat, temperature) {
   549	  const apiKey = process.env.OPENAI_API_KEY;
   550	  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
   551	
   552	  const model = getModel();
   553	  const body = {
   554	    model,
   555	    messages: [
   556	      { role: 'system', content: systemPrompt },
   557	      ...messages.slice(-50),
   558	    ],
   559	    max_tokens: maxTokens || 300,
   560	    temperature: temperature !== undefined ? temperature : 0.7,
   561	  };
   562	  if (responseFormat) {
   563	    body.response_format = responseFormat;
   564	  }
   565	
   566	  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
   567	  const upstream = await fetch(baseUrl + '/chat/completions', {
   568	    method: 'POST',
   569	    headers: {
   570	      'Content-Type': 'application/json',
   571	      'Authorization': `Bearer ${apiKey}`,
   572	    },
   573	    body: JSON.stringify(body),
   574	  });
   575	
   576	  if (!upstream.ok) {
   577	    const errBody = await upstream.text().catch(() => '');
   578	    console.error(`[api/client-chat] OpenAI ${upstream.status}: ${errBody}`);
   579	    throw new Error(`OpenAI API error: ${upstream.status}`);
   580	  }
   581	
   582	  return await upstream.json();
   583	}
```

### Código real actual de `callProvider()` (con recuperación de JSON, reintento y logging):

```javascript
   855	async function callProvider(provider, messages, systemPrompt, client, clientId, bookingActive, structured) {
   856	  // 420 truncated real replies mid-sentence, including mid-marker (the model
   857	  // writes [MOSTRAR_MENU] itself per the prompt), leaving raw "[MOSTR" visible
   858	  // to the customer. [BUG-TRUNCATED-MARKER]
   859	  const interpreterPrompt = structured ? systemPrompt + buildInterpreterInstructions(structured.activeLanguage) : systemPrompt;
   860	  const maxTokens = structured ? (structured.bookingActive ? BOOKING_TURN_MAX_TOKENS : INTERPRETER_MAX_TOKENS) : 600;
   861	  const temperature = structured ? (structured.bookingActive ? BOOKING_TURN_TEMPERATURE : INTERPRETER_TEMPERATURE) : undefined;
   862	  const data = await callOpenAI(messages, interpreterPrompt, maxTokens, structured ? deepseekResponseFormat() : undefined, temperature);
   863	
   864:   let text = data.choices?.[0]?.message?.content || '';
   865: 
   866:   const inputTokens = data.usage?.prompt_tokens || 0;
   867:   const outputTokens = data.usage?.completion_tokens || 0;
   868:   const costPer1kInput = 0.00015;
   869:   const costPer1kOutput = 0.00060;
   870:   const estimatedCost = (inputTokens / 1000) * costPer1kInput + (outputTokens / 1000) * costPer1kOutput;
   871: 
   872:   trackUsage(clientId, inputTokens, outputTokens, estimatedCost);
   873: 
   874:   let interpretation = null;
   875:   if (structured) {
   876:     // 1. Intento inicial de parseo con limpieza de markdown (code fences ```json) y texto prosaico
   877:     interpretation = parseInterpretation(text);
   878:     if (interpretation) {
   879:       const parsedObj = extractJsonFromText(text);
   880:       if (parsedObj && typeof parsedObj.text === 'string') {
   881:         text = parsedObj.text;
   882:       }
   883:     } else {
   884:       // 2. Si el parseo/esquema falló, realizar UN reintento a OpenAI antes de rendirse
   885:       console.warn('[api/client-chat] initial JSON parse/schema failed, retrying OpenAI once. Raw response:', text);
   886:       try {
   887:         const retryData = await callOpenAI(messages, interpreterPrompt, maxTokens, deepseekResponseFormat(), temperature);
   888:         const retryText = retryData.choices?.[0]?.message?.content || '';
   889:         interpretation = parseInterpretation(retryText);
   890:         if (interpretation) {
   891:           text = retryText;
   892:           const parsedRetryObj = extractJsonFromText(retryText);
   893:           if (parsedRetryObj && typeof parsedRetryObj.text === 'string') {
   894:             text = parsedRetryObj.text;
   895:           }
   896:         }
   897:       } catch (retryErr) {
   898:         console.error('[api/client-chat] retry OpenAI failed:', retryErr.message);
   899:       }
   900:     }
   901: 
   902:     // 3. Fallback en caso de que el reintento también haya fallado
   903:     if (!interpretation) {
   904:       console.error('[api/client-chat] interpreter fallback — failed to get valid JSON interpretation after retry. Raw model response:', text);
   905:       captureApiException(new Error('Invalid JSON interpretation from AI after retry'), { clientId, feature: 'chat_interpretation', route: '/api/client-chat', rawText: text });
   906:       // Fail-closed: llamada de respaldo en texto plano.
   907:       try {
   908:         const fallback = await callOpenAI(messages, systemPrompt, 600);
   909:         text = fallback.choices?.[0]?.message?.content || '';
   910:       } catch (fbErr) {
   911:         console.error('[api/client-chat] plain text fallback failed:', fbErr.message);
   912:       }
   913:       interpretation = emptyInterpretation();
   914:     }
   915:   }
```

---

## 2. Estructura del intérprete y utilidades (`lib/message-interpreter.js`)

Modulo encargado de definir el contrato estructurado `{intent, text, entities}`, los esquemas de respuesta, la sanitización de intenciones/entidades, y las funciones de limpieza de JSON `extractJsonFromText()` y `parseInterpretation()`.

### Código real actual de extracción y sanitización de JSON:

```javascript
   197	// Extrae un bloque JSON válido de texto crudo devuelto por la IA.
   198	// Limpia code fences (```json ... ```) y texto prosaico alrededor.
   199	export function extractJsonFromText(rawText) {
   200	  if (typeof rawText !== 'string') return null;
   201	  const text = rawText.trim();
   202	  if (!text) return null;
   203	
   204	  try {
   205	    return JSON.parse(text);
   206	  } catch (e) {
   207	    // Continúa a limpia de markdown y búsqueda de llaves
   208	  }
   209	
   210	  // 1. Limpieza de markdown code fences ```json ... ``` o ``` ... ```
   211	  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
   212	  if (fenceMatch && fenceMatch[1]) {
   213	    try {
   214	      return JSON.parse(fenceMatch[1].trim());
   215	    } catch (e) {
   216	      // Continúa a búsqueda por delimitadores {}
   217	    }
   218	  }
   219	
   220	  // 2. Búsqueda de delimitadores de objeto JSON externo: de primer '{' a último '}'
   221	  const firstBrace = text.indexOf('{');
   222	  const lastBrace = text.lastIndexOf('}');
   223	  if (firstBrace !== -1 && lastBrace > firstBrace) {
   224	    const candidate = text.slice(firstBrace, lastBrace + 1).trim();
   225	    try {
   226	      return JSON.parse(candidate);
   227	    } catch (e) {
   228	      // No fue un JSON válido
   229	    }
   230	  }
   231	
   232	  return null;
   233	}
   234	
   235	// Fail-closed: si intent no existe, no es string, o no pertenece al enum
   236	// permitido, degrada a "unknown" — nunca asume booking/reschedule/
   237	// cancellation sin una clasificación válida del modelo. `parsed` debe ser
   238	// ya el resultado de JSON.parse(); si no es un objeto no nulo, se devuelve
   239	// null (el llamador decide degradar con emptyInterpretation()).
   240	export function sanitizeInterpretation(parsed) {
   241	  if (!parsed || typeof parsed !== 'object') return null;
   242	  const intent = INTENTS.indexOf(parsed.intent) !== -1 ? parsed.intent : 'unknown';
   243	  const entities = sanitizeEntitiesShape(parsed.entities);
   244	  return { intent, entities };
   245	}
   246	
   247	export function parseInterpretation(rawText) {
   248	  const parsed = extractJsonFromText(rawText);
   249	  if (!parsed) return null;
   250	  return sanitizeInterpretation(parsed);
   251	}
```

---

## 3. Pruebas unitarias y cobertura (`test/message-interpreter.test.mjs`)

Suite unitario dedicado a comprobar las garantías del intérprete de mensajes, sanitización de entidades, degradación fail-closed y recuperación de JSON malformado.

### Código real del bloque de pruebas de recuperación de JSON:

```javascript
   242	console.log('\n8. Recortes de markdown y limpieza de JSON (extractJsonFromText / parseInterpretation)');
   243	{
   244	  const { extractJsonFromText, parseInterpretation } = await import('../lib/message-interpreter.js');
   245	
   246	  // Caso 1: JSON dentro de code fences ```json ... ```
   247	  const markdownFenced = '```json\n{\n  "intent": "booking",\n  "text": "¡Claro! ¿Para qué fecha?",\n  "entities": {\n    "service": "Masaje Relajante",\n    "date": null,\n    "time": null,\n    "name": null,\n    "email": null,\n    "phone": null,\n    "people": null,\n    "notes": null\n  }\n}\n```';
   248	  const res1 = parseInterpretation(markdownFenced);
   249	  ok(res1 !== null, 'JSON dentro de code fences ```json se recupera correctamente');
   250	  ok(res1.intent === 'booking', 'intent extraído correctamente del code fence');
   251	  ok(res1.entities.service === 'Masaje Relajante', 'service extraído correctamente del code fence');
   252	
   253	  // Caso 2: JSON rodeado de texto explicativo (prosa antes y después)
   254	  const proseSurrounded = 'Aquí está el resultado en formato JSON:\n{\n  "intent": "show_menu",\n  "text": "Te muestro los servicios",\n  "entities": {\n    "service": null,\n    "date": null,\n    "time": null,\n    "name": null,\n    "email": null,\n    "phone": null,\n    "people": null,\n    "notes": null\n  }\n}\nEspero haberte ayudado.';
   255	  const res2 = parseInterpretation(proseSurrounded);
   256	  ok(res2 !== null, 'JSON rodeado de texto explicativo se recupera correctamente');
   257	  ok(res2.intent === 'show_menu', 'intent extraído correctamente de respuesta con prosa alrededor');
   258	
   259	  // Caso 3: Espacios y saltos de línea al inicio y final
   260	  const paddedJson = '   \n  {\n  "intent": "reschedule",\n  "text": "Cambiemos la fecha",\n  "entities": {\n    "service": null,\n    "date": "mañana",\n    "time": null,\n    "name": null,\n    "email": null,\n    "phone": null,\n    "people": null,\n    "notes": null\n  }\n}  \n ';
   261	  const res3 = parseInterpretation(paddedJson);
   262	  ok(res3 !== null, 'JSON con espacios y saltos de línea se recupera correctamente');
   263	  ok(res3.intent === 'reschedule', 'intent extraído correctamente de JSON con espacios alrededor');
   264	  ok(res3.entities.date === 'mañana', 'date extraído correctamente de JSON con espacios alrededor');
   265	}
```

---

## 4. Integración en frontend (`widget.js` / `asistente.html`)

El cliente web (tanto en el widget incrustable como en la vista de prueba `asistente.html`) se comunica con el backend mediante `POST /api/client-chat`.

1. **Recepción de Entidades**: Cuando `d.interpretation` trae `entities`, el cliente las procesa deterministamente con `CORE.sanitizeBookingEntities()` y las combina en `bookingData` con `CORE.mergeBookingEntities()`.
2. **Fail-Closed**: Si `d.interpretation` no se recibe o el backend degrada a `emptyInterpretation()`, el intent cae a `unknown` y el flujo conversacional no rompe la sesión del usuario.
3. **Casos locales deterministas**: `CORE.extractBooking()` se conserva exclusivamente para desambiguar nombres de una palabra (`confirmarNombreUnaPalabra`) y procesar acciones directas desde enlaces de correo (`emailAction`).

---

## 5. Backend de autoridad y reservación (`api/reservations.js` / `chat-core.js`)

El código de backend mantiene la autoridad absoluta sobre la reserva:

1. **`chat-core.js`**:
   - `sanitizeBookingEntities()`: Valida nombres de servicios contra el catálogo exacto `cfg.menu`, verifica fechas válidas, formatea horas, valida formato de emails (`EMAIL_RE2`) y números telefónicos.
   - `mergeBookingEntities()`: Actualiza únicamente las claves válidas recibidas sin sobrescribir los datos previamente capturados.
   - `buildModifyUpdateFromEntities()`: Construye el objeto de actualización de reagendamiento cuando el intent recibido es `reschedule`.

2. **`api/reservations.js`**:
   - Único endpoint con capacidad para escribir o modificar reservas en Redis.
   - Valida reglas de negocio: disponibilidad de horarios, solapamientos, límites de capacidad, anticipación mínima y generación de tokens de cancelación/modificación.

---

## 6. Cambios recientes (registro)

- **Commit `2f3686b`** — *refactor: simplify client-chat to OpenAI (gpt-4o-mini) provider only*
  - Simplificación de `api/client-chat.js` removiendo funciones y ramas condicionales relativas a Anthropic/Claude y DeepSeek.
  - Consolidación de llamadas del modelo a `callOpenAI` con modelo predeterminado `gpt-4o-mini`.
  - Actualización de costos de consumo a las tarifas de OpenAI.

- **Commit `d960a22`** — *fix: robust JSON extraction, markdown cleanup, and single retry in client-chat callProvider*
  - Creación de `extractJsonFromText()` y `parseInterpretation()` en `lib/message-interpreter.js` para extraer objetos JSON encerrados en code fences (` ```json `) o con prosa explicativa alrededor.
  - Implementación de un reintento único hacia OpenAI en `callProvider()` de `api/client-chat.js` ante fallos de parseo/esquema antes de degradar.
  - Registro enriquecido con el texto crudo del modelo en `console.error` y `captureApiException`.
  - Adición del bloque de pruebas 8 en `test/message-interpreter.test.mjs` para verificar la recuperación de JSON roto.

---

## 7. Panel admin — creación de cliente nuevo

### 7.1 Código del formulario creador de clientes (`admin.html`)

El creador de chatbots/clientes en el panel de administración (`admin.html`) opera mediante un wizard interactivo (`<template id="legacy-wizard">`) disparado por el botón `open-spa-creator-btn`.

#### Código real del formulario del negocio en `admin.html`:

```html
  2775	          <!-- ── Sección: Negocio ── -->
  2776	          <div class="wizard-step" data-step="1">
  2777	            <div class="ws-section-header"><span class="wizard-step-title">Negocio</span><span class="ws-section-badge" data-badge-for="1"></span></div>
  2778	            <div class="wizard-step-sub">Esta información se usará para personalizar el chatbot.</div>
  2779	            <div class="wizard-grid-2">
  2780	              <div class="form-group">
  2781	                <label>Nombre del negocio</label>
  2782	                <input type="text" id="w-b-name" class="admin-input" placeholder="Barbería López">
  2783	              </div>
  2784	              <div class="form-group">
  2785	                <label>Tipo de negocio</label>
  2786	                <select id="w-b-type" class="admin-input">
  2787	                  <option value="">Selecciona un tipo</option>
  2788	                  <option>Barbería</option>
  2789	                  <option>Restaurante</option>
  2790	                  <option>Salón de belleza</option>
  2791	                  <option>Spa</option>
  2792	                  <option>Uñas</option>
  2793	                  <option>Fotografía</option>
  2794	                  <option>Entrenador personal</option>
  2795	                  <option>Taller mecánico</option>
  2796	                  <option>Clínica</option>
  2797	                  <option>Hotel</option>
  2798	                  <option>Otro</option>
  2799	                </select>
  2800	              </div>
  2801	              <div class="form-group">
  2802	                <label>Plan</label>
  2803	                <select id="w-b-plan" class="admin-input">
  2804	                  <option value="basic">Básico</option>
  2805	                  <option value="pro">Pro</option>
  2806	                </select>
  2807	              </div>
  2808	              <div class="form-group">
  2809	                <label>Dirección</label>
  2810	                <input type="text" id="w-b-address" class="admin-input" placeholder="Av. Principal 123">
  2811	              </div>
  2812	              <div class="form-group">
  2813	                <label>Correo del dueño</label>
  2814	                <input type="email" id="w-b-email" class="admin-input" placeholder="owner@negocio.com">
  2815	              </div>
  2816	              <div class="form-group">
  2817	                <label>Teléfono <span>(opcional)</span></label>
  2818	                <div class="phone-row">
  2819	                  <select id="w-b-phone-country" class="admin-input phone-country-select"></select>
  2820	                  <input type="tel" id="w-b-phone-number" class="admin-input" placeholder="912345678" style="flex:1">
  2821	                </div>
  2822	              </div>
  2823	            </div>
  2824	
  2825	            <div class="form-group" style="margin-top:6px">
  2826	              <label>Idiomas del chatbot</label>
  2827	              <div class="lang-chip-row" id="w-b-lang-chips"></div>
  2828	            </div>
  2829	            <div class="form-group" style="max-width:260px">
  2830	              <label>Idioma principal</label>
  2831	              <select id="w-b-primary-lang" class="admin-input"></select>
  2832	            </div>
```

---

### 7.2 Selectores e IDs exactos para automatización de pruebas

- **Nombre del negocio**: `#w-b-name` (`input[type="text"]`)
- **Tipo de negocio (template)**: `#w-b-type` (`select` con opciones: `Barbería`, `Restaurante`, `Salón de belleza`, `Spa`, `Uñas`, `Fotografía`, `Entrenador personal`, `Taller mecánico`, `Clínica`, `Hotel`, `Otro`)
- **Plan**: `#w-b-plan` (`select` con opciones: `basic`, `pro`)
- **Dirección**: `#w-b-address` (`input[type="text"]`)
- **Correo del dueño**: `#w-b-email` (`input[type="email"]`)
- **Teléfono**: `#w-b-phone-number` (`input[type="tel"]`) y `#w-b-phone-country` (`select`)
- **Botón de Crear/Guardar**: `#wizard-create-btn` (`button.action-btn`) (Formulario legacy alternativo: `#create-btn`)

---

### 7.3 Flujo tras la creación y elemento del Client ID

1. Al presionar `#wizard-create-btn`, el frontend ejecuta `POST /api/generate-client-config` enviando la configuración del negocio.
2. El servidor responde con la configuración creada y su `clientId` único (ej: `barberia-lopez-83`).
3. La interfaz conmuta automáticamente al paso de éxito (`.wizard-step[data-step="success"]`).

#### Código real de la pantalla de éxito en `admin.html`:

```html
  2982	          <!-- ── Éxito (Fase 3) ── -->
  2983	          <div class="wizard-step" data-step="success" style="display:none">
  2984	            <div class="wizard-step-title">CHATBOT CREADO</div>
  2985	            <div style="margin:18px 0 26px;">
  2986	              <div class="summary-row"><span>Nombre</span><span id="w-success-name"></span></div>
  2987	              <div class="summary-row"><span>Estado</span><span class="st-badge st-yellow">Pendiente de pago</span></div>
  2988	            </div>
  2989	            <div style="display:flex;flex-direction:column;gap:12px;">
  2990	              <a id="w-success-try" class="action-btn" style="margin-top:0;text-align:center;text-decoration:none;display:block;" target="_blank" rel="noopener noreferrer">Probar chatbot</a>
  2991	              <button type="button" id="w-success-copy" class="wizard-btn-secondary">Copiar enlace</button>
  2992	              <button type="button" id="w-success-install-toggle" class="wizard-btn-secondary">Instalar en una web</button>
  2993	              <div id="w-success-install-panel" style="display:none;">
  2994	                <div class="snippet-box" id="w-success-snippet" style="word-break:break-all;"></div>
  2995	                <button type="button" id="w-success-install-copy" class="copy-link" style="margin-top:8px;">Copiar código</button>
  2996	              </div>
  2997	              <a id="w-success-reservas" class="wizard-btn-secondary" style="text-align:center;text-decoration:none;display:block;" target="_blank" rel="noopener noreferrer">Ver panel de reservas</a>
  2998	              <button type="button" id="w-success-back" class="wizard-btn-secondary">Volver a clientes</button>
  2999	            </div>
  3000	          </div>
```

- **Ubicación del `clientId` en la interfaz**:
  - Enlace "Probar chatbot": `<a id="w-success-try">` (atributo `href` contiene `/asistente.html?id=<clientId>`).
  - Enlace "Ver panel de reservas": `<a id="w-success-reservas">` (atributo `href` contiene `/reservas.html?id=<clientId>#t=<token>`).
  - Contenedor del snippet de código: `<div id="w-success-snippet">` (contiene el parámetro `id="<clientId>"`).

---

### 7.4 Vista de agenda de reservas del dueño (`reservas.html`)

Para confirmar visualmente que una reserva ha quedado creada y guardada en Redis, se utiliza el panel de reservas ([`reservas.html`](file:///Users/mike/jb-studio-site/reservas.html)).

#### Código real del listado y resumen de agenda en `reservas.html`:

```html
   210	      <section class="agenda-intro" aria-labelledby="agenda-title">
   211	        <div>
   212	          <div class="eyebrow" data-i18n="businessSchedule">Agenda del negocio</div>
   213	          <h1 id="agenda-title" data-i18n="myAppointments">Tus citas</h1>
   214	          <div class="sub" id="count">—</div>
   215	        </div>
   216	        <div class="agenda-live" data-i18n="autoRefresh">Actualización automática</div>
   217	      </section>
   218	
   219	      <section class="summary-grid" aria-label="Schedule summary">
   220	        <article class="summary-card is-today"><span class="summary-value" id="summary-today">0</span><span class="summary-label" data-i18n="todayAppointments">Citas de hoy</span></article>
   221	        <article class="summary-card is-upcoming"><span class="summary-value" id="summary-upcoming">0</span><span class="summary-label" data-i18n="upcomingAppointments">Próximas citas</span></article>
   222	        <article class="summary-card is-rescheduled"><span class="summary-value" id="summary-rescheduled">0</span><span class="summary-label" data-i18n="rescheduled">Reprogramadas</span></article>
   223	        <article class="summary-card is-cancelled"><span class="summary-value" id="summary-cancelled">0</span><span class="summary-label" data-i18n="cancelled">Canceladas</span></article>
   224	      </section>
   225	
   226	      <section aria-labelledby="list-title">
   227	        <div class="agenda-list-header">
   228	          <h2 id="list-title" data-i18n="schedule">Agenda</h2>
   229	          <div class="filters">
   230	            <button class="filter-btn" data-f="todas" onclick="setFilter('todas',this)" data-i18n="all">Todas</button>
   231	            <button class="filter-btn active" data-f="proximas" onclick="setFilter('proximas',this)" data-i18n="upcoming">Próximas</button>
   232	            <button class="filter-btn" data-f="hoy" onclick="setFilter('hoy',this)" data-i18n="todayFilter">Hoy</button>
   233	            <button class="filter-btn" data-f="manana" onclick="setFilter('manana',this)" data-i18n="tomorrowFilter">Mañana</button>
   234	            <button class="filter-btn" data-f="pasadas" onclick="setFilter('pasadas',this)" data-i18n="pastFilter">Pasadas</button>
   235	            <button class="filter-btn" data-f="canceladas" onclick="setFilter('canceladas',this)" data-i18n="cancelled">Canceladas</button>
   236	          </div>
   237	        </div>
   238	        <div class="sheet" id="sheet"></div>
   239	      </section>
   240	      <div class="updated" id="updated"></div>
   241	
   242	      <section class="activity" aria-labelledby="activity-title">
   243	        <div class="activity-head"><h2 id="activity-title" data-i18n="recentActivity">Actividad reciente</h2><p data-i18n="latestChanges">Últimos cambios</p></div>
   244	        <div class="activity-list" id="activity-list"></div>
   245	      </section>
```

#### IDs/Selectores clave para verificación visual de reservas:
- **Contenedor principal de la lista/tabla de citas**: `div#sheet` (`.sheet`)
- **Contador total de citas**: `div#count`
- **Contador de próximas citas**: `span#summary-upcoming`
- **Contador de citas de hoy**: `span#summary-today`
- **Lista de actividad reciente (auditoría)**: `div#activity-list`
- **Filtros de estado de agenda**: `button.filter-btn[data-f="proximas"]`, `button.filter-btn[data-f="todas"]`

