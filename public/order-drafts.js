(function () {
  const modal = () => document.getElementById('orderDraftsModal');
  const backdrop = () => document.getElementById('orderDraftsBackdrop');
  const list = () => document.getElementById('orderDraftsList');

  function notify(message, type) {
    if (typeof window.showSmsToast === 'function') window.showSmsToast(message, type || 'info');
    else if (typeof window.showToast === 'function') window.showToast(message);
    else window.alert(message);
  }

  function showModal() {
    backdrop()?.classList.remove('hidden');
    const el = modal();
    if (el) { el.classList.remove('hidden'); el.classList.add('flex'); }
  }

  window.closeOrderDrafts = function () {
    backdrop()?.classList.add('hidden');
    const el = modal();
    if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
  };

  function makeText(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = String(value || '');
    return el;
  }

  function renderDrafts(drafts) {
    const box = list();
    if (!box) return;
    box.replaceChildren();
    if (!drafts.length) {
      box.appendChild(makeText('p', 'text-center text-sm text-slate-500 py-8', 'لا توجد مسودات طلبات حالياً.'));
      return;
    }
    for (const draft of drafts) {
      const card = document.createElement('article');
      card.className = 'border border-slate-200 rounded-xl p-3 space-y-2 bg-white';
      const header = document.createElement('div');
      header.className = 'flex items-start justify-between gap-2';
      const who = document.createElement('div');
      who.appendChild(makeText('strong', 'block text-sm text-slate-900', draft.customer_name || draft.phone_normalized || 'عميل غير مطابق'));
      who.appendChild(makeText('small', 'block text-[10px] text-slate-500 font-mono mt-1', draft.phone_normalized || ''));
      const statusLabel = draft.status === 'needs_clarification' ? 'تحتاج توضيحاً' : 'مسودة للمراجعة';
      header.append(who, makeText('span', 'shrink-0 rounded-full bg-amber-50 text-amber-800 px-2 py-1 text-[10px] font-bold', statusLabel));
      card.appendChild(header);

      const items = Array.isArray(draft.items) ? draft.items : [];
      if (items.length) {
        const itemBox = document.createElement('div');
        itemBox.className = 'space-y-1';
        for (const item of items) {
          const quantity = Number(item.quantity) > 0 ? Number(item.quantity).toLocaleString('en-US') : 'كمية غير محددة';
          const category = item.category || 'صنف غير محدد';
          const unit = item.unit || 'وحدة غير محددة';
          itemBox.appendChild(makeText('p', 'text-xs text-slate-800 bg-slate-50 rounded-lg p-2', `${quantity} ${unit} — ${category}`));
        }
        card.appendChild(itemBox);
      } else {
        card.appendChild(makeText('p', 'text-xs text-amber-800 bg-amber-50 rounded-lg p-2', 'لم تُستخرج تفاصيل كافية للصنف والكمية.'));
      }

      if (draft.clarification_question) {
        const clarification = document.createElement('div');
        clarification.className = 'rounded-lg border border-blue-100 bg-blue-50 p-2';
        clarification.appendChild(makeText('strong', 'block text-[10px] text-blue-800 mb-1', 'سؤال توضيحي مقترح — لا يُرسل تلقائياً'));
        clarification.appendChild(makeText('p', 'text-xs text-blue-900', draft.clarification_question));
        card.appendChild(clarification);
      }
      if (draft.original_message) {
        const original = document.createElement('p');
        original.className = 'text-[11px] text-slate-500 border-t border-slate-100 pt-2';
        original.appendChild(makeText('span', 'font-bold', 'رسالة العميل: '));
        original.appendChild(document.createTextNode(String(draft.original_message)));
        card.appendChild(original);
      }
      const time = draft.created_at && typeof window.formatTimestamp === 'function' ? window.formatTimestamp(draft.created_at) : '';
      if (time) card.appendChild(makeText('time', 'block text-[10px] text-slate-400', time));
      card.appendChild(makeText('p', 'text-[10px] font-bold text-slate-500', 'لم يتم حجز مخزون أو إرسال تأكيد للعميل.'));
      box.appendChild(card);
    }
  }

  window.openOrderDrafts = async function () {
    showModal();
    const box = list();
    if (box) box.replaceChildren(makeText('p', 'text-center text-sm text-slate-500 py-8', 'جارٍ تحميل المسودات…'));
    try {
      if (typeof window.apiWithSession !== 'function') throw new Error('تعذر الاتصال بجلسة التطبيق.');
      const response = await window.apiWithSession('/api/orders/drafts?status=open&limit=50');
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) throw new Error(result.message || result.error || 'تعذر جلب مسودات الطلبات.');
      renderDrafts(Array.isArray(result.drafts) ? result.drafts : (Array.isArray(result.data) ? result.data : []));
    } catch (error) {
      if (box) box.replaceChildren(makeText('p', 'text-center text-sm text-red-600 py-8', error.message || 'تعذر تحميل المسودات.'));
    }
  };

  window.analyzeCurrentOrderDraft = async function () {
    const message = typeof selectedChatMessage !== 'undefined' ? selectedChatMessage : null;
    const phone = typeof selectedChatPhone !== 'undefined' ? selectedChatPhone : '';
    const button = document.getElementById('btnAnalyzeOrder');
    if (!message || !(message.body || message.message) || !phone) {
      notify('افتح محادثة واختر رسالة واردة أولاً لتحليلها كطلب.', 'warning');
      return;
    }
    if (message.direction && message.direction !== 'inbound') {
      notify('اختر رسالة العميل الواردة، وليس رسالة المكتب الصادرة.', 'warning');
      return;
    }
    const originalText = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'جارٍ تحليل الطلب…'; }
    try {
      if (typeof window.apiWithSession !== 'function') throw new Error('تعذر الاتصال بجلسة التطبيق.');
      const sourceMessageId = message.external_key || message.id || message._id || message.date || '';
      const response = await window.apiWithSession('/api/orders/drafts', {
        method: 'POST',
        body: JSON.stringify({
          phone,
          message: message.body || message.message,
          sourceMessageId: String(sourceMessageId)
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) throw new Error(result.message || result.error || 'تعذر تحليل الطلب.');
      if (!result.orderDetected || !result.draft) {
        notify('لم أتعرف على طلب شراء في هذه الرسالة؛ لم تُحفظ مسودة.', 'info');
        return;
      }
      notify(result.duplicate ? 'هذه الرسالة محللة مسبقاً؛ تعرض المسودة الحالية.' : 'حُفظ الطلب كمسودة للمراجعة فقط.', 'success');
      await window.openOrderDrafts();
    } catch (error) {
      notify(error.message || 'تعذر تحليل الطلب الآن؛ لم يتم أي حجز أو إرسال.', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = originalText || 'تحليل الطلب كمسودة'; }
    }
  };
})();
