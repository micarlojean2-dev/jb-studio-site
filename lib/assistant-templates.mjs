import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OFFICIAL_TEMPLATES = {
  spa: {
    template: new URL('../templates/spa/template.json', import.meta.url),
    features: new URL('../templates/spa/features.json', import.meta.url),
    promptBase: new URL('../templates/spa/prompt-base.txt', import.meta.url),
  },
  restaurant: {
    template: new URL('../templates/restaurant/template.json', import.meta.url),
    features: new URL('../templates/restaurant/features.json', import.meta.url),
    promptBase: new URL('../templates/restaurant/prompt-base.txt', import.meta.url),
  },
  barber: {
    template: new URL('../templates/barber/template.json', import.meta.url),
    features: new URL('../templates/barber/features.json', import.meta.url),
    promptBase: new URL('../templates/barber/prompt-base.txt', import.meta.url),
  },
};

function readJson(url) {
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

// Templates are server-owned. The browser can select an id, but it cannot
// provide a schema, feature set, or base prompt to be persisted.
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
  };
}
