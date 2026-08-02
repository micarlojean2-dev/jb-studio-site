import assert from 'node:assert/strict';
import { registrarActividad } from '../lib/activity.js';
import { createReservationsListHandler } from '../api/reservations-list.js';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const lists = new Map();
const store = {
  async get(key) { return key === 'client:spa' ? { panelToken: 'panel-key' } : null; },
  multi() {
    const ops = [];
    return {
      rpush(key, value) { ops.push(['rpush', key, value]); return this; },
      ltrim(key, start, end) { ops.push(['ltrim', key, start, end]); return this; },
      async exec() {
        ops.forEach((op) => {
          if (op[0] === 'rpush') lists.set(op[1], (lists.get(op[1]) || []).concat(op[2]));
          if (op[0] === 'ltrim') lists.set(op[1], (lists.get(op[1]) || []).slice(op[2]));
        });
      },
    };
  },
  async lrange(key) { return lists.get(key) || []; },
};

await registrarActividad('spa', { type: 'created', cliente: 'Ana', servicio: 'Facial', fecha: 'Viernes', hora: '3:00 PM' }, { redis: store });
await registrarActividad('spa', { type: 'cancelled', cliente: 'Mike', servicio: 'Masaje', fecha: 'Mañana', hora: '7:00 PM' }, { redis: store });
await registrarActividad('spa', { type: 'rescheduled', cliente: 'Ana', servicio: 'Facial', fecha: 'Sábado', hora: '4:00 PM', prevFecha: 'Viernes', prevHora: '3:00 PM' }, { redis: store });

assert.equal(lists.get('activity:spa').length, 3, 'stores each activity independently from digest events');
const response = { statusCode: 0, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
await createReservationsListHandler({ redis: store })({ method: 'GET', query: { clientId: 'spa', token: 'panel-key', scope: 'activity' }, body: {} }, response);
assert.equal(response.statusCode, 200, 'authenticated activity endpoint succeeds');
assert.deepEqual(response.body.activities.map((a) => a.type), ['rescheduled', 'cancelled', 'created'], 'returns newest activities first');

const panel = readFileSync(new URL('../reservas.html', import.meta.url), 'utf8');
assert.match(panel, /Actividad reciente/, 'panel includes the activity section');
assert.match(panel, /fetchActivity\(t\)/, 'panel fetches authenticated activity data');
assert.match(panel, /function renderActivity\(\)/, 'panel renders activity independently from reservation cards');

const dom = new JSDOM(panel, {
  runScripts: 'dangerously',
  url: 'https://example.test/reservas/spa',
  beforeParse(window) {
    window.fetch = async () => ({ ok: true, status: 200, json: async () => [] });
  },
});
dom.window.showPanel([], response.body.activities);
const activityText = dom.window.document.getElementById('activity-list').textContent;
assert.match(activityText, /Ana reagendó una cita/, 'panel renders the newest activity');
assert.match(activityText, /Sábado · 4:00 PM/, 'panel renders activity date and time');
assert.match(activityText, /Antes:Viernes · 3:00 PM/, 'panel renders the previous appointment slot');
assert.match(activityText, /Ahora:Sábado · 4:00 PM/, 'panel renders the current appointment slot');
dom.window.showPanel([], [{ type: 'created', cliente: 'Ana', servicio: 'Facial', fecha: 'Viernes', hora: '3:00 PM' }]);
assert.match(dom.window.document.getElementById('activity-list').textContent, /Ana creó una nueva reservaFacialViernes · 3:00 PM/,
  'new reservation activity includes the customer name');
dom.window.showPanel([], [{ type: 'rescheduled', cliente: 'Ana', servicio: 'Facial', fecha: 'Sábado', hora: '4:00 PM' }]);
assert.match(dom.window.document.getElementById('activity-list').textContent, /Ana reagendó una citaAhora:Sábado · 4:00 PM/,
  'old rescheduled events without previous fields remain renderable');
dom.window.close();

console.log('Activity storage, API, and panel integration verified');
