const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const patientDocumentsRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'patient-documents.js'), 'utf8');
const storageServiceSource = readFileSync(path.join(__dirname, '..', 'services', 'document-storage-service.js'), 'utf8');
const detectedDocumentMimeSource = serverSource.match(/function detectedDocumentMime\(buffer, filename\) \{[\s\S]*?\n\}/)?.[0] || '';

test('document upload uses binary signatures instead of trusting extensions', () => {
  assert.match(detectedDocumentMimeSource, /function detectedDocumentMime\(buffer, filename\)/);
  assert.match(detectedDocumentMimeSource, /buffer\.subarray\(0, 4\)\.toString\(\) === '%PDF'/);
  assert.match(detectedDocumentMimeSource, /buffer\[0\] === 0xff && buffer\[1\] === 0xd8 && buffer\[2\] === 0xff/);
  assert.match(detectedDocumentMimeSource, /Buffer\.from\(\[0x89, 0x50, 0x4e, 0x47/);
  assert.match(detectedDocumentMimeSource, /buffer\.subarray\(8, 12\)\.toString\(\) === 'WEBP'/);
  assert.match(detectedDocumentMimeSource, /buffer\.subarray\(128, 132\)\.toString\(\) === 'DICM'/);
  assert.doesNotMatch(detectedDocumentMimeSource, /ext === '\.dcm' \|\| ext === '\.dicom'/);
});

test('document replacement goes through the same binary validation and updates file columns', () => {
  assert.match(serverSource, /async function validateAndStorePatientDocumentFile/);
  assert.match(serverSource, /const detectedMime = detectedDocumentMime\(buffer, originalFilename\)/);
  assert.match(serverSource, /mimeType: detectedMime/);
  assert.match(serverSource, /if \(req\.body\.fileBase64\)/);
  assert.match(serverSource, /replacementFile = await validateAndStorePatientDocumentFile/);
  assert.match(patientDocumentsRepoSource, /original_filename = \?, stored_filename = \?, file_path = \?, mime_type = \?, file_size = \?, file_hash = \?/);
  assert.match(patientDocumentsRepoSource, /document\.filePath \? \[/);
});

test('document view and download use the storage abstraction with path/key validation', () => {
  assert.match(serverSource, /documentStorage\.read\(row\.file_path\)/);
  assert.match(serverSource, /function sendDocumentStorageError/);
  assert.match(serverSource, /Document storage is temporarily unavailable/);
  assert.match(serverSource, /res\.attachment\(row\.original_filename\)/);
  assert.match(storageServiceSource, /Document path is outside local upload storage/);
  assert.match(storageServiceSource, /Legacy local document is not available from Supabase Storage/);
  assert.match(storageServiceSource, /key\.includes\('\.\.'\)/);
  assert.match(storageServiceSource, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('document database failures and replacements clean up stored objects', () => {
  assert.match(serverSource, /Document cleanup after database failure/);
  assert.match(serverSource, /Replacement document cleanup failed/);
  assert.match(serverSource, /Previous document cleanup failed/);
  assert.match(serverSource, /documentStorage\.remove\(storedFile\.filePath\)/);
});
