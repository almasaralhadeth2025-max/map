/* ====================================================
   AUTOFILL PATCH — equipment_autofill_patch.js
   يُضاف بعد equipment.js وبعد equipment_camera_patch.js

   المنطق الصح:
   - كل بند فرعي عنده شيت خاص بيه (sheetId)
   - الـ saveDaily بيكتب في Sheet2 داخل نفس الشيت ده
   - عند اختيار عنصر + تاريخ، نجيب Sheet2 من شيت البند الفرعي
     ونبحث عن صف مطابق (element_id + date)
   ==================================================== */

/* ── كاش لكل sheetId — { sheetId: [rows] } ── */
var _afCache       = {};
var _afLoadingFor  = {};   // sheetId → true أثناء الجلب
var _afLastSheetId = null; // آخر شيت جُلب

/* ── مؤشرات الأعمدة (تُكتشف من الهيدر الفعلي) ── */
var _AF_COL = {
    ELEMENT_ID  : 0,
    ELEMENT_NAME: 1,
    ITEM_NAME   : 2,
    CONTRACTOR  : 3,
    DATE        : 4,
    DONE_QTY    : 5,
    PHOTO       : -1,
    EQUIP_START : 6,
};

/* ══════════════════════════════════════════════════
   1. اكتشاف الأعمدة من الهيدر
   ══════════════════════════════════════════════════ */
function afDetectColumns(headerVals) {
    var h = headerVals.map(function(v){ return (v||'').trim().toLowerCase(); });

    function find(names) {
        for (var i=0; i<h.length; i++)
            for (var j=0; j<names.length; j++)
                if (h[i] === names[j]) return i;
        return -1;
    }

    _AF_COL.ELEMENT_ID   = find(['element_id']);
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
        var cols = [_AF_COL.ELEMENT_ID, _AF_COL.ELEMENT_NAME, _AF_COL.ITEM_NAME,
                    _AF_COL.CONTRACTOR, _AF_COL.DATE, _AF_COL.DONE_QTY, _AF_COL.PHOTO];
        var maxFixed = Math.max.apply(null, cols.filter(function(x){ return x>=0; }));
        _AF_COL.EQUIP_START = maxFixed + 1;
    }

    console.log('[autofill] cols:', JSON.stringify(_AF_COL));
    console.log('[autofill] headers:', headerVals.slice(0,12).join(' | '));
}

/* ══════════════════════════════════════════════════
   2. CSV parser
   ══════════════════════════════════════════════════ */
function afParseCSV(csv) {
    var lines = csv.split('\n').filter(function(l){ return l.trim(); });

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

    if (lines.length < 2) return { headers: [], rows: [] };

    var headers = parseRow(lines[0]);
    var rows    = [];
    for (var i=1; i<lines.length; i++) {
        var vals = parseRow(lines[i]);
        if (vals.some(function(v){ return v.trim(); })) rows.push(vals);
    }
    return { headers: headers, rows: rows };
}

/* ══════════════════════════════════════════════════
   3. جلب Sheet2 من شيت البند الفرعي
      sheetId = الـ Google Sheets ID للشيت
      Sheet2 داخله = سجلات المنفذ اليومي
   ══════════════════════════════════════════════════ */
async function afFetchSheet2ForSubitem(sheetId) {
    if (!sheetId) return [];
    if (_afCache[sheetId]) return _afCache[sheetId];
    if (_afLoadingFor[sheetId]) return [];

    _afLoadingFor[sheetId] = true;

    /* نجرب gid مختلفة لـ Sheet2 — الأكثر شيوعاً:
       بعض الشيتات Sheet2 gid تختلف من شيت لآخر
       نجرب sheet=Sheet2 كأسلوب أموثق                */
    var attempts = [

        `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=1`,
    ];

    var parsed = null;
    for (var a=0; a<attempts.length; a++) {
        try {
            var r   = await fetch(attempts[a]);
            if (!r.ok) continue;
            var csv = await r.text();
            if (csv.trim().startsWith('<')) continue;

            var result = afParseCSV(csv);
            if (result.rows.length > 0) {
                parsed = result;
                console.log('[autofill] ✅ Sheet2 loaded via:', attempts[a].split('?')[1]);
                break;
            }
        } catch(e) {
            console.warn('[autofill] attempt failed:', e.message);
        }
    }

    if (!parsed) {
        console.warn('[autofill] ❌ could not load Sheet2 for sheetId:', sheetId);
        _afLoadingFor[sheetId] = false;
        return [];
    }

    /* اكتشف الأعمدة من الهيدر */
    afDetectColumns(parsed.headers);

    /* حوّل الصفوف لكائنات بسيطة */
    var rows = parsed.rows.map(function(vals) {
        var eid  = _AF_COL.ELEMENT_ID >= 0 ? (vals[_AF_COL.ELEMENT_ID]||'').trim() : '';
        var date = _AF_COL.DATE       >= 0 ? (vals[_AF_COL.DATE]       ||'').trim() : '';
        return { vals: vals, elementId: eid, date: date };
    });

    console.log('[autofill] loaded', rows.length, 'rows from Sheet2 of', sheetId);

    _afCache[sheetId]       = rows;
    _afLoadingFor[sheetId]  = false;
    return rows;
}

/* ══════════════════════════════════════════════════
   4. البحث عن صف مطابق
   ══════════════════════════════════════════════════ */
function afFindRow(rows, elementId, date) {
    if (!rows || !rows.length || !elementId || !date) return null;

    function normDate(d) {
        if (!d) return '';
        var m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) return m[3]+'-'+m[2]+'-'+m[1];
        /* Google Sheets ممكن يحفظها كـ M/D/YYYY */
        var m2 = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m2) return m2[3]+'-'+m2[2].padStart(2,'0')+'-'+m2[1].padStart(2,'0');
        return d.slice(0,10);
    }

    var targetDate = normDate(date);
    console.log('[autofill] searching element:', elementId, 'date:', targetDate,
                '— total rows:', rows.length);

    /* من الأسفل للأعلى = آخر إدخال */
    for (var i=rows.length-1; i>=0; i--) {
        var row = rows[i];
        if (row.elementId === elementId && normDate(row.date) === targetDate) {
            console.log('[autofill] ✅ found at index', i, '— vals:', row.vals.slice(0,8).join(' | '));
            return row.vals;
        }
    }

    console.log('[autofill] ❌ no match found');
    /* اطبع أول 3 صفوف للمساعدة في التشخيص */
    rows.slice(0,3).forEach(function(r,i){
        console.log('  row'+i+':', r.elementId, '|', r.date, '| normDate:', normDate(r.date));
    });
    return null;
}

/* ══════════════════════════════════════════════════
   5. ملء الفورم
   ══════════════════════════════════════════════════ */
function afFillForm(vals) {
    if (!vals) return;

    /* المقاول */
    if (_AF_COL.CONTRACTOR >= 0) {
        var contractor = (vals[_AF_COL.CONTRACTOR]||'').trim();
        if (contractor) {
            var sel = document.getElementById('eqf_contractor');
            if (sel) {
                var found = false;
                for (var i=0; i<sel.options.length; i++)
                    if (sel.options[i].value === contractor) { found=true; break; }
                if (!found) {
                    var opt = document.createElement('option');
                    opt.value = opt.textContent = contractor;
                    sel.appendChild(opt);
                }
                sel.value = contractor;
            }
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
    badge.style.cssText = [
        'display:inline-flex','align-items:center','gap:6px',
        'padding:6px 12px',
        'background:rgba(245,200,66,0.12)',
        'border:1px solid rgba(245,200,66,0.35)',
        'border-radius:8px',
        'font-size:11px','font-weight:700',
        'color:#f5c842',
        'font-family:Cairo,sans-serif',
        'margin-top:6px',
    ].join(';');
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
            var found = false;
            for (var i=0; i<typeSel.options.length; i++)
                if (typeSel.options[i].value === pair.type) { found=true; break; }
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
    badge.style.cssText = [
        'display:flex','align-items:center','gap:8px',
        'padding:10px 14px',
        'background:rgba(245,200,66,0.1)',
        'border:1px solid rgba(245,200,66,0.4)',
        'border-radius:10px',
        'margin-bottom:10px',
        'font-size:12px','font-weight:700',
        'color:#f5c842',
        'font-family:Cairo,sans-serif',
    ].join(';');
    badge.innerHTML =
        '<span style="font-size:16px;flex-shrink:0;">📋</span>' +
        '<span style="flex:1;">تم تحميل سجل موجود لهذا العنصر في نفس التاريخ — يمكنك تعديله وإعادة الحفظ</span>' +
        '<button onclick="afClearBadge()" style="background:none;border:1px solid rgba(245,200,66,0.4);color:rgba(245,200,66,0.8);padding:3px 9px;border-radius:6px;font-size:10px;font-weight:700;font-family:Cairo,sans-serif;cursor:pointer;">✕</button>';
    fb.parentElement.insertBefore(badge, fb);
}

function afClearBadge() {
    ['af_loaded_badge','af_photo_badge'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    });
}

/* ══════════════════════════════════════════════════
   6. الدالة الرئيسية
   ══════════════════════════════════════════════════ */
async function afCheckAndFill() {
    var elementId = (document.getElementById('eqf_element_id')?.value||'').trim();
    var date      = (document.getElementById('eqf_date')?.value     ||'').trim();
    var sheetId   = (document.getElementById('eqf_band_sheet')?.value||'').trim();

    afClearBadge();

    if (!elementId || !date) return;

    /* لو البند لسه ما اتختارش، استخرج sheetId من العنصر المختار */
    if (!sheetId) {
        var el = (window._eqAllElements||[]).find(function(e){ return e.id === elementId; });
        if (el) sheetId = el.sheetId;
    }

    if (!sheetId) {
        console.log('[autofill] no sheetId yet — will retry after band selected');
        return;
    }

    console.log('[autofill] checking sheetId:', sheetId, 'element:', elementId, 'date:', date);

    /* امسح الكاش لو تغيّر الشيت */
    if (_afLastSheetId && _afLastSheetId !== sheetId) {
        console.log('[autofill] sheet changed, clearing cache for:', _afLastSheetId);
    }
    _afLastSheetId = sheetId;

    var rows = await afFetchSheet2ForSubitem(sheetId);
    var vals = afFindRow(rows, elementId, date);
    if (vals) afFillForm(vals);
}

/* ══════════════════════════════════════════════════
   7. ربط الأحداث
   ══════════════════════════════════════════════════ */

/* عند اختيار عنصر من القائمة أو الخريطة */
var _origEqSelectElement_af = window.eqSelectElement;
window.eqSelectElement = function(id, name) {
    if (_origEqSelectElement_af) _origEqSelectElement_af(id, name);
    setTimeout(afCheckAndFill, 120);
};

/* عند تغيير التاريخ */
document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'eqf_date') setTimeout(afCheckAndFill, 80);
});

/* عند اختيار البند (لو غيّر البند بعد العنصر) */
var _origEqSelectBand_af = window.eqSelectBand;
window.eqSelectBand = function(name, sheetId, catName, catId) {
    if (_origEqSelectBand_af) _origEqSelectBand_af.apply(this, arguments);
    setTimeout(afCheckAndFill, 120);
};

/* عند فتح الفورم — امسح الكاش */
var _origOpenEqForm_af = window.openEquipmentFormModal;
window.openEquipmentFormModal = function() {
    if (_origOpenEqForm_af) _origOpenEqForm_af.apply(this, arguments);
    /* امسح الكاش عشان يجيب أحدث بيانات */
    _afCache      = {};
    _afLastSheetId = null;
};

/* عند إعادة التعيين */
var _origEqReset_af = window.eqResetForm;
window.eqResetForm = function() {
    afClearBadge();
    if (_origEqReset_af) _origEqReset_af.apply(this, arguments);
};

/* تصدير */
window.afCheckAndFill        = afCheckAndFill;
window.afClearBadge          = afClearBadge;
window.afFetchSheet2ForSubitem = afFetchSheet2ForSubitem;
