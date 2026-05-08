const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const backendEnv = readEnv(path.join(__dirname, "../../../backend/.env"));

function readEnv(filePath) {
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

async function login(page, role = "staff") {
  const isDirector = role === "director";
  await page.goto("/src/pages/login.html");
  await page.locator("#email").fill(isDirector ? "director@drosa.com" : "staff@drosa.com");
  await page.locator("#role").selectOption(role);
  await page.locator("#password").fill(isDirector ? backendEnv.INITIAL_DIRECTOR_PASSWORD : backendEnv.INITIAL_STAFF_PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page).toHaveURL(new RegExp(isDirector ? "director-panel\\.html" : "index\\.html"));
}

async function authenticate(page, role = "staff") {
  const isDirector = role === "director";
  const response = await page.request.post("/api/auth/login", {
    data: {
      email: isDirector ? "director@drosa.com" : "staff@drosa.com",
      password: isDirector ? backendEnv.INITIAL_DIRECTOR_PASSWORD : backendEnv.INITIAL_STAFF_PASSWORD,
      role
    }
  });

  if (!response.ok()) {
    throw new Error(`API login failed with HTTP ${response.status()}`);
  }

  const data = await response.json();
  await page.goto("/src/pages/login.html");
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("drrosa-token", token);
    localStorage.setItem("drrosa-session", JSON.stringify({
      ...user,
      loginTime: new Date().toISOString()
    }));
  }, data);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/src/pages/login.html");
  await page.evaluate(() => localStorage.clear());
});

test("login smoke test for staff and director roles", async ({ page }) => {
  await login(page, "staff");
  await expect(page.locator("h1")).toBeVisible();
  await page.locator("#logout-btn").click();
  await expect(page).toHaveURL(/login\.html/);

  await login(page, "director");
  await expect(page.getByRole("heading", { name: /Direktor panel/i })).toBeVisible();
});

test("staff navigation smoke test", async ({ page }) => {
  await authenticate(page, "staff");
  await page.goto("/src/pages/index.html");

  await page.getByRole("link", { name: "Novi unos" }).click();
  await expect(page).toHaveURL(/new-entry\.html/);
  await expect(page.getByRole("heading", { name: /Dodaj pregled/i })).toBeVisible();

  await page.getByRole("link", { name: "Novi pacijent" }).first().click();
  await expect(page).toHaveURL(/new-patient\.html/);
  await expect(page.getByRole("heading", { name: /Unos novog pacijenta/i })).toBeVisible();

  await page.getByRole("link", { name: /Kompletna evidencija/i }).click();
  await expect(page).toHaveURL(/all-records\.html/);
  await expect(page.locator("#all-records-body tr").first()).toBeVisible();

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/index\.html/);
});

test("create patient and visit smoke test", async ({ page }) => {
  await authenticate(page, "staff");

  const stamp = Date.now();
  const firstName = `Smoke${stamp}`;
  const lastName = "Playwright";
  const fullName = `${firstName} ${lastName}`;

  await page.goto("/src/pages/new-patient.html");
  page.on("dialog", dialog => dialog.accept());
  await page.locator("#first-name").fill(firstName);
  await page.locator("#last-name").fill(lastName);
  await page.locator("#birth-date").fill("1986-05-08");
  await page.locator("#gender").selectOption({ index: 1 });
  await page.locator("#address").fill("Playwright smoke address");
  await page.locator("#phone").fill("060123456");
  await page.locator("#email").fill(`smoke${stamp}@example.test`);
  await page.locator("#emergency-contact").fill("Smoke Contact");
  await page.locator("#medical-history").fill("Automated smoke patient");
  await page.getByRole("button", { name: /Sa.*uvaj pacijenta/i }).click();

  await page.goto("/src/pages/new-entry.html");
  await page.locator("#patient-name").fill(fullName);
  await page.locator("#last-visit").fill("2026-05-08");
  await page.locator("#procedure-activity").selectOption({ index: 1 });
  await expect(page.locator("#procedure")).toBeEnabled();
  await page.locator("#procedure").selectOption({ index: 1 });
  await page.locator("#status").selectOption({ index: 2 });
  await page.locator("#payment-status").selectOption({ index: 0 });
  await page.locator("#currency").selectOption("EUR");
  await page.locator("#shift").selectOption("Prva smena");
  await page.locator("#amount-due").fill("0");
  await page.locator("#note").fill("Automated Playwright visit smoke test");
  await page.getByRole("button", { name: /Spremi unos/i }).click();

  await expect(page.locator(".form-alert")).toContainText(/Unos je spremljen/i);

  await page.goto("/src/pages/all-records.html");
  await page.locator("#search-input").selectOption(fullName);
  await expect(page.locator("#all-records-body")).toContainText(fullName);
});

test("director panel reports smoke test", async ({ page }) => {
  await authenticate(page, "director");
  await page.goto("/src/pages/director-panel.html");

  const reports = [
    { id: "financial-report", table: "#payment-table" },
    { id: "patients-report", table: "#patients-table" },
    { id: "doctors-report", table: "#doctors-table" },
    { id: "procedures-report", table: "#procedures-table" },
    { id: "excel-report", table: "#excel-sheet-table" }
  ];

  for (const report of reports) {
    await page.locator(`[data-report-id="${report.id}"]`).click();
    await expect(page.locator(`#${report.id}`)).toHaveClass(/active/);
    await expect(page.locator(`${report.table} tr`).first()).toBeVisible();
    await page.locator(`#${report.id} .export-report-excel`).click();
    await page.locator(`#${report.id} .export-report-pdf`).click();
    await page.locator(`#${report.id} .back-to-reports`).click();
    await expect(page.locator("#reports-grid")).toBeVisible();
  }
});
