// Проверка OpenAPI-спецификации относительно реального роутера (без запуска сервера).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openapiSpec as spec } from '../docs/swagger.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routerSrc = fs.readFileSync(path.join(root, 'src/routes/api.routes.js'), 'utf8');
const routes = [...routerSrc.matchAll(/router\.(get|post|put|delete)\('([^']+)'/g)].map(m => ({ method: m[1], path: '/api' + m[2] }));

test('спецификация — OpenAPI 3.x с обязательными полями', () => {
  assert.match(spec.openapi, /^3\./); assert.ok(spec.info.title && spec.info.version);
  assert.ok(Object.keys(spec.paths).length >= 8);
});
test('каждый маршрут роутера описан в Swagger и наоборот', () => {
  assert.ok(routes.length >= 8);
  for (const r of routes) assert.ok(spec.paths[r.path]?.[r.method], `нет ${r.method.toUpperCase()} ${r.path} в спецификации`);
  for (const [p, ops] of Object.entries(spec.paths)) for (const m of Object.keys(ops)) assert.ok(routes.some(r => r.path === p && r.method === m), `лишний ${m} ${p}`);
});
test('у каждой операции есть тег, summary и успешный ответ (2xx)', () => {
  const tags = new Set(spec.tags.map(t => t.name));
  for (const [p, ops] of Object.entries(spec.paths)) for (const op of Object.values(ops)) {
    assert.ok(op.summary, p); assert.ok(Object.keys(op.responses).some(c => /^2\d\d$/.test(c)), p); assert.ok(op.tags.every(t => tags.has(t)), p);
  }
});
test('все $ref разрешаются', () => {
  const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g)].map(m => m[1].split('/'));
  assert.ok(refs.length > 0);
  for (const parts of refs) { let node = spec; for (const k of parts) node = node?.[k]; assert.ok(node, `битая ссылка #/${parts.join('/')}`); }
});
test('история описана: схема ответа и заголовок X-History-Source, без устаревшего 503', () => {
  const get = spec.paths['/api/history'].get;
  assert.equal(get.responses['200'].content['application/json'].schema.items.$ref, '#/components/schemas/HistoryPoint');
  assert.ok(get.responses['200'].headers['X-History-Source']);
  assert.equal(get.responses['503'], undefined);
});
test('границы параметров в Swagger совпадают с валидацией контроллера', () => {
  const params = (p) => Object.fromEntries((spec.paths[p].get.parameters || []).map(x => [x.name, x.schema]));
  const ctrl = fs.readFileSync(path.join(root, 'src/controllers/market.controller.js'), 'utf8');
  const h = params('/api/history');
  assert.equal(h.limit.maximum, 20000); assert.equal(h.bucket.maximum, 86400);
  assert.match(ctrl, /name: 'limit', fallback: 2000, min: 1, max: 20000/);
  assert.equal(params('/api/data').depth.maximum, 20); assert.equal(params('/api/scan').limit.maximum, 200);
  const interval = params('/api/klines').interval.enum;
  for (const i of interval) assert.match(i, /^(1m|3m|5m|15m|30m|60m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/);
});
test('индикаторы описаны: параметры, схемы и границы совпадают с контроллером', () => {
  const get = spec.paths['/api/indicators'].get;
  const params = Object.fromEntries(get.parameters.map(x => [x.name, x]));
  assert.equal(params.names.required, true); assert.equal(params.limit.schema.maximum, 500);
  assert.equal(get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/IndicatorsResult');
  assert.ok(get.responses['400'] && get.responses['502']);
  assert.ok(spec.paths['/api/indicators/catalog'].get);
  const ctrl = fs.readFileSync(path.join(root, 'src/controllers/market.controller.js'), 'utf8');
  assert.match(ctrl, /name: 'limit', fallback: 200, min: 1, max: 500/);
  assert.equal(spec.paths['/api/klines'].get.parameters.find(x => x.name === 'limit').schema.maximum, 500);
});
