// Интеграционные тесты шаблонизатора (EJS), страниц, статики и Swagger UI.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installMexcMock } from './helpers/mexc-mock.js';
import { startServer } from './helpers/server.js';
import { openapiSpec } from '../docs/swagger.js';

let srv, mock;
before(async () => { mock = installMexcMock(); srv = await startServer(); });
after(async () => { await srv.close(); mock.restore(); });
const html = async (p) => { const r = await fetch(srv.base + p); return { r, body: await r.text() }; };
const activeLabel = (body) => (body.match(/class="btn active"[^>]*>([^<]+)</) || [])[1]?.trim();

test('GET / — терминал отрендерен EJS без остатков тегов, навигация подсвечивает «Терминал»', async () => {
  const { r, body } = await html('/');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(body, /<title>MEXC PRO TERMINAL<\/title>/);
  assert.ok(!/<%|%>/.test(body), 'в HTML остались неотрендеренные EJS-теги');
  assert.match(body, /href="\/scanner"/); assert.match(activeLabel(body), /Терминал/);
  for (const id of ['bidLine', 'obAsks', 'symbolInput']) assert.ok(body.includes(id), id);
});
test('GET /scanner и алиасы /scanner.html, /table.html — сканер, подсвечен «Сканер»', async () => {
  for (const p of ['/scanner', '/scanner.html', '/table.html']) {
    const { r, body } = await html(p);
    assert.equal(r.status, 200, p); assert.match(body, /<title>MEXC SCANNER<\/title>/, p);
    assert.ok(!/<%|%>/.test(body), p); assert.match(activeLabel(body), /Сканер/, p);
  }
});
test('статика: /style.css отдаётся как CSS', async () => {
  const r = await fetch(srv.base + '/style.css');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/css/);
});
test('неизвестная страница → 404 JSON', async () => assert.equal((await fetch(srv.base + '/no-such-page')).status, 404));
test('GET /openapi.json совпадает с docs/swagger.js', async () => {
  const r = await fetch(srv.base + '/openapi.json');
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), JSON.parse(JSON.stringify(openapiSpec)));
});
test('GET /api-docs — открывается Swagger UI', async () => {
  const r = await fetch(srv.base + '/api-docs/'); const body = await r.text();
  assert.equal(r.status, 200); assert.match(body, /swagger-ui/i); assert.match(body, /MEXC Indicator API/);
});
test('ресурсы Swagger UI доступны', async () => {
  assert.equal((await fetch(srv.base + '/api-docs/swagger-ui-init.js')).status, 200);
});
