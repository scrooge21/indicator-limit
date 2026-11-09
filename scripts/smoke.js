#!/usr/bin/env node
// Пост-деплойная проверка УЖЕ ЗАПУЩЕННОГО сервера по HTTP (не поднимает приложение сама).
//
//   node scripts/smoke.js [BASE_URL] [--live]
//   BASE_URL=https://my-app.onrender.com npm run test:smoke
//   npm run test:smoke:live          # + реальные запросы к MEXC (нужен выход сервера в интернет)
//
// Без --live проверяется только сам сервис (страницы, Swagger, валидация, health): биржа не нужна.
// С --live добавляются проверки через настоящий MEXC: пары, стакан, свечи (в т.ч. 1h → 60m), индикаторы, история, сканер.
// Код выхода: 0 — всё прошло, 1 — есть упавшие проверки, 2 — сервер недоступен.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXPECTED_PATHS = ['/api/health', '/api/symbols', '/api/klines', '/api/indicators/catalog', '/api/indicators', '/api/data', '/api/history', '/api/scan'];

function assert(condition, message) { if (!condition) throw new Error(message); }

export function buildChecks(base, { live = false, timeoutMs = 20000 } = {}) {
  const get = (path) => fetch(base + path, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  const getJson = async (path, status = 200) => {
    const response = await get(path);
    const text = await response.text();
    assert(response.status === status, `${path}: ожидался HTTP ${status}, получен ${response.status} — ${text.slice(0, 140)}`);
    return { response, body: JSON.parse(text) };
  };
  const expect400 = async (path) => {
    const response = await get(path);
    assert(response.status === 400, `${path}: ожидался HTTP 400, получен ${response.status}`);
    const body = await response.json(); assert(typeof body.error === 'string' && body.error, `${path}: нет поля error`);
  };

  const offline = [
    ['health: сервис жив, источник истории известен', async () => {
      const { body } = await getJson('/api/health');
      assert(body.status === 'ok', `status=${body.status}`);
      assert(['memory', 'mongodb'].includes(body.history?.store), `history.store=${body.history?.store}`);
      assert(!Number.isNaN(Date.parse(body.timestamp)), 'timestamp не дата');
    }],
    ['страница терминала (/) отдаётся и отрисована', async () => {
      const r = await get('/'); const html = await r.text();
      assert(r.status === 200 && /text\/html/.test(r.headers.get('content-type')), `HTTP ${r.status}`);
      assert(/<html/i.test(html) && html.includes('id='), 'в ответе нет разметки страницы');
      assert(!/<%|%>/.test(html), 'в HTML остались нерассчитанные теги EJS');
    }],
    ['страница сканера (/scanner) отдаётся', async () => {
      const r = await get('/scanner'); const html = await r.text();
      assert(r.status === 200 && /<html/i.test(html) && !/<%|%>/.test(html), `HTTP ${r.status}`);
    }],
    ['статика: /style.css', async () => {
      const r = await get('/style.css'); assert(r.status === 200 && /css/.test(r.headers.get('content-type')), `HTTP ${r.status}`);
    }],
    ['OpenAPI: /openapi.json описывает все маршруты API', async () => {
      const { body } = await getJson('/openapi.json');
      assert(/^3\./.test(body.openapi), `openapi=${body.openapi}`);
      for (const p of EXPECTED_PATHS) assert(body.paths?.[p], `в спецификации нет ${p}`);
    }],
    ['Swagger UI: /api-docs открывается', async () => {
      const r = await get('/api-docs/'); const html = await r.text();
      assert(r.status === 200 && /swagger/i.test(html), `HTTP ${r.status}`);
    }],
    ['каталог индикаторов содержит rsi14, macd, rinar', async () => {
      const { body } = await getJson('/api/indicators/catalog');
      for (const id of ['rsi14', 'macd', 'rinar']) assert(Array.isArray(body) && body.some(i => i.id === id), `нет ${id}`);
    }],
    ['валидация: плохие параметры → 400 (без обращения к бирже)', async () => {
      for (const q of ['/api/data?depth=99', '/api/data?symbol=%24%24', '/api/klines?interval=7m', '/api/history?limit=0',
        '/api/scan?limit=201', '/api/indicators?names=nope', '/api/indicators?names=rinar&interval=1m']) await expect400(q);
    }],
    ['валидация: POST /api/history с мусорным телом отклоняется (400, или 401 если задан ключ), данные не пишутся', async () => {
      const r = await fetch(base + '/api/history', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nonsense: true }), signal: AbortSignal.timeout(timeoutMs) });
      assert([400, 401].includes(r.status), `POST с мусорным телом вернул HTTP ${r.status}`);
    }],
    ['неизвестный маршрут → 404 JSON', async () => {
      const r = await get('/api/nope'); assert(r.status === 404, `HTTP ${r.status}`);
      assert((await r.json()).error === 'Not found', 'нет error: Not found');
    }],
  ];

  const online = [
    ['LIVE /api/symbols: список USDT-пар, есть BTCUSDT', async () => {
      const { body } = await getJson('/api/symbols');
      assert(Array.isArray(body) && body.length > 50, `пар: ${body?.length}`); assert(body.includes('BTCUSDT'), 'нет BTCUSDT');
    }],
    ['LIVE /api/data: цена и ликвидность стакана', async () => {
      const { body } = await getJson('/api/data?symbol=BTCUSDT&depth=5');
      assert(body.price > 0, `price=${body.price}`); assert(body.bidUSD > 0 && body.askUSD > 0, 'пустая ликвидность');
      assert(body.book?.bids?.length && body.book?.asks?.length, 'пустой стакан');
    }],
    ['LIVE /api/history: после /api/data есть точка, виден источник', async () => {
      await getJson('/api/data?symbol=BTCUSDT'); const { response, body } = await getJson('/api/history?symbol=BTCUSDT&limit=10');
      assert(['memory', 'mongodb'].includes(response.headers.get('x-history-source')), 'нет заголовка X-History-Source');
      assert(Array.isArray(body) && body.length >= 1, 'история пуста');
    }],
    ['LIVE /api/klines: 1m, а также 1h → 60m (раньше был 400)', async () => {
      for (const interval of ['1m', '1h']) {
        const { body } = await getJson(`/api/klines?symbol=BTCUSDT&interval=${interval}&limit=50`);
        assert(Array.isArray(body) && body.length > 10, `${interval}: свечей ${body?.length}`);
      }
    }],
    ['LIVE /api/indicators: ema20, rsi14, macd на 1h', async () => {
      const { body } = await getJson('/api/indicators?symbol=BTCUSDT&interval=1h&names=ema20,rsi14,macd&limit=100');
      assert(body.candles > 100, `свечей: ${body.candles}`);
      assert(body.indicators.ema20.lines[0].points.length === 100, 'ema20: не 100 точек');
      const rsi = body.indicators.rsi14.lines[0].points.at(-1).value; assert(rsi >= 0 && rsi <= 100, `RSI вне 0–100: ${rsi}`);
    }],
    ['LIVE /api/indicators: Rinar на 1d (7 линий)', async () => {
      const { body } = await getJson('/api/indicators?symbol=BTCUSDT&interval=1d&names=rinar');
      assert(body.indicators.rinar.lines.length === 7, `линий: ${body.indicators.rinar.lines.length}`);
    }],
    ['LIVE /api/scan: сканер возвращает пары с imbalance', async () => {
      const { body } = await getJson('/api/scan?depth=2&limit=5');
      assert(Array.isArray(body) && body.length > 0, 'пусто');
      for (const k of ['symbol', 'price', 'volume', 'bidUSD', 'askUSD', 'imbalance']) assert(k in body[0], `нет поля ${k}`);
    }],
  ];
  return live ? [...offline, ...online] : offline;
}

export async function runSmoke(base, options = {}) {
  const results = [];
  for (const [name, fn] of buildChecks(base.replace(/\/+$/, ''), options)) {
    const started = performance.now();
    try { await fn(); results.push({ name, ok: true, ms: performance.now() - started }); }
    catch (error) { results.push({ name, ok: false, ms: performance.now() - started, error: error.cause?.code ? `${error.message} (${error.cause.code})` : error.message }); }
  }
  return { results, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length };
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const base = (args.find(a => !a.startsWith('--')) || process.env.BASE_URL || 'http://localhost:10000').replace(/\/+$/, '');
  const color = process.stdout.isTTY ? { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', x: '\x1b[0m' } : { g: '', r: '', d: '', x: '' };
  console.log(`Smoke-проверка ${base}${live ? ' (с реальным MEXC)' : ''}\n`);
  const { results, passed, failed } = await runSmoke(base, { live });
  for (const r of results) {
    console.log(`${r.ok ? color.g + '✓' : color.r + '✗'}${color.x} ${r.name} ${color.d}${Math.round(r.ms)} мс${color.x}`);
    if (!r.ok) console.log(`    ${color.r}${r.error}${color.x}`);
  }
  console.log(`\nИтого: ${passed} из ${results.length} прошли${failed ? `, ${color.r}${failed} упали${color.x}` : ''}`);
  const unreachable = results.length && results.every(r => !r.ok && /fetch failed|ECONNREFUSED|ENOTFOUND/.test(r.error));
  process.exit(unreachable ? 2 : failed ? 1 : 0);
}

// Запуск как CLI. Сравниваем реальные пути (а не URL-строки): на Windows регистр буквы диска и разделители могут отличаться.
const isMain = () => { try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); } catch { return false; } };
if (isMain()) main();
