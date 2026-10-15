const { DEFAULT_RSD_RATES } = require('../utils/currency-rates');

function reportError(message, code) {
  return Object.assign(new Error(message), { status: 409, code });
}

function amount(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    throw reportError('Izveštaj sadrži neispravan finansijski iznos.', 'REPORT_INVALID_AMOUNT');
  }
  return number;
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function currencyCode(value) {
  return String(value || 'RSD').trim().toUpperCase();
}

function add(target, currency, value) {
  target[currency] = round((target[currency] || 0) + value);
}

function currencyConverter(currencies = []) {
  const rates = new Map(Object.entries(DEFAULT_RSD_RATES));
  for (const item of currencies) {
    const code = currencyCode(item.value);
    if (code === 'RSD') continue;
    // An explicitly configured but broken rate must not silently fall back.
    rates.delete(code);
    let metadata = item.metadata;
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch { continue; }
    }
    const rate = Number(metadata?.exchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (currencyCode(metadata.rateBase || code) === code && currencyCode(metadata.rateCurrency || 'RSD') === 'RSD') rates.set(code, rate);
    else if (currencyCode(metadata.rateBase) === 'RSD' && currencyCode(metadata.rateCurrency || code) === code) rates.set(code, 1 / rate);
  }
  return (value, currency) => {
    const number = amount(value);
    if (!number) return 0;
    const code = currencyCode(currency);
    const rate = rates.get(code);
    if (!rate) throw reportError(`Valuta ${code} nema važeći kurs u šifarniku.`, 'REPORT_RATE_MISSING');
    return amount(number * rate);
  };
}

function receiptValueRsd(part, toRsd) {
  const paid = amount(part.amount);
  const saved = amount(part.amount_rsd);
  if (saved > 0 || paid === 0) return saved;
  const currency = currencyCode(part.currency);
  if (currency === 'RSD') return paid;
  const savedRate = Number(part.exchange_rate_to_rsd);
  if (Number.isFinite(savedRate) && savedRate > 0) return amount(paid * savedRate);
  return toRsd(paid, currency);
}

// Visits are the reporting source. Invoices/insurance are not added again:
// they are separate accounting flows and can refer to the same clinical work.
function buildFinancialReport({ records = [], currencies = [], total_patients = 0 } = {}) {
  const toRsd = currencyConverter(currencies);
  const revenueByCurrency = {}, debtByCurrency = {}, totalByCurrency = {};
  const patients = new Map();
  let revenueRsd = 0, debtRsd = 0, priceRsd = 0, paidValueRsd = 0, legacyPaymentCount = 0;
  for (const record of records) {
    const currency = currencyCode(record.currency);
    const paid = amount(record.amount_paid), debt = amount(record.amount_due);
    const price = paid + debt;
    const paidComparable = toRsd(paid, currency), debtComparable = toRsd(debt, currency);
    paidValueRsd += paidComparable;
    debtRsd += debtComparable;
    priceRsd += paidComparable + debtComparable;
    add(debtByCurrency, currency, debt);
    add(totalByCurrency, currency, price);
    const parts = Array.isArray(record.payment_parts) ? record.payment_parts : [];
    if (parts.length) {
      for (const part of parts) {
        const partAmount = amount(part.amount), partCurrency = currencyCode(part.currency);
        add(revenueByCurrency, partCurrency, partAmount);
        // Saved conversions preserve the rate at payment time. Older rows with
        // no RSD amount can use their saved rate, then the configured rate.
        revenueRsd += receiptValueRsd(part, toRsd);
      }
    } else {
      add(revenueByCurrency, currency, paid);
      revenueRsd += paidComparable;
      if (paid > 0) legacyPaymentCount++;
    }
    const id = Number(record.patient_id);
    if (!patients.has(id)) patients.set(id, { patientId: id, patient: record.patient_name, visits: 0, amount: {}, paid: {}, debt: {}, priceRsd: 0, paidRsd: 0 });
    const patient = patients.get(id);
    patient.visits++;
    add(patient.amount, currency, price);
    add(patient.paid, currency, paid);
    add(patient.debt, currency, debt);
    patient.priceRsd += paidComparable + debtComparable;
    patient.paidRsd += paidComparable;
  }
  const percentage = (paid, price) => (price > 0 ? paid / price * 100 : 0).toFixed(1);
  const totalRevenue = round(revenueRsd), totalDebt = round(debtRsd);
  const paymentPercentage = percentage(paidValueRsd, priceRsd);
  return {
    totalRevenue, totalDebt, totalAmount: round(priceRsd), totalPatients: Number(total_patients), totalVisits: records.length,
    paymentPercentage, revenueByCurrency, debtByCurrency, totalByCurrency, legacyPaymentCount,
    patients: [...patients.values()].sort((a, b) => String(a.patient).localeCompare(String(b.patient)) || a.patientId - b.patientId)
      .map(({ priceRsd: price, paidRsd: paid, ...patient }) => ({ ...patient, percentage: percentage(paid, price) })),
    valuation: { revenue: 'saved-payment-rates', debt: 'current-codebook-rates', collection: 'paid-share-of-visit-price-at-current-rates', legacyRevenue: 'current-codebook-rates' },
    details: { revenue: totalRevenue.toFixed(2), debt: totalDebt.toFixed(2), paidPercentage: paymentPercentage }
  };
}

function buildProceduresReport({ records = [], currencies = [] } = {}) {
  const toRsd = currencyConverter(currencies);
  const groups = new Map();
  for (const record of records) {
    const procedure = record.procedure;
    if (!groups.has(procedure)) groups.set(procedure, { procedure, count: 0, total: 0 });
    const group = groups.get(procedure);
    group.count++;
    group.total += toRsd(amount(record.amount_due) + amount(record.amount_paid), record.currency);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || String(a.procedure).localeCompare(String(b.procedure)))
    .map(({ procedure, count, total }) => ({ procedure, count, percentage: Number((count / records.length * 100).toFixed(1)), avgCost: round(total / count) }));
}

module.exports = { buildFinancialReport, buildProceduresReport };
