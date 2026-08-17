const path = require('path');

function registerSystemRoutes(app, { express, databaseClient, frontendRoot, authenticateToken, requireDirector }) {
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'API is running',
      database: databaseClient,
      timestamp: new Date().toISOString()
    });
  });

  const requireDirectorAsset = [authenticateToken, requireDirector].filter(Boolean);
  if (requireDirectorAsset.length === 2) {
    app.get('/src/pages/director-panel.html', ...requireDirectorAsset, (_req, res) => {
      res.sendFile(path.join(frontendRoot, 'src', 'pages', 'director-panel.html'));
    });
    app.get('/src/scripts/director-reports.js', ...requireDirectorAsset, (_req, res) => {
      res.sendFile(path.join(frontendRoot, 'src', 'scripts', 'director-reports.js'));
    });
  }

  app.use('/src', express.static(path.join(frontendRoot, 'src')));
  app.get(['/', '/index.html'], (_req, res) => {
    res.sendFile(path.join(frontendRoot, 'index.html'));
  });
}

module.exports = {
  registerSystemRoutes
};
