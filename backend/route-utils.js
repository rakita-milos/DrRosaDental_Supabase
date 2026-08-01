function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sendError(res, error, { fallbackStatus = 500, fallbackMessage = 'Server error', logLabel = 'Route error' } = {}) {
  const status = Number(error?.status || fallbackStatus);
  if (status >= 500) console.error(logLabel, error);
  return res.status(status).json({
    error: error?.message || fallbackMessage,
    ...(error?.runningJob ? { runningJob: error.runningJob } : {})
  });
}

module.exports = {
  asyncRoute,
  sendError
};
