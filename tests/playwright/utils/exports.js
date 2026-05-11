const fs = require("fs/promises");
const { expect } = require("@playwright/test");

async function downloadText(download) {
  const path = await download.path();
  expect(path, "download path should be available").toBeTruthy();
  return fs.readFile(path, "utf8");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function expectDownloadedExcelContains(download, texts) {
  const raw = await downloadText(download);
  const normalized = stripHtml(raw);
  for (const text of texts) {
    expect(normalized).toContain(text);
  }
}

async function expectPdfPopupContains(popup, texts) {
  const bodyText = await popup.locator("body").innerText();
  for (const text of texts) {
    expect(bodyText).toContain(text);
  }
}

module.exports = {
  expectDownloadedExcelContains,
  expectPdfPopupContains
};
