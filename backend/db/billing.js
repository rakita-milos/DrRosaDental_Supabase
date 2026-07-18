const {
  execute,
  insertReturningId,
  queryMany,
  queryOne,
  withTransaction
} = require('./postgres');
function createBillingRepository({ pgPool }) {
  if (!pgPool) throw new Error('pgPool is required for postgres billing repository.');
  return createPostgresBillingRepository(pgPool);
}

function createPostgresBillingRepository(pool) {
  return {
    async invoiceCountForYear(year) {
      const row = await queryOne(pool, "SELECT COUNT(*)::int as count FROM invoices WHERE invoice_number LIKE ?", [`DR-${year}-%`]);
      return Number(row?.count || 0);
    },
    invoiceItems(invoiceId) {
      return queryMany(pool, 'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id', [invoiceId]);
    },
    invoicePayments(invoiceId) {
      return queryMany(pool, 'SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date, id', [invoiceId]);
    },
    listInvoicesByPatient(patientId) {
      return queryMany(pool, 'SELECT * FROM invoices WHERE patient_id = ? ORDER BY issue_date DESC, id DESC', [patientId]);
    },
    findInvoice(id) {
      return queryOne(pool, 'SELECT * FROM invoices WHERE id = ?', [id]);
    },
    invoiceForPdf(id) {
      return queryOne(pool, 'SELECT i.*, p.first_name, p.last_name, p.email, p.phone FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.id = ?', [id]);
    },
    async createInvoice({ invoice, items, ledger }) {
      return withTransaction(pool, async (client) => {
        const invoiceId = await insertReturningId(client, `
          INSERT INTO invoices (patient_id, visit_record_id, invoice_number, status, issue_date, due_date, currency, discount, tax, notes, created_by)
          VALUES (?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?)
        `, [
          invoice.patientId,
          invoice.visitRecordId,
          invoice.invoiceNumber,
          invoice.issueDate,
          invoice.dueDate,
          invoice.currency,
          invoice.discount,
          invoice.tax,
          invoice.notes,
          invoice.createdBy
        ]);
        await replaceInvoiceItemsPostgres(client, invoiceId, items);
        await recalculateInvoicePostgres(client, invoiceId);
        const saved = await queryOne(client, 'SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        await insertLedgerEntryPostgres(client, { ...ledger, invoiceId, amount: saved.total, currency: saved.currency, description: `Racun ${saved.invoice_number}` });
        return saved;
      });
    },
    async addInvoicePayment({ invoiceId, payment, ledger }) {
      return withTransaction(pool, async (client) => {
        await execute(client, 'INSERT INTO invoice_payments (invoice_id, amount, payment_method, payment_date, payment_type, notes) VALUES (?, ?, ?, ?, ?, ?)', [
          invoiceId,
          payment.amount,
          payment.paymentMethod,
          payment.paymentDate,
          payment.paymentType,
          payment.notes
        ]);
        await recalculateInvoicePostgres(client, invoiceId);
        const invoice = await queryOne(client, 'SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        await insertLedgerEntryPostgres(client, {
          ...ledger,
          patientId: invoice.patient_id,
          invoiceId,
          currency: invoice.currency,
          description: `${payment.paymentType === 'refund' ? 'Povracaj' : 'Uplata'} za racun ${invoice.invoice_number}`
        });
        return invoice;
      });
    },
    async deleteInvoice({ invoice, ledger }) {
      return withTransaction(pool, async (client) => {
        const row = await queryOne(client, 'SELECT COALESCE(SUM(amount), 0) as amount FROM patient_ledger_entries WHERE invoice_id = ?', [invoice.id]);
        const ledgerBalance = Number(row?.amount || 0);
        if (ledgerBalance !== 0) {
          await insertLedgerEntryPostgres(client, {
            ...ledger,
            patientId: invoice.patient_id,
            invoiceId: invoice.id,
            entryType: ledgerBalance > 0 ? 'adjustment' : 'charge',
            amount: -ledgerBalance,
            currency: invoice.currency,
            description: `Storno racuna ${invoice.invoice_number}`,
            source: 'invoice_delete'
          });
        }
        await execute(client, 'DELETE FROM invoices WHERE id = ?', [invoice.id]);
      });
    },

    claimAttachments(claimId) {
      return queryMany(pool, `
        SELECT ca.*, d.title, d.document_type, d.original_filename
        FROM insurance_claim_attachments ca
        JOIN patient_documents d ON d.id = ca.document_id
        WHERE ca.claim_id = ?
        ORDER BY ca.created_at DESC, ca.id DESC
      `, [claimId]);
    },
    listClaimsByPatient(patientId) {
      return queryMany(pool, 'SELECT * FROM insurance_claims WHERE patient_id = ? ORDER BY created_at DESC', [patientId]);
    },
    findClaim(id) {
      return queryOne(pool, 'SELECT * FROM insurance_claims WHERE id = ?', [id]);
    },
    async createClaim(claim) {
      const id = await insertReturningId(pool, `
        INSERT INTO insurance_claims (
          patient_id, visit_record_id, invoice_id, provider, policy_number, claim_number, status,
          requested_amount, approved_amount, submitted_at, decision_at, eligibility_notes, preauthorization_notes, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, claimParams(claim));
      return this.findClaim(id);
    },
    async updateEligibility({ claimId, status, note, payerControlNumber }) {
      await execute(pool, `
        UPDATE insurance_claims
        SET status = 'eligibility_checked', eligibility_status = ?, eligibility_notes = ?,
            payer_control_number = ?, updated_at = now()
        WHERE id = ?
      `, [status, note, payerControlNumber, claimId]);
      return this.findClaim(claimId);
    },
    findClaimDocument({ documentId, patientId }) {
      return queryOne(pool, 'SELECT * FROM patient_documents WHERE id = ? AND patient_id = ? AND is_deleted = false', [documentId, patientId]);
    },
    async addClaimAttachment({ claimId, documentId, attachmentType, clearinghouseRef, notes, createdBy }) {
      return withTransaction(pool, async (client) => {
        const id = await insertReturningId(client, `
          INSERT INTO insurance_claim_attachments (claim_id, document_id, attachment_type, clearinghouse_ref, status, notes, created_by)
          VALUES (?, ?, ?, ?, 'attached', ?, ?)
        `, [claimId, documentId, attachmentType, clearinghouseRef, notes, createdBy]);
        await execute(client, 'UPDATE patient_documents SET claim_attachment_ready = true, updated_at = now() WHERE id = ?', [documentId]);
        return id;
      });
    },
    async attachmentCount(claimId) {
      const row = await queryOne(pool, 'SELECT COUNT(*)::int as count FROM insurance_claim_attachments WHERE claim_id = ?', [claimId]);
      return Number(row?.count || 0);
    },
    async submitClaim({ claimId, submittedAt, clearinghouseRef, notes }) {
      return withTransaction(pool, async (client) => {
        await execute(client, `
          UPDATE insurance_claims
          SET status = 'submitted', submitted_at = ?, clearinghouse_ref = ?, notes = ?, updated_at = now()
          WHERE id = ?
        `, [submittedAt, clearinghouseRef, notes, claimId]);
        await execute(client, "UPDATE insurance_claim_attachments SET status = 'submitted', clearinghouse_ref = ? WHERE claim_id = ?", [clearinghouseRef, claimId]);
        return queryOne(client, 'SELECT * FROM insurance_claims WHERE id = ?', [claimId]);
      });
    },
    async postEra({ claim, era, ledger }) {
      return withTransaction(pool, async (client) => {
        await execute(client, `
          UPDATE insurance_claims
          SET status = ?, approved_amount = ?, paid_amount = ?, decision_at = ?,
              denial_reason = ?, eob_json = ?, era_status = 'received', ledger_status = 'reconciled',
              updated_at = now()
          WHERE id = ?
        `, [era.status, era.approvedAmount, era.paidAmount, era.decisionAt, era.denialReason, era.eobJson, claim.id]);
        if (era.paidAmount > 0) {
          await insertLedgerEntryPostgres(client, ledger);
        }
        return queryOne(client, 'SELECT * FROM insurance_claims WHERE id = ?', [claim.id]);
      });
    },
    ledgerEntriesByPatient(patientId) {
      return queryMany(pool, `
        SELECT * FROM patient_ledger_entries
        WHERE patient_id = ?
        ORDER BY entry_date DESC, created_at DESC, id DESC
      `, [patientId]);
    },
    deleteClaim(id) {
      return execute(pool, 'DELETE FROM insurance_claims WHERE id = ?', [id]);
    }
  };
}

async function replaceInvoiceItemsPostgres(client, invoiceId, items) {
  await execute(client, 'DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
  for (let index = 0; index < items.length; index += 1) {
    await execute(client, 'INSERT INTO invoice_items (invoice_id, description, tooth_number, quantity, unit_price, discount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', invoiceItemParams(invoiceId, items[index], index));
  }
}

function invoiceItemParams(invoiceId, item, index) {
  return [invoiceId, item.description, item.toothNumber, item.quantity, item.unitPrice, item.discount, index];
}

function invoiceTotals(items, invoice, paid) {
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 1) * Number(item.unit_price || 0) - Number(item.discount || 0)), 0);
  const total = Math.max(0, subtotal - Number(invoice.discount || 0) + Number(invoice.tax || 0));
  const status = paid <= 0 ? 'issued' : paid >= total ? 'paid' : 'partially_paid';
  return { subtotal, total, paid, status };
}

async function recalculateInvoicePostgres(client, invoiceId) {
  const items = await queryMany(client, 'SELECT * FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
  const invoice = await queryOne(client, 'SELECT discount, tax FROM invoices WHERE id = ?', [invoiceId]);
  const row = await queryOne(client, `
    SELECT COALESCE(SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END), 0) as paid
    FROM invoice_payments WHERE invoice_id = ?
  `, [invoiceId]);
  const totals = invoiceTotals(items, invoice, Number(row?.paid || 0));
  await execute(client, 'UPDATE invoices SET subtotal = ?, total = ?, amount_paid = ?, status = ?, updated_at = now() WHERE id = ?', [
    totals.subtotal,
    totals.total,
    totals.paid,
    totals.status,
    invoiceId
  ]);
}

function insertLedgerEntryPostgres(client, entry) {
  return execute(client, `
    INSERT INTO patient_ledger_entries (
      patient_id, invoice_id, claim_id, entry_type, amount, currency, description, entry_date, source, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ledgerParams(entry));
}

function ledgerParams(entry) {
  return [
    entry.patientId,
    entry.invoiceId || null,
    entry.claimId || null,
    entry.entryType,
    entry.amount,
    entry.currency,
    entry.description,
    entry.entryDate,
    entry.source,
    entry.userId || null
  ];
}

function claimParams(claim) {
  return [
    claim.patientId,
    claim.visitRecordId,
    claim.invoiceId,
    claim.provider,
    claim.policyNumber,
    claim.claimNumber,
    claim.status,
    claim.requestedAmount,
    claim.approvedAmount,
    claim.submittedAt,
    claim.decisionAt,
    claim.eligibilityNotes,
    claim.preauthorizationNotes,
    claim.notes,
    claim.createdBy
  ];
}

module.exports = {
  createBillingRepository
};
