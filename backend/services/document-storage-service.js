const path = require('path');
const fs = require('fs');

const fsp = fs.promises;
const STORAGE_PREFIX = 'supabase:';
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const STORAGE_REQUEST_TIMEOUT_MS = 10000;

function storageError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeDriver(value) {
  return String(value || '').trim().toLowerCase() === 'supabase' ? 'supabase' : 'local';
}

function createDocumentStorage({ driver, localRoot, supabaseUrl, serviceRoleKey, bucket = 'patient-documents', fetchImpl = global.fetch }) {
  const normalizedDriver = normalizeDriver(driver);
  if (!localRoot) throw new Error('localRoot is required for document storage.');
  if (normalizedDriver === 'supabase') {
    if (!supabaseUrl || !serviceRoleKey || !bucket) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DOCUMENT_STORAGE_BUCKET are required for Supabase document storage.');
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for Supabase document storage.');
    return createSupabaseStorage({ supabaseUrl, serviceRoleKey, bucket, fetchImpl });
  }
  return createLocalStorage({ localRoot });
}

function createLocalStorage({ localRoot }) {
  const root = path.resolve(localRoot);
  function resolveLocalPath(filePath) {
    const resolved = path.resolve(String(filePath || ''));
    const allowedRoot = `${root}${path.sep}`;
    if (resolved !== root && !resolved.startsWith(allowedRoot)) throw storageError('Document path is outside local upload storage.', 403);
    return resolved;
  }
  return {
    driver: 'local',
    async store({ patientId, storedFilename, buffer }) {
      const dir = path.join(root, 'patients', String(patientId));
      await fsp.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, storedFilename);
      await fsp.writeFile(filePath, buffer, { flag: 'wx' });
      return { filePath };
    },
    read(filePath) {
      return fsp.readFile(resolveLocalPath(filePath));
    },
    async remove(filePath) {
      await fsp.unlink(resolveLocalPath(filePath)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  };
}

function createSupabaseStorage({ supabaseUrl, serviceRoleKey, bucket, fetchImpl }) {
  const baseUrl = String(supabaseUrl).replace(/\/+$/, '');
  const safeBucket = encodeURIComponent(bucket);
  const objectUrl = key => `${baseUrl}/storage/v1/object/${safeBucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  function keyFromReference(filePath) {
    const value = String(filePath || '');
    if (!value.startsWith(STORAGE_PREFIX)) throw storageError('Legacy local document is not available from Supabase Storage. Migrate the document before accessing it.', 409);
    const key = value.slice(STORAGE_PREFIX.length);
    if (!key || key.includes('..') || key.startsWith('/')) throw storageError('Invalid document storage key.', 403);
    return key;
  }
  const headers = extra => ({ apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, ...extra });
  async function request(url, options, failureMessage, { retries = 0 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), STORAGE_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        if (response.ok) return response;
        const status = response.status === 404 ? 404 : 502;
        lastError = storageError(failureMessage, status);
      } catch (error) {
        lastError = error?.name === 'AbortError'
          ? storageError(`${failureMessage}: request timed out`)
          : storageError(failureMessage);
      } finally {
        clearTimeout(timeout);
      }
      if (lastError.status !== 502 || attempt === retries) throw lastError;
    }
    throw lastError;
  }
  return {
    driver: 'supabase',
    async store({ patientId, storedFilename, buffer, mimeType }) {
      const key = `patients/${Number(patientId)}/${storedFilename}`;
      await request(objectUrl(key), {
        method: 'POST',
        headers: headers({ 'Content-Type': mimeType, 'x-upsert': 'false', 'cache-control': 'private, max-age=0' }),
        body: buffer
      }, 'Supabase document upload failed');
      return { filePath: `${STORAGE_PREFIX}${key}` };
    },
    async read(filePath) {
      const response = await request(objectUrl(keyFromReference(filePath)), { headers: headers() }, 'Supabase document download failed', { retries: 1 });
      const declaredSize = Number(response.headers.get('content-length') || 0);
      if (declaredSize > MAX_DOCUMENT_BYTES) throw storageError('Stored document exceeds the allowed size.', 502);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_DOCUMENT_BYTES) throw storageError('Stored document exceeds the allowed size.', 502);
      return buffer;
    },
    async remove(filePath) {
      const key = keyFromReference(filePath);
      await request(`${baseUrl}/storage/v1/object/${safeBucket}`, {
        method: 'DELETE',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [key] })
      }, 'Supabase document cleanup failed', { retries: 1 });
    }
  };
}

module.exports = { createDocumentStorage, normalizeDriver, STORAGE_PREFIX, MAX_DOCUMENT_BYTES };
