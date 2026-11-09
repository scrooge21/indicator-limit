// Поднимает настоящее Express-приложение на свободном порту.
export async function startServer() {
  const { default: app } = await import('../../src/app.js');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(resolve => server.close(resolve)) };
}
