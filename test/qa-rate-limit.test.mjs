// Prueba aislada del handler real: los POST inválidos cuentan para el límite
// igual que en producción, pero la ejecución local no toca Redis ni crea datos.
const { default: handler } = await import('../api/reservations.js');

function response() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

const ip = `rate-limit-test-${Date.now()}`;
for (let attempt = 1; attempt <= 6; attempt++) {
  const res = response();
  await handler({ method: 'POST', headers: { 'x-forwarded-for': ip }, body: {} }, res);
  const expected = attempt <= 5 ? 400 : 429;
  if (res.statusCode !== expected) {
    throw new Error(`intento ${attempt}: esperado ${expected}, recibido ${res.statusCode}`);
  }
}

console.log('Rate limit: cinco POST inválidos devuelven 400; el sexto devuelve 429.');
