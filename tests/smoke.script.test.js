// Проверяем сам scripts/smoke.js: он должен проходить на здоровом сервере и честно падать на сломанном/недоступном.
// Сервер настоящий (Express), биржа подменена фикстурами. CLI запускается дочерним процессом (асинхронно — сервер в этом же процессе).
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runSmoke } from '../scripts/smoke.js';
import { resetHistoryState } from '../src/services/history.service.js';
import { resetSymbolsCache } from '../src/services/market.service.js';
import { installMexcMock, json } from './helpers/mexc-mock.js';
import { startServer } from './helpers/server.js';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/smoke.js', import.meta.url));
const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/rinar-golden.json', import.meta.url), 'utf8'));
const goldenKlines = golden.times.map((t, i) => [t * 1000, String(golden.open[i]), String(golden.high[i]), String(golden.low[i]), String(golden.close[i]), String(golden.volume[i]), 0, '0']);
const manySymbols = { symbols: [{ symbol: 'BTCUSDT', quoteAsset: 'USDT', status: '1' }, ...Array.from({ length: 70 }, (_, i) => ({ symbol: `COIN${i}USDT`, quoteAsset: 'USDT', status: '1' }))] };

let srv, mock;
before(async () => {
  mock = installMexcMock({ '/api/v3/exchangeInfo': () => json(manySymbols), '/api/v3/klines': () => goldenKlines });
  srv = await startServer();
});
after(async () => { await srv.close(); mock.restore(); });
beforeEach(() => { resetHistoryState(); resetSymbolsCache(); });

const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test('smoke (без --live): все проверки сервиса проходят на здоровом сервере', async () => {
  const { results, failed } = await runSmoke(srv.base);
  assert.equal(failed, 0, results.filter(r => !r.ok).map(r => `${r.name}: ${r.error}`).join('\n'));
  assert.ok(results.length >= 8);
  assert.ok(results.every(r => !r.name.startsWith('LIVE')), 'без --live не должно быть обращений к бирже');
});

test('smoke (--live): проверки с биржей проходят (биржа подменена фикстурами)', async () => {
  const { results, failed } = await runSmoke(srv.base, { live: true });
  assert.equal(failed, 0, results.filter(r => !r.ok).map(r => `${r.name}: ${r.error}`).join('\n'));
  assert.ok(results.filter(r => r.name.startsWith('LIVE')).length >= 6);
});

test('smoke: падает, если биржа отвечает ошибкой (чтобы «зелёный» результат что-то значил)', async () => {
  const quiet = console.error; console.error = () => {};
  const broken = installMexcMock({ '/api/v3/ticker/price': () => json({ code: -1, msg: 'down' }, 500) });
  try {
    const { results, failed } = await runSmoke(srv.base, { live: true });
    assert.ok(failed >= 1); assert.ok(results.find(r => r.name.includes('/api/data')).ok === false);
    assert.equal(results.filter(r => !r.name.startsWith('LIVE')).every(r => r.ok), true, 'офлайн-проверки не зависят от биржи');
  } finally { console.error = quiet; broken.restore(); mock = installMexcMock({ '/api/v3/exchangeInfo': () => json(manySymbols), '/api/v3/klines': () => goldenKlines }); }
});

test('smoke: недоступный сервер → все проверки упали с понятной причиной', async () => {
  const { results, passed } = await runSmoke(`http://127.0.0.1:${await freePort()}`);
  assert.equal(passed, 0); assert.ok(results.every(r => /fetch failed|ECONNREFUSED/.test(r.error)), results[0].error);
});

test('CLI: код выхода 0 при успехе, 2 если сервер недоступен', async () => {
  const ok = await run(process.execPath, [script, srv.base]);
  assert.match(ok.stdout, /Итого: \d+ из \d+ прошли/); assert.doesNotMatch(ok.stdout, /упали/);
  await assert.rejects(run(process.execPath, [script, `http://127.0.0.1:${await freePort()}`]), (e) => e.code === 2 && /упали/.test(e.stdout));
});
