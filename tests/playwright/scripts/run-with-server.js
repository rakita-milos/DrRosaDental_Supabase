const { spawn } = require("child_process");
const path = require("path");
const { readEnv } = require("../utils/env");

const rootDir = path.join(__dirname, "../../..");
const testsDir = path.join(rootDir, "tests/playwright");
const backendDir = path.join(rootDir, "backend");
const playwrightCli = require.resolve("@playwright/test/cli");
const backendEnv = readEnv();

const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.APP_BASE_URL || "http://localhost:3010";
const parsedBaseUrl = new URL(baseURL);
const testPort = parsedBaseUrl.port || (parsedBaseUrl.protocol === "https:" ? "443" : "80");
const passthroughArgs = process.argv.slice(2);

const serverEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "test",
  PORT: testPort,
  SQLITE_DB_PATH: process.env.SQLITE_DB_PATH || "../tests/playwright/.backend-data/playwright.sqlite",
  BACKUP_DIR: process.env.BACKUP_DIR || "../tests/playwright/.backend-backups",
  UPLOAD_DIR: process.env.UPLOAD_DIR || "../tests/playwright/.uploads",
  SCANNER_IMPORT_DIR: process.env.SCANNER_IMPORT_DIR || "../tests/playwright/.scanner-inbox",
  CORS_ORIGIN: process.env.CORS_ORIGIN || `${baseURL},${parsedBaseUrl.origin}`,
  TRUST_PROXY: process.env.TRUST_PROXY || "loopback",
  JWT_SECRET: process.env.JWT_SECRET || backendEnv.JWT_SECRET,
  INITIAL_DIRECTOR_PASSWORD: process.env.INITIAL_DIRECTOR_PASSWORD || backendEnv.INITIAL_DIRECTOR_PASSWORD,
  INITIAL_STAFF_PASSWORD: process.env.INITIAL_STAFF_PASSWORD || backendEnv.INITIAL_STAFF_PASSWORD,
  BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY || "playwright-backup-key-dr-rosa-minimum-32-characters"
};

async function waitForHealth(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = new URL("/api/health", baseURL).toString();
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw lastError || new Error(`Timed out waiting for ${healthUrl}`);
}

function stopProcessTree(child) {
  if (!child || child.killed || child.exitCode !== null) return Promise.resolve();

  if (process.platform === "win32") {
    return new Promise(resolve => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  }

  child.kill("SIGTERM");
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: backendDir,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", chunk => process.stdout.write(`[backend] ${chunk}`));
  server.stderr.on("data", chunk => process.stderr.write(`[backend] ${chunk}`));

  try {
    await waitForHealth();
  } catch (error) {
    await stopProcessTree(server);
    console.error(`Backend did not become healthy: ${error.message}`);
    process.exit(1);
  }

  let exitCode = 1;
  try {
    const playwrightArgs = [playwrightCli, "test", "-c", "playwright.ci.config.js", ...passthroughArgs];
    const runner = spawn(process.execPath, playwrightArgs, {
      cwd: testsDir,
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: baseURL
      },
      stdio: "inherit"
    });

    exitCode = await new Promise(resolve => {
      runner.on("exit", code => resolve(code ?? 1));
      runner.on("error", error => {
        console.error(error);
        resolve(1);
      });
    });
  } finally {
    await stopProcessTree(server);
  }

  process.exit(exitCode);
}

process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

main().catch(async error => {
  console.error(error);
  process.exit(1);
});
