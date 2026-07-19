let serverModule;

function loadServer() {
  if (!serverModule) {
    serverModule = require('../backend/server');
  }
  return serverModule;
}

module.exports = async function handler(req, res) {
  try {
    const { app, ensureRuntimeReady } = loadServer();
    await ensureRuntimeReady();
    return app(req, res);
  } catch (error) {
    console.error('Vercel runtime initialization error:', error);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Service initialization failed.' }));
  }
};
