/* ====================================================
   CASHFLOW FORMS — COMPANY & CONTRACTOR
   ── القراءة والكتابة كلاهما عبر Apps Script ──
   ==================================================== */

/* ── URLs للسكريبتين ── */
const COMPANY_CF_SCRIPT_URL    = "https://script.google.com/macros/s/AKfycbwxGZAjYPvB8UYlfWY1GsZsSr3AMZgqOwivT2ejXgO0Fu5zQAvqvrDLH_xinoaCnUHv/exec";
const CONTRACTOR_CF_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyYba6oLvdJDgripNMmazO0hTiq12wK8jxoRdjoZj2Pq8CVUDKYuV8SwGPBmv24U3jI9g/exec";

/* ── حالة التعديل ── */
let _ccfEditingRow  = null;   // null = إضافة جديدة
let _concfEditingRow = null;

/* ====================================================
   أداة جلب البيانات — عبر Apps Script (GET) فقط
   لا كاش محلي — كل طلب يجلب أحدث نسخة من الشيت
   ==================================================== */

/**
 * جلب كل الصفوف من شيت معين عبر Apps Script GET
 * @param {string} scriptUrl  - رابط Web App الخاص بالشيت
 * @returns {{ headers: string[], rows: object[] }}
 */
async function _cfFetchRows(scriptUrl) {
    const url = scriptUrl + '?action=getRows&t=' + Date.now(); // cache-bust
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const json = await r.json();
    if (json.status !== 'success') throw new Error(json.message || 'fetch error');
    return json.data; // { headers, rows }
}

/* ── استخراج آخر رقم مستخلص وإرجاع التالي ── */
function _cfNextStatementNo(rows, colName) {
    const key = colName || (rows[0] ? Object.keys(rows[0]).find(k => !k.startsWith('__')) : '');
    let maxNum = 0;
    let lastVal = '';
    rows.forEach(row => {
        const v = String(row[key] || '').trim();
        if (!v) return;
        const n = parseInt(v.replace(/\D/g, '')) || 0;
        if (n > maxNum) { maxNum = n; lastVal = v; }
    });
    if (!maxNum) return '001';
    const nextNum = maxNum + 1;
    if (/^\d+$/.test(lastVal)) return String(nextNum).padStart(lastVal.length, '0');
    return String(nextNum).padStart(3, '0');
}

/* ====================================================
   COMPANY CASHFLOW FORM
   ==================================================== */

async function openCompanyCashflowForm() {
    openModal('companyCashflowModal');
    _ccfEditingRow = null;
    ccfSetMode('new');
    ccfReset(true);
    await ccfRefreshStatementNo();
}

function closeCompanyCashflowForm() {
    closeModal('companyCashflowModal');
}

function ccfSetMode(mode) {
    const btn    = document.getElementById('ccf_submit_btn');
    const badges = document.querySelectorAll('#companyCashflowModal .cf-form-mode-badge');
    if (mode === 'edit') {
        badges.forEach(b => b.style.display = 'flex');
        if (btn) {
            btn.textContent = '💾 حفظ التعديلات';
            btn.style.background = 'linear-gradient(135deg,#f5c842,#e8a800)';
            btn.style.color = '#1a0a2e';
        }
    } else {
        badges.forEach(b => b.style.display = 'none');
        if (btn) {
            btn.textContent = '💾 حفظ في السجل';
            btn.style.background = 'linear-gradient(135deg,#2196f3,#1565c0)';
            btn.style.color = 'white';
        }
    }
}

function ccfLoadRowForEdit(rowJson) {
    const row = (typeof rowJson === 'string') ? JSON.parse(rowJson) : rowJson;
    _ccfEditingRow = row;
    ccfSetMode('edit');
    const keys = Object.keys(row).filter(k => !k.startsWith('__'));

    // رقم المستخلص
    const noKey = keys[0];
    document.getElementById('ccf_statement_no').value = row[noKey] || '';

    // التاريخ
    const dateKey = keys.find(k => /date|تاريخ/i.test(k)) || keys[1] || '';
    document.getElementById('ccf_date').value = row[dateKey] || '';

    // القيمة
    const amtKey = keys.find(k => /amount|قيمة|مبلغ/i.test(k));
    if (amtKey) document.getElementById('ccf_amount').value = String(row[amtKey] || '').replace(/,/g, '');

    // الحالة
    const statusKey = keys.find(k => /status|حالة/i.test(k));
    if (statusKey) {
        const sel = document.getElementById('ccf_status');
        if (sel) {
            const v   = row[statusKey] || 'مدفوع';
            const opt = [...sel.options].find(o => o.value === v || o.textContent.trim() === v);
            sel.value = opt ? opt.value : 'مدفوع';
        }
    }

    // الملاحظات
    const notesKey = keys.find(k => /notes|ملاحظ/i.test(k));
    if (notesKey) document.getElementById('ccf_notes').value = row[notesKey] || '';

    ccfUpdatePreview();
    const hist = document.getElementById('ccf_history_panel');
    if (hist) hist.style.display = 'none';
    showAlert('✏️ تم تحميل المستخلص للتعديل', 'success');
}

function ccfBuildHistory(rows) {
    const panel = document.getElementById('ccf_history_panel');
    const list  = document.getElementById('ccf_history_list');
    if (!panel || !list) return;

    if (!rows || !rows.length) {
        list.innerHTML = '<div style="padding:12px 14px;text-align:center;color:rgba(255,255,255,0.35);font-size:12px;font-family:Cairo,sans-serif;">لا توجد مستخلصات سابقة</div>';
        panel.style.display = 'block';
        return;
    }

    const keys   = Object.keys(rows[0]).filter(k => !k.startsWith('__'));
    const amtKey = keys.find(k => /amount|قيمة|مبلغ/i.test(k)) || keys[2];

    list.innerHTML = rows.slice().reverse().map((row, i) => {
        const num  = row[keys[0]] || '-';
        const date = row[keys[1]] || '-';
        const amt  = amtKey ? (row[amtKey] || '-') : '-';
        const bg   = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
        return `<div onclick="ccfLoadRowForEdit(${JSON.stringify(row).replace(/"/g, '&quot;')})"
            style="display:flex;align-items:center;justify-content:space-between;gap:8px;
                   padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);
                   background:${bg};transition:background 0.15s;"
            onmouseover="this.style.background='rgba(33,150,243,0.12)'"
            onmouseout="this.style.background='${bg}'">
            <span style="font-size:12px;font-weight:700;color:#5baddf;font-family:'Cairo',sans-serif;">${num}</span>
            <span style="font-size:11px;color:rgba(255,255,255,0.5);font-family:'Cairo',sans-serif;">${date}</span>
            <span style="font-size:12px;font-weight:700;color:#f5c842;font-family:'Cairo',sans-serif;">${parseFloat(String(amt).replace(/,/g, '')) || amt}</span>
            <span style="font-size:10px;color:rgba(33,150,243,0.8);font-family:'Cairo',sans-serif;">تعديل ✎</span>
        </div>`;
    }).join('');
    panel.style.display = 'block';
}

async function ccfOpenHistory() {
    const panel = document.getElementById('ccf_history_panel');
    const list  = document.getElementById('ccf_history_list');
    if (!panel || !list) return;

    // إن كان السجل ظاهراً أغلقه
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        return;
    }

    // اجلب أحدث بيانات دائماً (بدون كاش)
    list.innerHTML = '<div style="padding:12px 14px;text-align:center;color:rgba(255,255,255,0.4);font-size:12px;font-family:Cairo,sans-serif;">⏳ جاري التحميل...</div>';
    panel.style.display = 'block';
    try {
        const { rows } = await _cfFetchRows(COMPANY_CF_SCRIPT_URL);
        ccfBuildHistory(rows);
    } catch (e) {
        list.innerHTML = '<div style="padding:12px 14px;text-align:center;color:#ff8a80;font-size:12px;">❌ تعذر التحميل</div>';
    }
}

function ccfReset(keepDate = false) {
    document.getElementById('ccf_amount').value  = '';
    document.getElementById('ccf_status').value  = 'مدفوع';
    document.getElementById('ccf_notes').value   = '';
    if (!keepDate) {
        document.getElementById('ccf_date').value = new Date().toISOString().split('T')[0];
    }
    document.getElementById('ccf_preview').style.display = 'none';
    ccfHideFeedback();
    _ccfEditingRow = null;
    ccfSetMode('new');
}

async function ccfRefreshStatementNo() {
    const inp = document.getElementById('ccf_statement_no');
    if (!inp) return;
    inp.value       = '';
    inp.placeholder = '⏳ جاري الجلب...';
    try {
        const { rows } = await _cfFetchRows(COMPANY_CF_SCRIPT_URL);
        const firstKey  = rows[0] ? Object.keys(rows[0]).find(k => !k.startsWith('__')) : '';
        const next      = _cfNextStatementNo(rows, firstKey);
        inp.value            = next;
        inp.style.borderColor = 'rgba(245,200,66,0.6)';
        inp.placeholder      = '';
        inp.title            = 'رقم تلقائي — للعرض فقط';
        ccfBuildHistory(rows);
    } catch (e) {
        console.warn('ccfRefreshStatementNo error:', e.message);
        inp.placeholder = 'مثال: 001';
        inp.value       = '';
    }
}

/* زرار تحديث يدوي */
async function ccfForceRefresh() {
    await ccfRefreshStatementNo();
    showAlert('✅ تم تحديث البيانات', 'success');
}

function ccfUpdatePreview() {
    const amt     = parseFloat(document.getElementById('ccf_amount').value) || 0;
    const preview = document.getElementById('ccf_preview');
    const prevAmt = document.getElementById('ccf_preview_amount');
    if (amt > 0) {
        preview.style.display = 'block';
        prevAmt.textContent   = amt.toLocaleString('en-US', { maximumFractionDigits: 2 });
    } else {
        preview.style.display = 'none';
    }
}

function ccfShowFeedback(msg, type) {
    const fb = document.getElementById('ccf_feedback');
    const styles = {
        success: { bg: 'rgba(39,174,106,0.15)',  border: '1px solid rgba(39,174,106,0.4)',  color: '#5cc890' },
        loading: { bg: 'rgba(245,200,66,0.1)',   border: '1px solid rgba(245,200,66,0.3)',  color: '#f5c842' },
        error:   { bg: 'rgba(244,67,54,0.15)',   border: '1px solid rgba(244,67,54,0.4)',   color: '#ff8a80' },
    };
    const s = styles[type] || styles.error;
    fb.style.display    = 'block';
    fb.style.background = s.bg;
    fb.style.border     = s.border;
    fb.style.color      = s.color;
    fb.textContent      = msg;
    if (type === 'success') setTimeout(() => ccfHideFeedback(), 4000);
}

function ccfHideFeedback() {
    const fb = document.getElementById('ccf_feedback');
    if (fb) fb.style.display = 'none';
}

async function ccfSubmit() {
    ccfHideFeedback();
    const statement_no = document.getElementById('ccf_statement_no').value.trim();
    const date         = document.getElementById('ccf_date').value.trim();
    const amount       = parseFloat(document.getElementById('ccf_amount').value) || 0;
    const status       = document.getElementById('ccf_status').value.trim();
    const notes        = document.getElementById('ccf_notes').value.trim();
    const isEdit       = !!_ccfEditingRow;

    if (!statement_no)         { ccfShowFeedback('❌ رقم المستخلص غير موجود', 'error'); return; }
    if (!date)                 { ccfShowFeedback('❌ يرجى اختيار التاريخ', 'error'); return; }
    if (!amount || amount <= 0){ ccfShowFeedback('❌ يرجى إدخال قيمة المستخلص', 'error'); return; }

    const btn = document.getElementById('ccf_submit_btn');
    btn.disabled    = true;
    btn.textContent = '⏳ جاري الحفظ...';
    ccfShowFeedback('⏳ جاري إرسال البيانات...', 'loading');

    const rowIndex = isEdit ? (_ccfEditingRow['__rowIndex'] || null) : null;

    try {
        const r = await fetch(COMPANY_CF_SCRIPT_URL, {
            method:   'POST',
            headers:  { 'Content-Type': 'text/plain' },
            body:     JSON.stringify({ action: isEdit ? 'update' : 'insert', rowIndex, statement_no, date, amount, status, notes }),
            redirect: 'follow',
        });
        const text = await r.text();
        let resp = {};
        try { resp = JSON.parse(text); } catch (_) {}

        if (resp.status === 'success' || r.ok) {
            const msg = isEdit ? '✅ تم تحديث المستخلص في سجل الشركة!' : '✅ تم حفظ المستخلص في سجل الشركة!';
            ccfShowFeedback(msg, 'success');
            showAlert(msg, 'success');

            // انتظر 4 ثواني عشان الشيت يتحدث ثم اجلب أحدث بيانات
            setTimeout(async () => {
                ccfSetMode('new');
                document.getElementById('ccf_amount').value          = '';
                document.getElementById('ccf_status').value          = 'مدفوع';
                document.getElementById('ccf_notes').value           = '';
                document.getElementById('ccf_preview').style.display = 'none';
                document.getElementById('ccf_date').value            = new Date().toISOString().split('T')[0];
                ccfHideFeedback();
                _ccfEditingRow = null;
                await ccfRefreshStatementNo(); // يجلب أحدث بيانات بدون كاش
            }, 4000);
        } else {
            throw new Error(resp.message || 'فشل الحفظ');
        }
    } catch (e) {
        console.error('Company CF submit error:', e);
        ccfShowFeedback('❌ تعذر الحفظ: ' + (e.message || 'خطأ في الاتصال'), 'error');
    } finally {
        btn.disabled    = false;
        btn.textContent = isEdit ? '💾 حفظ التعديلات' : '💾 حفظ في السجل';
    }
}

/* ====================================================
   CONTRACTOR CASHFLOW FORM
   ==================================================== */

async function openContractorCashflowForm() {
    openModal('contractorCashflowModal');
    _concfEditingRow = null;
    concfSetMode('new');
    concfPopulateContractors();
    concfReset(true);

    // إخفاء خانة رقم المستخلص حتى يختار المقاول
    const noWrap = document.getElementById('concf_statement_no_wrap');
    if (noWrap) noWrap.style.display = 'none';
}

function closeContractorCashflowForm() {
    closeModal('contractorCashflowModal');
}

function concfPopulateContractors() {
    const sel        = document.getElementById('concf_contractor_select');
    const currentVal = sel.value;
    sel.innerHTML    = '<option value="">-- اختر من القائمة --</option>';

    const contractors = new Set();
    Object.values(allData || {}).forEach(sheetData => {
        Object.values(sheetData).forEach(row => {
            const c = (row['CONTRACTOR'] || '').trim();
            if (c) contractors.add(c);
        });
    });
    Object.keys(contractorMap || {}).forEach(name => {
        if (name.trim()) contractors.add(name.trim());
    });

    [...contractors].sort((a, b) => a.localeCompare(b, 'ar')).forEach(name => {
        const opt      = document.createElement('option');
        opt.value      = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
}

async function concfSyncContractor(val) {
    document.getElementById('concf_contractor').value = val;
    const noWrap = document.getElementById('concf_statement_no_wrap');
    const inp    = document.getElementById('concf_statement_no');

    if (!val) {
        if (noWrap) noWrap.style.display = 'none';
        if (inp) inp.value = '';
        const hist = document.getElementById('concf_history_panel');
        if (hist) hist.style.display = 'none';
        return;
    }

    if (noWrap) noWrap.style.display = 'block';
    if (inp) { inp.value = ''; inp.placeholder = '⏳ جاري الجلب...'; }

    try {
        // جلب أحدث بيانات بدون كاش
        const { rows } = await _cfFetchRows(CONTRACTOR_CF_SCRIPT_URL);

        const keys = Object.keys(rows[0] || {}).filter(k => !k.startsWith('__'));
        const cKey  = keys.find(k => /contractor|مقاول/i.test(k)) || '';
        const noKey = keys[0] || '';

        const contractorRows = rows.filter(r => (r[cKey] || '').trim() === val.trim());
        const next           = _cfNextStatementNo(contractorRows, noKey);

        if (inp) {
            inp.value            = next;
            inp.style.borderColor = 'rgba(245,200,66,0.6)';
            inp.placeholder      = '';
            inp.title            = 'آخر مستخلص للمقاول ' + val + ' + 1';
        }
        concfBuildHistory(rows, val);
    } catch (e) {
        console.warn('concfSyncContractor error:', e.message);
        if (inp) inp.placeholder = 'مثال: 001';
    }
}

function concfSyncContractorText(val) {
    document.getElementById('concf_contractor').value = val;
}

function concfSetMode(mode) {
    const btn   = document.getElementById('concf_submit_btn');
    const badge = document.getElementById('concf_edit_badge');
    if (mode === 'edit') {
        if (btn)   { btn.textContent = '💾 حفظ التعديلات'; btn.style.background = 'linear-gradient(135deg,#2196f3,#1565c0)'; btn.style.color = 'white'; }
        if (badge) badge.style.display = 'flex';
    } else {
        if (btn)   { btn.textContent = '💾 حفظ في السجل'; btn.style.background = 'linear-gradient(135deg,#f5c842,#e8a800)'; btn.style.color = '#1a0a2e'; }
        if (badge) badge.style.display = 'none';
    }
}

function concfLoadRowForEdit(rowJson) {
    const row  = (typeof rowJson === 'string') ? JSON.parse(rowJson) : rowJson;
    _concfEditingRow = row;
    concfSetMode('edit');

    const keys     = Object.keys(row).filter(k => !k.startsWith('__'));
    const cKey     = keys.find(k => /contractor|مقاول/i.test(k))     || keys[0];
    const noKey    = keys.find(k => /statement|مستخلص|رقم/i.test(k)) || keys[1];
    const dateKey  = keys.find(k => /date|تاريخ/i.test(k))           || keys[2];
    const totalKey = keys.find(k => /total|إجمالي|مستحق/i.test(k));
    const spentKey = keys.find(k => /spent|مصروف|مدفوع|منصرف/i.test(k));
    const notesKey = keys.find(k => /notes|ملاحظ/i.test(k));

    // المقاول
    const cVal = row[cKey] || '';
    const sel  = document.getElementById('concf_contractor_select');
    if (sel) {
        const existing = [...sel.options].find(o => o.value === cVal.trim());
        if (!existing && cVal) {
            const opt      = document.createElement('option');
            opt.value      = cVal;
            opt.textContent = cVal;
            sel.appendChild(opt);
        }
        sel.value = cVal.trim();
    }
    document.getElementById('concf_contractor').value = cVal;

    // رقم المستخلص
    const noWrap = document.getElementById('concf_statement_no_wrap');
    if (noWrap) noWrap.style.display = 'block';
    const noInp = document.getElementById('concf_statement_no');
    if (noInp) {
        noInp.value            = row[noKey] || '';
        noInp.style.borderColor = 'rgba(245,200,66,0.6)';
    }

    // التاريخ
    document.getElementById('concf_date').value = row[dateKey] || '';

    // المستحق صرفه
    if (totalKey) document.getElementById('concf_total').value = String(row[totalKey] || '').replace(/,/g, '');

    // المنصرف سابقاً
    if (spentKey) document.getElementById('concf_spent').value = String(row[spentKey] || '').replace(/,/g, '');

    // الملاحظات
    if (notesKey) document.getElementById('concf_notes').value = row[notesKey] || '';

    concfUpdatePreview();
    const hist = document.getElementById('concf_history_panel');
    if (hist) hist.style.display = 'none';
    showAlert('✏️ تم تحميل مستخلص المقاول للتعديل', 'success');
}

function concfBuildHistory(rows, filterContractor) {
    const panel = document.getElementById('concf_history_panel');
    const list  = document.getElementById('concf_history_list');
    if (!panel || !list) return;

    let displayRows = rows.slice();
    if (filterContractor) {
        const cKey  = Object.keys(rows[0] || {}).find(k => /contractor|مقاول/i.test(k)) || '';
        displayRows = rows.filter(r => (r[cKey] || '').trim() === filterContractor.trim());
    }
    if (!displayRows.length) { panel.style.display = 'none'; return; }

    const keys     = Object.keys(displayRows[0]).filter(k => !k.startsWith('__'));
    const noKey    = keys.find(k => /statement|مستخلص|رقم/i.test(k)) || keys[0];
    const dateKey  = keys.find(k => /date|تاريخ/i.test(k))           || keys[1];
    const totalKey = keys.find(k => /total|إجمالي/i.test(k));
    const cKey     = keys.find(k => /contractor|مقاول/i.test(k));

    list.innerHTML = displayRows.slice().reverse().map((row, i) => {
        const num  = row[noKey]   || '-';
        const date = row[dateKey] || '-';
        const tot  = totalKey ? row[totalKey] : '-';
        const con  = cKey ? row[cKey] : '';
        const bg   = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
        return `<div onclick="concfLoadRowForEdit(${JSON.stringify(row).replace(/"/g, '&quot;')})"
            style="display:flex;align-items:center;justify-content:space-between;gap:8px;
                   padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);
                   background:${bg};transition:background 0.15s;"
            onmouseover="this.style.background='rgba(245,200,66,0.1)'"
            onmouseout="this.style.background='${bg}'">
            <span style="font-size:12px;font-weight:700;color:#f5c842;font-family:'Cairo',sans-serif;">${num}</span>
            ${!filterContractor && con ? `<span style="font-size:10px;color:rgba(255,255,255,0.5);font-family:'Cairo',sans-serif;">${con}</span>` : ''}
            <span style="font-size:11px;color:rgba(255,255,255,0.5);font-family:'Cairo',sans-serif;">${date}</span>
            <span style="font-size:12px;font-weight:700;color:#5cc890;font-family:'Cairo',sans-serif;">${parseFloat(String(tot).replace(/,/g, '')) || tot}</span>
            <span style="font-size:10px;color:rgba(245,200,66,0.8);font-family:'Cairo',sans-serif;">تعديل ✎</span>
        </div>`;
    }).join('');
    panel.style.display = 'block';
}

function concfReset(keepDate = false) {
    document.getElementById('concf_contractor_select').value = '';
    document.getElementById('concf_contractor').value        = '';
    const ct = document.getElementById('concf_contractor_text');
    if (ct) ct.value = '';
    document.getElementById('concf_statement_no').value = '';
    const noWrap = document.getElementById('concf_statement_no_wrap');
    if (noWrap) noWrap.style.display = 'none';
    document.getElementById('concf_total').value = '';
    document.getElementById('concf_spent').value = '';
    document.getElementById('concf_notes').value = '';
    if (!keepDate) document.getElementById('concf_date').value = new Date().toISOString().split('T')[0];
    document.getElementById('concf_preview').style.display = 'none';
    concfHideFeedback();
    _concfEditingRow = null;
    concfSetMode('new');
    const hist = document.getElementById('concf_history_panel');
    if (hist) hist.style.display = 'none';
}

function concfUpdatePreview() {
    const total     = parseFloat(document.getElementById('concf_total').value) || 0;
    const spent     = parseFloat(document.getElementById('concf_spent').value) || 0;
    const remaining = Math.max(0, total - spent);
    const preview   = document.getElementById('concf_preview');
    if (total > 0 || spent > 0) {
        preview.style.display = 'grid';
        document.getElementById('concf_prev_total').textContent     = total.toLocaleString('en-US', { maximumFractionDigits: 2 });
        document.getElementById('concf_prev_spent').textContent     = spent.toLocaleString('en-US', { maximumFractionDigits: 2 });
        document.getElementById('concf_prev_remaining').textContent = remaining.toLocaleString('en-US', { maximumFractionDigits: 2 });
    } else {
        preview.style.display = 'none';
    }
}

function concfShowFeedback(msg, type) {
    const fb = document.getElementById('concf_feedback');
    const styles = {
        success: { bg: 'rgba(39,174,106,0.15)',  border: '1px solid rgba(39,174,106,0.4)',  color: '#5cc890' },
        loading: { bg: 'rgba(245,200,66,0.1)',   border: '1px solid rgba(245,200,66,0.3)',  color: '#f5c842' },
        error:   { bg: 'rgba(244,67,54,0.15)',   border: '1px solid rgba(244,67,54,0.4)',   color: '#ff8a80' },
    };
    const s = styles[type] || styles.error;
    fb.style.display    = 'block';
    fb.style.background = s.bg;
    fb.style.border     = s.border;
    fb.style.color      = s.color;
    fb.textContent      = msg;
    if (type === 'success') setTimeout(() => concfHideFeedback(), 4000);
}

function concfHideFeedback() {
    const fb = document.getElementById('concf_feedback');
    if (fb) fb.style.display = 'none';
}

async function concfSubmit() {
    concfHideFeedback();
    const contractor   = document.getElementById('concf_contractor').value.trim();
    const statement_no = document.getElementById('concf_statement_no').value.trim();
    const date         = document.getElementById('concf_date').value.trim();
    const total        = parseFloat(document.getElementById('concf_total').value) || 0;
    const spent        = parseFloat(document.getElementById('concf_spent').value) || 0;
    const notes        = document.getElementById('concf_notes').value.trim();
    const isEdit       = !!_concfEditingRow;

    if (!contractor)          { concfShowFeedback('❌ يرجى اختيار المقاول', 'error'); return; }
    if (!statement_no)        { concfShowFeedback('❌ رقم المستخلص غير موجود', 'error'); return; }
    if (!date)                { concfShowFeedback('❌ يرجى اختيار التاريخ', 'error'); return; }
    if (!total || total <= 0) { concfShowFeedback('❌ يرجى إدخال المستحق صرفه', 'error'); return; }

    const btn = document.getElementById('concf_submit_btn');
    btn.disabled    = true;
    btn.textContent = '⏳ جاري الحفظ...';
    concfShowFeedback('⏳ جاري إرسال البيانات...', 'loading');

    const rowIndex = isEdit ? (_concfEditingRow['__rowIndex'] || null) : null;

    try {
        const r = await fetch(CONTRACTOR_CF_SCRIPT_URL, {
            method:   'POST',
            headers:  { 'Content-Type': 'text/plain' },
            body:     JSON.stringify({ action: isEdit ? 'update' : 'insert', rowIndex, contractor, statement_no, date, total: Number(total), spent: Number(spent), notes }),
            redirect: 'follow',
        });
        const text = await r.text();
        let resp = {};
        try { resp = JSON.parse(text); } catch (_) {}

        if (resp.status === 'success' || r.ok) {
            const msg = isEdit ? '✅ تم تحديث مستخلص المقاول!' : '✅ تم حفظ المستخلص في سجل المقاولين!';
            concfShowFeedback(msg, 'success');
            showAlert(msg, 'success');

            // انتظر 4 ثواني ثم اعد تحميل السجل
            setTimeout(async () => {
                concfReset();
            }, 4000);
        } else {
            throw new Error(resp.message || 'فشل الحفظ');
        }
    } catch (e) {
        console.error('Contractor CF submit error:', e);
        concfShowFeedback('❌ تعذر الحفظ: ' + (e.message || 'خطأ في الاتصال'), 'error');
    } finally {
        btn.disabled    = false;
        btn.textContent = isEdit ? '💾 حفظ التعديلات' : '💾 حفظ في السجل';
    }
}

/* ====================================================
   GLOBALS
   ==================================================== */
window.openCompanyCashflowForm     = openCompanyCashflowForm;
window.closeCompanyCashflowForm    = closeCompanyCashflowForm;
window.ccfSubmit                   = ccfSubmit;
window.ccfUpdatePreview            = ccfUpdatePreview;
window.ccfLoadRowForEdit           = ccfLoadRowForEdit;
window.ccfReset                    = ccfReset;
window.ccfOpenHistory              = ccfOpenHistory;
window.ccfForceRefresh             = ccfForceRefresh;
window.openContractorCashflowForm  = openContractorCashflowForm;
window.closeContractorCashflowForm = closeContractorCashflowForm;
window.concfSubmit                 = concfSubmit;
window.concfUpdatePreview          = concfUpdatePreview;
window.concfLoadRowForEdit         = concfLoadRowForEdit;
window.concfReset                  = concfReset;
window.concfSyncContractor         = concfSyncContractor;
window.concfSyncContractorText     = concfSyncContractorText;
window.concfBuildHistory           = concfBuildHistory;
window.concfSetMode                = concfSetMode;
