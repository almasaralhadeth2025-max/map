/* ====================================================
   CAMERA / PHOTO CAPTURE — إضافة على equipment.js
   يُضاف في نهاية ملف equipment.js
   ====================================================

   الفكرة:
   - زر 📷 يظهر في تبويب "المنفذ اليومي" قبل قسم المعدات
   - عند الضغط يفتح الكاميرا (أو معرض الصور على الموبايل)
   - بعد الاختيار تظهر معاينة صغيرة في الفورم
   - عند الحفظ يُرسل base64 للسكريبت مع باقي البيانات
   - السكريبت يحفظ "صورة" نصاً في العمود (وليس base64 كاملاً)

   ==================================================== */

/* ── متغير عالمي لحفظ base64 الصورة المختارة ── */
let _eqPhotoBase64 = null;   // null = لا يوجد صورة

/* ══════════════════════════════════════════════════
   1. حقن زر الكاميرا في DOM بعد فتح الفورم
   ══════════════════════════════════════════════════ */

/**
 * يُنشئ قسم الكاميرا كاملاً ويُحقنه في الفورم اليومي
 * قبل div أنواع المعدات (الحاوي بـ border-radius:12px)
 */
function eqInjectCameraSection() {
    // تحقق أنه لم يُضف من قبل
    if (document.getElementById('eqf_camera_section')) return;

    // إيجاد حاوية أنواع المعدات لنضع الكاميرا قبلها
    const equipContainer = document.getElementById('eqf_equipments_container');
    if (!equipContainer) return;
    const equipWrapper = equipContainer.closest('div[style*="border:1px solid rgba(39,174,106"]');
    if (!equipWrapper) return;

    const section = document.createElement('div');
    section.id = 'eqf_camera_section';
    section.style.cssText = `
        border: 1px solid rgba(33,150,243,0.25);
        border-radius: 12px;
        overflow: hidden;
        margin-bottom: 16px;
    `;
    section.innerHTML = `
        <!-- Header شريط الكاميرا -->
        <div style="
            background: linear-gradient(135deg,rgba(33,150,243,0.15),rgba(21,101,192,0.1));
            padding: 10px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid rgba(33,150,243,0.15);
        ">
            <span style="font-size:13px;font-weight:800;color:rgba(255,255,255,0.9);font-family:'Cairo',sans-serif;">
                📷 صورة الموقع
                <span style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);margin-right:6px;">(اختياري)</span>
            </span>
            <div style="display:flex;gap:8px;align-items:center;">
                <!-- زر الكاميرا الرئيسي -->
                <button type="button" onclick="eqOpenCamera()"
                    id="eqf_camera_btn"
                    style="
                        padding: 7px 14px;
                        background: linear-gradient(135deg,#1a4a8a,#2196f3);
                        border: none;
                        border-radius: 8px;
                        color: white;
                        font-size: 12px;
                        font-weight: 700;
                        font-family: 'Cairo', sans-serif;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        transition: all 0.2s;
                        box-shadow: 0 2px 10px rgba(33,150,243,0.3);
                    "
                    onmouseover="this.style.transform='translateY(-1px)'"
                    onmouseout="this.style.transform='translateY(0)'">
                    📷 التقاط صورة
                </button>
                <!-- زر حذف الصورة (مخفي حتى يتم اختيار صورة) -->
                <button type="button" onclick="eqClearPhoto()"
                    id="eqf_photo_clear_btn"
                    style="
                        display: none;
                        padding: 6px 10px;
                        background: rgba(244,67,54,0.12);
                        border: 1px solid rgba(244,67,54,0.3);
                        border-radius: 7px;
                        color: #ff8a80;
                        font-size: 11px;
                        font-weight: 700;
                        font-family: 'Cairo', sans-serif;
                        cursor: pointer;
                        transition: all 0.18s;
                    "
                    onmouseover="this.style.background='rgba(244,67,54,0.25)'"
                    onmouseout="this.style.background='rgba(244,67,54,0.12)'">
                    ✕ حذف
                </button>
            </div>
        </div>

        <!-- منطقة المعاينة -->
        <div id="eqf_photo_preview_wrap" style="
            padding: 12px 16px;
            min-height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
        ">
            <div id="eqf_photo_placeholder" style="
                color: rgba(255,255,255,0.2);
                font-size: 11px;
                font-family: 'Cairo', sans-serif;
                text-align: center;
                padding: 8px 0;
            ">
                لم يتم التقاط صورة بعد
            </div>
            <img id="eqf_photo_preview_img"
                style="
                    display: none;
                    max-width: 100%;
                    max-height: 180px;
                    border-radius: 8px;
                    border: 2px solid rgba(33,150,243,0.4);
                    object-fit: cover;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                "
                alt="صورة الموقع">
        </div>

        <!-- Input مخفي لفتح الكاميرا/المعرض -->
        <input type="file"
            id="eqf_photo_input"
            accept="image/*"
            capture="environment"
            style="display:none"
            onchange="eqHandlePhotoSelected(event)">
    `;

    /* إدراج القسم قبل حاوية المعدات مباشرة */
    equipWrapper.parentElement.insertBefore(section, equipWrapper);
}

/* ══════════════════════════════════════════════════
   2. فتح الكاميرا / المعرض
   ══════════════════════════════════════════════════ */
function eqOpenCamera() {
    const inp = document.getElementById('eqf_photo_input');
    if (!inp) return;
    inp.value = '';      // إعادة تعيين للسماح باختيار نفس الملف مرتين
    inp.click();
}

/* ══════════════════════════════════════════════════
   3. معالجة الصورة المختارة
   ══════════════════════════════════════════════════ */
function eqHandlePhotoSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    /* ── ضغط الصورة قبل الحفظ (max 800px، جودة 0.7) ── */
    const reader = new FileReader();
    reader.onload = function(e) {
        const original = e.target.result;
        _eqCompressPhoto(original, 800, 0.72, function(compressed) {
            _eqPhotoBase64 = compressed;
            eqShowPhotoPreview(compressed);
        });
    };
    reader.readAsDataURL(file);
}

/* ── ضغط الصورة عبر Canvas ── */
function _eqCompressPhoto(dataUrl, maxWidth, quality, callback) {
    const img = new Image();
    img.onload = function() {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
}

/* ══════════════════════════════════════════════════
   4. إظهار المعاينة
   ══════════════════════════════════════════════════ */
function eqShowPhotoPreview(base64) {
    const placeholder = document.getElementById('eqf_photo_placeholder');
    const img         = document.getElementById('eqf_photo_preview_img');
    const clearBtn    = document.getElementById('eqf_photo_clear_btn');

    if (placeholder) placeholder.style.display = 'none';
    if (img)         { img.src = base64; img.style.display = 'block'; }
    if (clearBtn)    clearBtn.style.display = 'block';
}

/* ══════════════════════════════════════════════════
   5. حذف الصورة المختارة
   ══════════════════════════════════════════════════ */
function eqClearPhoto() {
    _eqPhotoBase64 = null;

    const placeholder = document.getElementById('eqf_photo_placeholder');
    const img         = document.getElementById('eqf_photo_preview_img');
    const clearBtn    = document.getElementById('eqf_photo_clear_btn');
    const inp         = document.getElementById('eqf_photo_input');

    if (placeholder) placeholder.style.display = 'block';
    if (img)         { img.src = ''; img.style.display = 'none'; }
    if (clearBtn)    clearBtn.style.display = 'none';
    if (inp)         inp.value = '';
}

/* ══════════════════════════════════════════════════
   6. تصحير الكاميرا عند إعادة التعيين
   ══════════════════════════════════════════════════ */
const _origEqResetForm_camera = window.eqResetForm;
window.eqResetForm = function() {
    eqClearPhoto();
    if (_origEqResetForm_camera) _origEqResetForm_camera();
};

/* ══════════════════════════════════════════════════
   7. حقن القسم عند فتح الفورم
   ══════════════════════════════════════════════════ */
const _origOpenEquipmentFormModal_camera = window.openEquipmentFormModal;
window.openEquipmentFormModal = function() {
    if (_origOpenEquipmentFormModal_camera) _origOpenEquipmentFormModal_camera();
    /* نؤخر قليلاً حتى يكتمل رسم الـ DOM */
    setTimeout(function() {
        eqInjectCameraSection();
        eqClearPhoto(); // إعادة تعيين عند كل فتح
    }, 80);
};

/* ══════════════════════════════════════════════════
   8. تعديل eqSubmitForm لإرسال الصورة
   ══════════════════════════════════════════════════ */
const _origEqSubmitForm_camera = window.eqSubmitForm;
window.eqSubmitForm = function() {
    /* نتحقق أن التبويب النشط هو اليومي */
    if (window._eqFormActiveTab && window._eqFormActiveTab !== 'daily') {
        if (_origEqSubmitForm_camera) _origEqSubmitForm_camera();
        return;
    }

    /* نُعدّل الـ payload بإضافة الصورة — نعمل override مؤقت لـ fetch */
    _eqSubmitDailyWithPhoto();
};

/* ── الإرسال الكامل مع الصورة ── */
async function _eqSubmitDailyWithPhoto() {
    /* نفس منطق التحقق من equipment.js الأصلي */
    const eqHideFb    = window.eqHideFeedback || function(){};
    const eqShowFb    = window.eqShowFeedback  || function(){};
    const showAlertFn = window.showAlert       || function(){};

    eqHideFb();

    const element_id   = document.getElementById('eqf_element_id').value.trim();
    const element_name = document.getElementById('eqf_element_name').value.trim();
    const item_name    = document.getElementById('eqf_item_name').value.trim();
    const cat_name     = document.getElementById('eqf_cat_name').value.trim();
    const group_name   = document.getElementById('eqf_group_name').value.trim();
    const contractor   = document.getElementById('eqf_contractor').value.trim();
    const date         = document.getElementById('eqf_date').value.trim();
    const done_qty     = parseFloat(document.getElementById('eqf_done_qty').value) || 0;
    const band_sheet   = document.getElementById('eqf_band_sheet').value.trim();

    if (!element_name) { eqShowFb('❌ يرجى اختيار أو إدخال اسم العنصر', 'error'); return; }
    if (!item_name)    { eqShowFb('❌ يرجى اختيار البند', 'error'); return; }
    if (!contractor)   { eqShowFb('❌ يرجى اختيار المقاول', 'error'); return; }
    if (!date)         { eqShowFb('❌ يرجى اختيار التاريخ', 'error'); return; }
    if (!band_sheet)   { eqShowFb('❌ البند المختار ليس له شيت مرتبط — راجع الإعدادات', 'error'); return; }

    const equipments = window.eqCollectEquipments ? window.eqCollectEquipments() : [];
    if (!equipments.length) {
        eqShowFb('❌ يرجى إضافة معدة واحدة على الأقل', 'error');
        return;
    }

    const btn = document.getElementById('eqf_submit_btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...'; }
    eqShowFb('⏳ جاري إرسال البيانات...', 'loading');

    /* جلب scriptUrl */
    let scriptUrl = '';
    try {
        const allSubs   = (window.categories || []).flatMap(c => c.subitems || []);
        const matchedSub = allSubs.find(s => s.sheetId === band_sheet);
        if (matchedSub && matchedSub.scriptUrl) scriptUrl = matchedSub.scriptUrl.trim();
        if (!scriptUrl) throw new Error(
            'لم يتم العثور على رابط السكريبت — تأكد من إعداد رابط Apps Script في البند الفرعي'
        );
    } catch (fetchErr) {
        eqShowFb('❌ ' + fetchErr.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ في السجل'; }
        return;
    }

    /* بناء الـ payload مع الصورة */
    const payload = {
        form_type    : 'daily',
        group_name,
        cat_name,
        element_id,
        element_name,
        item_name,
        contractor,
        date,
        done_qty,
        equipments,
        /* الصورة: base64 كاملاً للسكريبت، السكريبت يحفظ "صورة" نصاً في الخلية */
        photo        : _eqPhotoBase64 || null,
        has_photo    : !!_eqPhotoBase64,
    };

    try {
        const r    = await fetch(scriptUrl, {
            method  : 'POST',
            headers : { 'Content-Type': 'text/plain' },
            body    : JSON.stringify(payload),
            redirect: 'follow',
        });
        const text = await r.text();
        let resp = {};
        try { resp = JSON.parse(text); } catch(e) {}

        if (resp.status === 'success' || r.ok) {
            const photoMsg = _eqPhotoBase64 ? ' مع صورة الموقع 📷' : '';
            eqShowFb('✅ تم حفظ بيانات المعدات بنجاح في السجل' + photoMsg + '!', 'success');
            showAlertFn('✅ تم تسجيل الكمية - المعدات بنجاح' + photoMsg, 'success');
            setTimeout(function() {
                if (window.eqResetForm) window.eqResetForm();
            }, 2500);
        } else {
            throw new Error(resp.message || 'فشل الحفظ');
        }
    } catch(e) {
        console.error('Equipment form submit error:', e);
        eqShowFb('❌ تعذر الحفظ: ' + (e.message || 'خطأ في الاتصال') + ' — تأكد من إعدادات Apps Script', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ في السجل'; }
    }
}

/* ══════════════════════════════════════════════════
   9. تصدير الدوال للـ window
   ══════════════════════════════════════════════════ */
window.eqOpenCamera          = eqOpenCamera;
window.eqClearPhoto          = eqClearPhoto;
window.eqHandlePhotoSelected = eqHandlePhotoSelected;
window.eqInjectCameraSection = eqInjectCameraSection;
