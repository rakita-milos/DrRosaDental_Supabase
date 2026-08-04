const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverSource = readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const patientDocumentsRepoSource = readFileSync(path.join(__dirname, '..', 'db', 'patient-documents.js'), 'utf8');
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
