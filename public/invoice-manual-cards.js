/* Mojam invoice UI: reference design with manual shipment-card selection and per-line empty crates. */
(function () {
  'use strict';

  const CATEGORIES = ['كبير', 'وسط', 'مطاعم', 'جفش', 'صغير'];
  const DEFAULT_PRICES = { 'كبير': 2200, 'وسط': 2150, 'مطاعم': 2100, 'جفش': 1900, 'صغير': 2000 };
  const CATEGORY_META = {
    'كبير': { label: 'كبير', row: 'row-cat-big', color: 'blue' },
    'وسط': { label: 'وسط', row: 'row-cat-mid', color: 'emerald' },
    'مطاعم': { label: 'مطاعم', row: 'row-cat-rest', color: 'amber' },
    'جفش': { label: 'جفوش', row: 'row-cat-jafsh', color: 'purple' },
    'صغير': { label: 'صغير', row: 'row-cat-small', color: 'rose' }
  };
  const num = value => Math.max(0, Number(value) || 0);
  const integer = value => Math.floor(num(value));
  const fmt = value => num(value).toLocaleString('en-US');
  const lineBoxes = item => integer(item?.emptyCrates ?? item?.empty_crates ?? item?.crates);
  const totalBoxes = items => (items || []).reduce((sum, item) => sum + lineBoxes(item), 0);
  const categoryName = value => value === 'جفوش' ? 'جفش' : value;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const sourceIdForItem = (item, invoice) => String(item?.supplierCardId || item?.cardId || invoice?.supplierCardId || '');

  function allRows() {
    return [...document.querySelectorAll('#invoice-items-body .invoice-line-row')];
  }

  function stockInCard(card, category) {
    if (typeof window.cardLinesTotal === 'function') return num(window.cardLinesTotal(card, category));
    return num((card?.lines || []).filter(line => categoryName(line.cat) === category).reduce((sum, line) =>
      sum + num(line.boxes) * num(line.cap) + num(line.plus) - num(line.dead) - num(line.returned), 0));
  }

  function savedCardSales(cardId, category) {
    let sold = 0;
    (window.batchInvoices || batchInvoices || []).forEach((invoice, index) => {
      if (Number.isInteger(window.editingInvoiceIndex ?? editingInvoiceIndex) && index === (window.editingInvoiceIndex ?? editingInvoiceIndex)) return;
      (invoice.items || []).forEach(item => {
        if (categoryName(item.name) === category && sourceIdForItem(item, invoice) === String(cardId)) sold += num(item.qty);
      });
    });
    return sold;
  }

  function pendingCardSales(cardId, category, exceptRow = null) {
    return allRows().reduce((sum, row) => {
      if (row === exceptRow || categoryName(row.dataset.cat) !== category) return sum;
      if (String(row.querySelector('.invoice-source')?.value || '') !== String(cardId)) return sum;
      return sum + num(row.querySelector('.qty')?.value);
    }, 0);
  }

  function cardAvailable(cardId, category, exceptRow = null) {
    const card = (window.incomingCards || incomingCards || []).find(item => String(item.id) === String(cardId));
    if (!card) return 0;
    return Math.max(0, stockInCard(card, category) - savedCardSales(cardId, category) - pendingCardSales(cardId, category, exceptRow));
  }

  function generalStockBase(category) {
    const previous = num((window.stockState || stockState || {})[category]?.yesterday);
    const returned = (window.returnsData || returnsData || []).filter(item => categoryName(item.cat) === category).reduce((sum, item) => sum + num(item.net), 0);
    return previous + returned;
  }

  function savedGeneralSales(category) {
    let sold = 0;
    (window.batchInvoices || batchInvoices || []).forEach((invoice, index) => {
      if (Number.isInteger(window.editingInvoiceIndex ?? editingInvoiceIndex) && index === (window.editingInvoiceIndex ?? editingInvoiceIndex)) return;
      (invoice.items || []).forEach(item => {
        if (categoryName(item.name) === category && !sourceIdForItem(item, invoice)) sold += num(item.qty);
      });
    });
    return sold;
  }

  function pendingGeneralSales(category, exceptRow = null) {
    return allRows().reduce((sum, row) => {
      if (row === exceptRow || categoryName(row.dataset.cat) !== category) return sum;
      if (String(row.querySelector('.invoice-source')?.value || '')) return sum;
      return sum + num(row.querySelector('.qty')?.value);
    }, 0);
  }

  function generalAvailable(category, exceptRow = null) {
    return Math.max(0, generalStockBase(category) - savedGeneralSales(category) - pendingGeneralSales(category, exceptRow));
  }

  function aggregateAvailable(category, exceptRow = null) {
    const general = generalAvailable(category, exceptRow);
    const cards = (window.incomingCards || incomingCards || []).reduce((sum, card) => sum + cardAvailable(card.id, category, exceptRow), 0);
    return general + cards;
  }

  function cardById(id) {
    return (window.incomingCards || incomingCards || []).find(card => String(card.id) === String(id));
  }

  function cardTitle(card) {
    if (!card) return 'المخزون العام';
    const farm = card.farm || card.supplier || 'بدون مزرعة';
    const driver = card.driver ? ` — السائق ${card.driver}` : '';
    return `كرت ${card.no || '—'} — ${farm}${driver}`;
  }

  function setRowSource(row, cardId, title = '') {
    if (!row) return;
    const source = row.querySelector('.invoice-source');
    const cleanId = String(cardId || '');
    if (source) source.value = cleanId;
    row.dataset.cardId = cleanId;
    const tag = row.querySelector('.selected-card-tag');
    if (tag) {
      tag.textContent = title || (cleanId ? cardTitle(cardById(cleanId)) : 'المخزون العام');
      tag.classList.remove('hidden');
      tag.dataset.source = cleanId ? 'card' : 'general';
    }
    window.recalcInvoiceLines();
  }

  function ensureSummary(table) {
    let wrapper = table.closest('.invoice-table-scroll');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'invoice-table-scroll';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
    let summary = document.getElementById('invoice-summary-grid');
    if (!summary) {
      summary = document.createElement('div');
      summary.id = 'invoice-summary-grid';
      summary.className = 'invoice-summary-grid grid grid-cols-3 gap-2.5 my-3.5';
      summary.innerHTML = `<div class="summary-card summary-chicken"><span>إجمالي الدجاج</span><strong><b id="inv-total-chicken">0</b> <small>حبة</small></strong></div><div class="summary-card summary-crates"><span>الصناديق الفارغة</span><strong><b id="inv-total-crates">0</b> <small>صندوق</small></strong></div><div class="summary-card summary-money"><span>إجمالي المبلغ</span><strong><b id="inv-grand-total">0.00</b> <small>ريال</small></strong></div>`;
      wrapper.after(summary);
    }
    const oldSummary = document.getElementById('invoice-empty-crates-summary');
    if (oldSummary) oldSummary.remove();
    const oldControls = document.getElementById('invoice-add-line-controls');
    if (oldControls) oldControls.remove();
    table.querySelector('tfoot')?.remove();
    return { wrapper, summary };
  }

  function ensureSupplierModal() {
    let modal = document.getElementById('supplier-card-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'supplier-card-modal';
    modal.className = 'mojam-supplier-modal';
    modal.innerHTML = `<div class="mojam-supplier-modal-card" role="dialog" aria-modal="true" aria-labelledby="supplier-modal-title"><div class="mojam-modal-head"><div><h3 id="supplier-modal-title">تحديد كرت المورد / المزرعة</h3><p id="supplier-modal-cat-name"></p></div><button type="button" class="mojam-modal-close" aria-label="إغلاق" onclick="closeSupplierCardModal()">×</button></div><p class="mojam-modal-help">اختر مصدر الصنف؛ سيُحفظ السطر مرتبطًا بالكرت المختار.</p><div id="supplier-cards-options-list" class="mojam-card-options"></div><button type="button" class="mojam-modal-cancel" onclick="closeSupplierCardModal()">إلغاء</button></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) window.closeSupplierCardModal(); });
    modal.querySelector('#supplier-cards-options-list').addEventListener('click', event => {
      const button = event.target.closest('[data-card-choice]');
      if (!button) return;
      window.selectCardForActiveRow(button.dataset.cardId || '', button.dataset.cardTitle || 'المخزون العام');
    });
    return modal;
  }

  let activePickingRow = null;

  window.addInvoiceLine = function (category, source = '', qty = '', price = '', fromModal = false, emptyCrates = 0, isDuplicate = false, afterRow = null) {
    category = categoryName(category);
    if (!CATEGORIES.includes(category)) return null;
    const body = document.getElementById('invoice-items-body');
    if (!body) return null;
    const meta = CATEGORY_META[category];
    const row = document.createElement('tr');
    row.className = `invoice-line-row ${meta.row}`;
    row.dataset.cat = category;
    row.dataset.rowId = `manual_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    row.dataset.cardId = String(source || '');
    const label = meta.label;
    const rate = document.getElementById(`rate-${category}`)?.value || DEFAULT_PRICES[category];
    const initialPrice = price !== '' && price !== null && price !== undefined ? price : rate;
    row.innerHTML = `<td class="invoice-category-cell"><div class="invoice-category-wrap"><button type="button" class="cat-label invoice-category-button" onclick="openSupplierCardModal('${category}',this.closest('tr'))" title="اضغط لاختيار كرت المورد والمزرعة"><span>${label}</span><i class="fa-solid fa-building-wheat" aria-hidden="true"></i></button><span class="selected-card-tag hidden" aria-live="polite"></span><div class="invoice-row-tools"><button type="button" class="duplicate-row-button" onclick="duplicateCategoryRow('${category}',this)" title="إضافة سطر آخر للصنف">⌄</button>${isDuplicate ? `<button type="button" class="remove-row-button" onclick="removeCategoryRow(this)" title="حذف هذا السطر">×</button>` : ''}</div></div><input type="hidden" class="invoice-source" value="${esc(source)}"></td><td class="remaining-cell"><div class="cell-box remaining-box"><span class="line-remaining">0 حبة</span></div></td><td><input type="number" min="0" step="any" inputmode="decimal" aria-label="كمية ${label}" oninput="recalcInvoiceLines()" class="qty cell-box cell-input" placeholder="الكمية" value="${esc(qty)}"></td><td><input type="number" min="0" step="any" inputmode="decimal" aria-label="سعر الحبة ${label}" oninput="recalcInvoiceLines()" class="price cell-box cell-input" value="${esc(initialPrice)}"></td><td><input type="number" min="0" step="1" inputmode="numeric" aria-label="الصناديق الفارغة لصنف ${label}" oninput="recalcInvoiceLines()" class="empty-crates cell-box cell-input" placeholder="0" value="${integer(emptyCrates) || ''}"></td>`;
    if (afterRow?.parentElement === body) afterRow.after(row); else body.appendChild(row);
    if (source) setRowSource(row, source, cardTitle(cardById(source)));
    return row;
  };

  window.initializeItemLevelInvoiceTable = function (force = false) {
    const body = document.getElementById('invoice-items-body');
    if (!body) return;
    const table = body.closest('table');
    if (!table) return;
    table.classList.add('inv-table');
    if (force || body.dataset.manualCardsReady !== '1') {
      body.innerHTML = '';
      CATEGORIES.forEach(category => window.addInvoiceLine(category));
      body.dataset.manualCardsReady = '1';
    }
    const head = table.querySelector('thead tr');
    if (head) head.innerHTML = ['الصنف (المورد / المزرعة)', 'المتبقي بالمخزن', 'الوزن / الكمية', 'سعر الحبة (ريال)', 'صناديق فاضي'].map(title => `<th>${title}</th>`).join('');
    ensureSummary(table);
    ensureSupplierModal();
    window.recalcInvoiceLines();
  };

  window.openSupplierCardModal = function (category, rowElement) {
    category = categoryName(category);
    activePickingRow = rowElement;
    if (!activePickingRow) return;
    const modal = ensureSupplierModal();
    const title = modal.querySelector('#supplier-modal-cat-name');
    const list = modal.querySelector('#supplier-cards-options-list');
    title.textContent = `الصنف: ${CATEGORY_META[category]?.label || category}`;
    const currentSource = String(rowElement.querySelector('.invoice-source')?.value || '');
    const general = generalAvailable(category, rowElement);
    const options = [`<button type="button" class="mojam-card-choice mojam-general-choice ${currentSource ? '' : 'is-selected'}" data-card-choice data-card-id="" data-card-title="المخزون العام"><span><b>المخزون العام</b><small>بدون تخصيص لكرت مورد</small></span><strong>${fmt(general)} متاح</strong></button>`];
    const cards = (window.incomingCards || incomingCards || []).filter(card => cardAvailable(card.id, category, rowElement) > 0 || String(card.id) === currentSource);
    cards.forEach(card => {
      const titleText = cardTitle(card);
      const available = cardAvailable(card.id, category, rowElement);
      options.push(`<button type="button" class="mojam-card-choice ${String(card.id) === currentSource ? 'is-selected' : ''}" data-card-choice data-card-id="${esc(card.id)}" data-card-title="${esc(titleText)}"><span><b>كرت ${esc(card.no || '—')} — ${esc(card.supplier || card.farm || 'المورد')}</b><small>المزرعة: ${esc(card.farm || '—')} · السائق: ${esc(card.driver || '—')}</small></span><strong>${fmt(available)} متاح</strong></button>`);
    });
    if (cards.length === 0 && general <= 0) options.push(`<div class="mojam-no-cards">لا توجد كروت أو أرصدة متاحة لهذا الصنف حاليًا.</div>`);
    list.innerHTML = options.join('');
    modal.classList.add('active');
    modal.querySelector('.mojam-modal-close')?.focus();
  };

  window.selectCardForActiveRow = function (cardId, title) {
    if (!activePickingRow) return;
    const card = cardId ? cardById(cardId) : null;
    setRowSource(activePickingRow, cardId, title || cardTitle(card));
    if (typeof window.showToast === 'function') window.showToast(`تم ربط الصنف بـ ${title || cardTitle(card)}`);
    window.closeSupplierCardModal();
  };

  window.closeSupplierCardModal = function () {
    document.getElementById('supplier-card-modal')?.classList.remove('active');
    activePickingRow = null;
  };

  window.duplicateCategoryRow = function (category, button) {
    const currentRow = button?.closest('tr');
    const price = document.getElementById(`rate-${category}`)?.value || DEFAULT_PRICES[category];
    const row = window.addInvoiceLine(category, '', '', price, false, 0, true, currentRow);
    row?.querySelector('.qty')?.focus();
    window.recalcInvoiceLines();
  };

  window.removeCategoryRow = function (button) {
    button?.closest('tr')?.remove();
    window.recalcInvoiceLines();
    if (typeof window.showToast === 'function') window.showToast('تم حذف السطر الإضافي');
  };

  window.removeInvoiceLine = function (rowId) {
    document.querySelector(`#invoice-items-body .invoice-line-row[data-row-id="${CSS.escape(String(rowId))}"]`)?.remove();
    window.recalcInvoiceLines();
  };

  window.recalcInvoiceLines = function () {
    let money = 0, chicken = 0, crates = 0;
    allRows().forEach(row => {
      const category = categoryName(row.dataset.cat);
      const qty = num(row.querySelector('.qty')?.value);
      const price = num(row.querySelector('.price')?.value);
      const empty = integer(row.querySelector('.empty-crates')?.value);
      const total = qty * price;
      money += total; chicken += qty; crates += empty;
      const source = String(row.querySelector('.invoice-source')?.value || '');
      const available = source ? cardAvailable(source, category, row) : aggregateAvailable(category, row);
      const remaining = row.querySelector('.line-remaining');
      if (remaining) remaining.textContent = `${fmt(Math.max(0, available - qty))} حبة`;
      const emptyInput = row.querySelector('.empty-crates');
      if (emptyInput && Number(emptyInput.value) < 0) emptyInput.value = '0';
      row.style.display = '';
    });
    const chickenElement = document.getElementById('inv-total-chicken');
    const crateElement = document.getElementById('inv-total-crates');
    const moneyElement = document.getElementById('inv-grand-total');
    if (chickenElement) chickenElement.textContent = fmt(chicken);
    if (crateElement) crateElement.textContent = fmt(crates);
    if (moneyElement) moneyElement.textContent = money.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  window.calcInvoiceRow = window.recalcInvoiceLines;

  window.applyDailyPricesToCurrentInvoice = function () {
    CATEGORIES.forEach(category => {
      const rate = document.getElementById(`rate-${category}`);
      if (rate) document.querySelectorAll(`#invoice-items-body tr[data-cat="${category}"] .price`).forEach(input => { input.value = rate.value; });
    });
    window.recalcInvoiceLines();
    if (typeof window.showToast === 'function') window.showToast('تم تطبيق أسعار البورصة على الفاتورة');
  };

  window.getActiveInvoiceData = function () {
    const items = [];
    let totalChicken = 0, emptyCratesReceived = 0;
    allRows().forEach(row => {
      const category = categoryName(row.dataset.cat);
      const qty = num(row.querySelector('.qty')?.value);
      const price = num(row.querySelector('.price')?.value);
      const emptyCrates = integer(row.querySelector('.empty-crates')?.value);
      const cardId = String(row.querySelector('.invoice-source')?.value || '');
      if (qty <= 0 && emptyCrates <= 0) return;
      totalChicken += qty; emptyCratesReceived += emptyCrates;
      const lineTotal = qty * price;
      items.push({ _rowId: row.dataset.rowId, name: category, categoryCode: ({ 'كبير': 'kabeer', 'وسط': 'wasat', 'مطاعم': 'restaurants', 'جفش': 'jafsh', 'صغير': 'saghir' })[category], qty, price, total: lineTotal.toFixed(2), lineTotal, emptyCrates, supplierCardId: cardId, cardId });
    });
    const customer = (document.getElementById('cust-name')?.value || '').trim();
    const legacy = Number.isInteger(editingInvoiceIndex) ? batchInvoices?.[editingInvoiceIndex] : null;
    const grand = num(document.getElementById('inv-grand-total')?.textContent?.replace(/,/g, ''));
    const byCategory = Object.fromEntries(CATEGORIES.map(category => [category, items.filter(item => item.name === category).reduce((sum, item) => sum + lineBoxes(item), 0)]));
    return { invoiceId: '', num: document.getElementById('inv-num')?.value || '', customer: customer || 'عميل عام', phone: (document.getElementById('cust-phone')?.value || '').trim(), type: customer ? 'آجل' : 'نقد', total: grand.toFixed(2), totalChicken, items, date: currentActiveDate || '', crates: num(legacy?.crates), capacity: num(legacy?.capacity), emptyCratesReceived, emptyCratesTotal: emptyCratesReceived, emptyCratesByCategory: byCategory, boxReceiver: legacy?.boxReceiver || '', sellerName: legacy?.sellerName || window.mojamCurrentUser?.name || '', sellerUserId: legacy?.sellerUserId || window.mojamCurrentUser?.id || '' };
  };

  function cardBalanceAtSave(cardId, category) {
    const card = cardById(cardId);
    if (!card) return null;
    return Math.max(0, stockInCard(card, category) - savedCardSales(cardId, category));
  }

  function generalBalanceAtSave(category) {
    return Math.max(0, generalStockBase(category) - savedGeneralSales(category));
  }

  window.commitInvoiceData = function (data) {
    const normalized = [];
    const cardBalances = new Map(), generalBalances = new Map();
    for (const input of data.items || []) {
      const category = categoryName(input.name);
      if (!CATEGORIES.includes(category)) continue;
      const qty = num(input.qty === '-' ? 0 : input.qty);
      const price = num(input.price === '-' ? 0 : input.price);
      const emptyCrates = integer(input.emptyCrates ?? input.empty_crates ?? input.crates);
      const cardId = String(input.supplierCardId || input.cardId || '');
      if (qty <= 0 && emptyCrates <= 0) continue;
      const card = cardId ? cardById(cardId) : null;
      if (cardId && !card) { alert(`كرت المورد المختار لصنف ${category} لم يعد موجودًا. اختر كرتًا متاحًا ثم أعد الحفظ.`); return false; }
      if (qty > 0) {
        if (cardId) {
          const key = `${category}::${cardId}`;
          if (!cardBalances.has(key)) cardBalances.set(key, cardBalanceAtSave(cardId, category));
          const available = cardBalances.get(key) || 0;
          if (qty > available + 0.000001) { alert(`الكمية المطلوبة من ${category} (${fmt(qty)}) أكبر من المتبقي في كرت ${card.no || '—'} (${fmt(available)}). خفّض الكمية أو اختر كرتًا آخر.`); return false; }
          cardBalances.set(key, Math.max(0, available - qty));
        } else {
          if (!generalBalances.has(category)) generalBalances.set(category, generalBalanceAtSave(category));
          const available = generalBalances.get(category) || 0;
          if (qty > available + 0.000001) { alert(`الرصيد العام لا يكفي لصنف ${category} (المتاح ${fmt(available)}). اختر كرت الشحنة يدويًا من اسم الصنف.`); return false; }
          generalBalances.set(category, Math.max(0, available - qty));
        }
      }
      const lineTotal = qty * price;
      const sourceLabel = card ? cardTitle(card) : 'المخزون العام';
      normalized.push({ ...input, _rowId: undefined, name: category, qty, price, total: lineTotal.toFixed(2), lineTotal, emptyCrates, supplierCardId: card ? String(card.id) : '', cardId: card ? String(card.id) : '', sourceType: card ? 'supplier-card' : 'general-stock', sourceLabel, supplier: card?.supplier || (card ? '' : 'المخزون العام'), supplierName: card?.supplier || (card ? '' : 'المخزون العام'), cardNo: card?.no || '', driver: card?.driver || '', farm: card?.farm || '', truck: card?.truck || '' });
    }
    const total = normalized.reduce((sum, item) => sum + num(item.lineTotal), 0);
    const crates = totalBoxes(normalized);
    if (!normalized.length || (total <= 0 && crates <= 0)) { alert('أدخل كمية بسعر، أو سجّل صناديق فارغة لصنف قبل حفظ الفاتورة.'); return false; }
    data.items = normalized;
    data.total = total.toFixed(2);
    data.totalChicken = normalized.reduce((sum, item) => sum + num(item.qty), 0);
    data.emptyCratesReceived = crates;
    data.emptyCratesTotal = crates;
    data.emptyCratesByCategory = Object.fromEntries(CATEGORIES.map(category => [category, normalized.filter(item => item.name === category).reduce((sum, item) => sum + lineBoxes(item), 0)]));
    data.crates = num(data.crates); data.capacity = num(data.capacity);
    data.type = data.customer && data.customer !== 'عميل عام' ? 'آجل' : 'نقد';
    const index = Number.isInteger(editingInvoiceIndex) ? editingInvoiceIndex : null;
    const old = index !== null ? batchInvoices?.[index] : null;
    if (index === null) {
      const reservation = window.mojamInvoiceNumberReservation;
      if (!reservation?.invoiceNumber || String(data.num) !== String(reservation.invoiceNumber)) {
        alert('لم يُحجز رقم فاتورة فريد بعد. تحقق من اتصال الإنترنت ثم أعد الحفظ.');
        if (typeof window.ensureUniqueInvoiceNumber === 'function') window.ensureUniqueInvoiceNumber();
        return false;
      }
      const reservedNumeric = Number(reservation.invoiceNumber);
      const duplicate = (batchInvoices || []).some((invoice, invoiceIndex) => invoiceIndex !== index && Number(invoice.num) === reservedNumeric);
      if (duplicate) {
        if (typeof window.consumeInvoiceNumberReservation === 'function') window.consumeInvoiceNumberReservation();
        if (typeof window.ensureUniqueInvoiceNumber === 'function') window.ensureUniqueInvoiceNumber(undefined, true);
        alert('ظهر رقم قديم مطابق في تكدس هذا الجهاز. حُجز رقم جديد؛ راجع الرقم الظاهر ثم احفظ مرة أخرى.');
        return false;
      }
      data.num = String(reservation.invoiceNumber);
      data.sellerName = String(reservation.sellerName || window.mojamCurrentUser?.name || 'غير مسجل');
      data.sellerUserId = String(reservation.sellerUserId || window.mojamCurrentUser?.id || '');
    } else {
      // عند التعديل يُحافظ على رقم الفاتورة المحفوظ، ولا يُستهلك رقم جديد.
      data.num = old?.num || data.num;
      data.sellerName = old?.sellerName || data.sellerName || window.mojamCurrentUser?.name || 'غير مسجل';
      data.sellerUserId = old?.sellerUserId || data.sellerUserId || window.mojamCurrentUser?.id || '';
    }
    data.invoiceId = data.invoiceId || old?.invoiceId || old?.id || `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    data.createdAt = old?.createdAt || old?.created_at || new Date().toISOString();
    if (data.customer && data.customer !== 'عميل عام' && typeof window.saveCustomerData === 'function') window.saveCustomerData(data.customer, data.phone || '');
    if (index !== null && batchInvoices?.[index]) batchInvoices[index] = data; else batchInvoices.push(data);
    localStorage.setItem(`mojam_invoices_${currentActiveDate}`, JSON.stringify(batchInvoices));
    window.lastSavedInvoiceForThermal = JSON.parse(JSON.stringify(data));
    if (typeof lastSavedInvoiceForThermal !== 'undefined') lastSavedInvoiceForThermal = window.lastSavedInvoiceForThermal;
    const retryButton = document.querySelector('.retry-last-thermal-print'); if (retryButton) retryButton.style.display = 'inline-block';
    editingInvoiceIndex = null;
    if (index === null && typeof window.consumeInvoiceNumberReservation === 'function') window.consumeInvoiceNumberReservation();
    if (typeof window.setInvoiceEditMode === 'function') window.setInvoiceEditMode(false);
    window.resetInvoiceForm((Number(data.num) || 14001) + 1);
    if (typeof window.syncSystem === 'function') window.syncSystem();
    if (typeof window.renderBatchInvoices === 'function') window.renderBatchInvoices();
    if (typeof window.showToast === 'function') window.showToast('تم حفظ الفاتورة وربط كل صنف بالكرت المحدد');
    return true;
  };

  window.editInvoice = function (index) {
    const invoice = (window.batchInvoices || batchInvoices || [])[index];
    if (!invoice) return;
    editingInvoiceIndex = index;
    const number = document.getElementById('inv-num'); if (number) number.value = invoice.num || '';
    const name = document.getElementById('cust-name'); if (name) name.value = invoice.customer === 'عميل عام' ? '' : (invoice.customer || '');
    const phone = document.getElementById('cust-phone'); if (phone) phone.value = invoice.phone || '';
    const body = document.getElementById('invoice-items-body'); if (!body) return;
    body.innerHTML = '';
    const savedItems = (invoice.items || []).filter(item => CATEGORIES.includes(categoryName(item.name)));
    const oldBoxes = integer(invoice.emptyCratesReceived ?? invoice.emptyCratesTotal ?? invoice.crates);
    const lineBoxesSaved = totalBoxes(savedItems);
    let legacyRemainder = Math.max(0, oldBoxes - lineBoxesSaved);
    if (savedItems.length) {
      savedItems.forEach((item, itemIndex) => {
        const category = categoryName(item.name);
        const legacyBoxes = itemIndex === 0 ? legacyRemainder : 0;
        window.addInvoiceLine(category, sourceIdForItem(item, invoice), num(item.qty), item.price === '-' ? '' : item.price, true, lineBoxes(item) + legacyBoxes, itemIndex > 0);
      });
    } else {
      CATEGORIES.forEach((category, itemIndex) => window.addInvoiceLine(category, '', '', undefined, false, itemIndex === 0 ? oldBoxes : 0, false));
    }
    if (typeof window.setInvoiceEditMode === 'function') window.setInvoiceEditMode(true, invoice);
    if (typeof window.navigateTo === 'function') window.navigateTo('view-invoices');
    window.recalcInvoiceLines();
  };

  window.resetInvoiceForm = function (next) {
    const number = document.getElementById('inv-num'); if (number) number.value = next || '14002';
    ['cust-name', 'cust-phone'].forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; });
    ['cust-crates', 'cust-capacity'].forEach(id => { const input = document.getElementById(id); if (input) input.value = '0'; });
    if (typeof window.setInvoiceEditMode === 'function') window.setInvoiceEditMode(false);
    window.initializeItemLevelInvoiceTable(true);
    if (typeof window.ensureUniqueInvoiceNumber === 'function') window.ensureUniqueInvoiceNumber(next);
  };

  window.generateInvoiceHTML = function (invoice) {
    const boxes = totalBoxes(invoice.items || []) || integer(invoice.emptyCratesReceived || invoice.emptyCratesTotal || invoice.crates);
    const rows = (invoice.items || []).filter(item => num(item.qty) > 0 || lineBoxes(item) > 0).map(item => {
      const card = cardById(sourceIdForItem(item, invoice));
      const source = item.sourceLabel || (card ? cardTitle(card) : 'المخزون العام');
      return `<tr><td>${esc(item.name === 'جفش' ? 'جفوش' : item.name)}</td><td>${esc(source)}</td><td>${fmt(item.qty)}</td><td>${fmt(item.price)}</td><td>${fmt(item.total)}</td><td>${fmt(lineBoxes(item))}</td></tr>`;
    }).join('');
    return `<div class="print-sheet" dir="rtl"><div style="display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:8px"><div><h2 style="font-size:18px;font-weight:900;margin:0;color:#0f766e">مكتب معجم لتسويق الدواجن</h2><p style="font-size:11px;margin:2px 0">سوق الخوم المركزي للإنتاج والتسويق</p></div><div style="text-align:left;font-family:monospace;font-size:11px"><div>النوع: <b>${esc(invoice.type || 'نقد')}</b></div><div>الرقم: <b>${esc(invoice.num || '')}</b></div><div>التاريخ: <b>${esc(invoice.date || '')}</b></div></div></div><div style="background:#f1f5f9;padding:5px 8px;margin-bottom:8px;font-size:12px;display:flex;justify-content:space-between;font-weight:bold"><span>الزبون: ${esc(invoice.customer || 'عميل عام')}</span><span>الهاتف: ${esc(invoice.phone || '—')}</span></div><table style="width:100%;border-collapse:collapse;text-align:center;font-size:10px;border:1px solid #000"><thead><tr style="background:#e2e8f0"><th>الصنف</th><th>المورد / السائق / الكرت</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>صناديق فارغة</th></tr></thead><tbody>${rows}</tbody><tfoot><tr style="background:#fef3c7;font-weight:bold"><td colspan="5">المجموع الكلي</td><td>${fmt(invoice.total)} ريال</td></tr></tfoot></table><div style="margin-top:6px;font-size:10px;font-weight:bold">إجمالي الصناديق الفارغة: ${fmt(boxes)}</div><div style="display:flex;justify-content:space-between;margin-top:18px;font-size:10px;font-weight:bold"><span>توقيع المستلم: ........</span><span>ختم المحل</span><span>البائع: ${esc(invoice.sellerName || 'غير مسجل')}</span></div></div>`;
  };

  window.thermalInvoiceMarkup = function (invoice) {
    const boxes = totalBoxes(invoice.items || []) || integer(invoice.emptyCratesReceived || invoice.emptyCratesTotal || invoice.crates);
    const dots = Number(localStorage.getItem('printer_width') || localStorage.getItem('mojam_printer_width') || 576) === 384 ? 384 : 576;
    const narrow = dots === 384;
    const bodySize = narrow ? 22 : 29;
    const titleSize = narrow ? 19 : 23;
    const metaSize = narrow ? 23 : 29;
    const numberSize = narrow ? 30 : 40;
    const tableSize = narrow ? 22 : 28;
    const headerSize = narrow ? 19 : 24;
    const amountSize = narrow ? 30 : 40;
    const signatureSize = narrow ? 19 : 24;
    const cellPadding = narrow ? 9 : 12;
    const rows = (invoice.items || []).filter(item => num(item.qty) > 0 || lineBoxes(item) > 0).map(item => {
      const cell = `padding:${cellPadding}px 2px;border:2px solid #000;vertical-align:middle`;
      const numeric = `${cell};font-family:Arial,sans-serif;font-size:${tableSize}px;font-weight:900;line-height:1.2`;
      return `<tr><td style="${cell};font-size:${tableSize}px;font-weight:900;line-height:1.3;overflow-wrap:anywhere">${esc(item.name === 'جفش' ? 'جفوش' : item.name)}</td><td dir="ltr" style="${numeric}">${fmt(item.qty)}</td><td dir="ltr" style="${numeric}">${fmt(item.price)}</td><td dir="ltr" style="${numeric}">${fmt(item.total)}</td><td dir="ltr" style="${numeric}">${fmt(lineBoxes(item))}</td></tr>`;
    }).join('');
    const brandSize = narrow ? 25 : 32;
    const addressSize = narrow ? 18 : 22;
    const phoneSize = narrow ? 17 : 21;
    const headingPadding = narrow ? 11 : 13;
    const mastFont = addressSize;
    const contactFont = phoneSize;
    const officeFont = narrow ? 24 : 30;
    const noteFont = narrow ? 18 : 22;
    const signatureLabelFont = narrow ? 15 : 19;
    const signatureValueFont = narrow ? 13 : 17;
    return `<article dir="rtl" lang="ar" style="width:100%;box-sizing:border-box;margin:0;padding:0 2px;color:#000;font-family:Arial,Tahoma,sans-serif;font-size:${bodySize}px;font-weight:900;line-height:1.45;overflow-wrap:anywhere">
      <header style="border-bottom:4px solid #000;padding:0 0 10px;margin:0 0 12px;text-align:center">
        <div dir="rtl" style="display:flex;justify-content:flex-start;margin-bottom:4px"><span style="font-size:${titleSize}px;font-weight:900;line-height:1.2">زوع</span></div>
        <div style="display:grid;grid-template-columns:1fr 1.1fr 1fr;gap:2px;align-items:center;direction:ltr;width:100%">
          <div dir="rtl" style="text-align:center;font-size:${mastFont}px;font-weight:900;line-height:1.65;overflow-wrap:anywhere"><div>الجمهورية اليمنية</div><div>محافظة البيضاء</div><div>سوق الحوم المركزي</div></div>
          <div dir="rtl" style="text-align:center;min-width:0"><img src="/mojam-logo.svg" alt="شعار مكتب معجم" style="display:block;width:${narrow ? 92 : 122}px;height:auto;max-width:100%;margin:0 auto"></div>
          <div dir="ltr" style="text-align:center;font-family:Arial,sans-serif;font-size:${contactFont}px;font-weight:900;line-height:1.8;overflow-wrap:anywhere"><div>733436682</div><div>737980235</div><div>736014373</div><div>735429057</div></div>
        </div>
        <div style="font-size:${officeFont}px;font-weight:900;line-height:1.2;margin-top:5px">مكتب معجم</div>
        <div style="font-size:${brandSize}px;font-weight:900;line-height:1.25">لتسويق الدواجن</div>
      </header>
      <section style="border:3px solid #000;padding:10px;margin-bottom:12px;font-size:${metaSize}px;font-weight:900;line-height:1.65"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span>رقم الفاتورة</span><b dir="ltr" style="font-size:${numberSize}px;font-family:Arial,sans-serif">${esc(invoice.num || '')}</b></div><div>التاريخ: ${esc(invoice.date || '—')}</div><div>العميل: ${esc(invoice.customer || 'مبيعات نقداً')}</div><div>الهاتف: <span dir="ltr">${esc(invoice.phone || '—')}</span></div></section>
      <table style="width:100%;table-layout:fixed;border-collapse:collapse;border:3px solid #000;text-align:center;font-size:${tableSize}px;font-weight:900"><colgroup><col style="width:23%"><col style="width:18%"><col style="width:18%"><col style="width:23%"><col style="width:18%"></colgroup><thead style="vertical-align:middle"><tr style="background:#e5e7eb"><th style="padding:${headingPadding}px 2px;border:2px solid #000;font-size:${headerSize}px;font-weight:900;line-height:1.2">الصنف</th><th style="padding:${headingPadding}px 1px;border:2px solid #000;font-size:${headerSize}px;font-weight:900;line-height:1.2">كمية</th><th style="padding:${headingPadding}px 1px;border:2px solid #000;font-size:${headerSize}px;font-weight:900;line-height:1.2">سعر</th><th style="padding:${headingPadding}px 1px;border:2px solid #000;font-size:${headerSize}px;font-weight:900;line-height:1.2">إجمالي</th><th style="padding:${headingPadding}px 1px;border:2px solid #000;font-size:${headerSize}px;font-weight:900;line-height:1.2">شبوك</th></tr></thead><tbody>${rows}</tbody></table>
      <section style="text-align:center;border:3px solid #000;margin-top:12px;padding:10px;font-size:${metaSize}px;font-weight:900">المجموع الكلي<br><b dir="ltr" style="display:inline-block;font-size:${amountSize}px;font-family:Arial,sans-serif;font-weight:900">${fmt(invoice.total)} ريال</b><div style="margin-top:7px">الشبوك الفاضي: <b dir="ltr" style="font-size:${numberSize}px">${fmt(boxes)}</b></div></section>
      <footer style="margin-top:14px;padding-top:10px;font-size:${signatureSize}px;font-weight:900;line-height:1.6">
        <div style="text-align:center;font-size:${narrow ? 22 : 28}px;font-weight:900;margin:0 0 12px">شكراً لتعاملكم معنا</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;direction:ltr;text-align:center">
          <div dir="rtl" style="border-top:2px solid #000;padding-top:5px;font-size:${signatureLabelFont}px">توقيع المستلم</div>
          <div dir="rtl" style="border-top:2px solid #000;padding-top:5px;font-size:${signatureLabelFont}px">البائع<div style="font-size:${signatureValueFont}px;line-height:1.35">${esc(invoice.sellerName || 'غير مسجل')}</div></div>
          <div dir="rtl" style="border-top:2px solid #000;padding-top:5px;font-size:${signatureLabelFont}px">الختم</div>
        </div>
        <div style="border-top:3px solid #000;margin-top:12px;padding-top:8px;text-align:center;font-size:${signatureLabelFont}px;font-weight:900">تنويه هام</div>
        <div style="border-top:2px solid #000;margin-top:5px;padding-top:7px;font-size:${noteFont}px;font-weight:900;line-height:1.55;text-align:center">
          <div>١- البضاعة لا ترد ولا تستبدل.</div>
          <div style="margin-top:4px">٢- الزبون يتحمل مسؤولية ضياع أو إتلاف الشبوك.</div>
          <div style="margin-top:4px">٣- الفاتورة صحيحة 100٪ إذا لم يردنا اعتراض عليها خلال 24 ساعة من تاريخ إصدارها ومراجعتها. شاكرين تعاونكم.</div>
        </div>
        <div style="border-bottom:3px solid #000;margin-top:8px"></div>
      </footer>
    </article>`;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => {
    window.initializeItemLevelInvoiceTable();
    document.addEventListener('keydown', event => { if (event.key === 'Escape') window.closeSupplierCardModal(); });
  }, { once: true });
  else window.initializeItemLevelInvoiceTable();
})();
