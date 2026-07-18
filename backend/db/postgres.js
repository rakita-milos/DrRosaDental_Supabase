const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_SEARCH_PATH = 'app,public';

function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for PostgreSQL/Supabase mode.');
  }

  const searchPath = process.env.PG_SEARCH_PATH || DEFAULT_SEARCH_PATH;
  if (!isValidSearchPath(searchPath)) {
    throw new Error('PG_SEARCH_PATH contains an invalid schema name.');
  }

  const sslEnabled = process.env.PGSSL !== 'false';

  return new Pool({
    connectionString: sslEnabled ? stripSslConnectionParams(connectionString) : connectionString,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10000),
    options: `-c search_path=${searchPath}`
  });
}

function stripSslConnectionParams(connectionString) {
  try {
    const url = new URL(connectionString);
    for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

function isValidSearchPath(searchPath) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*(,[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(searchPath);
}

function positionalPlaceholdersToPostgres(sql) {
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let output = '';

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      output += char;
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      output += char;
      if (char === '*' && next === '/') {
        output += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '-' && next === '-') {
      output += char + next;
      i += 1;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '/' && next === '*') {
      output += char + next;
      i += 1;
      inBlockComment = true;
      continue;
    }

    if (!inDoubleQuote && char === "'") {
      output += char;
      if (inSingleQuote && next === "'") {
        output += next;
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (!inSingleQuote && char === '"') {
      output += char;
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '?') {
      index += 1;
      output += `$${index}`;
      continue;
    }

    output += char;
  }

  return output;
}

function normalizeResult(result) {
  return {
    rows: result.rows,
    changes: result.rowCount,
    rowCount: result.rowCount,
    lastInsertRowid: result.rows?.[0]?.id ?? null
  };
}

async function queryMany(client, sql, params = []) {
  const result = await client.query(positionalPlaceholdersToPostgres(sql), params);
  return result.rows;
}

async function queryOne(client, sql, params = []) {
  const rows = await queryMany(client, sql, params);
  return rows[0] || null;
}

async function execute(client, sql, params = []) {
  const result = await client.query(positionalPlaceholdersToPostgres(sql), params);
  return normalizeResult(result);
}

async function insertReturningId(client, sql, params = []) {
  const trimmed = sql.trim().replace(/;$/, '');
  const returningSql = /\breturning\b/i.test(trimmed) ? trimmed : `${trimmed} RETURNING id`;
  const result = await execute(client, returningSql, params);
  return result.lastInsertRowid;
}

async function withTransaction(pool, callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function initializePostgresSchema(pool) {
  const schemaPath = path.join(__dirname, '..', 'database.postgres.sql');
  const schema = await fs.promises.readFile(schemaPath, 'utf8');
  await pool.query(schema);
}

async function configureSearchPath(pool, searchPath = process.env.PG_SEARCH_PATH || DEFAULT_SEARCH_PATH) {
  if (!isValidSearchPath(searchPath)) {
    throw new Error('PG_SEARCH_PATH contains an invalid schema name.');
  }

  await pool.query(`SET search_path TO ${searchPath}`);
}

module.exports = {
  DEFAULT_SEARCH_PATH,
  createPool,
  configureSearchPath,
  execute,
  initializePostgresSchema,
  insertReturningId,
  queryMany,
  queryOne,
  positionalPlaceholdersToPostgres,
  stripSslConnectionParams,
  withTransaction
};
