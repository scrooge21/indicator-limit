import crypto from 'node:crypto';
import { env } from '../config/env.js';

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

// Защита операций записи. Ключ — переменная окружения ADMIN_API_KEY, передаётся в заголовке X-API-Key.
// Не задан → запись отключена (403), чтобы публичный сервер нельзя было засорить чужими данными.
export function requireApiKey(req, res, next) {
  if (!env.adminApiKey) return res.status(403).json({ error: 'Manual writes are disabled: set ADMIN_API_KEY on the server' });
  const given = req.get('x-api-key');
  if (!given || !crypto.timingSafeEqual(digest(given), digest(env.adminApiKey))) return res.status(401).json({ error: 'Invalid or missing X-API-Key' });
  next();
}
