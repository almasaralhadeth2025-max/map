/* ====================================================
   AUTOFILL PATCH — equipment_autofill_patch.js
   يُضاف بعد equipment.js وبعد equipment_camera_patch.js
   ==================================================== */

/* ── كاش ومؤشرات الأعمدة (تُكتشف تلقائياً من الهيدر) ── */
let _afSheet2Cache   = null;
let _afSheet2Loading = false;
let _AF_COL = {
    ELEMENT_ID  : 0,
    ELEMENT_NAME: 1,
    ITEM_NAME   : 2,
    CONTRACTOR  : 3,
    DATE        : 4,
    DONE_QTY    : 5,
    PHOTO       : -1,   // -1 = غير موجود
    EQUIP_START : 6,
};

/* ══════════════════════════════════════════════════
   اكتشاف الأعمدة تلقائياً من الهيدر الفعلي
   ══════════════════════════════════════════════════ */
function afDetectColumns(headerVals) {
    var h = headerVals.map(function(v){ return (v||'').trim().toLowerCase(); });

    function find(names) {
        for (var i=0; i<h.length; i++)
            for (var j=0; j<names.length; j++)
                if (h[i] === names[j]) return i;
        return -1;
    }

    _AF_COL.ELEMENT_ID   = find(['element_id','id']);
    _AF_COL.ELEMENT_NAME = find(['element_name']);
    _AF_COL.ITEM_NAME    = find(['item_name']);
    _AF_COL.CONTRACTOR   = find(['contractor']);
    _AF_COL.DATE         = find(['date']);
    _AF_COL.DONE_QTY     = find(['done_qty','done-qty']);
    _AF_COL.PHOTO        = find(['photo']);

    /* EQUIP_START = أول عمود اسمه type1 */
    var t1 = find(['type1']);
    if (t1 !== -1) {
        _AF_COL.EQUIP_START = t1;
    } else {
        /* fallback: بعد آخر عمود ثابت */
        var cols = [_AF_COL.ELEMENT_ID, _AF_COL.ELEMENT_NAME, _AF_COL.ITEM_NAME,
                    _AF_COL.CONTRACTOR, _AF_COL.DATE, _AF_COL.DONE_QTY, _AF_COL.PHOTO];
        var maxFixed = Math.max.apply(null, cols.filter(function(x){ return x>=0; }));
        _AF_COL.EQUIP_START = maxFixed + 1;
    }

    console.log('[autofill] cols:', JSON.stringify(_AF_COL));
    console.log('[autofill] headers:', headerVals.slice(0,12).join(' | '));
}

/* ══════════════════════════════════════════════════
   جلب Sheet2
   ══════════════════════════════════════════════════ */
async function afFetchSheet2() {
    if (_afSheet2Loading) return;
    _afSheet2Loading = true;
    _afSheet2Cache   = null;

    try {
        const url = `https://docs.google.com/spreadsheets/d/${EQ_REG_SHEET_ID}/export?format=csv&gid=987650458`;
        const r   = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const csv = await r.text();
        if (csv.trim().startsWith('<')) throw new Error('not public or wrong gid');

        const lines = csv.split('\n').filter(l => l.trim());
        if (lines.length < 2) { _afSheet2Cache = []; return; }

        /* CSV parser */
        function parseRow(line) {
            var result=[], cur='', inQ=false;
            for (var i=0; i<line.length; i++) {
                var ch = line[i];
                if (ch==='"') {
                    if (inQ && line[i+1]==='"') { cur+='"'; i++; }
                    else inQ=!inQ;
                } else if (ch===',' && !inQ) { result.push(cur.trim()); cur=''; }
                else cur+=ch;
            }
            result.push(cur.trim());
            return result;
        }

        /* اكتشاف الأعمدة من الهيدر */
        var headerVals = parseRow(lines[0]);
        afDetectColumns(headerVals);

        _afSheet2Cache = [];
        for (var i=1; i<lines.length; i++) {
            var vals = parseRow(lines[i]);
            var eid  = _AF_COL.ELEMENT_ID >= 0 ? (vals[_AF_COL.ELEMENT_ID]||'').trim() : '';
            var date = _AF_COL.DATE        >= 0 ? (vals[_AF_COL.DATE]       ||'').trim() : '';
            if (!eid && !date) continue;
            _afSheet2Cache.push({ vals, elementId: eid, date });
        }

        console.log('[autofill] loaded', _afSheet2Cache.length, 'rows from Sheet2');

    } catch(e) {
        console.warn('[autofill] fetch failed:', e.message);
        _afSheet2Cache = [];
    } finally {
        _afSheet2Loading = false;
    }
}

/* ══════════════════════════════════════════════════
   البحث عن صف مطابق
   ══════════════════════════════════════════════════ */
function afFindRow(elementId, date) {
    if (!_afSheet2Cache || !elementId || !date) return null;

    function normDate(d) {
        if (!d) return '';
        /* DD-MM-YYYY → YYYY-MM-DD */
        var m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) return m[3]+'-'+m[2]+'-'+m[1];
        return d.slice(0,10);
    }

    var targetDate = normDate(date);
    console.log('[autofill] searching:', elementId, targetDate, '— cache rows:', _afSheet2Cache.length);

    /* من الأسفل للأعلى = آخر إدخال */
    for (var i=_afSheet2Cache.length-1; i>=0; i--) {
        var row = _afSheet2Cache[i];
        if (row.elementId === elementId && normDate(row.date) === targetDate) {
            console.log('[autofill] ✅ found row index', i);
            return row.vals;
        }
    }
    console.log('[autofill] ❌ no match');
    return null;
}

/* ══════════════════════════════════════════════════
   ملء الفورم
   ══════════════════════════════════════════════════ */
function afFillForm(vals) {
    if (!vals) return;

    /* المقاول */
    var contractor = _AF_COL.CONTRACTOR >= 0 ? (vals[_AF_COL.CONTRACTOR]||'').trim() : '';
    if (contractor) {
        var sel = document.getElementById('eqf_contractor');
        if (sel) {
            var found = [...sel.options].find(o => o.value === contractor);
            if (!found) {
                var opt = document.createElement('option');
                opt.value = opt.textContent = contractor;
                sel.appendChild(opt);
            }
            sel.value = contractor;
        }
    }

    /* الكمية المنفذة */
    if (_AF_COL.DONE_QTY >= 0) {
        var doneQty = (vals[_AF_COL.DONE_QTY]||'').trim();
        var doneInp = document.getElementById('eqf_done_qty');
        if (doneInp && doneQty !== '') doneInp.value = doneQty;
    }

    /* الصورة */
    if (_AF_COL.PHOTO >= 0) {
        var photoVal = (vals[_AF_COL.PHOTO]||'').trim();
        afShowPhotoStatus(photoVal);
    }

    /* المعدات */
    afFillEquipments(vals);

    /* بادج التنبيه */
    afShowLoadedBadge();
}

/* بادج الصورة */
function afShowPhotoStatus(photoVal) {
    var old = document.getElementById('af_photo_badge');
    if (old) old.remove();
    if (!photoVal) return;

    var wrap = document.getElementById('eqf_photo_preview_wrap');
    if (!wrap) return;

    var badge = document.createElement('div');
    badge.id = 'af_photo_badge';
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(245,200,66,0.12);border:1px solid rgba(245,200,66,0.35);border-radius:8px;font-size:11px;font-weight:700;color:#f5c842;font-family:Cairo,sans-serif;margin-top:6px;';
    badge.textContent = '📷 يوجد صورة مسجلة لهذا اليوم — التقط جديدة لاستبدالها';
    wrap.appendChild(badge);
}

/* ملء المعدات */
function afFillEquipments(vals) {
    var container = document.getElementById('eqf_equipments_container');
    if (!container) return;

    var pairs = [];
    for (var j=_AF_COL.EQUIP_START; j+1<vals.length; j+=2) {
        var typeName = (vals[j]  ||'').trim();
        var count    = (vals[j+1]||'').trim();
        if (typeName) pairs.push({ type: typeName, count: count||'0' });
    }
    if (!pairs.length) return;

    container.innerHTML = '';
    window.eqFormEquipmentCount = 0;

    pairs.forEach(function(pair) {
        if (window.eqAddEquipmentRow) window.eqAddEquipmentRow();

        var rowId   = 'eqrow_' + window.eqFormEquipmentCount;
        var typeSel = document.getElementById(rowId+'_type');
        var cntInp  = document.getElementById(rowId+'_count');

        if (typeSel) {
            var found = [...typeSel.options].find(o => o.value === pair.type);
            if (!found) {
                var opt = document.createElement('option');
                opt.value = opt.textContent = pair.type;
                typeSel.appendChild(opt);
            }
            typeSel.value = pair.type;
        }
        if (cntInp) cntInp.value = pair.count;
    });

    console.log('[autofill] filled', pairs.length, 'equipment rows');
}

/* بادج "تم تحميل سجل موجود" */
function afShowLoadedBadge() {
    var old = document.getElementById('af_loaded_badge');
    if (old) old.remove();

    var fb = document.getElementById('eqf_feedback');
    if (!fb || !fb.parentElement) return;

    var badge = document.createElement('div');
    badge.id = 'af_loaded_badge';
    badge.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(245,200,66,0.1);border:1px solid rgba(245,200,66,0.4);border-radius:10px;margin-bottom:10px;font-size:12px;font-weight:700;color:#f5c842;font-family:Cairo,sans-serif;';
    badge.innerHTML =
        '<span style="font-size:16px;flex-shrink:0;">📋</span>' +
        '<span style="flex:1;">تم تحميل سجل موجود لهذا العنصر في نفس التاريخ — يمكنك تعديله وإعادة الحفظ</span>' +
        '<button onclick="afClearBadge()" style="background:none;border:1px solid rgba(245,200,66,0.4);color:rgba(245,200,66,0.8);padding:3px 9px;border-radius:6px;font-size:10px;font-weight:700;font-family:Cairo,sans-serif;cursor:pointer;">✕</button>';

    fb.parentElement.insertBefore(badge, fb);
}

/* مسح البادجات */
function afClearBadge() {
    ['af_loaded_badge','af_photo_badge'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    });
}

/* ══════════════════════════════════════════════════
   الدالة الرئيسية
   ══════════════════════════════════════════════════ */
async function afCheckAndFill() {
    var elementId = (document.getElementById('eqf_element_id')?.value||'').trim();
    var date      = (document.getElementById('eqf_date')?.value     ||'').trim();

    afClearBadge();
    if (!elementId || !date) return;

    if (_afSheet2Cache === null) await afFetchSheet2();

    var vals = afFindRow(elementId, date);
    if (vals) afFillForm(vals);
}

/* ══════════════════════════════════════════════════
   ربط الأحداث
   ══════════════════════════════════════════════════ */

/* عند اختيار عنصر */
var _origEqSelectElement_af = window.eqSelectElement;
window.eqSelectElement = function(id, name) {
    if (_origEqSelectElement_af) _origEqSelectElement_af(id, name);
    setTimeout(afCheckAndFill, 100);
};

/* عند تغيير التاريخ */
document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'eqf_date') setTimeout(afCheckAndFill, 60);
});

/* عند فتح الفورم */
var _origOpenEqForm_af = window.openEquipmentFormModal;
window.openEquipmentFormModal = function() {
    if (_origOpenEqForm_af) _origOpenEqForm_af.apply(this, arguments);
    _afSheet2Cache = null;
    afFetchSheet2();
};

/* عند إعادة التعيين */
var _origEqReset_af = window.eqResetForm;
window.eqResetForm = function() {
    afClearBadge();
    if (_origEqReset_af) _origEqReset_af.apply(this, arguments);
};

/* تصدير */
window.afCheckAndFill = afCheckAndFill;
window.afClearBadge   = afClearBadge;
window.afFetchSheet2  = afFetchSheet2;
