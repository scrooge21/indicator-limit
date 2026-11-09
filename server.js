import app from './src/app.js';
import { env } from './src/config/env.js';
import { connectDatabase } from './src/config/database.js';
import { logTrackedPairs } from './src/services/market.service.js';
import { pruneHistory } from './src/services/history.service.js';

await connectDatabase();
const server = app.listen(env.port, () => console.log(`MEXC Indicator ready at http://localhost:${env.port}`));
const logger = setInterval(logTrackedPairs, env.logIntervalMs);
const pruner = setInterval(pruneHistory, env.historyPruneIntervalMs);
logger.unref(); pruner.unref();
logTrackedPairs(); // не ждём первый интервал — история начинает копиться сразу

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  clearInterval(logger); clearInterval(pruner);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
