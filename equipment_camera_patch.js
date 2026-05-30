/* ====================================================
   CAMERA PATCH — equipment_camera_patch.js
   يُضاف كملف منفصل بعد equipment.js في index.html:
   <script src="equipment_camera_patch.js"></script>

   الاستراتيجية:
   - لا يعيد كتابة eqSubmitForm أبداً
   - يعمل override خفيف على fetch() فقط
     ليُضيف حقل photo للـ payload قبل الإرسال
   - باقي التحقق والإرسال يبقى في equipment.js الأصلي
   ==================================================== */

/* ── متغير عالمي للصورة ── */
let _eqPhotoBase64 = null;

/* ══════════════════════════════════════════════════
   1. Override خفيف على fetch
      يفحص كل طلب POST من فورم المعدات اليومي
      ويُضيف حقل photo + has_photo للـ body
   ══════════════════════════════════════════════════ */
(function patchFetchForPhoto() {
    const _origFetch = window.fetch;

    window.fetch = function(url, options) {
        /* شغّل الـ patch فقط على طلبات POST للسكريبت
           التي تحتوي form_type = 'daily'               */
        if (
            options &&
            options.method === 'POST' &&
            options.body &&
            typeof options.body === 'string'
        ) {
            try {
                const payload = JSON.parse(options.body);

                if (payload.form_type === 'daily' && _eqPhotoBase64) {
                    payload.photo     = _eqPhotoBase64;
                    payload.has_photo = true;
                    options = Object.assign({}, options, {
                        body: JSON.stringify(payload)
                    });
                }
            } catch(e) {
                /* ليس JSON أو ليس payload للمعدات — تجاهل */
            }
        }

        return _origFetch.call(this, url, options);
    };
})();

/* ══════════════════════════════════════════════════
   2. حقن قسم الكاميرا في الفورم
   ══════════════════════════════════════════════════ */
function eqInjectCameraSection() {
    if (document.getElementById('eqf_camera_section')) return;

    /* ابحث عن حاوية أنواع المعدات لنضع الكاميرا قبلها */
    const equipContainer = document.getElementById('eqf_equipments_container');
    if (!equipContainer) return;

    /* الـ wrapper هو الـ div الأب الذي يحتوي على border-radius وبيانات المعدات */
    const equipWrapper = equipContainer.parentElement;
    if (!equipWrapper) return;

    const section = document.createElement('div');
    section.id = 'eqf_camera_section';
    section.style.cssText = [
        'border:1px solid rgba(33,150,243,0.25)',
        'border-radius:12px',
        'overflow:hidden',
        'margin-bottom:16px'
    ].join(';');

    section.innerHTML = `
        <div style="
            background:linear-gradient(135deg,rgba(33,150,243,0.15),rgba(21,101,192,0.1));
            padding:10px 16px;
            display:flex;
            align-items:center;
            justify-content:space-between;
            border-bottom:1px solid rgba(33,150,243,0.15);
        ">
            <span style="font-size:13px;font-weight:800;color:rgba(255,255,255,0.9);font-family:'Cairo',sans-serif;">
                📷 صورة الموقع
                <span style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.4);margin-right:6px;">(اختياري)</span>
            </span>
            <div style="display:flex;gap:8px;align-items:center;">
                <button type="button" onclick="eqOpenCamera()" id="eqf_camera_btn"
                    style="
                        padding:7px 14px;
                        background:linear-gradient(135deg,#1a4a8a,#2196f3);
                        border:none;border-radius:8px;color:white;
                        font-size:12px;font-weight:700;font-family:'Cairo',sans-serif;
                        cursor:pointer;display:flex;align-items:center;gap:6px;
                        transition:all 0.2s;box-shadow:0 2px 10px rgba(33,150,243,0.3);
                    "
                    onmouseover="this.style.transform='translateY(-1px)'"
                    onmouseout="this.style.transform='translateY(0)'">
                    📷 التقاط صورة
                </button>
                <button type="button" onclick="eqClearPhoto()" id="eqf_photo_clear_btn"
                    style="
                        display:none;
                        padding:6px 10px;
                        background:rgba(244,67,54,0.12);
                        border:1px solid rgba(244,67,54,0.3);
                        border-radius:7px;color:#ff8a80;
                        font-size:11px;font-weight:700;font-family:'Cairo',sans-serif;
                        cursor:pointer;transition:all 0.18s;
                    "
                    onmouseover="this.style.background='rgba(244,67,54,0.25)'"
                    onmouseout="this.style.background='rgba(244,67,54,0.12)'">
                    ✕ حذف
                </button>
            </div>
        </div>

        <div id="eqf_photo_preview_wrap" style="
            padding:12px 16px;min-height:50px;
            display:flex;align-items:center;justify-content:center;
        ">
            <div id="eqf_photo_placeholder" style="
                color:rgba(255,255,255,0.2);font-size:11px;
                font-family:'Cairo',sans-serif;text-align:center;padding:8px 0;
            ">لم يتم التقاط صورة بعد</div>

            <img id="eqf_photo_preview_img"
                style="
                    display:none;max-width:100%;max-height:180px;
                    border-radius:8px;border:2px solid rgba(33,150,243,0.4);
                    object-fit:cover;box-shadow:0 4px 16px rgba(0,0,0,0.4);
                " alt="صورة الموقع">
        </div>

        <input type="file" id="eqf_photo_input"
            accept="image/*" capture="environment"
            style="display:none"
            onchange="eqHandlePhotoSelected(event)">
    `;

    /* أدرج قبل حاوية المعدات مباشرة */
    equipWrapper.parentElement.insertBefore(section, equipWrapper);
}

/* ══════════════════════════════════════════════════
   3. فتح الكاميرا
   ══════════════════════════════════════════════════ */
function eqOpenCamera() {
    const inp = document.getElementById('eqf_photo_input');
    if (!inp) return;
    inp.value = '';
    inp.click();
}

/* ══════════════════════════════════════════════════
   4. معالجة الصورة — ضغط ثم تخزين
   ══════════════════════════════════════════════════ */
function eqHandlePhotoSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        _eqCompressPhoto(e.target.result, 800, 0.72, function(compressed) {
            _eqPhotoBase64 = compressed;
            _eqShowPhotoPreview(compressed);
        });
    };
    reader.readAsDataURL(file);
}

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
   5. عرض / مسح الصورة
   ══════════════════════════════════════════════════ */
function _eqShowPhotoPreview(base64) {
    const ph  = document.getElementById('eqf_photo_placeholder');
    const img = document.getElementById('eqf_photo_preview_img');
    const del = document.getElementById('eqf_photo_clear_btn');
    if (ph)  ph.style.display  = 'none';
    if (img) { img.src = base64; img.style.display = 'block'; }
    if (del) del.style.display = 'block';
}

function eqClearPhoto() {
    _eqPhotoBase64 = null;
    const ph  = document.getElementById('eqf_photo_placeholder');
    const img = document.getElementById('eqf_photo_preview_img');
    const del = document.getElementById('eqf_photo_clear_btn');
    const inp = document.getElementById('eqf_photo_input');
    if (ph)  ph.style.display  = 'block';
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (del) del.style.display = 'none';
    if (inp) inp.value = '';
}

/* ══════════════════════════════════════════════════
   6. ربط مع دورة حياة الفورم
   ══════════════════════════════════════════════════ */

/* حقن القسم عند فتح الفورم + مسح الصورة القديمة */
const _origOpenEqForm = window.openEquipmentFormModal;
window.openEquipmentFormModal = function() {
    if (_origOpenEqForm) _origOpenEqForm.apply(this, arguments);
    setTimeout(function() {
        eqInjectCameraSection();
        eqClearPhoto();
    }, 90);
};

/* مسح الصورة مع إعادة تعيين الفورم */
const _origEqReset = window.eqResetForm;
window.eqResetForm = function() {
    eqClearPhoto();
    if (_origEqReset) _origEqReset.apply(this, arguments);
};

/* ══════════════════════════════════════════════════
   7. تصدير للـ window
   ══════════════════════════════════════════════════ */
window.eqOpenCamera          = eqOpenCamera;
window.eqClearPhoto          = eqClearPhoto;
window.eqHandlePhotoSelected = eqHandlePhotoSelected;
window.eqInjectCameraSection = eqInjectCameraSection;
