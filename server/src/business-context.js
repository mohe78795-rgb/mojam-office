'use strict';

const CATEGORIES = ['كبير', 'وسط', 'مطاعم', 'جفش', 'صغير'];
const categoryName = value => value === 'جفوش' || value === 'جفوش ' ? 'جفش' : String(value || '').trim();
const numeric = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const positive = value => Math.max(0, numeric(value));
const formatNumber = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const hasNumber = (object, key) => hasOwn(object, key) && object[key] !== null && object[key] !== '' && Number.isFinite(Number(object[key]));
const plainDataText = (value, max = 120) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-9);
}

function stockInCard(card, category) {
  const lines = Array.isArray(card?.lines) ? card.lines : [];
  const total = lines.filter(line => categoryName(line.cat || line.name) === category).reduce((sum, line) =>
    sum + positive(line.boxes) * positive(line.cap) + positive(line.plus) - positive(line.dead) - positive(line.returned), 0);
  return Math.max(0, total);
}

function computeStock(payload = {}) {
  const hasSource = Array.isArray(payload.incomingCards) || Array.isArray(payload.returns) || (payload.stock && typeof payload.stock === 'object');
  if (!hasSource) return null;
  const cards = Array.isArray(payload.incomingCards) ? payload.incomingCards : [];
  const returns = Array.isArray(payload.returns) ? payload.returns : [];
  const invoices = Array.isArray(payload.invoices) ? payload.invoices : [];
  const stockState = payload.stock && typeof payload.stock === 'object' ? payload.stock : {};
  const available = {};
  for (const category of CATEGORIES) {
    const opening = positive(stockState[category]?.yesterday);
    const returned = returns.reduce((sum, item) => sum + (categoryName(item.cat || item.name) === category ? numeric(item.net) : 0), 0);
    const shipments = cards.reduce((sum, card) => sum + stockInCard(card, category), 0);
    const sold = invoices.reduce((sum, invoice) => {
      if (['ملغي', 'محذوف', 'void', 'cancelled', 'deleted'].includes(String(invoice.status || '').toLowerCase())) return sum;
      return sum + (Array.isArray(invoice.items) ? invoice.items : []).reduce((sub, item) =>
        sub + (categoryName(item.name || item.cat) === category ? positive(item.qty) : 0), 0);
    }, 0);
    available[category] = Math.max(0, opening + returned + shipments - sold);
  }
  return available;
}

function hasCustomerQuestion(message) {
  return /حساب|رصيد|علي|علينا|عليكم|شبوك|صناديق|صندوق|مديون|آجل|فاتور|باقي|متبقي|مستحق|آخر|اخر|كم\s*(معي|معاي|عندي)|كم عندكم/i.test(String(message || ''));
}

function customerCrateFacts(customer) {
  const nested = customer?.crates_balance || customer?.cratesBalance || {};
  const hasDelivered = hasNumber(nested, 'total_delivered') || hasNumber(nested, 'totalDelivered') || hasNumber(customer, 'total_delivered') || hasNumber(customer, 'totalDelivered');
  const hasReturned = hasNumber(nested, 'total_returned') || hasNumber(nested, 'totalReturned') || hasNumber(customer, 'total_returned') || hasNumber(customer, 'totalReturned');
  const delivered = positive(nested.total_delivered ?? nested.totalDelivered ?? customer?.total_delivered ?? customer?.totalDelivered);
  const returned = positive(nested.total_returned ?? nested.totalReturned ?? customer?.total_returned ?? customer?.totalReturned);
  const known = hasDelivered || hasReturned;
  return { known, delivered, returned, owed: Math.max(0, delivered - returned), extraReturned: Math.max(0, returned - delivered) };
}

function customerFinancialDebt(customer) {
  const nested = customer?.crates_balance || customer?.cratesBalance || {};
  for (const [object, key] of [[nested, 'remaining_debt'], [nested, 'remainingDebt'], [customer, 'remaining_debt'], [customer, 'remainingDebt'], [customer, 'balance_due'], [customer, 'outstanding_balance']]) {
    if (hasNumber(object, key)) return Number(object[key]);
  }
  return null;
}

async function firstRow(cursor) {
  const rows = await cursor.limit(1).toArray();
  return rows[0] || null;
}

async function getCustomerByPhone(db, accountId, phone) {
  const phoneKey = normalizePhone(phone);
  if (!phoneKey) return null;
  const collection = db.collection('customers');
  const direct = await collection.findOne({ account_id: accountId, phone_normalized: phoneKey });
  if (direct) return direct;
  const legacy = await collection.find({ account_id: accountId }, { projection: { name: 1, full_name: 1, phone: 1, phone_normalized: 1, total_delivered: 1, total_returned: 1, crates_balance: 1, cratesBalance: 1, remaining_debt: 1, remainingDebt: 1, balance_due: 1, outstanding_balance: 1 } }).limit(500).toArray();
  return legacy.find(row => normalizePhone(row.phone_normalized || row.phone) === phoneKey) || null;
}

function invoiceMatchesCustomer(invoice, customer) {
  const invoicePhone = normalizePhone(invoice?.phone || invoice?.phone_normalized);
  if (invoicePhone && normalizePhone(customer?.phone_normalized || customer?.phone) === invoicePhone) return true;
  if (invoicePhone) return false;
  const invoiceName = String(invoice?.customer || invoice?.customerName || '').trim().toLocaleLowerCase();
  return Boolean(invoiceName && invoiceName === String(customer?.name || '').trim().toLocaleLowerCase());
}

function safeRecentInvoice(invoice, sessionDate) {
  const items = (Array.isArray(invoice.items) ? invoice.items : []).filter(item => positive(item.qty) > 0).slice(0, 8).map(item => ({
    category: CATEGORIES.includes(categoryName(item.name || item.cat)) ? categoryName(item.name || item.cat) : 'صنف غير معروف',
    quantity: positive(item.qty)
  }));
  return {
    number: plainDataText(invoice.num || invoice.invoiceNumber, 40),
    date: plainDataText(invoice.date || sessionDate, 30),
    type: plainDataText(invoice.type, 30),
    total: positive(invoice.total),
    emptyCratesReceived: positive(invoice.emptyCratesReceived ?? invoice.emptyCratesTotal ?? invoice.crates),
    items
  };
}

async function buildBusinessContext(db, accountId, options = {}) {
  const lines = [];
  const latestDay = await firstRow(db.collection('daily_sessions').find({ account_id: accountId }, { projection: { session_date: 1, 'payload.date': 1, 'payload.dailyPrices': 1, 'payload.stock': 1, 'payload.returns': 1, 'payload.incomingCards': 1, 'payload.invoices': 1 } }).sort({ session_date: -1 }));
  const payload = latestDay?.payload || {};
  const sessionDate = String(latestDay?.session_date || payload.date || 'غير مسجل');
  lines.push(`مصدر بيانات التشغيل: اليومية المحفوظة بتاريخ ${sessionDate}.`);

  let priceDay = latestDay;
  if (!payload.dailyPrices || typeof payload.dailyPrices !== 'object') {
    priceDay = await firstRow(db.collection('daily_sessions').find({ account_id: accountId, 'payload.dailyPrices': { $exists: true } }, { projection: { session_date: 1, 'payload.date': 1, 'payload.dailyPrices': 1 } }).sort({ session_date: -1 }));
  }
  const pricePayload = priceDay?.payload || {};
  const dailyPrices = pricePayload.dailyPrices && typeof pricePayload.dailyPrices === 'object' ? pricePayload.dailyPrices : null;
  const validPrices = dailyPrices ? CATEGORIES.filter(category => Number.isFinite(Number(dailyPrices[category])) && Number(dailyPrices[category]) > 0) : [];
  if (validPrices.length) {
    const priceDate = String(priceDay?.session_date || pricePayload.date || 'غير مسجل');
    lines.push(`آخر أسعار البورصة المحفوظة في MongoDB (تاريخ سجلها ${priceDate}؛ لا تنسبها إلى اليوم إذا كان التاريخ مختلفًا): ${validPrices.map(category => `${category} ${formatNumber(dailyPrices[category])} ريال للحبة`).join('، ')}.`);
  } else {
    lines.push('لم يُعثر على أسعار يومية محفوظة في MongoDB؛ لا تخمّن أسعارًا من القيم الافتراضية أو الفواتير القديمة.');
  }

  const remainingStock = computeStock(payload);
  if (remainingStock) {
    lines.push(`المخزون المتبقي المحسوب من آخر يوم محفوظ (افتتاحي + وارد + مرتجعات - فواتير ذلك اليوم)، بتاريخ ${sessionDate}: ${CATEGORIES.map(category => `${category} ${formatNumber(remainingStock[category])} حبة`).join('، ')}.`);
  } else {
    lines.push('بيانات المخزون اليومي غير متوفرة في MongoDB؛ لا تدّع معرفة الكمية المتاحة.');
  }

  const customerQuestion = hasCustomerQuestion(options.message);
  const phoneKey = normalizePhone(options.phone);
  let customerName = '';
  if (customerQuestion) {
    if (!phoneKey) {
      lines.push('سؤال العميل يتعلق بحساب أو صندوق، لكن لا يوجد رقم هاتف مرسل موثوق لمطابقة سجل العميل؛ لا تعرض أي رصيد خاص.');
      return { text: lines.join('\n').slice(0, 5200), customerName, customerLookupAttempted: true, date: sessionDate };
    }
    const customer = await getCustomerByPhone(db, accountId, options.phone);
    if (!customer) {
      lines.push('لم يُعثر على سجل عميل مطابق لرقم هاتف المرسل في MongoDB؛ لا تخمّن رصيدًا أو مشتريات، واطلب مراجعة الإدارة.');
      return { text: lines.join('\n').slice(0, 5200), customerName, customerLookupAttempted: true, date: sessionDate };
    }

    customerName = plainDataText(customer.name || customer.full_name, 100);
    lines.push(`اسم العميل في السجل المطابق برقم المرسل: ${JSON.stringify(customerName || 'اسم غير مسجل')}.`);
    const crate = customerCrateFacts(customer);
    if (crate.known) {
      lines.push(`الصناديق المسجلة للعميل: المستلم من المكتب ${formatNumber(crate.delivered)}، والراجع إلى المكتب ${formatNumber(crate.returned)}، والمتبقي عليه ${formatNumber(crate.owed)} صندوق${crate.extraReturned ? `، ويوجد ${formatNumber(crate.extraReturned)} صندوق زائد في المرتجعات المسجلة` : ''}.`);
    } else {
      lines.push('لا يوجد سجل موثوق لعدد الصناديق المستلمة والراجعة لهذا العميل؛ لا تقدّر عدد الشبوك من عدد الدجاج.');
    }

    const debt = customerFinancialDebt(customer);
    if (debt !== null) {
      lines.push(`الرصيد المالي المتبقي المسجل صراحةً في سجل العميل: ${formatNumber(debt)} ريال.`);
    } else {
      lines.push('لا يوجد حقل رصيد مالي متبقٍ موثوق لهذا العميل. سجل التطبيق الحالي لا يحتوي على دفتر سداد مكتمل؛ لا تجمع فواتير الآجل وتعرضها كدين صافٍ.');
    }

    const history = await db.collection('daily_sessions')
      .find({ account_id: accountId }, { projection: { session_date: 1, 'payload.invoices': 1 } })
      .sort({ session_date: -1 }).limit(365).toArray();
    const customerInvoices = history.flatMap(session => (Array.isArray(session?.payload?.invoices) ? session.payload.invoices : [])
      .filter(invoice => invoiceMatchesCustomer(invoice, customer))
      .map(invoice => safeRecentInvoice(invoice, session.session_date)))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)))
      .slice(0, 5);
    if (customerInvoices.length) {
      lines.push(`آخر فواتير العميل الموجودة ضمن اليوميات المحفوظة (حتى 365 يومًا): ${customerInvoices.map(invoice => {
        const items = invoice.items.map(item => `${item.category} ${formatNumber(item.quantity)} حبة`).join('، ') || 'لا تفاصيل أصناف';
        return `فاتورة ${invoice.number || 'بلا رقم'} بتاريخ ${invoice.date}: ${items}; الإجمالي ${formatNumber(invoice.total)} ريال; صناديق فارغة مستلمة ${formatNumber(invoice.emptyCratesReceived)}.`;
      }).join(' | ')}.`);
    } else {
      lines.push('لم تُعثر على فواتير محفوظة مرتبطة بهذا العميل ضمن اليوميات المتاحة.');
    }
  }

  return { text: lines.join('\n').slice(0, 5200), customerName, customerLookupAttempted: customerQuestion, date: sessionDate };
}

module.exports = { CATEGORIES, normalizePhone, computeStock, hasCustomerQuestion, buildBusinessContext };
