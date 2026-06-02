/* ====================================================
   AUTOFILL PATCH — equipment_autofill_patch.js  (v4)
   الفرق عن v3: حذف عمود PHOTO (hyperlink) — الصورة تُقرأ من col[6] مباشرة كـ URL خام
   هيكل Sheet2: [0]element_id [1]element_name [2]item_name [3]contractor
                [4]date [5]done_qty [6]PHOTO_URL [7]type1 [8]count1 ...
   ==================================================== */

var _afRows = [];

/* ── جلب Sheet2 ── */
async function afLoadSheet2(sheetId) {
    _afRows = [];
    try {
        var url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/export?format=csv&gid=987650458';
        var r   = await fetch(url);
        var csv = await r.text();
        if (csv.trim().startsWith('<')) { console.warn('[autofill] sheet not public'); return; }

        var lines = csv.split('\n').filter(function(l){ return l.trim(); });
        if (lines.length < 2) return;

        for (var i = 1; i < lines.length; i++) {
            _afRows.push(_afParseCSVLine(lines[i]));
        }
        console.log('[autofill] loaded', _afRows.length, 'rows — col6 sample:',
            _afRows[0] ? (_afRows[0][6] || '(empty)') : 'n/a');
    } catch(e) {
        console.warn('[autofill] error:', e.message);
    }
}

/* ── CSV parser يدعم الحقول المقتبسة ── */
function _afParseCSVLine(line) {
    var result = [];
    var cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (ch === '"') {
            if (inQ && line[i+1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
            result.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    result.push(cur.trim());
    return result;
}

/* ── بناء thumbnail URL من Drive view URL ── */
function _afBuildDirectUrl(viewUrl) {
    if (!viewUrl) return null;
    /* /file/d/{ID}/view */
    var m = viewUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w800';
    /* ?id={ID} */
    var m2 = viewUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m2) return 'https://drive.google.com/thumbnail?id=' + m2[1] + '&sz=w800';
    return null;
}

/* ── ملء الفورم من الصف المطابق ── */
function afFill(elementId, date) {
    if (!_afRows.length || !elementId || !date) return;

    function norm(d) {
        if (!d) return '';
        var m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) return m[3]+'-'+m[2]+'-'+m[1];
        var m2 = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m2) return m2[3]+'-'+m2[2].padStart(2,'0')+'-'+m2[1].padStart(2,'0');
        return d.slice(0,10);
    }

    var target = norm(date);
    var found  = null;

    for (var i = _afRows.length - 1; i >= 0; i--) {
        var row = _afRows[i];
        if ((row[0]||'').trim() === elementId && norm((row[4]||'').trim()) === target) {
            found = row;
            break;
            window._afFoundRowIndex = i + 2; // +2: صف الهيدر (1) + index يبدأ من 0
        }
    }

    if (!found) {
        console.log('[autofill] no match for', elementId, target);
        return;
    }

    /* col 3 = contractor */
    var contractor = (found[3]||'').trim();
    if (contractor) {
        var sel = document.getElementById('eqf_contractor');
        if (sel) {
            var exists = false;
            for (var k=0; k<sel.options.length; k++)
                if (sel.options[k].value===contractor){ exists=true; break; }
            if (!exists) {
                var opt = document.createElement('option');
                opt.value = opt.textContent = contractor;
                sel.appendChild(opt);
            }
            sel.value = contractor;
        }
    }

    /* col 5 = done_qty */
    var doneInp = document.getElementById('eqf_done_qty');
    if (doneInp && found[5]) doneInp.value = found[5].trim();

    /* ══════════════════════════════════════════
       col 6 = PHOTO_URL — URL خام مباشرة
    ══════════════════════════════════════════ */
    var photoUrl = (found[6]||'').trim();
    console.log('[autofill] PHOTO_URL col[6]:', photoUrl);

    if (photoUrl) {
        if (window.eqInjectCameraSection) eqInjectCameraSection();

        var directUrl = _afBuildDirectUrl(photoUrl);
        _afDisplayPhoto(photoUrl, directUrl);
    }

    /* col 7+ = معدات (انتقل من col8 إلى col7 بسبب حذف عمود PHOTO) */
    var pairs = [];
    for (var j = 7; j+1 < found.length; j += 2) {
        var type  = (found[j]  ||'').trim();
        var count = (found[j+1]||'').trim();
        if (type) pairs.push({ type:type, count:count||'0' });
    }

    if (pairs.length) {
        var container = document.getElementById('eqf_equipments_container');
        if (container) {
            container.innerHTML = '';
            window.eqFormEquipmentCount = 0;
            pairs.forEach(function(pair) {
                if (window.eqAddEquipmentRow) window.eqAddEquipmentRow();

                /* ── نجيب آخر صف اتضاف فعلياً من الـ DOM ── */
                var allSelects = container.querySelectorAll('select[id$="_type"]');
                var typeSel    = allSelects.length ? allSelects[allSelects.length - 1] : null;
                var allInputs  = container.querySelectorAll('input[id$="_count"]');
                var cntInp     = allInputs.length  ? allInputs[allInputs.length - 1]  : null;

                /* fallback: لو ما لقى بالـ DOM يجرب العداد */
                if (!typeSel) {
                    var fbId = 'eqrow_' + window.eqFormEquipmentCount;
                    typeSel  = document.getElementById(fbId+'_type');
                    cntInp   = document.getElementById(fbId+'_count');
                }

                if (typeSel) {
                    var ex = false;
                    for (var x=0; x<typeSel.options.length; x++)
                        if (typeSel.options[x].value===pair.type){ ex=true; break; }
                    if (!ex) {
                        var o = document.createElement('option');
                        o.value = o.textContent = pair.type;
                        typeSel.appendChild(o);
                    }
                    typeSel.value = pair.type;
                    console.log('[autofill] eq row set type:', pair.type, '→', typeSel.id);
                }
                if (cntInp) {
                    cntInp.value = pair.count;
                    console.log('[autofill] eq row set count:', pair.count, '→', cntInp.id);
                }
            });
        }
    }
   var rowIdxInp = document.getElementById('eqf_row_index');
   if (!rowIdxInp) {
       rowIdxInp = document.createElement('input');
       rowIdxInp.type = 'hidden';
       rowIdxInp.id = 'eqf_row_index';
       document.getElementById('eqf_feedback').parentElement.appendChild(rowIdxInp);
   }
   rowIdxInp.value = window._afFoundRowIndex || '';
    /* بادج "تم تحميل سجل موجود" */
    var oldBadge = document.getElementById('af_loaded_badge');
    if (oldBadge) oldBadge.remove();
    var fb = document.getElementById('eqf_feedback');
    if (fb) {
        var badge = document.createElement('div');
        badge.id = 'af_loaded_badge';
        badge.style.cssText = [
            'display:flex','align-items:center','gap:8px',
            'padding:10px 14px',
            'background:rgba(245,200,66,0.1)',
            'border:1px solid rgba(245,200,66,0.4)',
            'border-radius:10px','margin-bottom:10px',
            'font-size:12px','font-weight:700','color:#f5c842',
            'font-family:Cairo,sans-serif'
        ].join(';');
        badge.innerHTML =
            '<span>📋</span>' +
            '<span style="flex:1;">تم تحميل سجل موجود — يمكنك تعديله وإعادة الحفظ</span>' +
            '<button onclick="afClearBadge()" style="background:none;border:1px solid rgba(245,200,66,0.4);color:rgba(245,200,66,0.7);padding:3px 9px;border-radius:6px;font-size:10px;font-weight:700;font-family:Cairo,sans-serif;cursor:pointer;">✕</button>';
        fb.parentElement.insertBefore(badge, fb);
    }
}

/* ── عرض الصورة من Drive في مربع الكاميرا ── */
function _afDisplayPhoto(viewUrl, directUrl) {
    if (window.eqShowPhotoFromDriveUrl) {
        eqShowPhotoFromDriveUrl(viewUrl, directUrl);
        _afShowPhotoBadge(
            '📷 صورة محفوظة على Drive — التقط جديدة لاستبدالها',
            '#5baddf', 'rgba(33,150,243,0.12)', 'rgba(33,150,243,0.35)'
        );
        return;
    }

    /* fallback يدوي */
    var ph   = document.getElementById('eqf_photo_placeholder');
    var img  = document.getElementById('eqf_photo_preview_img');
    var link = document.getElementById('eqf_photo_drive_link');
    var wrap = document.getElementById('eqf_photo_preview_wrap');

    if (ph) ph.style.display = 'none';

    if (!img && wrap) {
        img = document.createElement('img');
        img.id = 'eqf_photo_preview_img';
        img.style.cssText = 'max-width:100%;max-height:180px;border-radius:8px;border:2px solid rgba(33,150,243,0.4);object-fit:cover;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
        img.alt = 'صورة الموقع';
        wrap.appendChild(img);
    }
    if (!link && wrap) {
        link = document.createElement('a');
        link.id = 'eqf_photo_drive_link';
        link.target = '_blank';
        link.rel = 'noopener';
        link.style.cssText = 'font-size:11px;font-weight:700;color:#5baddf;font-family:Cairo,sans-serif;text-decoration:none;padding:4px 12px;background:rgba(33,150,243,0.1);border:1px solid rgba(33,150,243,0.3);border-radius:6px;';
        link.textContent = '🔗 فتح الصورة على Drive';
        wrap.appendChild(link);
    }

    if (img && directUrl) {
        img.src = directUrl;
        img.style.display = 'block';
        img.onerror = function() { img.style.display = 'none'; };
    }
    if (link && viewUrl) {
        link.href = viewUrl;
        link.style.display = 'inline-flex';
        link.style.alignItems = 'center';
    }

    _afShowPhotoBadge(
        '📷 صورة محفوظة على Drive — التقط جديدة لاستبدالها',
        '#5baddf', 'rgba(33,150,243,0.12)', 'rgba(33,150,243,0.35)'
    );
}

/* ── بادج الصورة ── */
function _afShowPhotoBadge(text, color, bg, border) {
    var wrap = document.getElementById('eqf_photo_preview_wrap');
    if (!wrap || document.getElementById('af_photo_badge')) return;
    var pb = document.createElement('div');
    pb.id = 'af_photo_badge';
    pb.style.cssText = [
        'display:flex','align-items:center','gap:6px',
        'padding:6px 12px',
        'background:' + bg,
        'border:1px solid ' + border,
        'border-radius:8px','font-size:11px','font-weight:700',
        'color:' + color,'font-family:Cairo,sans-serif','margin-top:4px'
    ].join(';');
    pb.textContent = text;
    wrap.appendChild(pb);
}

/* ── مسح البوادج ── */
function afClearBadge() {
    ['af_loaded_badge','af_photo_badge'].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.remove();
    });
}

/* ── الدالة الرئيسية ── */
async function afCheck() {
    var elementId = (document.getElementById('eqf_element_id')?.value  || '').trim();
    var date      = (document.getElementById('eqf_date')?.value        || '').trim();
    var sheetId   = (document.getElementById('eqf_band_sheet')?.value  || '').trim();

    afClearBadge();
    if (window.eqClearPhoto) eqClearPhoto();

    if (!elementId || !date || !sheetId) return;

    await afLoadSheet2(sheetId);
    afFill(elementId, date);
}

/* ── ربط الأحداث ── */
var _origSelect = window.eqSelectElement;
window.eqSelectElement = function(id, name) {
    if (_origSelect) _origSelect(id, name);
    setTimeout(afCheck, 150);
};

document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'eqf_date') setTimeout(afCheck, 80);
});

var _origReset = window.eqResetForm;
window.eqResetForm = function() {
    afClearBadge();
    _afRows = [];
    if (_origReset) _origReset.apply(this, arguments);
};

// في equipment_autofill_patch.js، في ربط أحداث التغيير
document.addEventListener('change', function(e) {
    if (e.target && (e.target.id === 'eqf_date')) {
        // لو التاريخ تغيّر، امسح الـ row_index لأن autofill سيعيد البحث
        var rowIdx = document.getElementById('eqf_row_index');
        if (rowIdx) rowIdx.value = '';
        window._afFoundRowIndex = null;
        setTimeout(afCheck, 80); // afCheck ستملأ row_index لو لقت سجل جديد
    }
});
window.afCheck      = afCheck;
window.afClearBadge = afClearBadge;
