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
