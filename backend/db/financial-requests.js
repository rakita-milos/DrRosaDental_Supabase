const { createHash } = require('crypto');
const { queryOne, execute, withTransaction } = require('./postgres');

function conflict(message) {
  return Object.assign(new Error(message), { status: 409, code: 'FINANCIAL_REQUEST_CONFLICT' });
}

function requestKey(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(value)) {
    throw Object.assign(new Error('Neispravan ključ finansijskog zahteva.'), { status: 400 });
  }
  return value;
}

function financialAmount(value, { positive = false } = {}) {
  if (!((typeof value === 'number') || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())))) {
    throw Object.assign(new Error('Neispravan finansijski iznos.'), { status: 400 });
  }
  const number = Number(value);
  // Monetary columns use NUMERIC(12, 2). Reject overflow before PostgreSQL.
  if (!Number.isFinite(number) || number < 0 || number > 9999999999.99 || (positive && number <= 0)) {
    throw Object.assign(new Error('Neispravan finansijski iznos.'), { status: 400 });
  }
  // PostgreSQL NUMERIC rounds decimal ties away from zero. All accepted
  // amounts are nonnegative; round the decimal digits before converting back
  // to Number, so inputs such as 10.075 do not become 10.07 in binary math.
  // Numbers below half a cent round to zero, including exponent notation.
  const decimal = typeof value === 'string' ? value.trim() : number < 0.005 ? '0' : String(number);
  const [whole, fraction = ''] = decimal.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'))
    + (fraction[2] >= '5' ? 1n : 0n);
  if (cents > 999999999999n) throw Object.assign(new Error('Neispravan finansijski iznos.'), { status: 400 });
  const rounded = Number(cents) / 100;
  if (positive && rounded <= 0) throw Object.assign(new Error('Iznos uplate mora biti pozitivan.'), { status: 400 });
  return rounded;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

// The receipt and financial mutation commit together. Concurrent duplicates wait
// on the unique key, then receive the original response, including after a lost HTTP response.
async function withFinancialRequest(pool, { scope, key, payload }, work) {
  const safeKey = requestKey(key);
  const hash = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
  return withTransaction(pool, async client => {
    if (safeKey) {
      const inserted = await queryOne(client, `
        INSERT INTO financial_requests (scope, request_key, payload_hash)
        VALUES (?, ?, ?) ON CONFLICT (scope, request_key) DO NOTHING RETURNING scope
      `, [scope, safeKey, hash]);
      if (!inserted) {
        const receipt = await queryOne(client, 'SELECT payload_hash, response_json FROM financial_requests WHERE scope = ? AND request_key = ?', [scope, safeKey]);
        if (receipt.payload_hash !== hash) throw conflict('Isti ključ je već korišćen za drugačiji finansijski zahtev.');
        return { body: receipt.response_json, replayed: true };
      }
    }
    const body = await work(client);
    if (safeKey) await execute(client, 'UPDATE financial_requests SET response_json = ?::jsonb WHERE scope = ? AND request_key = ?', [JSON.stringify(body), scope, safeKey]);
    return { body, replayed: false };
  });
}

module.exports = { withFinancialRequest, requestKey, conflict, financialAmount };
