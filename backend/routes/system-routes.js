const path = require('path');

function registerSystemRoutes(app, { express, databaseClient, frontendRoot }) {
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'API is running',
      database: databaseClient,
      timestamp: new Date().toISOString()
    });
  });

  app.use('/src', express.static(path.join(frontendRoot, 'src')));
  app.get(['/', '/index.html'], (_req, res) => {
    res.sendFile(path.join(frontendRoot, 'index.html'));
  });
}

module.exports = {
  registerSystemRoutes
};
