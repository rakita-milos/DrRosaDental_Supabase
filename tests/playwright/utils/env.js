const fs = require("fs");
const path = require("path");

function readEnv(filePath = path.join(__dirname, "../../../backend/.env")) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(line => line.includes("=") && !line.trim().startsWith("#"))
    .reduce((env, line) => {
      const index = line.indexOf("=");
      env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      return env;
    }, {});
}

module.exports = { readEnv };
