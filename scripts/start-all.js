// Запуск всех сервисов одной командой: npm start
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const services = ['market-data', 'indicator', 'scanner', 'analytics', 'gateway'];

const children = services.map((name) => {
    const child = spawn(process.execPath, [path.join(root, 'services', name, 'main.js')], { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => console.log(`[${name}] завершён, код ${code}`));
    return child;
});

const stop = () => { children.forEach(c => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
