const fs = require("fs");
const path = require("path");

function readEnv(filePath = path.join(__dirname, "../../../backend/.env")) {
  const fileEnv = (fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : '')
    .split(/\r?\n/)
    .filter(line => line.includes("=") && !line.trim().startsWith("#"))
    .reduce((env, line) => {
      const index = line.indexOf("=");
      env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      return env;
    }, {});

  // CI and the isolated Playwright runner provide disposable credentials via
  // process.env. Those values must win over a developer's local backend/.env,
  // otherwise the browser signs tokens for the wrong JWT secret or database.
  return {
    ...fileEnv,
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => (
      value !== undefined && String(value).trim() !== ""
    )))
  };
}

module.exports = { readEnv };
