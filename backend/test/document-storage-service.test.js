const assert = require('node:assert');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createDocumentStorage } = require('../services/document-storage-service');

test('local document storage confines files to its configured root', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'drrosa-document-storage-'));
  const storage = createDocumentStorage({ driver: 'local', localRoot: root });
  const stored = await storage.store({ patientId: 42, storedFilename: 'safe.pdf', buffer: Buffer.from('pdf') });
  assert.equal(readFileSync(stored.filePath, 'utf8'), 'pdf');
  await assert.rejects(async () => storage.read(path.join(root, '..', 'outside.pdf')), /outside local upload storage/);
  await storage.remove(stored.filePath);
});

test('Supabase document storage uses a private object endpoint and opaque object key', async () => {
  const requests = [];
  const storage = createDocumentStorage({
    driver: 'supabase',
    localRoot: tmpdir(),
    supabaseUrl: 'https://example.supabase.co/',
    serviceRoleKey: 'service-role',
    bucket: 'patient-documents',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response('', { status: 200 });
    }
  });
  const stored = await storage.store({ patientId: 9, storedFilename: 'opaque.pdf', buffer: Buffer.from('pdf'), mimeType: 'application/pdf' });
  assert.equal(stored.filePath, 'supabase:patients/9/opaque.pdf');
  assert.match(requests[0].url, /\/storage\/v1\/object\/patient-documents\/patients\/9\/opaque\.pdf$/);
  assert.equal(requests[0].options.headers['x-upsert'], 'false');
  await assert.rejects(storage.read('C:\\legacy\\file.pdf'), /Migrate the document/);
});

test('Supabase document storage preserves missing-object status and rejects oversized downloads', async () => {
  const storage = createDocumentStorage({
    driver: 'supabase',
    localRoot: tmpdir(),
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'service-role',
    bucket: 'patient-documents',
    fetchImpl: async () => new Response('', { status: 404 })
  });
  await assert.rejects(storage.read('supabase:patients/9/missing.pdf'), error => error.status === 404);

  const oversized = createDocumentStorage({
    driver: 'supabase',
    localRoot: tmpdir(),
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'service-role',
    bucket: 'patient-documents',
    fetchImpl: async () => new Response('small', { status: 200, headers: { 'content-length': String(10 * 1024 * 1024 + 1) } })
  });
  await assert.rejects(oversized.read('supabase:patients/9/large.pdf'), error => error.status === 502 && /exceeds/.test(error.message));
});
