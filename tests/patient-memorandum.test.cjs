// Standalone, synthetic browser tests. No backend, database, or real session.
// Run: node --test tests/patient-memorandum.test.cjs
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { inflateRawSync } = require("node:zlib");
const { chromium } = require("./playwright/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "data/memorandum-qa");
const patient = { id: "memorandum-qa", firstName: "Đorđe", lastName: "Čačić & Šimić" };
let server, browser, baseURL;

function unzip(buffer) {
  const files = {};
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "Valid DOCX ZIP archive");
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString();
    const local = buffer.readUInt32LE(offset + 42);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files[name] = method === 8 ? inflateRawSync(data) : data;
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return files;
}

before(async () => {
  await fs.mkdir(output, { recursive: true });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      if (url.pathname === "/api/auth/verify") return res.end(JSON.stringify({ user: { role: "doctor", username: "qa" } }));
      if (url.pathname === "/api/patients/memorandum-qa") return res.end(JSON.stringify(patient));
      if (url.pathname === "/api/patients/missing") { res.statusCode = 404; return res.end('{"error":"Not found"}'); }
      return res.end("[]");
    }
    const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
    try {
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
      res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
      res.end(await fs.readFile(file));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openCard(options = {}, id = patient.id) {
  const context = await browser.newContext({ timezoneId: "America/Los_Angeles", ...options });
  const page = await context.newPage();
  await page.route("**/*", route => {
    if (route.request().url().startsWith(baseURL)) return route.continue();
    return route.abort();
  });
  await page.addInitScript(() => localStorage.setItem("drrosa-session", JSON.stringify({ role: "doctor", username: "qa" })));
  await page.goto(`${baseURL}/src/pages/patient-dashboard.html?patientId=${id}`);
  return { context, page };
}

test("doctor downloads genuine DOCX with loaded patient's name and computer's click date", async () => {
  const { context, page } = await openCard();
  try {
    const button = page.locator("#patient-memorandum-btn");
    await button.waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector("#patient-memorandum-btn").disabled);
    assert.equal(await page.evaluate(() => Boolean(window.docx)), false, "Word library is loaded on demand");
    // UTC has already crossed midnight; the doctor's computer is still on October 11.
    await page.clock.install({ time: new Date("2026-10-12T00:30:00Z") });
    // Move past local midnight after the card has loaded, before clicking.
    await page.clock.setFixedTime(new Date("2026-10-12T07:30:00Z"));
    const downloadPromise = page.waitForEvent("download");
    await button.click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "Memorandum_Đorđe_Čačić_&_Šimić_2026-10-12.docx");
    const file = path.join(output, "memorandum-synthetic.docx");
    await download.saveAs(file);
    const files = unzip(await fs.readFile(file));
    const xml = files["word/document.xml"].toString();
    assert.match(xml, /Đorđe Čačić &amp; Šimić/);
    assert.match(xml, /12\.10\.2026/);
    for (const label of ["Doktor:", "Delatnost:", "Postupak:", "Detalji rada:"]) assert.ok(xml.includes(label));
    for (const old of ["Dijagnoza", "Terapija", "Mara Bogdanov", "30.12.2025", "Urgentni"]) assert.ok(!xml.includes(old));
    assert.match(xml, /w:hRule="atLeast"/);
    assert.ok(!xml.includes("w:cantSplit"), "Details can continue on the next page");
    assert.match(files["word/header1.xml"].toString(), /<w:drawing>/);
    assert.match(files["word/footer1.xml"].toString(), /<w:drawing>/);
    assert.match(files["word/header1.xml"].toString(), /name="Zaglavlje memoranduma"/);
    assert.match(files["word/footer1.xml"].toString(), /name="Podnožje memoranduma"/);
    assert.equal(Object.keys(files).filter(name => name.startsWith("word/media/") && !name.endsWith("/")).length, 2);
    // Same UTC day, previous calendar day on the doctor's computer.
    await page.clock.setFixedTime(new Date("2026-10-12T00:30:00Z"));
    const previousDateDownload = page.waitForEvent("download");
    await button.click();
    const previous = await previousDateDownload;
    assert.ok(previous.suggestedFilename().endsWith("2026-10-11.docx"));
    const previousFile = path.join(output, "memorandum-local-date.docx");
    await previous.saveAs(previousFile);
    assert.match(unzip(await fs.readFile(previousFile))["word/document.xml"].toString(), /11\.10\.2026/);
    await page.screenshot({ path: path.join(output, "patient-desktop.png"), fullPage: true });
  } finally { await context.close(); }
});

test("mobile card keeps the memorandum button visible without horizontal overflow", async () => {
  const { context, page } = await openCard({ viewport: { width: 390, height: 844 } });
  try {
    await page.waitForFunction(() => !document.querySelector("#patient-memorandum-btn").disabled);
    const bounds = await page.locator("#patient-memorandum-btn").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(bounds.y + bounds.height <= 844);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, "patient-mobile.png"), fullPage: true });
  } finally { await context.close(); }
});

test("failed artwork download reports an error and permits retry", async () => {
  const { context, page } = await openCard();
  try {
    await page.waitForFunction(() => !document.querySelector("#patient-memorandum-btn").disabled);
    const pattern = "**/assets/memorandum/header.png";
    await page.route(pattern, route => route.fulfill({ status: 503, body: "Unavailable" }));
    await page.locator("#patient-memorandum-btn").click();
    await page.waitForFunction(() => document.querySelector("#patient-memorandum-message").textContent.includes("nije učitan"));
    assert.equal(await page.locator("#patient-memorandum-btn").isEnabled(), true);
    await page.unroute(pattern);
    const download = page.waitForEvent("download");
    await page.locator("#patient-memorandum-btn").click();
    await download;
  } finally { await context.close(); }
});

test("missing patient cannot produce a memorandum", async () => {
  const { context, page } = await openCard({}, "missing");
  try {
    await page.waitForFunction(() => document.querySelector("#patient-name-title").textContent.includes("nije pronadjen"));
    assert.equal(await page.locator("#patient-memorandum-btn").isDisabled(), true);
  } finally { await context.close(); }
});
