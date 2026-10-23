const { createBillingRepository } = require('../db/billing');
const { createRecordsPaymentsRepository } = require('../db/records-payments');
const { createDirectorAdminRepository } = require('../db/director-admin');
const { withFinancialRequest, requestKey, conflict, financialAmount } = require('../db/financial-requests');

// Owns payment transactions and business decisions. Repositories own SQL;
// HTTP permissions, status codes and request audit context stay in the routes.
function createFinancialPaymentService({
  pgPool, cleanText, todayIsoDate, money, roundMoney, normalizeCurrency,
  normalizePaymentPart, calculatePaymentSummary, hydrateVisitRecords,
  serializePaymentHistoryRecord, serializeInvoice, serializeClaim
}) {
  async function appendVisitPayment({ recordId, key, payload }) {
    return withFinancialRequest(pgPool, {
      scope: `visit-payment:${recordId}`, key, payload
    }, async connection => {
      const repository = createRecordsPaymentsRepository({ pgPool: connection, inTransaction: true });
      await repository.withRecordForUpdate(recordId, async ({ current, records, client }) => {
        const currencyRepository = createDirectorAdminRepository({ pgPool: client });
        if (!current) throw Object.assign(new Error('Record not found'), { status: 404 });

        const payment = await records.findPaymentByVisitRecordId(recordId);
        const currentDebt = money(payment?.amount || 0);
        if (currentDebt <= 0) throw Object.assign(new Error('Poseta nema dug za dodatnu uplatu.'), { status: 400 });

        const currency = normalizeCurrency(payment?.currency || payload.currency || 'RSD');
        const existingParts = (await records.paymentPartsForRecord(recordId)).map(part => ({
          amount: Number(part.amount || 0),
          currency: part.currency || currency,
          exchangeRateToRsd: Number(part.exchange_rate_to_rsd || 0),
          amountRsd: Number(part.amount_rsd || 0),
          paymentMethod: part.payment_method || '',
          paymentDate: part.payment_date || '',
          notes: part.notes || ''
        }));
        const paymentPart = await normalizePaymentPart({
          ...payload,
          paymentDate: payload.paymentDate || payload.payment_date || current.visit_date || todayIsoDate()
        }, currencyRepository);
        const allParts = [...existingParts, paymentPart];
        const totalAmount = roundMoney(currentDebt + money(payment?.amount_paid || 0));
        const summary = await calculatePaymentSummary({
          amount: totalAmount,
          currency,
          paymentParts: allParts,
          paymentStatus: payment?.payment_status
        }, currencyRepository);
        await records.appendPaymentPart({
          payment,
          visitRecordId: recordId,
          patientId: payment?.patient_id || current.patient_id,
          paymentPart,
          paymentSummary: summary,
          currency
        });

      });
      const record = await repository.recordByIdForList(recordId);
      const [hydrated] = await hydrateVisitRecords([record], repository);
      return serializePaymentHistoryRecord(hydrated);
    });
  }

  async function addInvoicePayment({ invoiceId, key, payload, userId }) {
    return withFinancialRequest(pgPool, {
      scope: `invoice-payment:${invoiceId}`, key, payload
    }, async client => {
      const repository = createBillingRepository({ pgPool: client, inTransaction: true });
      const paymentType = ['payment', 'advance', 'installment', 'refund'].includes(payload.paymentType || payload.payment_type) ? (payload.paymentType || payload.payment_type) : 'payment';
      const amount = financialAmount(payload.amount, { positive: true });
      const invoice = await repository.addInvoicePayment({
        invoiceId,
        payment: {
          amount,
          paymentMethod: cleanText(payload.paymentMethod || payload.payment_method, { max: 80 }),
          paymentDate: cleanText(payload.paymentDate || payload.payment_date || todayIsoDate(), { max: 20, required: true }),
          paymentType,
          notes: cleanText(payload.notes, { max: 1000 })
        },
        ledger: {
          entryType: paymentType === 'refund' ? 'refund' : 'patient_payment',
          amount: paymentType === 'refund' ? amount : -amount,
          source: 'invoice_payment',
          entryDate: todayIsoDate(),
          userId
        }
      });
      return serializeInvoice(invoice, repository);
    });
  }

  async function postEra({ claimId, key, payload, userId }) {
    const eventId = requestKey(payload.eventId ?? payload.event_id ?? key);
    const paidAmount = financialAmount(payload.paidAmount ?? payload.paid_amount ?? payload.approvedAmount ?? payload.approved_amount ?? 0);
    const approvedAmount = financialAmount(payload.approvedAmount ?? payload.approved_amount ?? paidAmount);
    const denialReason = cleanText(payload.denialReason || payload.denial_reason, { max: 1000 });
    return withFinancialRequest(pgPool, {
      scope: `era:${claimId}`, key: eventId || 'legacy', payload: { paidAmount, approvedAmount, denialReason }
    }, async client => {
      const repository = createBillingRepository({ pgPool: client, inTransaction: true });
      const claim = await repository.findClaimForUpdate(claimId);
      if (!claim) throw Object.assign(new Error('Insurance claim not found'), { status: 404 });
      // The existing UI submits one cumulative EOB per claim. Historical postings
      // are recognized without adding their full amount again. Corrections need an explicit event identity.
      if (!eventId && claim.era_status === 'received') {
        if (paidAmount !== Number(claim.paid_amount) || approvedAmount !== Number(claim.approved_amount) || (denialReason || '') !== (claim.denial_reason || '')) {
          throw conflict('Korekcija ERA obračuna zahteva novi eventId.');
        }
        return serializeClaim(claim, repository);
      }
      const status = denialReason ? 'denied' : (paidAmount >= Number(claim.requested_amount || 0) ? 'paid' : 'partially_approved');
      const eob = {
        payer: claim.provider,
        payerControlNumber: claim.payer_control_number || `EOB-${claimId}`,
        approvedAmount,
        paidAmount,
        adjustment: Math.max(0, Number(claim.requested_amount || 0) - approvedAmount),
        denialReason: denialReason || '',
        receivedAt: new Date().toISOString()
      };
      const updated = await repository.postEra({
        claim,
        era: {
          status,
          approvedAmount,
          paidAmount,
          decisionAt: new Date().toISOString(),
          denialReason,
          eobJson: JSON.stringify(eob)
        },
        ledger: {
          patientId: claim.patient_id,
          invoiceId: claim.invoice_id,
          claimId,
          entryType: 'insurance_payment',
          amount: -paidAmount,
          currency: 'RSD',
          description: `ERA uplata ${claim.provider}`,
          source: 'era',
          entryDate: todayIsoDate(),
          userId
        }
      });
      return serializeClaim(updated, repository);
    });
  }

  return { appendVisitPayment, addInvoicePayment, postEra };
}

module.exports = { createFinancialPaymentService };
