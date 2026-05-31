/* ====================================================
   AUTOFILL PATCH — equipment_autofill_patch.js  (v2 – Drive Photo)
   يُضاف بعد equipment.js و equipment_camera_patch.js
   ==================================================== */

var _afRows = [];

/* جلب Sheet2 من شيت البند الفرعي */
async function afLoadSheet2(sheetId) {
    _afRows = [];
    try {
        var url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/export?format=csv&gid=987650458';
        var r   = await fetch(url);
        var csv = await r.text();
        if (csv.trim().startsWith('<')) { console.warn('[autofill] not public'); return; }

        var lines = csv.split('\n').filter(function(l){ return l.trim(); });
        if (lines.length < 2) return;

        for (var i = 1; i < lines.length; i++) {
            var cols = lines[i].split(',').map(function(v){ return v.trim(); });
            _afRows.push(cols);
        }
        console.log('[autofill] loaded', _afRows.length, 'rows from Sheet2 of', sheetId);
    } catch(e) {
        console.warn('[autofill] error:', e.message);
    }
}

/* بحث عن صف مطابق وملء الفورم */
function afFill(elementId, date) {
    if (!_afRows.length || !elementId || !date) return;

    /* توحيد التاريخ إلى YYYY-MM-DD */
    function norm(d) {
        if (!d) return '';
        var m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) return m[3] + '-' + m[2] + '-' + m[1];
        var m2 = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m2) return m2[3] + '-' + m2[2].padStart(2,'0') + '-' + m2[1].padStart(2,'0');
        return d.slice(0, 10);
    }

    var target = norm(date);
    var found  = null;

    /* ابحث من الأسفل للأعلى = آخر إدخال */
    for (var i = _afRows.length - 1; i >= 0; i--) {
        var row = _afRows[i];
        /* col 0 = element_id ، col 4 = date */
        if ((row[0]||'').trim() === elementId && norm((row[4]||'').trim()) === target) {
            found = row;
            break;
        }
    }

    if (!found) {
        console.log('[autofill] no match for', elementId, target);
        return;
    }
    console.log('[autofill] found row:', found.slice(0,8).join(' | '));

    /* col 3 = contractor */
    var contractor = (found[3]||'').trim();
    if (contractor) {
        var sel = document.getElementById('eqf_contractor');
        if (sel) {
            var exists = false;
            for (var k=0; k<sel.options.length; k++)
                if (sel.options[k].value === contractor) { exists=true; break; }
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

    /* ══════════════════════════════════════════════
       col 6 = PHOTO — عرض صورة Drive إن وُجدت
       القيمة إما:
         - رابط Drive كامل (https://drive.google.com/...)
         - صيغة HYPERLINK("url","📷 صورة")
         - كلمة "صورة" (fallback قديم)
    ══════════════════════════════════════════════ */
    var photoVal = (found[6]||'').trim();

    if (photoVal) {
        /* استخرج الـ URL من صيغة HYPERLINK لو كانت موجودة */
        var driveUrl = _afExtractDriveUrl(photoVal);

        /* تأكد إن قسم الكاميرا محقون */
        if (window.eqInjectCameraSection) eqInjectCameraSection();

        var wrap = document.getElementById('eqf_photo_preview_wrap');

        if (driveUrl) {
            /* ── عرض الصورة من Drive URL ── */
            /* حوّل رابط view إلى رابط thumbnail مباشر */
            var directUrl = _afBuildDirectUrl(driveUrl);
            /* استخدم الدالة من camera patch */
            if (window.eqShowPhotoFromDriveUrl) {
                eqShowPhotoFromDriveUrl(driveUrl, directUrl);
            } else {
                /* fallback manual */
                _afShowPhotoFallback(driveUrl, directUrl);
            }

            /* بادج "صورة محفوظة" */
            if (wrap && !document.getElementById('af_photo_badge')) {
                var pb = document.createElement('div');
                pb.id = 'af_photo_badge';
                pb.style.cssText = [
                    'display:flex','align-items:center','gap:6px',
                    'padding:6px 12px',
                    'background:rgba(33,150,243,0.12)',
                    'border:1px solid rgba(33,150,243,0.35)',
                    'border-radius:8px','font-size:11px','font-weight:700',
                    'color:#5baddf','font-family:Cairo,sans-serif','margin-top:4px'
                ].join(';');
                pb.innerHTML = '📷 <span>صورة محفوظة من Drive — التقط جديدة لاستبدالها</span>';
                wrap.appendChild(pb);
            }
        } else {
            /* fallback: كلمة "صورة" فقط بدون URL */
            if (wrap && !document.getElementById('af_photo_badge')) {
                var pb2 = document.createElement('div');
                pb2.id = 'af_photo_badge';
                pb2.style.cssText = [
                    'display:flex','align-items:center','gap:6px',
                    'padding:6px 12px',
                    'background:rgba(245,200,66,0.12)',
                    'border:1px solid rgba(245,200,66,0.35)',
                    'border-radius:8px','font-size:11px','font-weight:700',
                    'color:#f5c842','font-family:Cairo,sans-serif','margin-top:4px'
                ].join(';');
                pb2.textContent = '📷 يوجد صورة مسجلة — التقط جديدة لاستبدالها';
                wrap.appendChild(pb2);
            }
        }
    }

    /* col 7,8,9,10... = type1,count1,type2,count2,... */
    var pairs = [];
    for (var j = 7; j + 1 < found.length; j += 2) {
        var type  = (found[j]  ||'').trim();
        var count = (found[j+1]||'').trim();
        if (type) pairs.push({ type: type, count: count || '0' });
    }

    if (pairs.length) {
        var container = document.getElementById('eqf_equipments_container');
        if (container) {
            container.innerHTML = '';
            window.eqFormEquipmentCount = 0;
            pairs.forEach(function(pair) {
                if (window.eqAddEquipmentRow) window.eqAddEquipmentRow();
                var id      = 'eqrow_' + window.eqFormEquipmentCount;
                var typeSel = document.getElementById(id + '_type');
                var cntInp  = document.getElementById(id + '_count');
                if (typeSel) {
                    var ex = false;
                    for (var x=0; x<typeSel.options.length; x++)
                        if (typeSel.options[x].value===pair.type) { ex=true; break; }
                    if (!ex) {
                        var o = document.createElement('option');
                        o.value = o.textContent = pair.type;
                        typeSel.appendChild(o);
                    }
                    typeSel.value = pair.type;
                }
                if (cntInp) cntInp.value = pair.count;
            });
        }
    }

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
        badge.innerHTML = '<span>📋</span>' +
            '<span style="flex:1;">تم تحميل سجل موجود — يمكنك تعديله وإعادة الحفظ</span>' +
            '<button onclick="afClearBadge()" style="background:none;border:1px solid rgba(245,200,66,0.4);color:rgba(245,200,66,0.7);padding:3px 9px;border-radius:6px;font-size:10px;font-weight:700;font-family:Cairo,sans-serif;cursor:pointer;">✕</button>';
        fb.parentElement.insertBefore(badge, fb);
    }
}

/* ── استخراج Drive URL من قيمة الخلية ── */
function _afExtractDriveUrl(val) {
    if (!val) return null;
    /* صيغة HYPERLINK("url","label") */
    var hMatch = val.match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
    if (hMatch) return hMatch[1];
    /* رابط Drive مباشر */
    if (val.startsWith('https://drive.google.com') || val.startsWith('https://docs.google.com')) {
        return val;
    }
    return null;
}

/* ── بناء رابط thumbnail مباشر من رابط Drive ── */
function _afBuildDirectUrl(viewUrl) {
    if (!viewUrl) return null;
    /* استخرج file ID */
    var m = viewUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) {
        return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w800';
    }
    /* لو كان بصيغة id= مباشرة */
    var m2 = viewUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m2) {
        return 'https://drive.google.com/thumbnail?id=' + m2[1] + '&sz=w800';
    }
    return null;
}

/* ── fallback لعرض الصورة لو camera patch غير محمل ── */
function _afShowPhotoFallback(viewUrl, directUrl) {
    var ph  = document.getElementById('eqf_photo_placeholder');
    var img = document.getElementById('eqf_photo_preview_img');
    var linkEl = document.getElementById('eqf_photo_drive_link');

    if (ph) ph.style.display = 'none';

    if (img && directUrl) {
        img.src = directUrl;
        img.style.display = 'block';
        img.onerror = function() { img.style.display = 'none'; };
    }

    if (linkEl && viewUrl) {
        linkEl.href = viewUrl;
        linkEl.style.display = 'inline-flex';
        linkEl.style.alignItems = 'center';
        linkEl.style.gap = '4px';
    }
}

function afClearBadge() {
    ['af_loaded_badge','af_photo_badge'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    });
}

/* الدالة الرئيسية */
async function afCheck() {
    var elementId = (document.getElementById('eqf_element_id')?.value  || '').trim();
    var date      = (document.getElementById('eqf_date')?.value        || '').trim();
    var sheetId   = (document.getElementById('eqf_band_sheet')?.value  || '').trim();

    afClearBadge();
    /* امسح الصورة المعروضة حالياً عند التحقق من سجل جديد */
    if (window.eqClearPhoto) eqClearPhoto();

    if (!elementId || !date || !sheetId) return;

    await afLoadSheet2(sheetId);
    afFill(elementId, date);
}

/* ربط الأحداث */
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

window.afCheck      = afCheck;
window.afClearBadge = afClearBadge;
