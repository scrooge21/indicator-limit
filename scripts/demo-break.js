#!/usr/bin/env node
// Демонстрация ценности автотестов: в КОПИЮ проекта (временная папка) вносится по одному реалистичному багу,
// затем запускаются соответствующие тесты — они должны упасть. Ваши исходники не меняются.
//
//   npm run demo:break            # все баги
//   npm run demo:break -- 2       # только баг №2
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BUGS = [
  { title: 'Ликвидность стакана: окно глубины считается в 10 раз шире (деление на 10 вместо 100)',
    file: 'src/services/mexc.service.js', tests: ['tests/mexc.service.test.js', 'tests/api.http.test.js'],
    from: 'price * (1 - depthPct / 100)', to: 'price * (1 - depthPct / 10)' },
  { title: 'История BID/ASK: отключён троттлинг — каждая загрузка страницы пишет точку (так забивалась база)',
    file: 'src/services/history.service.js', tests: ['tests/history.service.test.js', 'tests/api.http.test.js'],
    from: '< env.historyMinIntervalMs) return false', to: '< 0) return false' },
  { title: 'RSI: неверное сглаживание Уайлдера (делитель length+1) — значения «плывут» относительно rinar_bot',
    file: 'src/services/indicators.js', tests: ['tests/indicators.test.js'],
    from: 'au = (au * (length - 1) + up[k]) / length;', to: 'au = (au * (length - 1) + up[k]) / (length + 1);' },
  { title: 'Валидация: depth принимает до 2000 % вместо 20 % (абсурдный запрос проходит проверку)',
    file: 'src/controllers/market.controller.js', tests: ['tests/api.http.test.js', 'tests/indicators.controller.test.js', 'tests/swagger.spec.test.js'],
    from: "name: 'depth', fallback: 5, min: 0.1, max: 20", to: "name: 'depth', fallback: 5, min: 0.1, max: 2000" },
];

const c = process.stdout.isTTY ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' } : { g: '', r: '', y: '', d: '', b: '', x: '' };

function makeCopy() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mexc-demo-'));
  for (const item of ['src', 'docs', 'tests', 'views', 'public', 'package.json']) fs.cpSync(path.join(root, item), path.join(tmp, item), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
  return tmp;
}

async function runTests(cwd, files) {
  try { const { stdout } = await run(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd, maxBuffer: 32 * 1024 * 1024 }); return { code: 0, stdout }; }
  catch (e) { return { code: e.code ?? 1, stdout: e.stdout || '' }; }
}
const failedNames = (tap) => [...tap.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(m => m[1].replace(/ # .*/, ''));
const count = (tap, key) => Number(tap.match(new RegExp(`^# ${key} (\\d+)`, 'm'))?.[1] ?? 0);

async function main() {
  if (!fs.existsSync(path.join(root, 'node_modules'))) { console.error('Сначала выполните npm install'); process.exit(2); }
  const pick = process.argv[2] ? [BUGS[Number(process.argv[2]) - 1]].filter(Boolean) : BUGS;
  if (!pick.length) { console.error(`Нет бага №${process.argv[2]}; доступно 1–${BUGS.length}`); process.exit(2); }

  const tmp = makeCopy();
  let caught = 0;
  try {
    console.log(`${c.b}Базовая линия${c.x}: тесты на неизменённой копии`);
    const base = await runTests(tmp, [...new Set(BUGS.flatMap(b => b.tests))]);
    console.log(`  ${base.code === 0 ? c.g + '✓' : c.r + '✗'}${c.x} ${count(base.stdout, 'pass')} прошли, ${count(base.stdout, 'fail')} упали\n`);
    if (base.code !== 0) { console.error('Исходный код не проходит тесты — демонстрация невозможна.'); process.exit(1); }

    for (const [i, bug] of pick.entries()) {
      const n = process.argv[2] ? Number(process.argv[2]) : i + 1;
      const target = path.join(tmp, bug.file); const original = fs.readFileSync(target, 'utf8');
      if (original.split(bug.from).length !== 2) throw new Error(`Баг №${n}: фрагмент для замены не найден ровно один раз в ${bug.file} (код изменился — обновите scripts/demo-break.js)`);
      console.log(`${c.b}Баг №${n}.${c.x} ${bug.title}`);
      console.log(`  ${c.d}${bug.file}${c.x}\n  ${c.r}- ${bug.from}${c.x}\n  ${c.g}+ ${bug.to}${c.x}`);
      fs.writeFileSync(target, original.replace(bug.from, bug.to));
      const res = await runTests(tmp, bug.tests);
      fs.writeFileSync(target, original); // вернуть чистый файл перед следующим багом
      const names = failedNames(res.stdout);
      if (res.code !== 0 && names.length) {
        caught++;
        console.log(`  ${c.g}✓ ТЕСТЫ ПОЙМАЛИ БАГ${c.x}: упало ${count(res.stdout, 'fail')} из ${count(res.stdout, 'tests')}`);
        for (const name of names.slice(0, 3)) console.log(`    ${c.r}✗${c.x} ${name}`);
        if (names.length > 3) console.log(`    ${c.d}… и ещё ${names.length - 3}${c.x}`);
      } else console.log(`  ${c.y}⚠ баг НЕ пойман — это дыра в тестах${c.x}`);
      console.log('');
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  console.log(`${c.b}Итого${c.x}: тесты поймали ${caught} из ${pick.length} внесённых багов. Ваши исходники не изменялись.`);
  process.exit(caught === pick.length ? 0 : 1);
}
main().catch(e => { console.error(e.message); process.exit(2); });
