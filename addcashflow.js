/* =====================================================
   CASHFLOW FORMS — من الصفر
   شيت الشركة  : رقم المستخلص | التاريخ | القيمة | الحالة | الملاحظات
   شيت المقاولين: المقاول | رقم المستخلص | التاريخ | الإجمالي | المنصرف | الملاحظات
   ===================================================== */

/* ── روابط الـ Web App (غيّرهم بعد النشر) ── */
/*URL سكريبت الشركة هنا*/
const CCF_URL  = 'https://script.google.com/macros/s/AKfycbz3QFPW-Sd7OhC5WeIuY0H9pnrfy1fApXghA8hhh8I_svbMHp9Kc39CPAs6v05lOkhE/exec';
/*URL سكريبت المقاولين هنا*/
const CONCF_URL = 'https://script.google.com/macros/s/AKfycbwJCZePc58kGZI3ta3aoHOZ6JjCWi-tSI67mz6Hrcy9wvGyZlXDvZIy0bjxuhUYZQkrXA/exec';

/* ── حالة التعديل (null = إضافة جديدة) ── */
let _ccfEditing  = null;
let _concfEditing = null;

/* =====================================================
   أداة مشتركة — جلب البيانات من Apps Script
   بدون أي كاش — كل استدعاء يجلب أحدث نسخة
   ===================================================== */
async function _cfGet(scriptUrl) {
    // t= لكسر كاش المتصفح
    const res = await fetch(scriptUrl + '?t=' + Date.now(), {
        method:   'GET',
        redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch(_) { throw new Error('رد غير صالح من السكريبت'); }
    if (json.status !== 'success') throw new Error(json.message || 'خطأ في السكريبت');
    return json.data; // { headers, rows }
}

async function _cfPost(scriptUrl, body) {
    const res = await fetch(scriptUrl, {
        method:   'POST',
        headers:  { 'Content-Type': 'text/plain' },
        body:     JSON.stringify(body),
        redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch(_) { throw new Error('رد غير صالح من السكريبت'); }
    if (json.status !== 'success') throw new Error(json.message || 'فشل الحفظ');
    return json;
}

/* ── حساب رقم المستخلص التالي (دايماً 3 خانات) ── */
function _nextNo(rows, colName) {
    let max = 0;
    rows.forEach(row => {
        const v = String(row[colName] || '').trim();
        const n = parseInt(v.replace(/\D/g, ''), 10) || 0;
        if (n > max) max = n;
    });
    return String(max + 1).padStart(3, '0');
}

/* =====================================================
   COMPANY CASHFLOW
   ===================================================== */

async function openCompanyCashflowForm() {
    openModal('companyCashflowModal');
    _ccfEditing = null;
    _ccfSetMode('new');
    _ccfClearFields(true);
    await _ccfLoad();
}

function closeCompanyCashflowForm() {
    closeModal('companyCashflowModal');
}

/* جلب البيانات وملء الرقم والسجل */
async function _ccfLoad() {
    const inp = document.getElementById('ccf_statement_no');
    if (inp) { inp.value = ''; inp.placeholder = '⏳ جاري الجلب...'; }
    try {
        const { rows } = await _cfGet(CCF_URL);
        const next = _nextNo(rows, 'رقم المستخلص');
        if (inp) {
            inp.value             = next;
            inp.placeholder       = '';
            inp.style.borderColor = 'rgba(245,200,66,0.6)';
        }
        _ccfBuildHistory(rows);
    } catch (e) {
        console.error('[ccf] load error:', e.message);
        if (inp) { inp.placeholder = 'تعذر الجلب'; inp.value = ''; }
        _ccfShowFeedback('❌ تعذر جلب البيانات: ' + e.message, 'error');
    }
}

function _ccfSetMode(mode) {
    const btn    = document.getElementById('ccf_submit_btn');
    const badges = document.querySelectorAll('#companyCashflowModal .cf-form-mode-badge');
    if (mode === 'edit') {
        badges.forEach(b => b.style.display = 'flex');
        if (btn) { btn.textContent = '💾 حفظ التعديلات'; btn.style.background = 'linear-gradient(135deg,#f5c842,#e8a800)'; btn.style.color = '#1a0a2e'; }
    } else {
        badges.forEach(b => b.style.display = 'none');
        if (btn) { btn.textContent = '💾 حفظ في السجل'; btn.style.background = 'linear-gradient(135deg,#2196f3,#1565c0)'; btn.style.color = '#fff'; }
    }
}

function _ccfClearFields(keepDate = false) {
    document.getElementById('ccf_amount').value = '';
    document.getElementById('ccf_status').value = 'مدفوع';
    document.getElementById('ccf_notes').value  = '';
    if (!keepDate) document.getElementById('ccf_date').value = new Date().toISOString().split('T')[0];
    const prev = document.getElementById('ccf_preview');
    if (prev) prev.style.display = 'none';
    _ccfHideFeedback();
}

function ccfReset(keepDate = false) {
    _ccfEditing = null;
    _ccfSetMode('new');
    _ccfClearFields(keepDate);
    _ccfLoad();
}

function ccfUpdatePreview() {
    const amt  = parseFloat(document.getElementById('ccf_amount').value) || 0;
    const prev = document.getElementById('ccf_preview');
    const span = document.getElementById('ccf_preview_amount');
    if (amt > 0 && prev && span) {
        prev.style.display  = 'block';
        span.textContent    = amt.toLocaleString('en-US', { maximumFractionDigits: 2 });
    } else if (prev) {
        prev.style.display = 'none';
    }
}

/* تحميل صف للتعديل */
function ccfLoadRowForEdit(rowJson) {
    const row = typeof rowJson === 'string' ? JSON.parse(rowJson) : rowJson;
    _ccfEditing = row;
    _ccfSetMode('edit');

    document.getElementById('ccf_statement_no').value = row['رقم المستخلص'] || '';
    document.getElementById('ccf_date').value         = row['التاريخ']       || '';
    document.getElementById('ccf_amount').value       = String(row['القيمة'] || '').replace(/,/g, '');
    document.getElementById('ccf_notes').value        = row['الملاحظات']     || '';

    const sel = document.getElementById('ccf_status');
    if (sel) {
        const v   = row['الحالة'] || 'مدفوع';
        const opt = [...sel.options].find(o => o.value === v || o.textContent.trim() === v);
        sel.value = opt ? opt.value : 'مدفوع';
    }

    ccfUpdatePreview();
    const hist = document.getElementById('ccf_history_panel');
    if (hist) hist.style.display = 'none';
    showAlert('✏️ تم تحميل المستخلص للتعديل', 'success');
}

/* بناء سجل المستخلصات */
function _ccfBuildHistory(rows) {
    const panel = document.getElementById('ccf_history_panel');
    const list  = document.getElementById('ccf_history_list');
    if (!panel || !list) return;

    if (!rows.length) {
        list.innerHTML      = '<div style="padding:14px;text-align:center;color:rgba(255,255,255,0.35);font-family:Cairo,sans-serif;font-size:12px;">لا توجد مستخلصات سابقة</div>';
        panel.style.display = 'block';
        return;
    }

    list.innerHTML = [...rows].reverse().map((row, i) => {
        const bg = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
        return `
        <div onclick="ccfLoadRowForEdit(${JSON.stringify(row).replace(/"/g, '&quot;')})"
             style="display:flex;align-items:center;justify-content:space-between;gap:8px;
                    padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);
                    background:${bg};transition:background .15s;"
             onmouseover="this.style.background='rgba(33,150,243,0.12)'"
             onmouseout="this.style.background='${bg}'">
            <span style="font-size:12px;font-weight:700;color:#5baddf;font-family:Cairo,sans-serif;">${row['رقم المستخلص'] || '-'}</span>
            <span style="font-size:11px;color:rgba(255,255,255,0.5);font-family:Cairo,sans-serif;">${row['التاريخ'] || '-'}</span>
            <span style="font-size:12px;font-weight:700;color:#f5c842;font-family:Cairo,sans-serif;">${parseFloat(String(row['القيمة'] || '0').replace(/,/g,'')).toLocaleString('en-US',{maximumFractionDigits:2})}</span>
            <span style="font-size:11px;color:rgba(255,255,255,0.4);font-family:Cairo,sans-serif;">${row['الحالة'] || ''}</span>
            <span style="font-size:10px;color:rgba(33,150,243,0.8);font-family:Cairo,sans-serif;">✎ تعديل</span>
        </div>`;
    }).join('');
    panel.style.display = 'block';
}



function _ccfShowFeedback(msg, type) {
    const fb = document.getElementById('ccf_feedback');
    if (!fb) return;
    const map = {
        success: ['rgba(39,174,106,0.15)', 'rgba(39,174,106,0.4)',  '#5cc890'],
        loading: ['rgba(245,200,66,0.1)',  'rgba(245,200,66,0.3)',  '#f5c842'],
        error:   ['rgba(244,67,54,0.15)',  'rgba(244,67,54,0.4)',   '#ff8a80'],
    };
    const [bg, border, color] = map[type] || map.error;
    fb.style.cssText    = `display:block;background:${bg};border:1px solid ${border};color:${color};padding:10px 14px;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px;margin-top:8px;`;
    fb.textContent      = msg;
    if (type === 'success') setTimeout(() => _ccfHideFeedback(), 4000);
}

function _ccfHideFeedback() {
    const fb = document.getElementById('ccf_feedback');
    if (fb) fb.style.display = 'none';
}

async function ccfSubmit() {
    _ccfHideFeedback();

    const statement_no = document.getElementById('ccf_statement_no').value.trim();
    const date         = document.getElementById('ccf_date').value.trim();
    const amount       = parseFloat(document.getElementById('ccf_amount').value) || 0;
    const status       = document.getElementById('ccf_status').value.trim();
    const notes        = document.getElementById('ccf_notes').value.trim();
    const isEdit       = !!_ccfEditing;

    if (!statement_no)         { _ccfShowFeedback('❌ رقم المستخلص غير موجود', 'error');     return; }
    if (!date)                 { _ccfShowFeedback('❌ يرجى اختيار التاريخ', 'error');         return; }
    if (!amount || amount <= 0){ _ccfShowFeedback('❌ يرجى إدخال قيمة المستخلص', 'error');   return; }

    const btn = document.getElementById('ccf_submit_btn');
    btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';
    _ccfShowFeedback('⏳ جاري إرسال البيانات...', 'loading');

    try {
        await _cfPost(CCF_URL, {
            action:       isEdit ? 'update' : 'insert',
            rowIndex:     isEdit ? (_ccfEditing['__rowIndex'] || null) : null,
            statement_no, date, amount, status, notes,
        });

        const msg = isEdit ? '✅ تم تحديث المستخلص!' : '✅ تم حفظ المستخلص!';
        _ccfShowFeedback(msg, 'success');
        showAlert(msg, 'success');

        // انتظر 4 ثواني عشان الشيت يتحدث ثم جدّد
        setTimeout(async () => {
            _ccfEditing = null;
            _ccfSetMode('new');
            _ccfClearFields(false);
            await _ccfLoad();
        }, 4000);

    } catch (e) {
        console.error('[ccf] submit error:', e);
        _ccfShowFeedback('❌ ' + e.message, 'error');
    } finally {
        btn.disabled    = false;
        btn.textContent = isEdit ? '💾 حفظ التعديلات' : '💾 حفظ في السجل';
    }
}

/* =====================================================
   CONTRACTOR CASHFLOW
   ===================================================== */

async function openContractorCashflowForm() {
    openModal('contractorCashflowModal');
    _concfEditing = null;
    _concfSetMode('new');
    _concfClearFields(true);
    _concfPopulateContractors();
    const noWrap = document.getElementById('concf_statement_no_wrap');
    if (noWrap) noWrap.style.display = 'none';
}

function closeContractorCashflowForm() {
    closeModal('contractorCashflowModal');
}

function _concfPopulateContractors() {
    const sel = document.getElementById('concf_contractor_select');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- اختر من القائمة --</option>';
    const set = new Set();
    Object.values(allData || {}).forEach(sd => Object.values(sd).forEach(row => { const c = (row['CONTRACTOR'] || '').trim(); if (c) set.add(c); }));
    Object.keys(contractorMap || {}).forEach(n => { if (n.trim()) set.add(n.trim()); });
    [...set].sort((a, b) => a.localeCompare(b, 'ar')).forEach(name => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = name;
        sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
}

/* اختيار مقاول من القائمة */
async function concfSyncContractor(val) {
    document.getElementById('concf_contractor').value = val;
    const noWrap = document.getElementById('concf_statement_no_wrap');
    const inp    = document.getElementById('concf_statement_no');
    const hist   = document.getElementById('concf_history_panel');

    if (!val) {
        if (noWrap) noWrap.style.display = 'none';
        if (inp)   inp.value = '';
        if (hist)  hist.style.display = 'none';
        return;
    }

    if (noWrap) noWrap.style.display = 'block';
    if (inp)   { inp.value = ''; inp.placeholder = '⏳ جاري الجلب...'; }

    try {
        const { rows } = await _cfGet(CONCF_URL);

        // فلتر صفوف المقاول المختار
        const contractorRows = rows.filter(r => (r['المقاول'] || '').trim() === val.trim());
        const next           = _nextNo(contractorRows, 'رقم المستخلص');

        if (inp) {
            inp.value             = next;
            inp.placeholder       = '';
            inp.style.borderColor = 'rgba(245,200,66,0.6)';
            inp.title             = 'آخر مستخلص للمقاول ' + val + ' + 1';
        }
        _concfBuildHistory(rows, val);

    } catch (e) {
        console.error('[concf] sync error:', e.message);
        if (inp) { inp.placeholder = 'تعذر الجلب'; inp.value = ''; }
    }
}

function concfSyncContractorText(val) {
    document.getElementById('concf_contractor').value = val;
}

function _concfSetMode(mode) {
    const btn   = document.getElementById('concf_submit_btn');
    const badge = document.getElementById('concf_edit_badge');
    if (mode === 'edit') {
        if (btn)   { btn.textContent = '💾 حفظ التعديلات'; btn.style.background = 'linear-gradient(135deg,#2196f3,#1565c0)'; btn.style.color = '#fff'; }
        if (badge) badge.style.display = 'flex';
    } else {
        if (btn)   { btn.textContent = '💾 حفظ في السجل'; btn.style.background = 'linear-gradient(135deg,#f5c842,#e8a800)'; btn.style.color = '#1a0a2e'; }
        if (badge) badge.style.display = 'none';
    }
}

function _concfClearFields(keepDate = false) {
    const sel = document.getElementById('concf_contractor_select');
    if (sel) sel.value = '';
    document.getElementById('concf_contractor').value = '';
    const ct = document.getElementById('concf_contractor_text');
    if (ct) ct.value = '';
    document.getElementById('concf_statement_no').value = '';
    const noWrap = document.getElementById('concf_statement_no_wrap');
    if (noWrap) noWrap.style.display = 'none';
    document.getElementById('concf_total').value = '';
    document.getElementById('concf_spent').value = '';
    document.getElementById('concf_notes').value = '';
    if (!keepDate) document.getElementById('concf_date').value = new Date().toISOString().split('T')[0];
    const prev = document.getElementById('concf_preview');
    if (prev) prev.style.display = 'none';
    const hist = document.getElementById('concf_history_panel');
    if (hist) hist.style.display = 'none';
    _concfHideFeedback();
}

function concfReset(keepDate = false) {
    _concfEditing = null;
    _concfSetMode('new');
    _concfClearFields(keepDate);
}

function concfUpdatePreview() {
    const total     = parseFloat(document.getElementById('concf_total').value) || 0;
    const spent     = parseFloat(document.getElementById('concf_spent').value) || 0;
    const remaining = Math.max(0, total - spent);
    const prev      = document.getElementById('concf_preview');
    if (total > 0 || spent > 0) {
        if (prev) prev.style.display = 'grid';
        document.getElementById('concf_prev_total').textContent     = total.toLocaleString('en-US', { maximumFractionDigits: 2 });
        document.getElementById('concf_prev_spent').textContent     = spent.toLocaleString('en-US', { maximumFractionDigits: 2 });
        document.getElementById('concf_prev_remaining').textContent = remaining.toLocaleString('en-US', { maximumFractionDigits: 2 });
    } else {
        if (prev) prev.style.display = 'none';
    }
}

/* تحميل صف مقاول للتعديل */
function concfLoadRowForEdit(rowJson) {
    const row = typeof rowJson === 'string' ? JSON.parse(rowJson) : rowJson;
    _concfEditing = row;
    _concfSetMode('edit');

    // المقاول
    const cVal = row['المقاول'] || '';
    const sel  = document.getElementById('concf_contractor_select');
    if (sel) {
        if (![...sel.options].find(o => o.value === cVal.trim()) && cVal) {
            const opt = document.createElement('option');
            opt.value = opt.textContent = cVal;
            sel.appendChild(opt);
        }
        sel.value = cVal.trim();
    }
    document.getElementById('concf_contractor').value = cVal;

    // رقم المستخلص
    const noWrap = document.getElementById('concf_statement_no_wrap');
    if (noWrap) noWrap.style.display = 'block';
    const noInp = document.getElementById('concf_statement_no');
    if (noInp) { noInp.value = row['رقم المستخلص'] || ''; noInp.style.borderColor = 'rgba(245,200,66,0.6)'; }

    document.getElementById('concf_date').value  = row['التاريخ']    || '';
    document.getElementById('concf_total').value = String(row['الإجمالي'] || '').replace(/,/g, '');
    document.getElementById('concf_spent').value = String(row['المنصرف']  || '').replace(/,/g, '');
    document.getElementById('concf_notes').value = row['الملاحظات']  || '';

    concfUpdatePreview();
    const hist = document.getElementById('concf_history_panel');
    if (hist) hist.style.display = 'none';
    showAlert('✏️ تم تحميل مستخلص المقاول للتعديل', 'success');
}

/* بناء سجل مستخلصات المقاولين */
function _concfBuildHistory(rows, filterContractor) {
    const panel = document.getElementById('concf_history_panel');
    const list  = document.getElementById('concf_history_list');
    if (!panel || !list) return;

    const display = filterContractor
        ? rows.filter(r => (r['المقاول'] || '').trim() === filterContractor.trim())
        : rows;

    if (!display.length) { panel.style.display = 'none'; return; }

    list.innerHTML = [...display].reverse().map((row, i) => {
        const bg = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
        return `
        <div onclick="concfLoadRowForEdit(${JSON.stringify(row).replace(/"/g, '&quot;')})"
             style="display:flex;align-items:center;justify-content:space-between;gap:8px;
                    padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);
                    background:${bg};transition:background .15s;"
             onmouseover="this.style.background='rgba(245,200,66,0.1)'"
             onmouseout="this.style.background='${bg}'">
            <span style="font-size:12px;font-weight:700;color:#f5c842;font-family:Cairo,sans-serif;">${row['رقم المستخلص'] || '-'}</span>
            ${!filterContractor ? `<span style="font-size:10px;color:rgba(255,255,255,0.5);font-family:Cairo,sans-serif;">${row['المقاول'] || ''}</span>` : ''}
            <span style="font-size:11px;color:rgba(255,255,255,0.5);font-family:Cairo,sans-serif;">${row['التاريخ'] || '-'}</span>
            <span style="font-size:12px;font-weight:700;color:#5cc890;font-family:Cairo,sans-serif;">${parseFloat(String(row['الإجمالي'] || '0').replace(/,/g,'')).toLocaleString('en-US',{maximumFractionDigits:2})}</span>
            <span style="font-size:10px;color:rgba(245,200,66,0.8);font-family:Cairo,sans-serif;">✎ تعديل</span>
        </div>`;
    }).join('');
    panel.style.display = 'block';
}

function _concfShowFeedback(msg, type) {
    const fb = document.getElementById('concf_feedback');
    if (!fb) return;
    const map = {
        success: ['rgba(39,174,106,0.15)', 'rgba(39,174,106,0.4)',  '#5cc890'],
        loading: ['rgba(245,200,66,0.1)',  'rgba(245,200,66,0.3)',  '#f5c842'],
        error:   ['rgba(244,67,54,0.15)',  'rgba(244,67,54,0.4)',   '#ff8a80'],
    };
    const [bg, border, color] = map[type] || map.error;
    fb.style.cssText = `display:block;background:${bg};border:1px solid ${border};color:${color};padding:10px 14px;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px;margin-top:8px;`;
    fb.textContent   = msg;
    if (type === 'success') setTimeout(() => _concfHideFeedback(), 4000);
}

function _concfHideFeedback() {
    const fb = document.getElementById('concf_feedback');
    if (fb) fb.style.display = 'none';
}

async function concfSubmit() {
    _concfHideFeedback();

    const contractor   = document.getElementById('concf_contractor').value.trim();
    const statement_no = document.getElementById('concf_statement_no').value.trim();
    const date         = document.getElementById('concf_date').value.trim();
    const total        = parseFloat(document.getElementById('concf_total').value) || 0;
    const spent        = parseFloat(document.getElementById('concf_spent').value) || 0;
    const notes        = document.getElementById('concf_notes').value.trim();
    const isEdit       = !!_concfEditing;

    if (!contractor)          { _concfShowFeedback('❌ يرجى اختيار المقاول', 'error');      return; }
    if (!statement_no)        { _concfShowFeedback('❌ رقم المستخلص غير موجود', 'error');   return; }
    if (!date)                { _concfShowFeedback('❌ يرجى اختيار التاريخ', 'error');       return; }
    if (!total || total <= 0) { _concfShowFeedback('❌ يرجى إدخال المستحق صرفه', 'error'); return; }

    const btn = document.getElementById('concf_submit_btn');
    btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';
    _concfShowFeedback('⏳ جاري إرسال البيانات...', 'loading');

    try {
        await _cfPost(CONCF_URL, {
            action:       isEdit ? 'update' : 'insert',
            rowIndex:     isEdit ? (_concfEditing['__rowIndex'] || null) : null,
            contractor, statement_no, date,
            total: Number(total),
            spent: Number(spent),
            notes,
        });

        const msg = isEdit ? '✅ تم تحديث مستخلص المقاول!' : '✅ تم حفظ المستخلص!';
        _concfShowFeedback(msg, 'success');
        showAlert(msg, 'success');

        setTimeout(() => {
            _concfEditing = null;
            _concfSetMode('new');
            _concfClearFields(false);
        }, 4000);

    } catch (e) {
        console.error('[concf] submit error:', e);
        _concfShowFeedback('❌ ' + e.message, 'error');
    } finally {
        btn.disabled    = false;
        btn.textContent = isEdit ? '💾 حفظ التعديلات' : '💾 حفظ في السجل';
    }
}

/* =====================================================
   GLOBALS
   ===================================================== */
window.openCompanyCashflowForm     = openCompanyCashflowForm;
window.closeCompanyCashflowForm    = closeCompanyCashflowForm;
window.ccfSubmit                   = ccfSubmit;
window.ccfUpdatePreview            = ccfUpdatePreview;
window.ccfLoadRowForEdit           = ccfLoadRowForEdit;
window.ccfReset                    = ccfReset;

window.openContractorCashflowForm  = openContractorCashflowForm;
window.closeContractorCashflowForm = closeContractorCashflowForm;
window.concfSubmit                 = concfSubmit;
window.concfUpdatePreview          = concfUpdatePreview;
window.concfLoadRowForEdit         = concfLoadRowForEdit;
window.concfReset                  = concfReset;
window.concfSyncContractor         = concfSyncContractor;
window.concfSyncContractorText     = concfSyncContractorText;
window.concfSetMode                = _concfSetMode;
window.concfBuildHistory           = _concfBuildHistory;
