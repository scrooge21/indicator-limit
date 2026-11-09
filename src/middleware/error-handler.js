export function notFound(req, res) { res.status(404).json({ error: 'Not found', path: req.originalUrl }); }
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : error.message });
}
