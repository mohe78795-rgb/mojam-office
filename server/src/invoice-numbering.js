'use strict';

async function numberExistsInLegacyData(db, accountId, invoiceNumber) {
  const candidates = [invoiceNumber, Number(invoiceNumber)];
  const dailySessionFields = [
    'payload.invoices.num',
    'payload.invoices.invoice_number',
    'payload.invoices.invoiceNumber'
  ];
  const dailySession = await db.collection('daily_sessions').findOne({
    account_id: accountId,
    $or: dailySessionFields.map(field => ({ [field]: { $in: candidates } }))
  }, { projection: { _id: 1 } });
  if (dailySession) return true;

  // Older deployments may have stored invoices as individual MongoDB documents.
  const invoiceFields = ['invoice_number', 'invoiceNumber', 'num', 'number'];
  const legacyInvoice = await db.collection('invoices').findOne({
    account_id: accountId,
    $or: invoiceFields.map(field => ({ [field]: { $in: candidates } }))
  }, { projection: { _id: 1 } });
  return Boolean(legacyInvoice);
}

async function reserveInvoiceNumber(db, accountId, user, createdAt = new Date()) {
  const sequences = db.collection('number_sequences');
  const counterId = `${accountId}:invoice-number`;

  // Each increment is atomic in MongoDB, so different workers/devices cannot
  // receive the same newly generated number. The first reservation maps 1 -> 00000.
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const result = await sequences.findOneAndUpdate(
      { _id: counterId },
      {
        $inc: { value: 1 },
        $setOnInsert: { account_id: accountId, sequence: 'invoice-number', created_at: createdAt }
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false }
    );
    const document = result?.value && typeof result.value === 'object' ? result.value : result;
    const counterValue = Number(document?.value);
    if (!Number.isSafeInteger(counterValue) || counterValue < 1) {
      throw new Error('INVOICE_SEQUENCE_UNAVAILABLE');
    }

    const serial = counterValue - 1;
    const invoiceNumber = String(serial).padStart(5, '0');
    if (await numberExistsInLegacyData(db, accountId, invoiceNumber)) continue;

    return {
      invoiceNumber,
      sellerName: String(user?.full_name || user?.name || user?.employee_code || '').trim(),
      sellerUserId: String(user?.id || '').trim()
    };
  }
  throw new Error('INVOICE_SEQUENCE_EXHAUSTED');
}

module.exports = { reserveInvoiceNumber, numberExistsInLegacyData };
