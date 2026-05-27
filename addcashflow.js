/* ====================================================
   COMPANY CASHFLOW FORM
   ==================================================== */

const COMPANY_CF_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwwgjYBDyXw5IxvrTlZTQHz0rUqg0RHNbeIQ4aS1YoMoB0uMx7xkNCprb3voS9d6RrC/exec";

/* شيت ID للشركة — يُجلب منه آخر رقم مستخلص */
const COMPANY_CF_SHEET_READ_ID  = "1HTV35zXKroQdPJJ0XDew5rFgLwRX73-16AbtI1IymYA";
const CONTRACTOR_CF_SHEET_READ_ID = "1xmSUQNR02prdGK9P6QiJo8ybVKwdVZAE74yUkUTbVYA";

/* ── كاش لبيانات المستخلصات ── */
let _ccfRowsCache = null;
let _concfRowsCache = null;
let _ccfEditingRow = null;   // null = إضافة جديدة, row-object = تعديل
let _concfEditingRow = null;

/* ── جلب صفوف شيت CSV وإرجاعها كـ array of objects ── */
async function _cfFetchRows(sheetId) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const csv = await r.text();
    if (csv.trim().startsWith('<')) throw new Error('not public');
    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };
    const headers = parseCSVLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        if (!vals.some(v => v.trim())) continue;
        const obj = {};
        headers.forEach((h, idx) => { obj[h.trim()] = vals[idx] || ''; });
        obj['__rowIndex'] = i; // 1-based (header=0)
        rows.push(obj);
    }
    return { headers, rows };
}

/* ── استخراج آخر رقم مستخلص وإرجاع التالي ── */
function _cfNextStatementNo(rows, colName) {
    // العمود الأول دايماً هو رقم المستخلص (عمود A في الشيت)
    // colName = اسم الـ header للعمود الأول
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

async function openCompanyCashflowForm() {
    openModal('companyCashflowModal');
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('ccf_date').value = today;
    _ccfEditingRow = null;
    ccfSetMode('new');
    ccfReset(true);
    // جلب آخر رقم مستخلص وبناء سجل الاسترجاع
    await ccfRefreshStatementNo();
}

function closeCompanyCashflowForm() {
    closeModal('companyCashflowModal');
}

function ccfSetMode(mode) {
    const btn = document.getElementById('ccf_submit_btn');
    // The mode badge is the first .cf-form-mode-badge inside companyCashflowModal
    const badges = document.querySelectorAll('#companyCashflowModal .cf-form-mode-badge');
    if (mode === 'edit') {
        badges.forEach(b => b.style.display = 'flex');
        if (btn) { btn.textContent = '💾 حفظ التعديلات'; btn.style.background = 'linear-gradient(135deg,#f5c842,#e8a800)'; btn.style.color = '#1a0a2e'; }
    } else {
        badges.forEach(b => b.style.display = 'none');
        if (btn) { btn.textContent = '💾 حفظ في السجل'; btn.style.background = 'linear-gradient(135deg,#2196f3,#1565c0)'; btn.style.color = 'white'; }
    }
}

function ccfLoadRowForEdit(rowJson) {
    const row = (typeof rowJson === 'string') ? JSON.parse(rowJson) : rowJson;
    _ccfEditingRow = row;
    ccfSetMode('edit');
    const keys = Object.keys(row).filter(k => !k.startsWith('__'));
    // --- رقم المستخلص (عمود 0) ---
    const noKey = keys[0];
    const noVal = row[noKey] || '';
    const noInp = document.getElementById('ccf_statement_no');
    noInp.value = noVal;
    // --- التاريخ (عمود 1) ---
    const dateKey = keys.find(k => /date|تاريخ/i.test(k)) || keys[1] || '';
    document.getElementById('ccf_date').value = row[dateKey] || '';
    // --- القيمة ---
    const amtKey = keys.find(k => /amount|قيمة|مبلغ/i.test(k));
    if (amtKey) document.getElementById('ccf_amount').value = String(row[amtKey] || '').replace(/,/g,'');
    // --- الحالة ---
    const statusKey = keys.find(k => /status|حالة/i.test(k));
    if (statusKey) {
        const sel = document.getElementById('ccf_status');
        if (sel) {
            const v = row[statusKey] || 'مدفوع';
            // حاول مطابقة القيمة مع الخيارات الموجودة
            const opt = [...sel.options].find(o => o.value === v || o.textContent.trim() === v);
            sel.value = opt ? opt.value : 'مدفوع';
        }
    }
    // --- الملاحظات ---
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
    const keys = Object.keys(rows[0]).filter(k => !k.startsWith('__'));
    list.innerHTML = rows.slice().reverse().map((row, i) => {
        const num  = row[keys[0]] || '-';
        const date = row[keys[1]] || '-';
        const amt  = row[keys.find(k => /amount|قيمة|مبلغ/i.test(k))] || '-';
        const bg   = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
        return `<div onclick="ccfLoadRowForEdit(${JSON.stringify(row).replace(/"/g,'&quot;')})"
            style="display:flex;align-items:center;justify-content:space-between;gap:8px;
                   padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);
                   background:${bg};transition:background 0.15s;"
            onmouseover="this.style.background='rgba(33,150,243,0.12)'"
            onmouseout="this.style.background='${bg}'">
            <span style="font-size:12px;font-weight:700;color:#5baddf;font-family:'Cairo',sans-serif;">${num}</span>
            <span style="font-size:11px;color:rgba(255,255,255,0.5);font-family:'Cairo',sans-serif;">${date}</span>
            <span style="font-size:12px;font-weight:700;color:#f5c842;font-family:'Cairo',sans-serif;">${parseFloat(String(amt).replace(/,/g,''))||amt}</span>
            <span style="font-size:10px;color:rgba(33,150,243,0.8);font-family:'Cairo',sans-serif;">تعديل ✎</span>
        </div>`;
    }).join('');
    panel.style.display = 'block';
}

async function ccfOpenHistory() {
    const panel = document.getElementById('ccf_history_panel');
    const list  = document.getElementById('ccf_history_list');
    if (!panel || !list) return;
    // إن الكاش فاضي اجلب أحدث بيانات
    if (!_ccfRowsCache || !_ccfRowsCache.length) {
        list.innerHTML = '<div style="padding:12px 14px;text-align:center;color:rgba(255,255,255,0.4);font-size:12px;font-family:Cairo,sans-serif;">&#x23F3; جاري التحميل...</div>';
        panel.style.display = 'block';
        try {
            const { rows } = await _cfFetchRows(COMPANY_CF_SHEET_READ_ID);
            _ccfRowsCache = rows;
            ccfBuildHistory(rows);
        } catch(e) {
            list.innerHTML = '<div style="padding:12px 14px;text-align:center;color:#ff8a80;font-size:12px;">&#x274C; تعذر التحميل</div>';
        }
    } else {
        if (panel.style.display === 'block') {
            panel.style.display = 'none';
        } else {
            ccfBuildHistory(_ccfRowsCache);
            panel.style.display = 'block';
        }
    }
}

function ccfReset(keepDate = false) {
    document.getElementById('ccf_amount').value = '';
    document.getElementById('ccf_status').value = 'مدفوع';
    document.getElementById('ccf_notes').value = '';
    if (!keepDate) {
        document.getElementById('ccf_date').value = new Date().toISOString().split('T')[0];
    }
    document.getElementById('ccf_preview').style.display = 'none';
    ccfHideFeedback();
    _ccfEditingRow = null;
    ccfSetMode('new');
    // أعد حساب رقم المستخلص التالي تلقائياً
    ccfRefreshStatementNo();
}

async function ccfRefreshStatementNo() {
    const inp = document.getElementById('ccf_statement_no');
    if (!inp) return;
    inp.value = '';
    inp.placeholder = '⏳ جاري الجلب...';
    try {
        // امسح الكاش دائماً عشان تجيب أحدث البيانات بعد الحفظ
        _ccfRowsCache = null;
        const { rows } = await _cfFetchRows(COMPANY_CF_SHEET_READ_ID);
        _ccfRowsCache = rows;
        const firstKey = rows[0] ? Object.keys(rows[0]).find(k => !k.startsWith('__')) : '';
        console.log('[ccf] rows:', rows.length, '| first key:', firstKey, '| sample:', rows[0]?.[firstKey]);
        const next = _cfNextStatementNo(rows, firstKey);
        console.log('[ccf] next statement no:', next);
        inp.value = next;
        inp.style.borderColor = 'rgba(245,200,66,0.6)';
        inp.placeholder = '';
        inp.title = 'رقم تلقائي — للعرض فقط';
        // بناء سجل المستخلصات
        ccfBuildHistory(rows);
    } catch(e) {
        console.warn('ccfRefreshStatementNo error:', e.message);
        inp.placeholder = 'مثال: 001';
        inp.value = '';
    }
}

function ccfUpdatePreview() {
    const amt     = parseFloat(document.getElementById('ccf_amount').value) || 0;
    const preview = document.getElementById('ccf_preview');
    const prevAmt = document.getElementById('ccf_preview_amount');
    if (amt > 0) {
        preview.style.display = 'block';
        prevAmt.textContent = amt.toLocaleString('en-US', { maximumFractionDigits: 2 });
    } else {
        preview.style.display = 'none';
    }
}

function ccfShowFeedback(msg, type) {
    const fb = document.getElementById('ccf_feedback');
    fb.style.display = 'block';
    fb.style.background = type === 'success' ? 'rgba(39,174,106,0.15)' : type === 'loading' ? 'rgba(245,200,66,0.1)' : 'rgba(244,67,54,0.15)';
    fb.style.border = type === 'success' ? '1px solid rgba(39,174,106,0.4)' : type === 'loading' ? '1px solid rgba(245,200,66,0.3)' : '1px solid rgba(244,67,54,0.4)';
    fb.style.color = type === 'success' ? '#5cc890' : type === 'loading' ? '#f5c842' : '#ff8a80';
    fb.textContent = msg;
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

    if (!statement_no) { ccfShowFeedback('❌ رقم المستخلص غير موجود', 'error'); return; }
    if (!date)         { ccfShowFeedback('❌ يرجى اختيار التاريخ', 'error'); return; }
    if (!amount || amount <= 0) { ccfShowFeedback('❌ يرجى إدخال قيمة المستخلص', 'error'); return; }

    const btn = document.getElementById('ccf_submit_btn');
    btn.disabled = true;
    btn.textContent = '⏳ جاري الحفظ...';
    ccfShowFeedback('⏳ جاري إرسال البيانات...', 'loading');

    // rowIndex = رقم الصف في الشيت (1-based بدون header)
    const rowIndex = isEdit ? (_ccfEditingRow['__rowIndex'] || null) : null;

    try {
        const r = await fetch(COMPANY_CF_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: isEdit ? 'update' : 'insert',
                rowIndex,
                statement_no, date, amount, status, notes
            }),
            redirect: 'follow'
        });
        const text = await r.text();
        let resp = {};
        try { resp = JSON.parse(text); } catch(e) {}
        if (resp.status === 'success' || r.ok) {
            const msg = isEdit ? '✅ تم تحديث المستخلص في سجل الشركة!' : '✅ تم حفظ المستخلص في سجل الشركة!';
            ccfShowFeedback(msg, 'success');
            showAlert(msg, 'success');
            _ccfRowsCache = null; // مسح الكاش لإعادة الجلب بأحدث البيانات
            // انتظر قليلاً عشان الشيت يتحدث ثم اجلب الرقم الجديد والسجل
            setTimeout(async () => {
                ccfSetMode('new');
                document.getElementById('ccf_amount').value = '';
                document.getElementById('ccf_status').value = 'مدفوع';
                document.getElementById('ccf_notes').value = '';
                document.getElementById('ccf_preview').style.display = 'none';
                ccfHideFeedback();
                _ccfEditingRow = null;
                document.getElementById('ccf_date').value = new Date().toISOString().split('T')[0];
                await ccfRefreshStatementNo();
            }, 2500);
        } else {
            throw new Error(resp.message || 'فشل الحفظ');
        }
    } catch(e) {
        console.error('Company CF submit error:', e);
        ccfShowFeedback('❌ تعذر الحفظ: ' + (e.message || 'خطأ في الاتصال'), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = isEdit ? '💾 حفظ التعديلات' : '💾 حفظ في السجل';
    }
}

/* ====================================================
   CONTRACTOR CASHFLOW FORM
   ==================================================== */

const CONTRACTOR_CF_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyrYHgPndRYq2YKAiBdEsRPM8SGEvrCBHEyTjhH5Ul4ER9keTCzZqoqTELLw1pEm2y1lQ/exec";

async function openContractorCashflowForm() {
    openModal('contractorCashflowModal');
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('concf_date').value = today;
    _concfEditingRow = null;
    concfSetMode('new');
    concfPopulateContractors();
    concfReset(true);
    // جلب كل المستخلصات مسبقاً للكاش — بدون تعيين رقم حتى يختار المقاول
    try {
        const { rows } = await _cfFetchRows(CONTRACTOR_CF_SHEET_READ_ID);
        _concfRowsCache = rows;
    } catch(e) {
        console.warn('concf fetch rows:', e.message);
    }
    // إخفاء خانة رقم المستخلص حتى يختار المقاول
    const noWrap = document.getElementById('concf_statement_no_wrap');
    if (noWrap) noWrap.style.display = 'none';
}

function closeContractorCashflowForm() {
    closeModal('contractorCashflowModal');
}

function concfPopulateContractors() {
    const sel = document.getElementById('concf_contractor_select');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- اختر من القائمة --</option>';
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
    [...contractors].sort((a,b) => a.localeCompare(b,'ar')).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
}

function concfSyncContractor(val) {
    document.getElementById('concf_contractor').value = val;
    const noWrap = document.getElementById('concf_statement_no_wrap');
    const inp    = document.getElementById('concf_statement_no');

    if (!val) {
        // أخفِ خانة الرقم عند إلغاء الاختيار
        if (noWrap) noWrap.style.display = 'none';
        if (inp) inp.value = '';
        return;
    }

    // أظهر خانة الرقم
    if (noWrap) noWrap.style.display = 'block';

    const _calcAndShow = (rows) => {
        const keys = Object.keys(rows[0] || {}).filter(k => !k.startsWith('__'));
        const cKey  = keys.find(k => /contractor|مقاول/i.test(k)) || '';
        // العمود الأول دايماً = رقم المستخلص (عمود A)
        const noKey = keys[0] || '';
        const contractorRows = rows.filter(r => (r[cKey] || '').trim() === val.trim());
        console.log('[concf] contractor:', val, '| noKey:', noKey, '| rows found:', contractorRows.length, '| sample no:', contractorRows[0]?.[noKey]);
        const next = _cfNextStatementNo(contractorRows, noKey);
        if (inp) {
            inp.value = next;
            inp.style.borderColor = 'rgba(245,200,66,0.6)';
            inp.title = 'آخر مستخلص للمقاول ' + val + ' + 1';
        }
        concfBuildHistory(rows, val);
    };

    if (_concfRowsCache && _concfRowsCache.length) {
        _calcAndShow(_concfRowsCache);
    } else {
        if (inp) { inp.value = ''; inp.placeholder = '⏳ جاري الجلب...'; }
        _cfFetchRows(CONTRACTOR_CF_SHEET_READ_ID).then(({ rows }) => {
            _concfRowsCache = rows;
            _calcAndShow(rows);
            if (inp) inp.placeholder = 'مثال: 001';
        }).catch(e => {
            console.warn('concf fetch on contractor select:', e.message);
            if (inp) inp.placeholder = 'مثال: 001';
        });
    }
}

function concfSyncContractorText(val) {
    document.getElementById('concf_contractor').value = val;
}

function concfSetMode(mode) {
    const btn   = document.getElementById('concf_submit_btn');
    const badge = document.getElementById('concf_edit_badge');
    if (mode === 'edit') {
        if (btn) { btn.textContent = '💾 حفظ التعديلات'; btn.style.background = 'linear-gradient(135deg,#2196f3,#1565c0)'; btn.style.color = 'white'; }
        if (badge) badge.style.display = 'flex';
    } else {
        if (btn) { btn.textContent = '💾 حفظ في السجل'; btn.style.background = 'linear-gradient(135deg,#f5c842,#e8a800)'; btn.style.color = '#1a0a2e'; }
        if (badge) badge.style.display = 'none';
    }
}

function concfLoadRowForEdit(rowJson) {
    const row = (typeof rowJson === 'string') ? JSON.parse(rowJson) : rowJson;
    _concfEditingRow = row;
    concfSetMode('edit');
    const keys = Object.keys(row).filter(k => !k.startsWith('__'));
    const cKey     = keys.find(k => /contractor|مقاول/i.test(k))      || keys[0];
    const noKey    = keys.find(k => /statement|مستخلص|رقم/i.test(k))  || keys[1];
    const dateKey  = keys.find(k => /date|تاريخ/i.test(k))            || keys[2];
    const totalKey = keys.find(k => /total|إجمالي|مستحق/i.test(k));
    const spentKey = keys.find(k => /spent|مصروف|مدفوع|منصرف/i.test(k));
    const notesKey = keys.find(k => /notes|ملاحظ/i.test(k));

    // --- المقاول ---
    const cVal = row[cKey] || '';
    const sel  = document.getElementById('concf_contractor_select');
    if (sel) {
        const existing = [...sel.options].find(o => o.value === cVal.trim());
        if (!existing && cVal) {
            const opt = document.createElement('option');
            opt.value = cVal; opt.textContent = cVal;
            sel.appendChild(opt);
        }
        sel.value = cVal.trim();
    }
    document.getElementById('concf_contractor').value = cVal;

    // --- رقم المستخلص: أظهر الخانة وامل القيمة ---
    const noWrap = document.getElementById('concf_statement_no_wrap');
    if (noWrap) noWrap.style.display = 'block';
    const noInp = document.getElementById('concf_statement_no');
    if (noInp) {
        noInp.value = row[noKey] || '';
        noInp.style.borderColor = 'rgba(245,200,66,0.6)';
    }

    // --- التاريخ ---
    document.getElementById('concf_date').value = row[dateKey] || '';

    // --- المستحق صرفه (total) ---
    if (totalKey) document.getElementById('concf_total').value = String(row[totalKey] || '').replace(/,/g,'');

    // --- المنصرف سابقاً (spent) ---
    if (spentKey) document.getElementById('concf_spent').value = String(row[spentKey] || '').replace(/,/g,'');

    // --- الملاحظات ---
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
        const cKey = Object.keys(rows[0] || {}).find(k => /contractor|مقاول/i.test(k)) || '';
        displayRows = rows.filter(r => (r[cKey] || '').trim() === filterContractor.trim());
    }
    if (!displayRows.length) { panel.style.display = 'none'; return; }
    const keys = Object.keys(displayRows[0]).filter(k => !k.startsWith('__'));
    const noKey     = keys.find(k => /statement|مستخلص|رقم/i.test(k)) || keys[0];
    const dateKey   = keys.find(k => /date|تاريخ/i.test(k)) || keys[1];
    const totalKey  = keys.find(k => /total|إجمالي/i.test(k));
    const cKey      = keys.find(k => /contractor|مقاول/i.test(k));
    list.innerHTML = displayRows.slice().reverse().map((row, i) => {
        const num  = row[noKey]    || '-';
        const date = row[dateKey]  || '-';
        const tot  = totalKey ? row[totalKey] : '-';
        const con  = cKey ? row[cKey] : '';
        const bg   = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
        return `<div onclick="concfLoadRowForEdit(${JSON.stringify(row).replace(/"/g,'&quot;')})"
            style="display:flex;align-items:center;justify-content:space-between;gap:8px;
                   padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);
                   background:${bg};transition:background 0.15s;"
            onmouseover="this.style.background='rgba(245,200,66,0.1)'"
            onmouseout="this.style.background='${bg}'">
            <span style="font-size:12px;font-weight:700;color:#f5c842;font-family:'Cairo',sans-serif;">${num}</span>
            ${!filterContractor && con ? `<span style="font-size:10px;color:rgba(255,255,255,0.5);font-family:'Cairo',sans-serif;">${con}</span>` : ''}
            <span style="font-size:11px;color:rgba(255,255,255,0.5);font-family:'Cairo',sans-serif;">${date}</span>
            <span style="font-size:12px;font-weight:700;color:#5cc890;font-family:'Cairo',sans-serif;">${parseFloat(String(tot).replace(/,/g,''))||tot}</span>
            <span style="font-size:10px;color:rgba(245,200,66,0.8);font-family:'Cairo',sans-serif;">تعديل ✎</span>
        </div>`;
    }).join('');
    panel.style.display = 'block';
}

function concfReset(keepDate = false) {
    document.getElementById('concf_contractor_select').value = '';
    document.getElementById('concf_contractor').value = '';
    if (document.getElementById('concf_contractor_text')) document.getElementById('concf_contractor_text').value = '';
    document.getElementById('concf_statement_no').value = '';
    // أخفِ خانة رقم المستخلص حتى يختار المقاول
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
    const total   = parseFloat(document.getElementById('concf_total').value) || 0;
    const spent   = parseFloat(document.getElementById('concf_spent').value) || 0;
    const remaining = Math.max(0, total - spent);
    const preview = document.getElementById('concf_preview');
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
    fb.style.display = 'block';
    fb.style.background = type === 'success' ? 'rgba(39,174,106,0.15)' : type === 'loading' ? 'rgba(245,200,66,0.1)' : 'rgba(244,67,54,0.15)';
    fb.style.border = type === 'success' ? '1px solid rgba(39,174,106,0.4)' : type === 'loading' ? '1px solid rgba(245,200,66,0.3)' : '1px solid rgba(244,67,54,0.4)';
    fb.style.color = type === 'success' ? '#5cc890' : type === 'loading' ? '#f5c842' : '#ff8a80';
    fb.textContent = msg;
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

    if (!contractor)   { concfShowFeedback('❌ يرجى اختيار المقاول', 'error'); return; }
    if (!statement_no) { concfShowFeedback('❌ رقم المستخلص غير موجود', 'error'); return; }
    if (!date)         { concfShowFeedback('❌ يرجى اختيار التاريخ', 'error'); return; }
    if (!total || total <= 0) { concfShowFeedback('❌ يرجى إدخال المستحق صرفه', 'error'); return; }

    const btn = document.getElementById('concf_submit_btn');
    btn.disabled = true;
    btn.textContent = '⏳ جاري الحفظ...';
    concfShowFeedback('⏳ جاري إرسال البيانات...', 'loading');

    const rowIndex = isEdit ? (_concfEditingRow['__rowIndex'] || null) : null;

    try {
        const r = await fetch(CONTRACTOR_CF_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: isEdit ? 'update' : 'insert',
                rowIndex,
                contractor,
                statement_no,
                date,
                total:  Number(total),
                spent:  Number(spent),
                notes
            }),
            redirect: 'follow'
        });
        const text = await r.text();
        let resp = {};
        try { resp = JSON.parse(text); } catch(e) {}
        if (resp.status === 'success' || r.ok) {
            const msg = isEdit ? '✅ تم تحديث مستخلص المقاول!' : '✅ تم حفظ المستخلص في سجل المقاولين!';
            concfShowFeedback(msg, 'success');
            showAlert(msg, 'success');
            _concfRowsCache = null;
            setTimeout(() => concfReset(), 2500);
        } else {
            throw new Error(resp.message || 'فشل الحفظ');
        }
    } catch(e) {
        console.error('Contractor CF submit error:', e);
        concfShowFeedback('❌ تعذر الحفظ: ' + (e.message || 'خطأ في الاتصال'), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = isEdit ? '💾 حفظ التعديلات' : '💾 حفظ في السجل';
    }
}

// expose globals
window.openCompanyCashflowForm    = openCompanyCashflowForm;
window.closeCompanyCashflowForm   = closeCompanyCashflowForm;
window.ccfSubmit                  = ccfSubmit;
window.ccfUpdatePreview           = ccfUpdatePreview;
window.ccfLoadRowForEdit          = ccfLoadRowForEdit;
window.ccfReset                   = ccfReset;
window.ccfOpenHistory             = ccfOpenHistory;
window.openContractorCashflowForm = openContractorCashflowForm;
window.closeContractorCashflowForm= closeContractorCashflowForm;
window.concfSubmit                = concfSubmit;
window.concfUpdatePreview         = concfUpdatePreview;
window.concfLoadRowForEdit        = concfLoadRowForEdit;
window.concfReset                 = concfReset;
window.concfSyncContractor        = concfSyncContractor;
window.concfSyncContractorText    = concfSyncContractorText;
window.concfBuildHistory          = concfBuildHistory;
window.concfSetMode               = concfSetMode;
