import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OFFICIAL_TEMPLATES = {
  spa: {
    template: new URL('../templates/spa/template.json', import.meta.url),
    features: new URL('../templates/spa/features.json', import.meta.url),
    promptBase: new URL('../templates/spa/prompt-base.txt', import.meta.url),
    promptBaseEn: new URL('../templates/spa/prompt-base-en.txt', import.meta.url),
  },
  restaurant: {
    template: new URL('../templates/restaurant/template.json', import.meta.url),
    features: new URL('../templates/restaurant/features.json', import.meta.url),
    promptBase: new URL('../templates/restaurant/prompt-base.txt', import.meta.url),
    promptBaseEn: new URL('../templates/restaurant/prompt-base-en.txt', import.meta.url),
  },
  barber: {
    template: new URL('../templates/barber/template.json', import.meta.url),
    features: new URL('../templates/barber/features.json', import.meta.url),
    promptBase: new URL('../templates/barber/prompt-base.txt', import.meta.url),
    promptBaseEn: new URL('../templates/barber/prompt-base-en.txt', import.meta.url),
  },
};

function readJson(url) {
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

// Templates are server-owned. The browser can select an id, but it cannot
// provide a schema, feature set, or base prompt to be persisted.
//
// promptBaseEn (auditoría FASE 4 — bilingüe): equivalente oficial en inglés
// de promptBase, escrito a mano (nunca traducido en runtime por IA) y
// versionado junto al resto de la plantilla. Antes solo Spa tenía una
// traducción fija (SPA_BASE_PROMPT_EN, embebida en api/client-chat.js);
// ahora las 3 plantillas oficiales la traen aquí mismo, en el mismo lugar
// que ya es la única fuente de verdad para promptBase.
export function getOfficialTemplate(templateId) {
  const files = OFFICIAL_TEMPLATES[templateId];
  if (!files) return null;

  const template = readJson(files.template);
  if (template.id !== templateId || template.version !== '1.0' || template.status !== 'official') {
    throw new Error(`Invalid official ${templateId} template`);
  }

  return {
    ...template,
    features: readJson(files.features),
    promptBase: readFileSync(fileURLToPath(files.promptBase), 'utf8').trim(),
    promptBaseEn: readFileSync(fileURLToPath(files.promptBaseEn), 'utf8').trim(),
  };
}

// Listado para selectores de UI (ej. el creador del admin). Nunca incluye
// promptBase: el prompt base es un detalle de implementación server-side,
// no algo que el navegador deba ver ni reenviar.
export function listOfficialTemplates() {
  return Object.keys(OFFICIAL_TEMPLATES).map(id => {
    const template = getOfficialTemplate(id);
    return {
      id: template.id,
      name: template.name,
      version: template.version,
      requiredFields: template.requiredFields,
      features: template.features,
    };
  });
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Deriva el system prompt final a partir del promptBase oficial de la
// plantilla + los datos reales y ya validados del negocio. Antes vivía
// (sin exportar) solo en api/generate-client-config.js; se centraliza aquí
// para que api/clients.js también lo use al crear directamente desde el
// formulario del admin, sin duplicar la lógica.
export function buildTemplatePrompt(businessData, template) {
  const b = businessData || {};
  const services = (b.services || []).map(service =>
    `- ${service.nombre}${service.precio ? `: ${service.precio}` : ''}${service.duracion ? ` (${service.duracion})` : ''}`
  ).join('\n') || '- No especificados';
  const businessHours = b.businessHours || {};
  const hours = DAYS.map(day => {
    const value = businessHours[day];
    if (!value || value.unknown) return '';
    if (!value.enabled || !value.ranges.length) return `${day}: Cerrado`;
    return `${day}: ${value.ranges.map(range => `${range.start}-${range.end}`).join(', ')}`;
  }).filter(Boolean).join('\n') || 'No especificados';

  return `${template.promptBase}\n\nDATOS VALIDADOS DEL NEGOCIO\nNombre: ${b.businessName || 'No especificado'}\nDirección: ${b.address || 'No especificada'}\nTeléfono: ${b.phoneCountryCode || ''}${b.phoneNumber || 'No especificado'}\n\nHORARIOS\n${hours}\n\nSERVICIOS\n${services}`.slice(0, 6000);
}
