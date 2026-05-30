/* ====================================================
   AUTOFILL PATCH — equipment_autofill_patch.js
   يُضاف بعد equipment.js وبعد equipment_camera_patch.js

   الوظيفة:
   بعد اختيار العنصر أو تغيير التاريخ، يبحث في Sheet2
   عن صف يطابق (element_id + date) — إذا وُجد يملأ:
     • المقاول
     • الكمية المنفذة
     • حالة الصورة (بادج تنبيه)
     • أنواع المعدات وعددها
   مع بادج تنبيه واضح "تم تحميل سجل موجود"
   ==================================================== */

/* ══════════════════════════════════════════════════
   مؤشرات أعمدة Sheet2 (بعد v4 مع PHOTO)
   element_id | element_name | item_name | contractor | date | done_qty | PHOTO | type1 | count1 | ...
       0             1             2            3         4       5         6       7        8
   ══════════════════════════════════════════════════ */
const _AF_COL = {
    ELEMENT_ID  : 0,
    ELEMENT_NAME: 1,
    ITEM_NAME   : 2,
    CONTRACTOR  : 3,
    DATE        : 4,
    DONE_QTY    : 5,
    PHOTO       : 6,
    EQUIP_START : 7,
};

/* ── كاش Sheet2 ── */
let _afSheet2Cache   = null;
let _afSheet2Loading = false;

/* ══════════════════════════════════════════════════
   1. جلب Sheet2 كـ CSV وتخزينها
   ══════════════════════════════════════════════════ */
async function afFetchSheet2() {
    if (_afSheet2Loading) return;
    _afSheet2Loading = true;
    _afSheet2Cache   = null;

    try {
        /* Sheet2 = gid=1 في معظم الحالات
           لو الشيت رفض، جرب: &sheet=Sheet2 بدل gid=1  */
        const url = `https://docs.google.com/spreadsheets/d/${EQ_REG_SHEET_ID}/export?format=csv&gid=1`;
        const r   = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const csv = await r.text();
        if (csv.trim().startsWith('<')) throw new Error('not public');

        const lines = csv.split('\n').filter(l => l.trim());
        if (lines.length < 2) { _afSheet2Cache = []; return; }

        /* CSV parser بسيط يدعم الاقتباسات */
        const parseRow = function(line) {
            var result = [], cur = '', inQ = false;
            for (var i = 0; i < line.length; i++) {
                var ch = line[i];
                if (ch === '"') {
                    if (inQ && line[i+1] === '"') { cur += '"'; i++; }
                    else inQ = !inQ;
                } else if (ch === ',' && !inQ) {
                    result.push(cur.trim()); cur = '';
                } else {
                    cur += ch;
                }
            }
            result.push(cur.trim());
            return result;
        };

        _afSheet2Cache = [];
        for (var i = 1; i < lines.length; i++) {
            var vals = parseRow(lines[i]);
            if (!vals[0] && !vals[1]) continue;
            _afSheet2Cache.push({
                vals      : vals,
                elementId : (vals[_AF_COL.ELEMENT_ID] || '').trim(),
                date      : (vals[_AF_COL.DATE]        || '').trim(),
            });
        }
    } catch(e) {
        console.warn('[autofill] Sheet2 fetch failed:', e.message);
        _afSheet2Cache = [];
    } finally {
        _afSheet2Loading = false;
    }
}

/* ══════════════════════════════════════════════════
   2. البحث عن آخر صف مطابق (element_id + date)
   ══════════════════════════════════════════════════ */
function afFindRow(elementId, date) {
    if (!_afSheet2Cache || !elementId || !date) return null;

    /* توحيد صيغة التاريخ للمقارنة */
    var normDate = function(d) {
        if (!d) return '';
        var m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) return m[3] + '-' + m[2] + '-' + m[1];
        return d.slice(0, 10);
    };

    var targetDate = normDate(date);

    /* نبحث من الأسفل للأعلى للحصول على آخر إدخال */
    for (var i = _afSheet2Cache.length - 1; i >= 0; i--) {
        var row = _afSheet2Cache[i];
        if (row.elementId === elementId && normDate(row.date) === targetDate) {
            return row.vals;
        }
    }
    return null;
}

/* ══════════════════════════════════════════════════
   3. ملء الفورم من الصف المطابق
   ══════════════════════════════════════════════════ */
function afFillForm(vals) {
    if (!vals) return;

    /* ── المقاول ── */
    var contractor = (vals[_AF_COL.CONTRACTOR] || '').trim();
    if (contractor) {
        var sel = document.getElementById('eqf_contractor');
        if (sel) {
            var found = false;
            for (var i = 0; i < sel.options.length; i++) {
                if (sel.options[i].value === contractor) { found = true; break; }
            }
            if (!found) {
                var opt = document.createElement('option');
                opt.value = opt.textContent = contractor;
                sel.appendChild(opt);
            }
            sel.value = contractor;
        }
    }

    /* ── الكمية المنفذة ── */
    var doneQty = (vals[_AF_COL.DONE_QTY] || '').trim();
    var doneInp = document.getElementById('eqf_done_qty');
    if (doneInp && doneQty !== '') doneInp.value = doneQty;

    /* ── حالة الصورة ── */
    var photoVal = (vals[_AF_COL.PHOTO] || '').trim();
    afShowPhotoStatus(photoVal);

    /* ── أنواع المعدات ── */
    afFillEquipments(vals);

    /* ── بادج التنبيه ── */
    afShowLoadedBadge();
}

/* ── بادج الصورة السابقة ── */
function afShowPhotoStatus(photoVal) {
    var old = document.getElementById('af_photo_badge');
    if (old) old.remove();

    if (!photoVal) return;

    var wrap = document.getElementById('eqf_photo_preview_wrap');
    if (!wrap) return;

    var badge = document.createElement('div');
    badge.id = 'af_photo_badge';
    badge.style.cssText = [
        'display:inline-flex', 'align-items:center', 'gap:6px',
        'padding:6px 12px',
        'background:rgba(245,200,66,0.12)',
        'border:1px solid rgba(245,200,66,0.35)',
        'border-radius:8px',
        'font-size:11px', 'font-weight:700',
        'color:#f5c842',
        'font-family:\'Cairo\',sans-serif',
        'margin-top:6px',
    ].join(';');
    badge.textContent = '📷 يوجد صورة مسجلة لهذا اليوم — التقط صورة جديدة لاستبدالها';
    wrap.appendChild(badge);
}

/* ── ملء صفوف المعدات ── */
function afFillEquipments(vals) {
    var container = document.getElementById('eqf_equipments_container');
    if (!container) return;

    /* اجمع الأزواج (type, count) */
    var pairs = [];
    for (var j = _AF_COL.EQUIP_START; j + 1 < vals.length; j += 2) {
        var typeName = (vals[j]   || '').trim();
        var count    = (vals[j+1] || '').trim();
        if (typeName) pairs.push({ type: typeName, count: count || '0' });
    }
    if (!pairs.length) return;

    /* امسح الصفوف الحالية */
    container.innerHTML = '';
    window.eqFormEquipmentCount = 0;

    /* أضف صف لكل نوع معدة */
    pairs.forEach(function(pair) {
        if (window.eqAddEquipmentRow) window.eqAddEquipmentRow();

        var rowId   = 'eqrow_' + window.eqFormEquipmentCount;
        var typeSel = document.getElementById(rowId + '_type');
        var cntInp  = document.getElementById(rowId + '_count');

        if (typeSel) {
            /* أضف الخيار مؤقتاً لو مش موجود */
            var found = false;
            for (var i = 0; i < typeSel.options.length; i++) {
                if (typeSel.options[i].value === pair.type) { found = true; break; }
            }
            if (!found) {
                var opt = document.createElement('option');
                opt.value = opt.textContent = pair.type;
                typeSel.appendChild(opt);
            }
            typeSel.value = pair.type;
        }
        if (cntInp) cntInp.value = pair.count;
    });
}

/* ── بادج "تم تحميل سجل موجود" ── */
function afShowLoadedBadge() {
    var old = document.getElementById('af_loaded_badge');
    if (old) old.remove();

    /* أدرجه فوق حقل feedback */
    var fb = document.getElementById('eqf_feedback');
    if (!fb || !fb.parentElement) return;

    var badge = document.createElement('div');
    badge.id = 'af_loaded_badge';
    badge.style.cssText = [
        'display:flex', 'align-items:center', 'gap:8px',
        'padding:10px 14px',
        'background:rgba(245,200,66,0.1)',
        'border:1px solid rgba(245,200,66,0.4)',
        'border-radius:10px',
        'margin-bottom:10px',
        'font-size:12px', 'font-weight:700',
        'color:#f5c842',
        'font-family:\'Cairo\',sans-serif',
    ].join(';');
    badge.innerHTML =
        '<span style="font-size:16px;flex-shrink:0;">📋</span>' +
        '<span style="flex:1;">تم تحميل سجل موجود لهذا العنصر في نفس التاريخ — يمكنك تعديله وإعادة الحفظ</span>' +
        '<button onclick="afClearBadge()" style="' +
            'background:none;border:1px solid rgba(245,200,66,0.4);' +
            'color:rgba(245,200,66,0.8);padding:3px 9px;border-radius:6px;' +
            'font-size:10px;font-weight:700;font-family:\'Cairo\',sans-serif;cursor:pointer;' +
        '">✕</button>';

    fb.parentElement.insertBefore(badge, fb);
}

/* ══════════════════════════════════════════════════
   4. مسح البادجات
   ══════════════════════════════════════════════════ */
function afClearBadge() {
    ['af_loaded_badge', 'af_photo_badge'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    });
}

/* ══════════════════════════════════════════════════
   5. الدالة الرئيسية — تُستدعى عند اختيار عنصر أو تغيير تاريخ
   ══════════════════════════════════════════════════ */
async function afCheckAndFill() {
    var elementId = (document.getElementById('eqf_element_id')?.value || '').trim();
    var date      = (document.getElementById('eqf_date')?.value      || '').trim();

    afClearBadge();

    if (!elementId || !date) return;

    /* إذا الكاش فارغ اجلبه أولاً */
    if (_afSheet2Cache === null) {
        await afFetchSheet2();
    }

    var vals = afFindRow(elementId, date);
    if (vals) afFillForm(vals);
}

/* ══════════════════════════════════════════════════
   6. ربط الأحداث
   ══════════════════════════════════════════════════ */

/* عند اختيار عنصر من القائمة أو الخريطة */
var _origEqSelectElement_af = window.eqSelectElement;
window.eqSelectElement = function(id, name) {
    if (_origEqSelectElement_af) _origEqSelectElement_af(id, name);
    setTimeout(afCheckAndFill, 80);
};

/* عند تغيير التاريخ */
document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'eqf_date') {
        setTimeout(afCheckAndFill, 60);
    }
});

/* عند فتح الفورم — جلب أحدث بيانات */
var _origOpenEqForm_af = window.openEquipmentFormModal;
window.openEquipmentFormModal = function() {
    if (_origOpenEqForm_af) _origOpenEqForm_af.apply(this, arguments);
    _afSheet2Cache = null;
    afFetchSheet2();
};

/* عند إعادة تعيين الفورم */
var _origEqReset_af = window.eqResetForm;
window.eqResetForm = function() {
    afClearBadge();
    if (_origEqReset_af) _origEqReset_af.apply(this, arguments);
};

/* ══════════════════════════════════════════════════
   7. تصدير
   ══════════════════════════════════════════════════ */
window.afCheckAndFill = afCheckAndFill;
window.afClearBadge   = afClearBadge;
window.afFetchSheet2  = afFetchSheet2;
