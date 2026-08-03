// Cobertura de las nuevas exportaciones de lib/assistant-templates.mjs
// (auditoría "creador multi plantilla", FASE 1): listOfficialTemplates() y
// buildTemplatePrompt(), agregadas ANTES de quitar la copia local que tenía
// api/generate-client-config.js, para no perder cobertura durante el cambio.
import assert from 'node:assert/strict';
import { getOfficialTemplate, listOfficialTemplates, buildTemplatePrompt } from '../lib/assistant-templates.mjs';

console.log('listOfficialTemplates()');
{
  const list = listOfficialTemplates();
  assert.equal(list.length, 3, 'expone exactamente las 3 plantillas oficiales');
  const ids = list.map(t => t.id).sort();
  assert.deepEqual(ids, ['barber', 'restaurant', 'spa'], 'ids: barber, restaurant, spa');
  for (const t of list) {
    assert.ok(t.name, `${t.id}: tiene name`);
    assert.equal(t.version, '1.0', `${t.id}: tiene version (el admin la necesita para templateVersion, sin hardcodear)`);
    assert.ok(Array.isArray(t.requiredFields) && t.requiredFields.length, `${t.id}: tiene requiredFields`);
    assert.ok(t.features && typeof t.features === 'object', `${t.id}: tiene features`);
    assert.equal(t.promptBase, undefined, `${t.id}: NUNCA expone promptBase al listar (no debe llegar al navegador)`);
  }
}

console.log('getOfficialTemplate() sigue intacto');
{
  const spa = getOfficialTemplate('spa');
  assert.equal(spa.id, 'spa');
  assert.equal(spa.version, '1.0');
  assert.ok(spa.promptBase && spa.promptBase.length > 0, 'getOfficialTemplate SÍ trae promptBase (uso server-side)');
  assert.equal(getOfficialTemplate('unknown-template'), null, 'plantilla desconocida devuelve null');
}

console.log('buildTemplatePrompt()');
{
  const template = getOfficialTemplate('spa');
  const prompt = buildTemplatePrompt({
    businessName: 'Spa Prueba',
    address: 'Calle Falsa 123',
    phoneCountryCode: '+56',
    phoneNumber: '912345678',
    services: [{ nombre: 'Masaje', precio: '35000', duracion: '60' }],
    businessHours: {
      monday: { enabled: true, ranges: [{ start: '10:00', end: '19:00' }] },
      tuesday: { enabled: false, ranges: [] },
    },
  }, template);

  assert.ok(prompt.startsWith(template.promptBase), 'el prompt empieza con el promptBase oficial de la plantilla');
  assert.ok(prompt.includes('Spa Prueba'), 'incluye businessName');
  assert.ok(prompt.includes('Calle Falsa 123'), 'incluye address');
  assert.ok(prompt.includes('+56912345678'), 'incluye teléfono compuesto');
  assert.ok(prompt.includes('Masaje') && prompt.includes('35000') && prompt.includes('60'), 'incluye servicios con precio y duración');
  assert.ok(prompt.includes('monday: 10:00-19:00'), 'incluye horario habilitado');
  assert.ok(prompt.includes('tuesday: Cerrado'), 'día deshabilitado se marca Cerrado');
  assert.ok(prompt.length <= 6000, 'el prompt nunca excede 6000 caracteres');

  const empty = buildTemplatePrompt({}, template);
  assert.ok(empty.includes('No especificado'), 'sin datos de negocio, usa placeholders en vez de romper');
  assert.ok(empty.includes('No especificados'), 'sin servicios/horarios, usa placeholders en vez de romper');

  // Distintas plantillas producen distintos prompts base — nunca se mezclan.
  const barberPrompt = buildTemplatePrompt({ businessName: 'Barber Prueba' }, getOfficialTemplate('barber'));
  const restaurantPrompt = buildTemplatePrompt({ businessName: 'Rest Prueba' }, getOfficialTemplate('restaurant'));
  assert.notEqual(barberPrompt, prompt, 'barbería no produce el mismo prompt que spa');
  assert.notEqual(restaurantPrompt, prompt, 'restaurante no produce el mismo prompt que spa');
  assert.ok(barberPrompt.startsWith(getOfficialTemplate('barber').promptBase), 'barbería usa su propio promptBase');
  assert.ok(restaurantPrompt.startsWith(getOfficialTemplate('restaurant').promptBase), 'restaurante usa su propio promptBase');
  assert.notEqual(getOfficialTemplate('barber').promptBase, getOfficialTemplate('spa').promptBase, 'promptBase de barbería difiere del de spa');
  assert.notEqual(getOfficialTemplate('restaurant').promptBase, getOfficialTemplate('spa').promptBase, 'promptBase de restaurante difiere del de spa');
}

console.log('Todas las pruebas de lib/assistant-templates.mjs pasan');
