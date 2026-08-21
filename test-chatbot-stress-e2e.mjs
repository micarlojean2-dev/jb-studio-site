import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL = 'https://jbstudio.app/asistente.html?id=spa';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = join(process.cwd(), 'auditoria-e2e-produccion', RUN_ID);
const SCREENSHOT_DIR = join(OUTPUT_DIR, 'screenshots');
const REPORT_PATH = join(OUTPUT_DIR, 'reporte-e2e-chatbot.json');
const SUMMARY_PATH = join(OUTPUT_DIR, 'resumen-e2e-chatbot.md');
const TEST_CUSTOMER = {
  name: `E2E TEST ${RUN_ID.slice(0, 10)}`,
  phone: '2025550147',
  email: `e2e-test-${Date.now()}@example.invalid`,
  requests: 'E2E TEST - cancelar al terminar',
};

await mkdir(SCREENSHOT_DIR, { recursive: true });

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  url: BASE_URL,
  testCustomer: { ...TEST_CUSTOMER, email: '[redacted in summary]' },
  cases: [],
  console: [],
  network: [],
  findings: [],
};

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function probableSource(message = '') {
  if (/booking|reserv|slot|fecha|hora|service|servicio/i.test(message)) return 'chat-flow.js or api/reservations.js';
  if (/intent|chat|openai|interpret/i.test(message)) return 'api/client-chat.js or lib/message-interpreter.js';
  if (/button|selector|flow|customer/i.test(message)) return 'asistente.html';
  return 'No deterministic source identified';
}

async function waitForIdle(page, delay = 450) {
  await page.waitForTimeout(delay);
  await page.waitForFunction(() => !document.querySelector('#a-ty'), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function visibleMessages(page) {
  return page.locator('.a-b').evaluateAll(nodes => nodes.map(node => node.textContent.trim()).filter(Boolean));
}

async function visibleButtons(page) {
  return page.locator('button.a-quick-btn:visible').evaluateAll(nodes => nodes.map(node => node.textContent.trim()).filter(Boolean));
}

async function snapshot(page, scenario, label) {
  const file = join(SCREENSHOT_DIR, `${slug(scenario)}-${slug(label)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function openScenario(browser, scenario) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const started = Date.now();
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      report.console.push({ scenario, type: message.type(), text: message.text(), at: new Date().toISOString() });
    }
  });
  page.on('pageerror', error => report.console.push({ scenario, type: 'pageerror', text: error.message, at: new Date().toISOString() }));
  page.on('response', response => {
    if (response.status() >= 400) {
      report.network.push({ scenario, status: response.status(), url: response.url(), at: new Date().toISOString() });
    }
  });
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.locator('#a-inp').waitFor({ state: 'visible', timeout: 20_000 });
  await waitForIdle(page, 700);
  return { context, page, loadMs: Date.now() - started };
}

async function chooseLanguageIfPresent(page, actions) {
  const buttons = await visibleButtons(page);
  const spanish = buttons.find(button => /español|spanish/i.test(button));
  if (spanish) {
    await page.getByRole('button', { name: spanish, exact: true }).click();
    actions.push({ type: 'click', value: spanish });
    await waitForIdle(page);
  }
}

async function send(page, text, actions) {
  const input = page.locator('#a-inp');
  await input.fill(text);
  await page.locator('#a-snd').click();
  actions.push({ type: 'message', value: text, at: new Date().toISOString() });
  await waitForIdle(page);
}

async function clickFirstMatching(page, pattern, actions) {
  const buttons = await visibleButtons(page);
  const label = buttons.find(button => pattern.test(button));
  if (!label) return null;
  await page.getByRole('button', { name: label, exact: true }).click();
  actions.push({ type: 'click', value: label, at: new Date().toISOString() });
  await waitForIdle(page);
  return label;
}

async function clickFirstButton(page, actions) {
  const buttons = await visibleButtons(page);
  if (!buttons.length) return null;
  const label = buttons[0];
  await page.getByRole('button', { name: label, exact: true }).click();
  actions.push({ type: 'click', value: label, at: new Date().toISOString() });
  await waitForIdle(page);
  return label;
}

async function completeGuidedBooking(page, actions, expectations = {}) {
  const initialButtons = await visibleButtons(page);
  if (expectations.skipService && initialButtons.length) {
    throw new Error(`Expected direct date selection after named service, found buttons: ${initialButtons.join(' | ')}`);
  }

  if (!expectations.skipService) {
    if (!await clickFirstButton(page, actions)) throw new Error('No service button appeared');
  }
  if (!await clickFirstButton(page, actions)) throw new Error('No date button appeared');
  if (!await clickFirstButton(page, actions)) throw new Error('No time button appeared');

  await send(page, `${TEST_CUSTOMER.name}, ${TEST_CUSTOMER.phone}, ${TEST_CUSTOMER.email}, ${TEST_CUSTOMER.requests}`, actions);
  if (!await clickFirstMatching(page, /continuar|continue/i, actions)) throw new Error('Summary continue button did not appear');
  if (!await clickFirstMatching(page, /^confirmar$|^confirm$/i, actions)) throw new Error('Confirmation button did not appear');
}

async function runCase(browser, name, runner) {
  const result = { name, status: 'passed', actions: [], transcript: [], screenshots: [], errors: [], startedAt: new Date().toISOString() };
  let session;
  try {
    session = await openScenario(browser, name);
    result.loadMs = session.loadMs;
    await chooseLanguageIfPresent(session.page, result.actions);
    await runner(session.page, result);
    result.transcript = await visibleMessages(session.page);
    result.buttonsAtEnd = await visibleButtons(session.page);
  } catch (error) {
    result.status = 'failed';
    result.errors.push({ message: error.message, probableSource: probableSource(error.message) });
    report.findings.push({ case: name, error: error.message, probableSource: probableSource(error.message) });
  } finally {
    if (session) {
      result.transcript = await visibleMessages(session.page).catch(() => result.transcript);
      result.buttonsAtEnd = await visibleButtons(session.page).catch(() => result.buttonsAtEnd);
      result.screenshots.push(await snapshot(session.page, name, result.status).catch(() => null));
      await session.context.close();
    }
  }
  result.screenshots = result.screenshots.filter(Boolean);
  result.finishedAt = new Date().toISOString();
  report.cases.push(result);
  return result;
}

const browser = await chromium.launch({ headless: true });
try {
  await runCase(browser, 'case-1-normal-booking', async (page, result) => {
    await send(page, 'Quiero reservar', result.actions);
    await completeGuidedBooking(page, result.actions);
    const messages = await visibleMessages(page);
    if (!messages.some(message => /confirmad[ao]/i.test(message))) {
      throw new Error('Reservation flow did not show a confirmed state');
    }

    await send(page, 'quiero cambiar la hora', result.actions);
    const afterModify = await visibleMessages(page);
    if (!afterModify.some(message => /cambiar|change|hora|time/i.test(message))) {
      throw new Error('Existing reservation did not enter modification flow');
    }

    await send(page, 'quiero cancelar mi cita', result.actions);
    const cancelButton = await clickFirstMatching(page, /cancelar|cancel/i, result.actions);
    if (!cancelButton) throw new Error('Cancellation action button did not appear');
    const messagesAfterCancel = await visibleMessages(page);
    if (!messagesAfterCancel.some(message => /cancelad[ao]/i.test(message))) {
      throw new Error('Cancellation did not produce a visible confirmation');
    }
  });

  await runCase(browser, 'case-2-named-service', async (page, result) => {
    await send(page, 'Quiero reservar: Masaje relajante', result.actions);
    await completeGuidedBooking(page, result.actions, { skipService: true });
  });

  for (const [index, message] of [
    'Me gustaría agendar una cita',
    'Necesito una reserva',
    'Quiero una cita para mañana',
  ].entries()) {
    await runCase(browser, `case-3-language-${index + 1}`, async (page, result) => {
      await send(page, message, result.actions);
      const buttons = await visibleButtons(page);
      if (!buttons.length) throw new Error(`Booking intent did not show guided options for: ${message}`);
    });
  }

  for (const [index, message] of ['Quiero reservar mañana', 'Quiero una cita'].entries()) {
    await runCase(browser, `case-4-incomplete-${index + 1}`, async (page, result) => {
      await send(page, message, result.actions);
      const messages = await visibleMessages(page);
      const buttons = await visibleButtons(page);
      if (!buttons.length && !messages.some(text => /elige|choose|fecha|date|servicio|service/i.test(text))) {
        throw new Error(`Incomplete booking did not request the next required step: ${message}`);
      }
    });
  }

  for (const [index, message] of ['hola', 'precio', 'asdfasdf', 'mañana'].entries()) {
    await runCase(browser, `case-5-unusual-${index + 1}`, async (page, result) => {
      await send(page, message, result.actions);
      const messages = await visibleMessages(page);
      if (messages.length < 2) throw new Error(`No visible chatbot reply for: ${message}`);
      const inputDisabled = await page.locator('#a-inp').isDisabled();
      if (inputDisabled) throw new Error(`Chat input remained blocked after: ${message}`);
    });
  }

  await runCase(browser, 'case-6-invalid-details', async (page, result) => {
    await send(page, 'Quiero reservar', result.actions);
    await clickFirstButton(page, result.actions);
    await clickFirstButton(page, result.actions);
    await clickFirstButton(page, result.actions);
    for (const invalid of ['Juan', '123', 'correo']) {
      await send(page, invalid, result.actions);
      const inputDisabled = await page.locator('#a-inp').isDisabled();
      if (inputDisabled) throw new Error(`Input remained blocked after invalid customer data: ${invalid}`);
    }
    const messages = await visibleMessages(page);
    if (!messages.some(message => /usa:|use:|correo|email|teléfono|phone/i.test(message))) {
      throw new Error('Invalid customer data did not trigger a validation instruction');
    }
  });

  await runCase(browser, 'case-7-duplicate-intent', async (page, result) => {
    for (let i = 0; i < 3; i++) await send(page, 'quiero reservar', result.actions);
    const bookingPrompts = (await visibleMessages(page)).filter(message => /elige un servicio|choose a service/i.test(message));
    if (bookingPrompts.length > 1) throw new Error(`Repeated booking intent duplicated guided state (${bookingPrompts.length} service prompts)`);
  });
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.summary = {
  passed: report.cases.filter(test => test.status === 'passed').length,
  failed: report.cases.filter(test => test.status === 'failed').length,
  consoleErrors: report.console.length,
  networkErrors: report.network.length,
};

await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
const markdown = [
  '# Auditoria E2E real del chatbot',
  '',
  `- URL: ${BASE_URL}`,
  `- Ejecucion: ${report.runId}`,
  `- Casos aprobados: ${report.summary.passed}`,
  `- Casos fallidos: ${report.summary.failed}`,
  `- Errores de consola: ${report.summary.consoleErrors}`,
  `- Respuestas HTTP >=400: ${report.summary.networkErrors}`,
  '',
  '## Casos',
  ...report.cases.map(test => `- ${test.status === 'passed' ? 'PASS' : 'FAIL'} ${test.name}: ${test.errors.map(error => error.message).join('; ') || 'sin error'}${test.screenshots[0] ? ` (${test.screenshots[0]})` : ''}`),
  '',
  '## Hallazgos',
  ...(report.findings.length ? report.findings.map(finding => `- ${finding.case}: ${finding.error} (${finding.probableSource})`) : ['- No se detectaron fallos automatizados.']),
  '',
  'El JSON conserva transcript, botones usados, errores de consola y fallos HTTP por escenario.',
].join('\n');
await writeFile(SUMMARY_PATH, markdown + '\n');

console.log(JSON.stringify({ report: REPORT_PATH, summary: SUMMARY_PATH, ...report.summary }, null, 2));
process.exitCode = report.summary.failed ? 1 : 0;
