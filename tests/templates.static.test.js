// Статическая проверка шаблонов EJS: не требует запуска сервера.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openapiSpec } from '../docs/swagger.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pages = { terminal: read('views/pages/terminal.ejs'), scanner: read('views/pages/scanner.ejs') };

for (const [name, src] of Object.entries(pages)) {
  test(`шаблон ${name}: каждый $('id') / getElementById из скрипта есть в разметке`, () => {
    const used = new Set([...src.matchAll(/\$\(['"]([\w-]+)['"]\)/g), ...src.matchAll(/getElementById\(['"]([\w-]+)['"]\)/g)].map(m => m[1]));
    const have = new Set([...src.matchAll(/\bid=["']([\w-]+)["']/g)].map(m => m[1]));
    assert.deepEqual([...used].filter(id => !have.has(id)), []);
  });
  test(`шаблон ${name}: подключает навигацию и стили, EJS-теги сбалансированы`, () => {
    assert.match(src, /include\(["']\.\.\/partials\/navigation["']/);
    assert.match(src, /href="\/style\.css"/);
    assert.equal((src.match(/<%/g) || []).length, (src.match(/%>/g) || []).length);
  });
  test(`шаблон ${name}: все вызываемые /api/* описаны в Swagger`, () => {
    const used = new Set([...src.matchAll(/\/api\/[a-z]+/g)].map(m => m[0]));
    assert.ok(used.size > 0);
    for (const p of used) assert.ok(openapiSpec.paths[p], `${p} отсутствует в docs/swagger.js`);
  });
}
test('партиал навигации подсвечивает активную страницу и ссылается на обе страницы', () => {
  const nav = read('views/partials/navigation.ejs');
  assert.match(nav, /href="\/"/); assert.match(nav, /href="\/scanner"/);
  assert.match(nav, /activePage === 'terminal'/); assert.match(nav, /activePage === 'scanner'/);
});
test('терминал содержит индикатор BID/ASK и его загрузку из истории', () => {
  assert.match(pages.terminal, /bidLine/); assert.match(pages.terminal, /askLine/); assert.match(pages.terminal, /\/api\/history\?/);
});
test('style.css существует и не пуст', () => assert.ok(read('public/style.css').length > 1000));
