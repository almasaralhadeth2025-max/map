/* ====================================================
   BILLS DASHBOARD
   ==================================================== */

let bdAllRows    = [];
let bdHeaders    = [];
let bdColMap     = {};
let bdLoaded     = false;
let bdSheetCache = {};   // sheetId → { doneQty, totalQty } — cache لتفادي إعادة الجلب

/* ── Open / Close ── */
function openBillsModal() {
    openModal('billsModal');
    bdSheetCache = {};   // امسح الكاش عند كل فتح عشان يجيب أحدث بيانات
    loadBillsData();
}

function closeBillsModal() {
    closeModal('billsModal');
}

/* ── Reports Tab Dropdown ── */
function toggleReportsDropdown(e) {
    e.stopPropagation();
    const dd  = document.getElementById('reportsDropdown');
    const tab = document.getElementById('navTabReports');
    const isOpen = dd.style.display === 'flex';
    // Close all other dropdowns/panels
    document.querySelectorAll('.tab-sub-dropdown').forEach(d => d.style.display = 'none');
    document.querySelectorAll('.notif-panel,.theme-panel,.user-dropdown,.contractor-panel,.settings-panel').forEach(p => p.classList.remove('active'));
    if (!isOpen) {
        const rect = tab.getBoundingClientRect();
        dd.style.left  = rect.left + 'px';
        dd.style.right = 'auto';
        dd.style.display = 'flex';
        tab.classList.add('active');
    } else {
        tab.classList.remove('active');
    }
}

function closeReportsDropdown() {
    const dd  = document.getElementById('reportsDropdown');
    const tab = document.getElementById('navTabReports');
    if (dd) dd.style.display = 'none';
    if (tab) tab.classList.remove('active');
}

/* ── Add Tab Dropdown ── */
function toggleAddDropdown(e) {
    e.stopPropagation();
    const dd  = document.getElementById('addDropdown');
    const tab = document.getElementById('navTabAdd');
    const isOpen = dd.style.display === 'flex';
    document.querySelectorAll('.tab-sub-dropdown').forEach(d => d.style.display = 'none');
    document.querySelectorAll('.notif-panel,.theme-panel,.user-dropdown,.contractor-panel,.settings-panel').forEach(p => p.classList.remove('active'));
    if (!isOpen) {
        const rect = tab.getBoundingClientRect();
        dd.style.left  = rect.left + 'px';
        dd.style.right = 'auto';
        dd.style.display = 'flex';
        tab.classList.add('active');
    } else {
        tab.classList.remove('active');
    }
}

function closeAddDropdown() {
    const dd  = document.getElementById('addDropdown');
    const tab = document.getElementById('navTabAdd');
    if (dd) dd.style.display = 'none';
    if (tab) tab.classList.remove('active');
}

document.addEventListener('click', () => { closeReportsDropdown(); closeAddDropdown(); });


function bdFmt(v) {
    const raw = String(v || '').replace(/,/g, '').trim();
    const n = parseFloat(raw);
    if (isNaN(n) || raw === '') return '—';
    if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' مليار';
    if (Math.abs(n) >= 1_000_000)     return (n / 1_000_000).toFixed(2) + ' م';
    if (Math.abs(n) >= 1_000)         return (n / 1_000).toFixed(1) + ' ك';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function bdFmtFull(v) {
    const raw = String(v || '').replace(/,/g, '').trim();
    const n = parseFloat(raw);
    if (isNaN(n) || raw === '') return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function bdNum(v) {
    const n = parseFloat(String(v || '').replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
}

/* ── جلب DONE-QTY و TOTAL-QTY من شيت معين وتجميعهم ──
   المنطق:
   1. ابحث في categories عن البند الفرعي الذي number بتاعه = billNum
   2. اجلب الشيت بتاعه مباشرة عبر CSV export
   3. اجمع DONE-QTY و TOTAL-QTY من كل صفوف الشيت
   4. الكاش يمنع إعادة الجلب إذا نفس الشيت مطلوب مرة تانية     ── */
async function bdFetchSheetTotals(sheetId) {
    if (!sheetId) return { doneQty: 0, totalQty: 0 };
    if (bdSheetCache[sheetId]) return bdSheetCache[sheetId];

    try {
        const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
        const r   = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const csv = await r.text();
        if (csv.trim().startsWith('<')) throw new Error('not public');

        const lines   = csv.split('\n').filter(l => l.trim());
        if (lines.length < 2) { bdSheetCache[sheetId] = { doneQty: 0, totalQty: 0 }; return bdSheetCache[sheetId]; }

        const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
        const doneIdx  = headers.findIndex(h => h === 'DONE-QTY'  || h === 'DONE_QTY');
        const totalIdx = headers.findIndex(h => h === 'TOTAL-QTY' || h === 'TOTAL_QTY');

        let doneQty = 0, totalQty = 0;
        for (let i = 1; i < lines.length; i++) {
            const vals = lines[i].split(',').map(v => v.trim());
            if (doneIdx  !== -1) doneQty  += bdNum(vals[doneIdx]  || 0);
            if (totalIdx !== -1) totalQty += bdNum(vals[totalIdx] || 0);
        }

        bdSheetCache[sheetId] = { doneQty, totalQty };
        return bdSheetCache[sheetId];

    } catch(e) {
        console.warn('bdFetchSheetTotals failed for', sheetId, e.message);
        bdSheetCache[sheetId] = { doneQty: 0, totalQty: 0, error: true };
        return bdSheetCache[sheetId];
    }
}

/* ── ابحث في categories عن شيت البند الفرعي المرتبط برقم بند معين ──
   البند الفرعي له خاصية `number` (رقم البند) و `sheetId`
   المطابقة: sub.number === billNum (بعد trim)                          ── */
function bdFindSubForBill(billNum) {
    const bn = String(billNum || '').trim();
    if (!bn) return null;
    for (const cat of (categories || [])) {
        for (const sub of (cat.subitems || [])) {
            if (String(sub.number || '').trim() === bn && sub.sheetId) {
                return sub;
            }
        }
    }
    return null;
}

/* ── Main loader ── */
async function loadBillsData() {
    const wrap = document.getElementById('bdTableWrap');
    if (!wrap) return;

    wrap.innerHTML = '<div class="bd-msg bd-msg-load">⏳ جاري تحميل بيانات البنود...</div>';
    document.getElementById('bdCountBadge').textContent = 'جاري التحميل...';

    ['bdKpiTotalVal','bdKpiDoneVal','bdKpiRemVal','bdKpiPct'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '—';
    });
    ['bdKpiDoneBar','bdKpiPctBar'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.width = '0%';
    });

    try {
        /* ── 1. جلب شيت البنود (5 أعمدة) ── */
        const url = `https://docs.google.com/spreadsheets/d/${BILLS_SHEET_ID}/export?format=csv&gid=0`;
        const r   = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const csv = await r.text();

        if (csv.trim().startsWith('<')) {
            wrap.innerHTML = `<div class="bd-msg bd-msg-err">
                ⚠️ شيت البنود يحتاج إعداد المشاركة العامة<br>
                <small style="opacity:0.7;">(Share → Anyone with the link → Viewer)</small>
            </div>`;
            return;
        }

        const lines = csv.split('\n').filter(l => l.trim());
        if (!lines.length) {
            wrap.innerHTML = '<div class="bd-msg bd-msg-err">لا توجد بيانات في الشيت</div>';
            return;
        }

        /*
         * أعمدة شيت البنود — بالترتيب الثابت:
         *  [0] رقم البند      ← يُطابق مع sub.number في categories
         *  [1] منطوق البند
         *  [2] الوحدة
         *  [3] السعر
         *  [4] الكمية الإجمالية
        */
        bdHeaders = parseCSVLine(lines[0]);
        bdColMap  = {
            num:      bdHeaders[0] || null,
            name:     bdHeaders[1] || null,
            unit:     bdHeaders[2] || null,
            price:    bdHeaders[3] || null,
            totalQty: bdHeaders[4] || null,
        };

        /* ── 2. بناء قائمة الصفوف مع sheetId لكل بند ── */
        const rawRows = [];
        for (let i = 1; i < lines.length; i++) {
            const vals = parseCSVLine(lines[i]);
            if (!vals.some(v => v.trim())) continue;
            const row = {};
            bdHeaders.forEach((h, idx) => { row[h] = vals[idx] || ''; });

            const billNum  = String(row[bdColMap.num]      || '').trim();
            const price    = bdNum(row[bdColMap.price]    || 0);
            const totalQty = bdNum(row[bdColMap.totalQty] || 0);
            const totalVal = price * totalQty;

            // ابحث عن البند الفرعي المرتبط
            const sub = bdFindSubForBill(billNum);

            row['__billNum']  = billNum;
            row['__price']    = price;
            row['__totalQty'] = totalQty;
            row['__totalVal'] = totalVal;
            row['__sheetId']  = sub ? sub.sheetId : null;
            row['__subName']  = sub ? sub.name    : null;
            rawRows.push(row);
        }

        /* ── 3. جلب الكميات المنفذة من شيتات البنود الفرعية بالتوازي ── */
        wrap.innerHTML = '<div class="bd-msg bd-msg-load">⏳ جاري جلب الكميات المنفذة من الشيتات...</div>';

        // اجمع SheetIds الفريدة عشان مين يجيب شيت واحد مرتين
        const uniqueSheets = [...new Set(rawRows.map(r => r['__sheetId']).filter(Boolean))];
        await Promise.all(uniqueSheets.map(sid => bdFetchSheetTotals(sid)));

        /* ── 4. احسب الأرقام لكل صف ── */
        bdAllRows = rawRows.map(row => {
            const price    = row['__price'];
            const totalQty = row['__totalQty'];
            const totalVal = row['__totalVal'];
            const sheetId  = row['__sheetId'];

            let doneQty = 0, linked = false, sheetError = false;

            if (sheetId && bdSheetCache[sheetId]) {
                const cache = bdSheetCache[sheetId];
                if (!cache.error) {
                    doneQty    = cache.doneQty;
                    linked     = true;
                } else {
                    sheetError = true;
                }
            }

            const doneVal = price * doneQty;
            const remQty  = Math.max(0, totalQty - doneQty);
            const remVal  = Math.max(0, totalVal  - doneVal);
            const pct     = totalVal > 0 ? Math.min(100, (doneVal / totalVal) * 100) : 0;

            return {
                ...row,
                __doneQty   : doneQty,
                __doneVal   : doneVal,
                __remQty    : remQty,
                __remVal    : remVal,
                __pct       : pct,
                __linked    : linked,
                __sheetError: sheetError,
            };
        });

        bdLoaded = true;
        bdComputeKPIs(bdAllRows);
        bdRenderTable(bdAllRows);

        const linkedCount = bdAllRows.filter(r => r['__linked']).length;
        const notLinked   = bdAllRows.length - linkedCount;
        const now = new Date().toLocaleTimeString('ar-SA');
        document.getElementById('bdLastUpdate').textContent = 'آخر تحديث: ' + now;
        document.getElementById('bdFooterNote').textContent =
            bdAllRows.length + ' بند • ' +
            linkedCount + ' مرتبط بالشيتات' +
            (notLinked ? ' • ' + notLinked + ' بدون ربط' : '') +
            ' — ' + now;

    } catch(e) {
        console.error('Bills load error:', e);
        wrap.innerHTML = `<div class="bd-msg bd-msg-err">
            ❌ تعذر تحميل البيانات<br>
            <small style="opacity:0.7;">${e.message}</small>
        </div>`;
    }
}

/* ── KPI cards ── */
function bdComputeKPIs(rows) {
    let totalVal = 0, doneVal = 0;
    rows.forEach(row => {
        totalVal += row['__totalVal'] || 0;
        doneVal  += row['__doneVal']  || 0;
    });

    const remVal  = Math.max(0, totalVal - doneVal);
    const donePct = totalVal > 0 ? Math.min(100, Math.round((doneVal / totalVal) * 100)) : 0;

    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('bdKpiTotalVal', bdFmt(totalVal));
    setEl('bdKpiDoneVal',  bdFmt(doneVal));
    setEl('bdKpiDoneUnit', donePct + '% من الإجمالي');
    setEl('bdKpiRemVal',   bdFmt(remVal));
    setEl('bdKpiPct',      donePct + '%');
    setEl('bdKpiCount',    rows.length);

    setTimeout(() => {
        const doneBar = document.getElementById('bdKpiDoneBar');
        const pctBar  = document.getElementById('bdKpiPctBar');
        if (doneBar) doneBar.style.width = donePct + '%';
        if (pctBar) {
            pctBar.style.width      = donePct + '%';
            pctBar.style.background = donePct < 30
                ? 'linear-gradient(90deg,#e74c3c,#c0392b)'
                : donePct < 70
                ? 'linear-gradient(90deg,#f39c12,#e67e22)'
                : 'linear-gradient(90deg,#27ae60,#1e8449)';
        }
    }, 80);
}

/* ── Data table ── */
function bdRenderTable(rows) {
    const badge = document.getElementById('bdCountBadge');
    const wrap  = document.getElementById('bdTableWrap');
    if (!badge || !wrap) return;

    badge.textContent = rows.length + ' بند';

    if (!rows.length) {
        wrap.innerHTML = '<div class="bd-msg bd-msg-load">لا توجد نتائج مطابقة للبحث</div>';
        return;
    }

    let html = `<div class="bd-tbl-wrap"><table class="bd-tbl"><thead><tr>
        <th style="min-width:80px;">رقم البند</th>
        <th style="min-width:200px;">منطوق البند</th>
        <th>الوحدة</th>
        <th>السعر</th>
        <th style="min-width:90px;">الكمية الإجمالية</th>
        <th style="min-width:110px;">القيمة الإجمالية</th>
        <th style="min-width:90px;">الكمية المنفذة</th>
        <th style="min-width:110px;">القيمة المنفذة</th>
        <th style="min-width:90px;">الكمية المتبقية</th>
        <th style="min-width:110px;">القيمة المتبقية</th>
        <th style="min-width:130px;">نسبة التنفيذ</th>
    <tr></thead><tbody>`;

    rows.forEach(row => {
        const numVal  = row['__billNum']       || '—';
        const nameVal = row[bdColMap.name]     || '—';
        const unit    = row[bdColMap.unit]     || '—';
        const price   = row['__price']         || 0;
        const tQty    = row['__totalQty']      || 0;
        const tVal    = row['__totalVal']      || 0;
        const dQty    = row['__doneQty']       || 0;
        const dVal    = row['__doneVal']       || 0;
        const rQty    = row['__remQty']        || 0;
        const rVal    = row['__remVal']        || 0;
        const pct     = row['__pct']           || 0;
        const pctRnd  = Math.round(pct);
        const linked  = row['__linked'];
        const errored = row['__sheetError'];

        const pctColor = pctRnd < 30 ? '#ff8a80' : pctRnd < 70 ? '#ffb74d' : '#5cc890';

        // حالة العمود: مرتبط / خطأ في الشيت / بدون ربط
        const statusDone = linked
            ? bdFmtFull(dQty)
            : errored
            ? '<span style="color:#ff8a80;font-size:10px;">⚠ خطأ في الشيت</span>'
            : '<span style="opacity:0.3;font-size:11px;">غير مرتبط</span>';

        const statusVal = linked
            ? bdFmtFull(dVal)
            : errored
            ? '<span style="color:#ff8a80;font-size:10px;">⚠</span>'
            : '<span style="opacity:0.3;">—</span>';

        const statusRemQ = linked
            ? bdFmtFull(rQty)
            : '<span style="opacity:0.3;">—</span>';

        const statusRemV = linked
            ? bdFmtFull(rVal)
            : '<span style="opacity:0.3;">—</span>';

        const statusPct = linked
            ? `<div style="display:flex;align-items:center;gap:7px;">
                <div class="bd-pct-bw" style="flex:1;min-width:60px;">
                    <div class="bd-pct-b" style="width:${pctRnd}%;background:${pctColor};"></div>
                </div>
                <span style="font-size:11px;font-weight:900;color:${pctColor};min-width:36px;text-align:left;font-family:'Cairo',sans-serif;">${pctRnd}%</span>
               </div>`
            : `<span style="opacity:0.3;font-size:11px;">${errored ? '⚠ خطأ' : 'أضف رقم البند للبند الفرعي'}</span>`;

        // tooltip يوضح اسم البند الفرعي المرتبط
        const subHint = row['__subName']
            ? ` title="مرتبط بـ: ${row['__subName']}"`
            : '';

        html += `<tr style="${!linked && !errored ? 'opacity:0.55;' : ''}">
            <td><span class="bd-num-pill"${subHint}>${numVal}</span></td>
            <td style="max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                title="${nameVal.replace(/"/g,"'")}">${nameVal}</td>
            <td style="color:rgba(255,255,255,0.5);font-size:11px;">${unit}</td>
            <td class="bdn">${bdFmtFull(price)}</td>
            <td class="bdn">${bdFmtFull(tQty)}</td>
            <td class="bdn">${bdFmtFull(tVal)}</td>
            <td class="bdg">${statusDone}</td>
            <td class="bdg">${statusVal}</td>
            <td class="bdb">${statusRemQ}</td>
            <td class="bdr">${statusRemV}</td>
            <td>${statusPct}</td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;
}

/* ── Search / Filter ── */
function bdFilterRows() {
    const q = (document.getElementById('bdSearchInput').value || '').trim().toLowerCase();
    if (!q) {
        bdRenderTable(bdAllRows);
        bdComputeKPIs(bdAllRows);
        return;
    }
    const filtered = bdAllRows.filter(row => {
        const numVal  = String(row['__billNum']    || '').toLowerCase();
        const nameVal = String(row[bdColMap.name]  || '').toLowerCase();
        return numVal.includes(q) || nameVal.includes(q);
    });
    bdRenderTable(filtered);
    bdComputeKPIs(filtered);
}

