/* ====================================================
   EQUIPMENT FORM — تسجيل المعدات في Google Sheet
   Apps Script endpoint: receives element_id, element_name,
   item_name, contractor, date, equipments[]
   ==================================================== */


// Known equipment types for autocomplete
/* ── قائمة أنواع المعدات — تُحمَّل حصراً من categories.json (لا قيم افتراضية) ── */
let equipmentTypes = [];
/* alias للتوافق مع الكود القديم */
const EQ_KNOWN_TYPES = new Proxy([], {
    get(_, key) { return equipmentTypes[key]; }
});

let eqFormEquipmentCount = 0;

/* ── Open / Close ── */
function openEquipmentFormModal() {
    document.getElementById('equipmentFormModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    eqPopulateSubitems();
    eqPopulateContractors();
    eqBuildElementsList();
    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('eqf_date').value = today;
    // Add first row if empty
    if (eqFormEquipmentCount === 0) eqAddEquipmentRow();
}

function closeEquipmentFormModal() {
    document.getElementById('equipmentFormModal').classList.remove('active');
    document.body.style.overflow = '';
}

/* ── Populate subitems — now handled by band picker modal, kept for compatibility ── */
function eqPopulateSubitems() {
    // البنود تُعرض الآن في eqBandPickerModal — لا حاجة لملء select
}

/* ── Populate contractors select from loaded data ── */
function eqPopulateContractors() {
    const sel = document.getElementById('eqf_contractor');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- اختر المقاول --</option>';
    const contractors = new Set();
    // من allData المحملة
    Object.values(allData || {}).forEach(sheetData => {
        Object.values(sheetData).forEach(row => {
            const c = (row['CONTRACTOR'] || '').trim();
            if (c) contractors.add(c);
        });
    });
    // من contractorMap
    Object.keys(contractorMap || {}).forEach(name => {
        if (name.trim()) contractors.add(name.trim());
    });
    const sorted = [...contractors].sort((a, b) => a.localeCompare(b, 'ar'));
    sorted.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
}

/* ── Element search dropdown ── */
let _eqAllElements = []; // { id, name, sheetId, subName }

function eqBuildElementsList() {
    _eqAllElements = [];
    categories.forEach(cat => {
        cat.subitems.forEach(sub => {
            if (!allData[sub.sheetId]) return;
            Object.values(allData[sub.sheetId]).forEach(row => {
                const nameKey = row['ROAD NAME'] ? 'ROAD NAME' : row['BLOCK NAME'] ? 'BLOCK NAME' : 'NAME';
                const name = (row[nameKey] || '').trim();
                const id   = (row['ID'] || '').trim();
                if (name && id) {
                    _eqAllElements.push({ id, name, sheetId: sub.sheetId, subName: sub.name });
                }
            });
        });
    });
}

function eqShowElementDropdown() {
    eqBuildElementsList();
    eqFilterElementDropdown();
}

function eqFilterElementDropdown() {
    const inp = document.getElementById('eqf_element_search');
    const dd  = document.getElementById('eqf_element_dropdown');
    const q   = (inp.value || '').trim().toLowerCase();

    const filtered = q
        ? _eqAllElements.filter(e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
        : _eqAllElements;

    if (!filtered.length) {
        dd.innerHTML = '<div style="padding:12px 14px;text-align:center;color:rgba(255,255,255,0.3);font-size:12px;font-family:\'Cairo\',sans-serif;">لا توجد عناصر مطابقة</div>';
    } else {
        dd.innerHTML = filtered.slice(0, 60).map(e =>
            '<div onclick="eqSelectElement(\'' + e.id.replace(/'/g,"\\'") + '\',\'' + e.name.replace(/'/g,"\\'") + '\')" ' +
            'style="padding:9px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);transition:background 0.15s;display:flex;flex-direction:column;gap:2px;" ' +
            'onmouseover="this.style.background=\'rgba(39,174,106,0.12)\'" onmouseout="this.style.background=\'\'">'+
            '<span style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.9);font-family:\'Cairo\',sans-serif;">' + e.name + '</span>' +
            '<span style="font-size:10px;color:rgba(255,255,255,0.4);font-family:\'Cairo\',sans-serif;">ID: ' + e.id + ' • ' + e.subName + '</span>' +
            '</div>'
        ).join('');
    }
    dd.style.display = 'block';

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', eqCloseElementDropdownOutside, { once: true, capture: true });
    }, 0);
}

function eqCloseElementDropdownOutside(e) {
    const dd  = document.getElementById('eqf_element_dropdown');
    const inp = document.getElementById('eqf_element_search');
    if (!dd || !inp) return;
    if (!dd.contains(e.target) && e.target !== inp) {
        dd.style.display = 'none';
    } else {
        // Re-attach if click was inside dropdown or input
        document.addEventListener('click', eqCloseElementDropdownOutside, { once: true, capture: true });
    }
}

function eqSelectElement(id, name) {
    document.getElementById('eqf_element_id').value   = id;
    document.getElementById('eqf_element_name').value = name;
    document.getElementById('eqf_element_search').value = name;
    document.getElementById('eqf_element_dropdown').style.display = 'none';
    // Show info bar
    const info = document.getElementById('eqf_element_info');
    document.getElementById('eqf_element_info_name').textContent = name;
    document.getElementById('eqf_element_info_id').textContent   = 'ID: ' + id;
    info.style.display = 'flex';

    // ── ملء البند الفرعي تلقائياً من العنصر المختار ──
    const el = _eqAllElements.find(e => e.id === id && e.name === name)
            || _eqAllElements.find(e => e.id === id);
    if (el) {
        // ابحث عن البند الفرعي الكامل في categories
        let matchedSub = null, matchedCat = null;
        (categories || []).forEach(cat => {
            cat.subitems.forEach(sub => {
                if (sub.sheetId === el.sheetId) {
                    matchedSub = sub;
                    matchedCat = cat;
                }
            });
        });

        if (matchedSub && matchedCat) {
            // ملء بيانات البند
            document.getElementById('eqf_item_name').value  = matchedSub.name;
            document.getElementById('eqf_band_sheet').value = matchedSub.sheetId || '';
            document.getElementById('eqf_cat_name').value   = matchedCat.name || '';
            document.getElementById('eqf_cat_id').value     = matchedCat.id   || '';

            // تحديث الـ label في الزر
            const lbl = document.getElementById('eqf_band_label');
            if (lbl) {
                lbl.textContent = matchedSub.name;
                lbl.style.color = 'rgba(255,255,255,0.9)';
            }
            const bandBtn = document.getElementById('eqf_band_btn');
            if (bandBtn) {
                bandBtn.style.borderColor = 'rgba(39,174,106,0.5)';
                bandBtn.disabled = true;
                bandBtn.style.opacity = '0.6';
                bandBtn.style.cursor  = 'not-allowed';
                bandBtn.title = 'البند مرتبط تلقائياً بالعنصر المختار';
            }

            // المجموعة
            const group = getGroupForSub(matchedSub.id);
            document.getElementById('eqf_group_name').value = group ? (group.name || '—') : '—';
            document.getElementById('eqf_group_id').value   = group ? (group.id   || '')  : '';
        }
    }
}

function eqClearElement() {
    document.getElementById('eqf_element_id').value   = '';
    document.getElementById('eqf_element_name').value = '';
    document.getElementById('eqf_element_search').value = '';
    document.getElementById('eqf_element_info').style.display = 'none';

    // ── إعادة تفعيل زر البند ──
    const bandBtn = document.getElementById('eqf_band_btn');
    if (bandBtn) {
        bandBtn.disabled = false;
        bandBtn.style.opacity  = '';
        bandBtn.style.cursor   = '';
        bandBtn.style.borderColor = '';
        bandBtn.title = '';
    }
    // مسح بيانات البند
    document.getElementById('eqf_item_name').value   = '';
    document.getElementById('eqf_band_sheet').value  = '';
    document.getElementById('eqf_cat_name').value    = '';
    document.getElementById('eqf_cat_id').value      = '';
    document.getElementById('eqf_group_name').value  = '';
    document.getElementById('eqf_group_id').value    = '';
    const lbl = document.getElementById('eqf_band_label');
    if (lbl) { lbl.textContent = '-- اختر البند --'; lbl.style.color = ''; }
}

/* ── Pick from map ── */
let _eqPickingFromMap = false;
let _eqMapClickHandler = null;

function eqPickFromMap() {
    if (!map) { showAlert('❌ الخريطة غير جاهزة'); return; }

    // تحقق إن فيه طبقات محملة
    const hasLayers = Object.keys(allLayers).length > 0;
    if (!hasLayers) {
        showAlert('❌ حمّل بنداً على الخريطة أولاً');
        return;
    }

    _eqPickingFromMap = true;

    // ── إخفاء المودال بالكامل ──
    document.getElementById('equipmentFormModal').style.display = 'none';

    // ── شريط تلميح فوق الخريطة ──
    let hint = document.getElementById('eqPickMapHint');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'eqPickMapHint';
        hint.style.cssText = [
            'position:fixed','top:70px','left:50%','transform:translateX(-50%)',
            'z-index:99999','background:linear-gradient(135deg,#1a4a8a,#2196f3)',
            'color:white','padding:12px 24px','border-radius:12px',
            'font-size:13px','font-weight:700','font-family:\'Cairo\',sans-serif',
            'box-shadow:0 8px 28px rgba(33,150,243,0.5)',
            'display:flex','align-items:center','gap:14px','white-space:nowrap',
            'pointer-events:auto'
        ].join(';');
        hint.innerHTML =
            '<span>🗺 انقر على أي عنصر في الخريطة لاختياره</span>' +
            '<button onclick="eqCancelPickFromMap()" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:white;padding:4px 12px;border-radius:7px;font-size:12px;font-weight:700;font-family:\'Cairo\',sans-serif;cursor:pointer;">إلغاء</button>';
        document.body.appendChild(hint);
    }
    hint.style.display = 'flex';

    // ── إضافة cursor crosshair على الخريطة ──
    map.getContainer().style.cursor = 'crosshair';

    // ── ربط click مباشرة على كل feature في كل طبقة ──
    _eqMapClickHandler = function(e) {
        if (!_eqPickingFromMap) return;

        // منع الـ popup من الفتح
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
            e.originalEvent.preventDefault();
        }
        if (map.closePopup) map.closePopup();

        const row = _eqGetRowFromFeatureEvent(e);
        eqCancelPickFromMap();

        if (row) {
            const nameKey = row['ROAD NAME'] ? 'ROAD NAME' : row['BLOCK NAME'] ? 'BLOCK NAME' : 'NAME';
            const name = (row[nameKey] || '').trim() || row['ID'];
            const id   = row['ID'] || '';
            eqSelectElement(id, name);
            showAlert('✅ تم اختيار: ' + name, 'success');
        }
    };

    // ── handler للنقر على المساحة الفارغة من الخريطة ──
    _eqMapBgClickHandler = function(e) {
        if (!_eqPickingFromMap) return;
        // ابحث عن أقرب feature للنقطة المنقورة
        let nearest = null, nearestDist = Infinity;
        Object.entries(allLayers).forEach(([sheetId, layer]) => {
            if (!layer || !allData[sheetId]) return;
            layer.eachLayer(f => {
                try {
                    const center = f.getBounds ? f.getBounds().getCenter()
                                 : f.getLatLng ? f.getLatLng() : null;
                    if (!center) return;
                    const d = map.distance(e.latlng, center);
                    if (d < nearestDist) {
                        nearestDist = d;
                        const row = allData[sheetId][f.feature.properties.ID];
                        if (row) nearest = row;
                    }
                } catch(err) {}
            });
        });

        if (nearest && nearestDist < 500) {
            // اختار الأقرب إن كان ضمن 500 متر
            _eqPickingFromMap = false; // منع التكرار
            map.closePopup();
            const nameKey = nearest['ROAD NAME'] ? 'ROAD NAME' : nearest['BLOCK NAME'] ? 'BLOCK NAME' : 'NAME';
            const name = (nearest[nameKey] || '').trim() || nearest['ID'];
            eqCancelPickFromMap();
            eqSelectElement(nearest['ID'] || '', name);
            showAlert('✅ تم اختيار: ' + name, 'success');
        }
    };

    // أضف الـ handler على كل feature
    Object.values(allLayers).forEach(layer => {
        if (!layer) return;
        layer.eachLayer(f => {
            f.on('click', _eqMapClickHandler);
        });
    });

    // وعلى الـ map كـ fallback
    map.on('click', _eqMapBgClickHandler);
}

function _eqGetRowFromFeatureEvent(e) {
    const f = e.target || e.layer;
    if (!f || !f.feature) return null;
    const fid = f.feature.properties.ID;
    for (const [sheetId, data] of Object.entries(allData)) {
        if (data[fid]) return data[fid];
    }
    return null;
}

let _eqMapBgClickHandler = null;

function eqCancelPickFromMap() {
    _eqPickingFromMap = false;

    // ── إعادة إظهار المودال ──
    document.getElementById('equipmentFormModal').style.display = '';

    // ── إخفاء الشريط ──
    const hint = document.getElementById('eqPickMapHint');
    if (hint) hint.style.display = 'none';

    // ── إزالة cursor crosshair ──
    if (map) map.getContainer().style.cursor = '';

    // ── إزالة handlers من كل feature ──
    if (_eqMapClickHandler) {
        Object.values(allLayers).forEach(layer => {
            if (!layer) return;
            layer.eachLayer(f => {
                f.off('click', _eqMapClickHandler);
            });
        });
        _eqMapClickHandler = null;
    }

    // ── إزالة map background handler ──
    if (map && _eqMapBgClickHandler) {
        map.off('click', _eqMapBgClickHandler);
        _eqMapBgClickHandler = null;
    }

    // ── إغلاق أي popup مفتوح ──
    if (map) map.closePopup();
}

/* ── Band Picker Sub-Modal ── */
function eqOpenBandPicker() {
    const modal = document.getElementById('eqBandPickerModal');
    modal.style.display = 'flex';
    document.getElementById('eqBandPickerSearch').value = '';
    eqRenderBandPicker('');
    setTimeout(() => document.getElementById('eqBandPickerSearch').focus(), 100);
}

function eqCloseBandPicker() {
    document.getElementById('eqBandPickerModal').style.display = 'none';
}

function eqFilterBandPicker() {
    const q = document.getElementById('eqBandPickerSearch').value.trim().toLowerCase();
    eqRenderBandPicker(q);
}

function eqRenderBandPicker(q) {
    const list = document.getElementById('eqBandPickerList');
    let html = '';

    (categories || []).forEach(cat => {
        const subs = (cat.subitems || []).filter(sub => {
            if (!q) return true;
            return sub.name.toLowerCase().includes(q) ||
                   (sub.number || '').toLowerCase().includes(q);
        });
        if (!subs.length) return;

        html += '<div style="margin-bottom:8px;">' +
            '<div style="font-size:10px;font-weight:900;color:rgba(106,45,145,0.9);padding:6px 8px 4px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(106,45,145,0.2);margin-bottom:4px;font-family:\'Cairo\',sans-serif;">' +
            cat.emoji + ' ' + cat.name +
            '</div>';

        subs.forEach(sub => {
            const numBadge = sub.number
                ? '<span style="font-size:9px;font-weight:700;color:rgba(106,45,145,0.8);background:rgba(106,45,145,0.12);padding:2px 7px;border-radius:4px;border:1px solid rgba(106,45,145,0.2);margin-left:6px;flex-shrink:0;">' + sub.number + '</span>'
                : '';
            const safeCatName = cat.name.replace(/'/g, "\\'");
            const safeCatId   = (cat.id || '').replace(/'/g, "\\'");
            html += '<div onclick="eqSelectBand(\'' + sub.name.replace(/'/g, "\\'") + '\',\'' + (sub.sheetId || '') + '\',\'' + safeCatName + '\',\'' + safeCatId + '\')" ' +
                'style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:9px;cursor:pointer;border:1.5px solid transparent;transition:all 0.15s;margin-bottom:3px;background:rgba(255,255,255,0.03);" ' +
                'onmouseover="this.style.background=\'rgba(106,45,145,0.12)\';this.style.borderColor=\'rgba(106,45,145,0.35)\'" ' +
                'onmouseout="this.style.background=\'rgba(255,255,255,0.03)\';this.style.borderColor=\'transparent\'">' +
                '<span style="font-size:16px;flex-shrink:0;">📌</span>' +
                '<span style="flex:1;font-size:13px;font-weight:700;color:rgba(255,255,255,0.9);font-family:\'Cairo\',sans-serif;text-align:right;">' + sub.name + '</span>' +
                numBadge +
                '</div>';
        });

        html += '</div>';
    });

    if (!html) {
        html = '<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.3);font-size:13px;font-family:\'Cairo\',sans-serif;">لا توجد بنود مطابقة</div>';
    }

    list.innerHTML = html;
}

function eqSelectBand(name, sheetId, catName, catId) {
    document.getElementById('eqf_item_name').value  = name;
    document.getElementById('eqf_band_sheet').value = sheetId || '';
    const lbl = document.getElementById('eqf_band_label');
    lbl.textContent = name;
    lbl.style.color = 'rgba(255,255,255,0.9)';
    document.getElementById('eqf_band_btn').style.borderColor = 'rgba(106,45,145,0.5)';

    // ── البند الرئيسي ──
    document.getElementById('eqf_cat_name').value = catName || '';
    document.getElementById('eqf_cat_id').value   = catId   || '';

    // ── المجموعة (من similarGroups) ──
    const sub = (categories || []).flatMap(c => c.subitems)
        .find(s => s.sheetId === sheetId && s.name === name);
    const group = sub ? getGroupForSub(sub.id) : null;
    document.getElementById('eqf_group_name').value = group ? (group.name || '—') : '—';
    document.getElementById('eqf_group_id').value   = group ? (group.id   || '')  : '';

    eqCloseBandPicker();
}

/* ── Add an equipment row ── */
function eqAddEquipmentRow() {
    var container = document.getElementById('eqf_equipments_container');
    var hint = container.querySelector('.eq-empty-hint');
    if (hint) hint.remove();

    // تحقق إن القائمة فيها أنواع
    if (!equipmentTypes.length) {
        showAlert('❌ لا توجد أنواع معدات في النظام — أضفها من الإعدادات ⚙️ ← أنواع المعدات');
        return;
    }

    eqFormEquipmentCount++;
    var rowId = 'eqrow_' + eqFormEquipmentCount;

    // Build select options — خلفية صلبة لضمان ظهور النص على كل الأجهزة
    var optionsHtml = '<option value="" disabled selected>-- اختر نوع المعدة --</option>' +
        equipmentTypes.map(function(t) {
            return '<option value="' + t + '">' + t + '</option>';
        }).join('');

    var row = document.createElement('div');
    row.className = 'eq-item-row';
    row.id = rowId;
    row.innerHTML =
        '<select class="eq-type-inp" id="' + rowId + '_type">' +
        optionsHtml + '</select>' +
        '<input type="number" placeholder="العدد" min="0" id="' + rowId + '_count" style="text-align:center;">' +
        '<button class="eq-del-row-btn" onclick="eqRemoveEquipmentRow(\'' + rowId + '\')" title="حذف">✕</button>';

    container.appendChild(row);

    var sel = row.querySelector('.eq-type-inp');
    if (sel) sel.focus();
}
/* ── Remove an equipment row ── */
function eqRemoveEquipmentRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) row.remove();
    eqShowEmptyHint();
}

/* ── Show hint if no rows ── */
function eqShowEmptyHint() {
    const container = document.getElementById('eqf_equipments_container');
    if (!container.querySelector('.eq-item-row')) {
        if (!container.querySelector('.eq-empty-hint')) {
            container.innerHTML = '<div class="eq-empty-hint">اضغط "إضافة معدة" لإضافة نوع معدة</div>';
        }
        eqFormEquipmentCount = 0;
    }
}

/* ── Reset the form ── */
function eqResetForm() {
    document.getElementById('eqf_element_id').value     = '';
    document.getElementById('eqf_element_name').value   = '';
    document.getElementById('eqf_element_search').value = '';
    document.getElementById('eqf_element_info').style.display = 'none';
    document.getElementById('eqf_element_dropdown').style.display = 'none';
    document.getElementById('eqf_item_name').value   = '';
    document.getElementById('eqf_band_sheet').value  = '';
    document.getElementById('eqf_cat_name').value    = '';
    document.getElementById('eqf_cat_id').value      = '';
    document.getElementById('eqf_group_name').value  = '';
    document.getElementById('eqf_group_id').value    = '';
    const lbl = document.getElementById('eqf_band_label');
    if (lbl) { lbl.textContent = '-- اختر البند --'; lbl.style.color = ''; }
    const btn = document.getElementById('eqf_band_btn');
    if (btn) btn.style.borderColor = '';
    document.getElementById('eqf_contractor').value   = '';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('eqf_date').value = today;
    const doneQty = document.getElementById('eqf_done_qty');
    if (doneQty) doneQty.value = '';
    document.getElementById('eqf_equipments_container').innerHTML = '';
    eqFormEquipmentCount = 0;
    eqShowEmptyHint();
    eqHideFeedback();
    eqCancelPickFromMap();
}

/* ── Show / hide feedback ── */
function eqShowFeedback(msg, type) {
    const fb = document.getElementById('eqf_feedback');
    fb.className = 'eqf-' + type;
    fb.textContent = msg;
    fb.style.display = 'block';
    if (type === 'success') {
        setTimeout(() => eqHideFeedback(), 4000);
    }
}

function eqHideFeedback() {
    const fb = document.getElementById('eqf_feedback');
    fb.style.display = 'none';
    fb.className = '';
}

/* ── Collect equipment rows ── */
function eqCollectEquipments() {
    const rows = document.querySelectorAll('#eqf_equipments_container .eq-item-row');
    const result = [];
    rows.forEach(row => {
        const typeInp  = row.querySelector('.eq-type-inp');
        const countInp = row.querySelector('input[type="number"]');
        const t = (typeInp ? typeInp.value.trim() : '');
        const c = parseInt(countInp ? countInp.value : '0') || 0;
        if (t) result.push({ type: t, count: c });
    });
    return result;
}

/* ── Submit the form ── */
async function eqSubmitForm() {
    eqHideFeedback();

    const element_id   = document.getElementById('eqf_element_id').value.trim();
    const element_name = document.getElementById('eqf_element_name').value.trim();
    const item_name    = document.getElementById('eqf_item_name').value.trim();
    const cat_name     = document.getElementById('eqf_cat_name').value.trim();
    const group_name   = document.getElementById('eqf_group_name').value.trim();
    const contractor   = document.getElementById('eqf_contractor').value.trim();
    const date         = document.getElementById('eqf_date').value.trim();
    const done_qty     = parseFloat(document.getElementById('eqf_done_qty').value) || 0;
    const band_sheet   = document.getElementById('eqf_band_sheet').value.trim();

    // Validation
    if (!element_name) { eqShowFeedback('❌ يرجى اختيار أو إدخال اسم العنصر', 'error'); return; }
    if (!item_name)    { eqShowFeedback('❌ يرجى اختيار البند', 'error'); return; }
    if (!contractor)   { eqShowFeedback('❌ يرجى اختيار المقاول', 'error'); return; }
    if (!date)         { eqShowFeedback('❌ يرجى اختيار التاريخ', 'error'); return; }
    if (!band_sheet)   { eqShowFeedback('❌ البند المختار ليس له شيت مرتبط — راجع الإعدادات', 'error'); return; }

    const equipments = eqCollectEquipments();
    if (!equipments.length) {
        eqShowFeedback('❌ يرجى إضافة معدة واحدة على الأقل', 'error');
        return;
    }

    // Disable submit button
    const btn = document.getElementById('eqf_submit_btn');
    btn.disabled = true;
    btn.textContent = '⏳ جاري الحفظ...';
    eqShowFeedback('⏳ جاري إرسال البيانات...', 'loading');

    // ── جيب scriptUrl من البند الفرعي في categories ──
    let scriptUrl = '';
    try {
        const allSubs = (categories || []).flatMap(c => c.subitems || []);
        const matchedSub = allSubs.find(s => s.sheetId === band_sheet);

        if (matchedSub && matchedSub.scriptUrl) {
            scriptUrl = matchedSub.scriptUrl.trim();
        }

        if (!scriptUrl) {
            throw new Error(
                'لم يتم العثور على رابط السكريبت — تأكد من:\n' +
                '1. فتح الإعدادات ⚙️ ← دبل كليك على البند الفرعي في السايدبار\n' +
                '2. إدخال رابط Apps Script في حقل "رابط سكريبت تسجيل الكمية - المعدات"\n' +
                '3. تصدير categories.json ⬇ وإعادة رفعه'
            );
        }
    } catch (fetchErr) {
        eqShowFeedback('❌ ' + fetchErr.message, 'error');
        btn.disabled    = false;
        btn.textContent = '💾 حفظ في السجل';
        return;
    }

    const payload = { form_type: 'daily', group_name, cat_name, element_id, element_name, item_name, contractor, date, done_qty, equipments };
    try {
        const r = await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });

        const text = await r.text();
        let resp = {};
        try { resp = JSON.parse(text); } catch(e) {}

        if (resp.status === 'success' || r.ok) {
            eqShowFeedback('✅ تم حفظ بيانات المعدات بنجاح في السجل!', 'success');
            showAlert('✅ تم تسجيل الكمية - المعدات بنجاح', 'success');
            setTimeout(() => eqResetForm(), 2500);
        } else {
            throw new Error(resp.message || 'فشل الحفظ');
        }

    } catch(e) {
        console.error('Equipment form submit error:', e);
        eqShowFeedback('❌ تعذر الحفظ: ' + (e.message || 'خطأ في الاتصال') + ' — تأكد من إعدادات Apps Script', 'error');
    } finally {
        btn.disabled    = false;
        btn.textContent = '💾 حفظ في السجل';
    }
}

/* ── Override openEquipmentModal to also load from the new sheet ── */
const _origOpenEquipmentModal = openEquipmentModal;
window.openEquipmentModal = function() {
    _eqActiveTab = 'overview';
    openModal('equipmentModal');
    // If new sheet data is available, merge it in before loading
    eqMergeNewSheetDataThenLoad();
};

/* ── Sheet ID for the new equipment registration sheet ── */
const EQ_REG_SHEET_ID = "1kPeMj-XDSmIu5nrNmRK6kmlK268LOzRxOm4WUWSkBwU";

/* ── Fetch data from the new registration sheet and merge into equipmentRawRows ── */
let _eqRegCache = null;
let _eqRegLastFetch = 0;

async function eqFetchRegistrationSheet() {
    const now = Date.now();
    // Cache for 2 minutes
    if (_eqRegCache && (now - _eqRegLastFetch) < 120000) return _eqRegCache;

    try {
        const url = `https://docs.google.com/spreadsheets/d/${EQ_REG_SHEET_ID}/export?format=csv&gid=0`;
        const r   = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const csv = await r.text();
        if (csv.trim().startsWith('<')) throw new Error('not public');

        const lines = csv.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];

        /*
         * الشيت الجديد له أعمدة بالترتيب:
         *  element_id | element_name | item_name | contractor | date | type1 | count1 | type2 | count2 | ...
         *
         * نحوّله لصفوف بصيغة {ID, البند, CONTRACTOR, [معدة]: عدد, ...}
         * حتى يتوافق مع نظام equipmentRawRows الحالي
         */
        const rows = [];
        const baseHeaders = ['ID', 'ELEMENT_NAME', 'البند', 'CONTRACTOR', 'DATE'];

        for (let i = 1; i < lines.length; i++) {
            const vals = lines[i].split(',').map(v => v.trim());
            if (!vals[0]) continue;

            const row = {
                'ID':           vals[0] || '',
                'ELEMENT_NAME': vals[1] || '',
                'البند':        vals[2] || '',
                'CONTRACTOR':   vals[3] || '',
                'DATE':         vals[4] || '',
            };

            // Equipment pairs: type, count starting at index 5
            for (let j = 5; j < vals.length - 1; j += 2) {
                const typeName = (vals[j] || '').trim();
                const count    = parseInt(vals[j+1] || '0') || 0;
                if (typeName) {
                    row[typeName.toUpperCase()] = String(count);
                }
            }
            rows.push(row);
        }

        _eqRegCache    = rows;
        _eqRegLastFetch = now;
        return rows;

    } catch(e) {
        console.warn('eqFetchRegistrationSheet failed:', e.message);
        return [];
    }
}

/* ── Build a unified view combining original + registration sheet data ── */
async function eqMergeNewSheetDataThenLoad() {
    const loadMsg = document.getElementById('eqLoadMsg');
    if (loadMsg) { loadMsg.style.display = 'block'; loadMsg.textContent = '⏳ جاري تحميل بيانات المعدات المسجلة...'; }

    const regRows = await eqFetchRegistrationSheet();

    if (regRows.length > 0) {
        // We need to rebuild combined headers for the dashboard
        // Gather all unique equipment type keys from both sources
        const allEqKeys = new Set();

        // From original equipment sheet
        (equipmentRawHeaders || []).forEach(h => {
            const u = h.trim().toUpperCase();
            if (!['ID','BAYAN','البيان','DESCRIPTION','بيان','البند','BAND','ALBND','ITEM','ELEMENT_NAME','CONTRACTOR','DATE'].includes(u) && h.trim()) {
                allEqKeys.add(h.trim());
            }
        });

        // From registration sheet rows
        regRows.forEach(row => {
            Object.keys(row).forEach(k => {
                if (!['ID','ELEMENT_NAME','البند','CONTRACTOR','DATE'].includes(k.toUpperCase()) && !['ID','ELEMENT_NAME','البند','CONTRACTOR','DATE'].includes(k)) {
                    allEqKeys.add(k);
                }
            });
        });

        // Build combined headers if we have reg data
        if (!window._eqCombinedInited) {
            window._eqCombinedInited = true;
        }

        // Store reg rows globally so dashboard can use them
        window.eqRegRows = regRows;
        window.eqAllEqKeys = [...allEqKeys];
    }

    loadEquipmentModalWithReg(regRows);
}

/* ── Extended loadEquipmentModal that includes registration sheet data ── */
function loadEquipmentModalWithReg(regRows) {
    const loadMsg = document.getElementById('eqLoadMsg');
    const allRows = [...(equipmentRawRows || [])];

    // Merge registration rows
    (regRows || []).forEach(rr => {
        allRows.push(rr);
    });

    if (!allRows.length) {
        if (loadMsg) loadMsg.style.display = 'block';
        if (loadMsg) loadMsg.textContent = '⏳ جاري التحميل...';
        setTimeout(() => { if (allRows.length || (regRows||[]).length) eqMergeNewSheetDataThenLoad(); }, 1500);
        return;
    }

    if (loadMsg) loadMsg.style.display = 'none';

    // Build combined headers
    const skip = new Set(['ID','BAYAN','البيان','DESCRIPTION','بيان','البند','BAND','ALBND','ITEM','ELEMENT_NAME','CONTRACTOR','DATE','ALBAYAN']);
    const colSet = new Set();
    allRows.forEach(row => {
        Object.keys(row).forEach(k => {
            const u = k.trim().toUpperCase();
            if (!skip.has(u) && !skip.has(k.trim()) && k.trim()) colSet.add(k.trim());
        });
    });
    const cols = [...colSet].map(name => ({ name, key: name.toUpperCase() }));

    // Detect band key
    const bKey = (function() {
        const found = allRows[0] ? Object.keys(allRows[0]).find(k => {
            const u = k.trim().toUpperCase();
            return u === 'البند' || u === 'BAND' || u === 'ALBND' || u === 'ITEM';
        }) : null;
        return found ? found.trim().toUpperCase() : null;
    })();

    const cKey = 'CONTRACTOR';

    /* ── KPIs ── */
    function sumCols(rows) {
        const t = {};
        cols.forEach(col => {
            let s = 0;
            rows.forEach(r => {
                const v = parseFloat(r[col.key] || r[col.name] || 0);
                if (!isNaN(v)) s += v;
            });
            if (s > 0) t[col.name] = s;
        });
        return t;
    }

    const totalsByType  = sumCols(allRows);
    const grandTotal    = Object.values(totalsByType).reduce((a,b) => a+b, 0);
    const contractors   = new Set(allRows.map(r => (r[cKey] || r['CONTRACTOR'] || '').trim()).filter(Boolean));
    const bands         = new Set(allRows.map(r => (r[bKey] || r['البند'] || '').trim()).filter(Boolean));

    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('eqKpiTypes',       Object.keys(totalsByType).length);
    setEl('eqKpiTotal',       fmtNum(grandTotal));
    setEl('eqKpiContractors', contractors.size || '—');
    setEl('eqKpiBands',       bands.size || '—');
    setEl('eqLastUpdate',     'آخر تحديث: ' + new Date().toLocaleTimeString('ar-SA') + ' — ' + allRows.length + ' سجل (أصلي + مسجل)');

    /* ── Overview chart ── */
    const entries = Object.entries(totalsByType).sort((a,b) => b[1]-a[1]);
    const legendEl = document.getElementById('eqOverviewLegend');
    if (legendEl) {
        legendEl.innerHTML = entries.map(([name, val], i) =>
            `<span style="display:flex;align-items:center;gap:5px;">
                <span style="width:10px;height:10px;border-radius:2px;background:${EQ_PALETTE[i%EQ_PALETTE.length]};display:inline-block;"></span>
                ${name}: <strong style="color:var(--gold);">${fmtNum(val)}</strong>
            </span>`).join('');
    }
    if (_eqChartInst) { _eqChartInst.destroy(); _eqChartInst = null; }
    const cvs = document.getElementById('eqOverviewChart');
    if (cvs && entries.length) {
        const doChart = () => {
            _eqChartInst = new Chart(cvs, {
                type: 'bar',
                data: {
                    labels: entries.map(([name]) => name),
                    datasets: [{
                        label: 'عدد المعدات',
                        data: entries.map(([,v]) => v),
                        backgroundColor: entries.map((_, i) => EQ_PALETTE[i % EQ_PALETTE.length]),
                        borderRadius: 5,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => ' ' + ctx.parsed.y.toLocaleString('en-US') + ' وحدة' } }
                    },
                    scales: {
                        x: { ticks: { autoSkip: false, maxRotation: 40, color: 'rgba(255,255,255,0.55)', font: { size: 11 } }, grid: { display: false } },
                        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.07)' }, ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 11 }, callback: v => v.toLocaleString('en-US') } }
                    }
                }
            });
        };
        if (typeof Chart !== 'undefined') doChart();
        else {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
            s.onload = doChart;
            document.head.appendChild(s);
        }
    }

    /* ── By Contractor ── */
    const contractorWrap = document.getElementById('eqContractorTableWrap');
    if (contractorWrap) {
        const byC = {};
        allRows.forEach(row => {
            const c = (row['CONTRACTOR'] || row[cKey] || '').trim();
            if (!c) return;
            if (!byC[c]) byC[c] = { rows: [], bands: new Set() };
            byC[c].rows.push(row);
            const b = row[bKey] || row['البند'] || '';
            if (b) byC[c].bands.add(b.trim());
        });
        if (!Object.keys(byC).length) {
            contractorWrap.innerHTML = '<div class="bd-msg bd-msg-load">لا يوجد بيانات مقاولين</div>';
        } else {
            const sortedC = Object.entries(byC).sort((a,b) => {
                const ta = Object.values(sumCols(a[1].rows)).reduce((x,y)=>x+y,0);
                const tb = Object.values(sumCols(b[1].rows)).reduce((x,y)=>x+y,0);
                return tb - ta;
            });
            let html = '<table class="bd-tbl"><thead><tr><th>المقاول</th><th>البند</th><th style="min-width:90px;text-align:center;">الإجمالي</th><th>تفاصيل المعدات</th></td></thead><tbody>';
            sortedC.forEach(([name, data]) => {
                const t = sumCols(data.rows);
                const tot = Object.values(t).reduce((a,b)=>a+b,0);
                const bandsStr = [...data.bands].join(' • ') || '—';
                const pillsArr = Object.entries(t).sort((a,b)=>b[1]-a[1]);
                const pills = pillsArr.slice(0,5).map(([pn, pv]) =>
                    `<span class="eq-pill-dark">${pn}: <strong>${fmtNum(pv)}</strong></span>`).join(' ');
                const more = pillsArr.length > 5 ? `<span class="eq-pill-dark">+${pillsArr.length-5} أخرى</span>` : '';
                html += `<tr>
                    <td style="font-weight:700;color:var(--gold);">${name}</td>
                    <td style="font-size:11px;color:rgba(255,255,255,0.55);">${bandsStr}</td>
                    <td style="text-align:center;"><span style="background:rgba(245,200,66,0.12);border:1px solid rgba(245,200,66,0.3);color:var(--gold);padding:2px 10px;border-radius:4px;font-weight:900;font-size:13px;">${fmtNum(tot)}</span></td>
                    <td><div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;">${pills}${more}</div></td>
                </tr>`;
            });
            html += '</tbody></table>';
            contractorWrap.innerHTML = html;
        }
    }

    /* ── By Band ── */
    const bandWrap = document.getElementById('eqBandTableWrap');
    if (bandWrap) {
        const byB = {};
        allRows.forEach(row => {
            const b = (row[bKey] || row['البند'] || '').trim();
            if (!b) return;
            if (!byB[b]) byB[b] = { rows: [], contractors: new Set() };
            byB[b].rows.push(row);
            const c = (row['CONTRACTOR'] || row[cKey] || '').trim();
            if (c) byB[b].contractors.add(c);
        });
        if (!Object.keys(byB).length) {
            bandWrap.innerHTML = '<div class="bd-msg bd-msg-load">لا يوجد بيانات بنود</div>';
        } else {
            const sortedB = Object.entries(byB).sort((a,b) => a[0].localeCompare(b[0],'ar'));
            let html = '<table class="bd-tbl"><thead><tr><th>البند</th><th>المقاولون</th><th style="min-width:90px;text-align:center;">الإجمالي</th><th>تفاصيل المعدات</th></tr></thead><tbody>';
            sortedB.forEach(([name, data]) => {
                const t = sumCols(data.rows);
                const tot = Object.values(t).reduce((a,b)=>a+b,0);
                const cStr = [...data.contractors].join(' • ') || '—';
                const pillsArr = Object.entries(t).sort((a,b)=>b[1]-a[1]);
                const pills = pillsArr.slice(0,5).map(([pn,pv]) =>
                    `<span class="eq-pill-dark">${pn}: <strong>${fmtNum(pv)}</strong></span>`).join(' ');
                const more = pillsArr.length > 5 ? `<span class="eq-pill-dark">+${pillsArr.length-5} أخرى</span>` : '';
                html += `<td>
                    <td style="font-weight:700;color:rgba(255,255,255,0.9);">${name}</td>
                    <td style="font-size:11px;color:rgba(255,255,255,0.55);">${cStr}</td>
                    <td style="text-align:center;"><span style="background:rgba(33,150,243,0.15);border:1px solid rgba(33,150,243,0.4);color:#5baddf;padding:2px 10px;border-radius:4px;font-weight:900;font-size:13px;">${fmtNum(tot)}</span></td>
                    <td><div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;">${pills}${more}</div></td>
                </tr>`;
            });
            html += '</tbody></table>';
            bandWrap.innerHTML = html;
        }
    }

    /* ── Matrix ── */
    const matrixWrap = document.getElementById('eqMatrixWrap');
    if (matrixWrap) {
        const contractorList = [...contractors].sort();
        const activeCols = cols.filter(col => {
            let s = 0;
            allRows.forEach(r => {
                const v = parseFloat(r[col.key] || r[col.name] || 0);
                if (!isNaN(v)) s += v;
            });
            return s > 0;
        });
        if (!contractorList.length) {
            matrixWrap.innerHTML = '<div class="bd-msg bd-msg-load">لا يوجد بيانات كافية للمصفوفة</div>';
        } else {
            const byC2 = {};
            allRows.forEach(row => {
                const c = (row['CONTRACTOR'] || row[cKey] || '').trim();
                if (!c) return;
                if (!byC2[c]) byC2[c] = {};
                activeCols.forEach(col => {
                    const v = parseFloat(row[col.key] || row[col.name] || 0);
                    if (!isNaN(v)) byC2[c][col.name] = (byC2[c][col.name]||0) + v;
                });
            });
            const colMaxes = {};
            activeCols.forEach(col => {
                colMaxes[col.name] = Math.max(...contractorList.map(c => (byC2[c]||{})[col.name]||0), 1);
            });
            let html = `<table class="bd-tbl" style="min-width:${activeCols.length*75+180}px;">
                <thead><tr><th style="min-width:160px;">المقاول</th>
                ${activeCols.map(c => `<th style="min-width:70px;text-align:center;font-size:10px;">${c.name}</th>`).join('')}
                <th style="min-width:80px;text-align:center;">المجموع</th>
                </tr></thead><tbody>`;
            contractorList.forEach(c => {
                const cData = byC2[c] || {};
                const rowTot = activeCols.reduce((a, col) => a + (cData[col.name]||0), 0);
                html += `<tr><td style="font-weight:700;color:rgba(255,255,255,0.85);">${c}</td>
                    ${activeCols.map(col => {
                        const v = cData[col.name] || 0;
                        const pct = v / colMaxes[col.name];
                        const bg = v > 0 ? `rgba(245,200,66,${0.1 + pct * 0.65})` : 'transparent';
                        return `<td style="text-align:center;background:${bg};font-variant-numeric:tabular-nums;color:${v>0?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.2)'};">${v>0?fmtNum(v):'—'}</td>`;
                    }).join('')}
                    <td style="text-align:center;"><span style="background:rgba(245,200,66,0.12);border:1px solid rgba(245,200,66,0.3);color:var(--gold);padding:2px 8px;border-radius:4px;font-weight:900;font-size:12px;">${fmtNum(rowTot)}</span></td>
                </tr>`;
            });
            const grandRow = activeCols.reduce((a,col) => {
                const s = contractorList.reduce((x,c) => x+((byC2[c]||{})[col.name]||0),0);
                return a + s;
            }, 0);
            html += `<tr style="border-top:1px solid rgba(255,255,255,0.12);">
                <td style="font-weight:900;color:rgba(255,255,255,0.6);font-size:11px;">الإجمالي الكلي</td>
                ${activeCols.map(col => {
                    const s = contractorList.reduce((a,c) => a+((byC2[c]||{})[col.name]||0),0);
                    return `<td style="text-align:center;font-weight:700;color:rgba(255,255,255,0.55);font-size:11px;">${s>0?fmtNum(s):'—'}</td>`;
                }).join('')}
                <td style="text-align:center;"><span style="background:rgba(255,152,0,0.15);border:1px solid rgba(255,152,0,0.4);color:#ff9800;padding:2px 8px;border-radius:4px;font-weight:900;">${fmtNum(grandTotal)}</span></td>
            <tr></tbody></table>`;
            matrixWrap.innerHTML = html;
        }
    }

    eqSwitchTab(_eqActiveTab);
}

/* ── Patch refresh button to also use merged data ── */
const _eqRefreshBtn = document.querySelector('[onclick="loadEquipmentModal()"]');
// Override the button onclick after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('[onclick="loadEquipmentModal()"]');
    if (btn) btn.setAttribute('onclick', 'eqMergeNewSheetDataThenLoad()');
});

// Also patch loadEquipmentModal called from footer refresh
window.loadEquipmentModal = function() {
    _eqRegCache = null; // force fresh fetch
    eqMergeNewSheetDataThenLoad();
};

/* ====================================================
   EQUIPMENT TYPES MANAGEMENT — Admin Only
   إدارة قائمة أنواع المعدات — للأدمن فقط
   ==================================================== */

function saveEquipmentTypes() {
    // حفظ مؤقت في الجلسة فقط — المصدر الأساسي هو categories.json
    // الأدمن يصدّر الملف ليتشاركه مع بقية المستخدمين
    refreshEquipmentDatalist();
    updateEqTypesCount();
}

function refreshEquipmentDatalist() {
    // أعد بناء كل الـ select الموجودة في نموذج التسجيل
    document.querySelectorAll('.eq-type-inp').forEach(function(sel) {
        var currentVal = sel.value;
        sel.innerHTML = '<option value="" disabled>-- اختر نوع المعدة --</option>' +
            equipmentTypes.map(function(t) {
                return '<option value="' + t + '"' + (t === currentVal ? ' selected' : '') + '>' + t + '</option>';
            }).join('');
        if (!equipmentTypes.includes(currentVal)) sel.value = '';
    });
}

function updateEqTypesCount() {
    const el = document.getElementById('eqTypesCount');
    if (el) el.textContent = equipmentTypes.length + ' نوع معدة في القائمة';
}

function renderEquipmentTypesList() {
    const list = document.getElementById('eqTypesList');
    if (!list) return;

    updateEqTypesCount();

    if (!equipmentTypes.length) {
        list.innerHTML = `<div style="text-align:center;color:var(--text-soft);font-size:11px;padding:16px 0;line-height:1.8;">
            لا توجد أنواع معدات بعد<br>
            <span style="opacity:0.7;">أضف من الحقل أعلاه ثم صدّر categories.json ⬇</span>
        </div>`;
        return;
    }

    list.innerHTML = equipmentTypes.map((type, idx) => `
        <div class="eq-type-row" id="eqtyperow_${idx}" draggable="true"
             ondragstart="eqTypeDragStart(event, ${idx})"
             ondragover="eqTypeDragOver(event)"
             ondrop="eqTypeDrop(event, ${idx})"
             ondragend="eqTypeDragEnd(event)"
             ondragleave="eqTypeDragLeave(event)"
             style="display:flex;align-items:center;gap:8px;padding:6px 9px;
                    background:rgba(39,174,106,0.04);border:1px solid rgba(39,174,106,0.12);
                    border-radius:7px;margin-bottom:4px;cursor:grab;
                    transition:all 0.15s;user-select:none;">
            <span style="color:rgba(39,174,106,0.5);font-size:13px;flex-shrink:0;" title="اسحب لإعادة الترتيب">⠿</span>
            <span style="flex:1;font-size:12px;font-weight:600;color:var(--text);text-align:right;">${type}</span>
            <button onclick="editEquipmentType(${idx})"
                title="تعديل الاسم"
                style="background:rgba(33,150,243,0.08);border:1px solid rgba(33,150,243,0.25);
                       color:#2196f3;width:24px;height:24px;border-radius:5px;
                       cursor:pointer;font-size:11px;display:flex;align-items:center;
                       justify-content:center;flex-shrink:0;transition:all 0.15s;
                       font-family:'Cairo',sans-serif;"
                onmouseover="this.style.background='rgba(33,150,243,0.18)'"
                onmouseout="this.style.background='rgba(33,150,243,0.08)'">✎</button>
            <button onclick="deleteEquipmentType(${idx})"
                title="حذف"
                style="background:rgba(244,67,54,0.08);border:1px solid rgba(244,67,54,0.25);
                       color:#e53935;width:24px;height:24px;border-radius:5px;
                       cursor:pointer;font-size:11px;display:flex;align-items:center;
                       justify-content:center;flex-shrink:0;transition:all 0.15s;
                       font-family:'Cairo',sans-serif;"
                onmouseover="this.style.background='rgba(244,67,54,0.18)'"
                onmouseout="this.style.background='rgba(244,67,54,0.08)'">✕</button>
        </div>`).join('');
}

/* ── Drag & Drop — إعادة ترتيب أنواع المعدات ── */
let _eqTypeDragIdx = null;

function eqTypeDragStart(e, idx) {
    _eqTypeDragIdx = idx;
    e.currentTarget.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
}

function eqTypeDragEnd(e) {
    e.currentTarget.style.opacity = '1';
    document.querySelectorAll('.eq-type-row').forEach(r => {
        r.style.borderColor = 'rgba(39,174,106,0.12)';
        r.style.opacity = '1';
    });
    _eqTypeDragIdx = null;
}

function eqTypeDragOver(e) {
    e.preventDefault();
    e.currentTarget.style.borderColor = '#f5c842';
    e.dataTransfer.dropEffect = 'move';
}

function eqTypeDragLeave(e) {
    e.currentTarget.style.borderColor = 'rgba(39,174,106,0.12)';
}

function eqTypeDrop(e, toIdx) {
    e.preventDefault();
    e.currentTarget.style.borderColor = 'rgba(39,174,106,0.12)';
    if (_eqTypeDragIdx === null || _eqTypeDragIdx === toIdx) return;
    const moved = equipmentTypes.splice(_eqTypeDragIdx, 1)[0];
    const adjustedIdx = _eqTypeDragIdx < toIdx ? toIdx - 1 : toIdx;
    equipmentTypes.splice(adjustedIdx, 0, moved);
    _eqTypeDragIdx = null;
    saveEquipmentTypes();
    renderEquipmentTypesList();
}

function addEquipmentType() {
    const inp = document.getElementById('eqTypeNewInput');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) { showAlert('❌ أدخل اسم المعدة'); return; }
    if (equipmentTypes.map(t=>t.trim()).includes(val)) { showAlert('⚠️ هذا النوع موجود بالفعل'); return; }
    equipmentTypes.push(val);
    saveEquipmentTypes();
    renderEquipmentTypesList();
    inp.value = '';
    inp.focus();
    showAlert('✅ تمت الإضافة: ' + val, 'success');
}

function editEquipmentType(idx) {
    const current = equipmentTypes[idx];
    const newName = prompt('تعديل نوع المعدة:', current);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) { showAlert('❌ الاسم لا يمكن أن يكون فارغاً'); return; }
    if (trimmed === current) return;
    if (equipmentTypes.some((t,i) => i !== idx && t.trim() === trimmed)) {
        showAlert('⚠️ هذا الاسم موجود بالفعل'); return;
    }
    equipmentTypes[idx] = trimmed;
    saveEquipmentTypes();
    renderEquipmentTypesList();
    showAlert('✅ تم التعديل: ' + trimmed, 'success');
}

function deleteEquipmentType(idx) {
    const name = equipmentTypes[idx];
    if (!confirm(`حذف "${name}" من قائمة أنواع المعدات؟`)) return;
    equipmentTypes.splice(idx, 1);
    saveEquipmentTypes();
    renderEquipmentTypesList();
    showAlert('✅ تم الحذف', 'success');
}

function resetEquipmentTypesToDefault() {
    if (!confirm('مسح جميع أنواع المعدات؟ ستصبح القائمة فارغة.')) return;
    equipmentTypes = [];
    saveEquipmentTypes();
    renderEquipmentTypesList();
    showAlert('✅ تم مسح القائمة', 'success');
}

function importEquipmentTypesFromCSV() {
    const area = document.getElementById('eqTypesImportArea');
    if (!area) return;
    const raw = area.value.trim();
    if (!raw) { showAlert('❌ الحقل فارغ'); return; }
    const items = raw.split(/[\n,،]+/).map(s => s.trim()).filter(Boolean);
    const existing = equipmentTypes.map(t => t.trim());
    const newOnes = items.filter(i => !existing.includes(i));
    if (!newOnes.length) { showAlert('⚠️ جميع الأنواع موجودة بالفعل'); return; }
    equipmentTypes = [...equipmentTypes, ...newOnes];
    saveEquipmentTypes();
    renderEquipmentTypesList();
    area.value = '';
    showAlert(`✅ تمت إضافة ${newOnes.length} نوع جديد`, 'success');
}
/* ====================================================
   CUMULATIVE QTY TAB — تبويب الكمية التراكمية
   يُضاف في نهاية equipment.js
   ==================================================== */

/* ── حالة التبويب النشط في مودال تسجيل المعدات ── */
let _eqFormActiveTab = 'daily'; // 'daily' | 'cumulative'

/* ── flag: هل نحن في وضع اختيار من الخريطة للتراكمي؟ ── */
let _eqPickingFromMapCumul = false;

/* ── تبديل التبويب ── */
function eqSwitchFormTab(tab) {
    _eqFormActiveTab = tab;
    const isDaily = tab === 'daily';

    const btnDaily = document.getElementById('eqfTabDaily');
    const btnCumul = document.getElementById('eqfTabCumul');
    if (btnDaily) {
        btnDaily.style.background = isDaily ? 'rgba(255,255,255,0.9)' : 'transparent';
        btnDaily.style.color      = isDaily ? '#1a6040' : 'rgba(255,255,255,0.65)';
    }
    if (btnCumul) {
        btnCumul.style.background = !isDaily ? 'rgba(255,255,255,0.9)' : 'transparent';
        btnCumul.style.color      = !isDaily ? '#1a4a8a' : 'rgba(255,255,255,0.65)';
    }

    const bodyDaily = document.getElementById('eqfBodyDaily');
    const bodyCumul = document.getElementById('eqfBodyCumul');
    if (bodyDaily) bodyDaily.style.display = isDaily ? 'block' : 'none';
    if (bodyCumul) bodyCumul.style.display = !isDaily ? 'block' : 'none';

    const submitBtn = document.getElementById('eqf_submit_btn');
    if (submitBtn) {
        submitBtn.textContent = isDaily ? '💾 حفظ في السجل' : '💾 حفظ الكمية التراكمية';
    }
}

/* ── فتح المودال: إعادة تعيين + تبويب يومي افتراضياً ── */
const _origOpenEquipmentFormModal_cumul = window.openEquipmentFormModal;
window.openEquipmentFormModal = function() {
    _origOpenEquipmentFormModal_cumul();
    eqSwitchFormTab('daily');
    const today = new Date().toISOString().split('T')[0];
    const cDate = document.getElementById('eqfc_date');
    if (cDate) cDate.value = today;
    eqPopulateCumulContractors();
};

/* ── ملء قائمة المقاولين في تبويب التراكمي ── */
function eqPopulateCumulContractors() {
    const sel = document.getElementById('eqfc_contractor');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- اختر المقاول --</option>';
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
    [...contractors].sort((a, b) => a.localeCompare(b, 'ar')).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
}

/* ── مسح عنصر تبويب التراكمي ── */
function eqClearCumulElement() {
    ['eqfc_element_id','eqfc_element_name','eqfc_element_search',
     'eqfc_item_name','eqfc_band_sheet','eqfc_cat_name',
     'eqfc_cat_id','eqfc_group_name','eqfc_group_id'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const info = document.getElementById('eqfc_element_info');
    if (info) info.style.display = 'none';
    const bandBtn = document.getElementById('eqfc_band_btn');
    if (bandBtn) {
        bandBtn.disabled = false;
        bandBtn.style.opacity = '';
        bandBtn.style.cursor  = '';
        bandBtn.style.borderColor = '';
    }
    const lbl = document.getElementById('eqfc_band_label');
    if (lbl) { lbl.textContent = '-- اختر البند --'; lbl.style.color = ''; }
    const badge = document.getElementById('eqfc_current_badge');
    if (badge) badge.style.display = 'none';
}

/* ════════════════════════════════════════════════════
   زر "اختر من الخريطة" للتبويب التراكمي
   ════════════════════════════════════════════════════ */
let _eqCumulMapClickHandler   = null;
let _eqCumulMapBgClickHandler = null;

function eqPickFromMapCumul() {
    if (!map) { showAlert('❌ الخريطة غير جاهزة'); return; }
    if (!Object.keys(allLayers).length) {
        showAlert('❌ حمّل بنداً على الخريطة أولاً');
        return;
    }

    _eqPickingFromMapCumul = true;

    // إخفاء المودال
    document.getElementById('equipmentFormModal').style.display = 'none';

    // شريط التلميح
    let hint = document.getElementById('eqPickMapHintCumul');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'eqPickMapHintCumul';
        hint.style.cssText = [
            'position:fixed','top:70px','left:50%','transform:translateX(-50%)',
            'z-index:99999','background:linear-gradient(135deg,#1a4a8a,#2196f3)',
            'color:white','padding:12px 24px','border-radius:12px',
            'font-size:13px','font-weight:700','font-family:\'Cairo\',sans-serif',
            'box-shadow:0 8px 28px rgba(33,150,243,0.5)',
            'display:flex','align-items:center','gap:14px','white-space:nowrap',
            'pointer-events:auto'
        ].join(';');
        hint.innerHTML =
            '<span>🗺 انقر على العنصر في الخريطة لاختياره</span>' +
            '<button onclick="eqCancelPickFromMapCumul()" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:white;padding:4px 12px;border-radius:7px;font-size:12px;font-weight:700;font-family:\'Cairo\',sans-serif;cursor:pointer;">إلغاء</button>';
        document.body.appendChild(hint);
    }
    hint.style.display = 'flex';
    map.getContainer().style.cursor = 'crosshair';

    // click على كل feature
    _eqCumulMapClickHandler = function(e) {
        if (!_eqPickingFromMapCumul) return;
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
            e.originalEvent.preventDefault();
        }
        if (map.closePopup) map.closePopup();

        const row = _eqGetRowFromFeatureEvent(e);
        eqCancelPickFromMapCumul();

        if (row) {
            const nameKey = row['ROAD NAME'] ? 'ROAD NAME' : row['BLOCK NAME'] ? 'BLOCK NAME' : 'NAME';
            const name = (row[nameKey] || '').trim() || row['ID'];
            const id   = row['ID'] || '';
            eqSelectCumulElement(id, name);
            showAlert('✅ تم اختيار: ' + name, 'success');
        }
    };

    // fallback: click على الخريطة الفارغة
    _eqCumulMapBgClickHandler = function(e) {
        if (!_eqPickingFromMapCumul) return;
        let nearest = null, nearestDist = Infinity;
        Object.entries(allLayers).forEach(([sheetId, layer]) => {
            if (!layer || !allData[sheetId]) return;
            layer.eachLayer(f => {
                try {
                    const center = f.getBounds ? f.getBounds().getCenter()
                                 : f.getLatLng ? f.getLatLng() : null;
                    if (!center) return;
                    const d = map.distance(e.latlng, center);
                    if (d < nearestDist) {
                        nearestDist = d;
                        const row = allData[sheetId][f.feature.properties.ID];
                        if (row) nearest = row;
                    }
                } catch(err) {}
            });
        });
        if (nearest && nearestDist < 500) {
            _eqPickingFromMapCumul = false;
            map.closePopup();
            const nameKey = nearest['ROAD NAME'] ? 'ROAD NAME' : nearest['BLOCK NAME'] ? 'BLOCK NAME' : 'NAME';
            const name = (nearest[nameKey] || '').trim() || nearest['ID'];
            eqCancelPickFromMapCumul();
            eqSelectCumulElement(nearest['ID'] || '', name);
            showAlert('✅ تم اختيار: ' + name, 'success');
        }
    };

    Object.values(allLayers).forEach(layer => {
        if (!layer) return;
        layer.eachLayer(f => { f.on('click', _eqCumulMapClickHandler); });
    });
    map.on('click', _eqCumulMapBgClickHandler);
}

function eqCancelPickFromMapCumul() {
    _eqPickingFromMapCumul = false;
    document.getElementById('equipmentFormModal').style.display = '';
    const hint = document.getElementById('eqPickMapHintCumul');
    if (hint) hint.style.display = 'none';
    if (map) map.getContainer().style.cursor = '';
    if (_eqCumulMapClickHandler) {
        Object.values(allLayers).forEach(layer => {
            if (!layer) return;
            layer.eachLayer(f => { f.off('click', _eqCumulMapClickHandler); });
        });
        _eqCumulMapClickHandler = null;
    }
    if (map && _eqCumulMapBgClickHandler) {
        map.off('click', _eqCumulMapBgClickHandler);
        _eqCumulMapBgClickHandler = null;
    }
    if (map) map.closePopup();
}

/* ════════════════════════════════════════════════════
   اختيار عنصر من القائمة النصية — تبويب التراكمي
   ════════════════════════════════════════════════════ */
function eqFilterCumulElementDropdown() {
    const inp = document.getElementById('eqfc_element_search');
    const dd  = document.getElementById('eqfc_element_dropdown');
    if (!inp || !dd) return;
    const q = (inp.value || '').trim().toLowerCase();

    const filtered = q
        ? _eqAllElements.filter(e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
        : _eqAllElements;

    if (!filtered.length) {
        dd.innerHTML = '<div style="padding:12px 14px;text-align:center;color:rgba(255,255,255,0.3);font-size:12px;font-family:\'Cairo\',sans-serif;">لا توجد عناصر مطابقة</div>';
    } else {
        dd.innerHTML = filtered.slice(0, 60).map(e =>
            '<div onclick="eqSelectCumulElement(\'' + e.id.replace(/'/g,"\\'") + '\',\'' + e.name.replace(/'/g,"\\'") + '\')" ' +
            'style="padding:9px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);transition:background 0.15s;display:flex;flex-direction:column;gap:2px;" ' +
            'onmouseover="this.style.background=\'rgba(33,150,243,0.12)\'" onmouseout="this.style.background=\'\'">'+
            '<span style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.9);font-family:\'Cairo\',sans-serif;">' + e.name + '</span>' +
            '<span style="font-size:10px;color:rgba(255,255,255,0.4);font-family:\'Cairo\',sans-serif;">ID: ' + e.id + ' • ' + e.subName + '</span>' +
            '</div>'
        ).join('');
    }
    dd.style.display = 'block';

    setTimeout(() => {
        document.addEventListener('click', _eqCumulDropdownOutside, { once: true, capture: true });
    }, 0);
}

function _eqCumulDropdownOutside(e) {
    const dd  = document.getElementById('eqfc_element_dropdown');
    const inp = document.getElementById('eqfc_element_search');
    if (!dd || !inp) return;
    if (!dd.contains(e.target) && e.target !== inp) {
        dd.style.display = 'none';
    } else {
        document.addEventListener('click', _eqCumulDropdownOutside, { once: true, capture: true });
    }
}

function eqSelectCumulElement(id, name) {
    document.getElementById('eqfc_element_id').value    = id;
    document.getElementById('eqfc_element_name').value  = name;
    document.getElementById('eqfc_element_search').value = name;
    const dd = document.getElementById('eqfc_element_dropdown');
    if (dd) dd.style.display = 'none';

    const info = document.getElementById('eqfc_element_info');
    if (info) {
        document.getElementById('eqfc_element_info_name').textContent = name;
        document.getElementById('eqfc_element_info_id').textContent   = 'ID: ' + id;
        info.style.display = 'flex';
    }

    // ملء بيانات البند تلقائياً
    const el = _eqAllElements.find(e => e.id === id && e.name === name)
            || _eqAllElements.find(e => e.id === id);
    if (!el) return;

    let matchedSub = null, matchedCat = null;
    (categories || []).forEach(cat => {
        cat.subitems.forEach(sub => {
            if (sub.sheetId === el.sheetId) { matchedSub = sub; matchedCat = cat; }
        });
    });
    if (!matchedSub || !matchedCat) return;

    document.getElementById('eqfc_item_name').value  = matchedSub.name;
    document.getElementById('eqfc_band_sheet').value = matchedSub.sheetId || '';
    document.getElementById('eqfc_cat_name').value   = matchedCat.name || '';
    document.getElementById('eqfc_cat_id').value     = matchedCat.id   || '';

    const lbl = document.getElementById('eqfc_band_label');
    if (lbl) { lbl.textContent = matchedSub.name; lbl.style.color = 'rgba(255,255,255,0.9)'; }

    const bandBtn = document.getElementById('eqfc_band_btn');
    if (bandBtn) {
        bandBtn.style.borderColor = 'rgba(33,150,243,0.5)';
        bandBtn.disabled = true;
        bandBtn.style.opacity = '0.6';
        bandBtn.style.cursor  = 'not-allowed';
        bandBtn.title = 'البند مرتبط تلقائياً بالعنصر المختار';
    }

    const group = getGroupForSub(matchedSub.id);
    document.getElementById('eqfc_group_name').value = group ? (group.name || '—') : '—';
    document.getElementById('eqfc_group_id').value   = group ? (group.id   || '')  : '';

    // ── جلب الكميات الحالية من allData وملء الخانتين ──
    _eqFillCumulQtys(id, matchedSub.sheetId);
}

/* ── جلب TOTAL-QTY و DONE-QTY من allData للعنصر المحدد ── */
function _eqFillCumulQtys(elementId, sheetId) {
    const totalInp = document.getElementById('eqfc_total_qty');
    const doneInp  = document.getElementById('eqfc_cumul_qty');
    if (!totalInp || !doneInp) return;

    // أولاً: ابحث في allData المحملة في الذاكرة
    const sheetData = allData[sheetId];
    if (sheetData) {
        const row = sheetData[elementId];
        if (row) {
            const total = row['TOTAL-QTY'] || row['TOTAL_QTY'] || '';
            const done  = row['DONE-QTY']  || row['DONE_QTY']  || '';
            if (total !== '' && total !== undefined) totalInp.value = parseFloat(total) || '';
            if (done  !== '' && done  !== undefined) doneInp.value  = parseFloat(done)  || '';
            _eqShowCumulCurrentBadge(total, done);
            return;
        }
    }

    // ثانياً: لو الشيت مش محمل في allData، اجلبه من Google Sheets مباشرة
    if (!sheetId) return;
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    fetch(url)
        .then(r => r.text())
        .then(csv => {
            const lines = csv.split('\n').filter(l => l.trim());
            if (lines.length < 2) return;
            const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
            const idIdx    = headers.indexOf('ID');
            const totalIdx = headers.indexOf('TOTAL-QTY');
            const doneIdx  = headers.indexOf('DONE-QTY');
            if (idIdx === -1) return;
            for (let i = 1; i < lines.length; i++) {
                const vals = lines[i].split(',').map(v => v.trim());
                if ((vals[idIdx] || '').trim() === elementId) {
                    const total = totalIdx !== -1 ? (vals[totalIdx] || '') : '';
                    const done  = doneIdx  !== -1 ? (vals[doneIdx]  || '') : '';
                    if (total !== '') totalInp.value = parseFloat(total) || '';
                    if (done  !== '') doneInp.value  = parseFloat(done)  || '';
                    _eqShowCumulCurrentBadge(total, done);
                    break;
                }
            }
        })
        .catch(() => {}); // صامت لو فشل الجلب
}

/* ── بادج يظهر القيم الحالية كـ hint للمستخدم ── */
function _eqShowCumulCurrentBadge(total, done) {
    let badge = document.getElementById('eqfc_current_badge');
    if (!badge) {
        // أنشئ البادج تحت خانة الكمية الإجمالية
        const container = document.getElementById('eqfc_total_qty')?.closest('.eq-form-field')?.parentElement;
        if (!container) return;
        badge = document.createElement('div');
        badge.id = 'eqfc_current_badge';
        badge.style.cssText = 'grid-column:1/-1;padding:8px 12px;background:rgba(255,200,66,0.08);border:1px solid rgba(255,200,66,0.2);border-radius:8px;font-size:11px;font-family:\'Cairo\',sans-serif;color:rgba(255,255,255,0.55);display:flex;gap:16px;align-items:center;margin-top:-6px;';
        container.appendChild(badge);
    }
    const t = parseFloat(total) || 0;
    const d = parseFloat(done)  || 0;
    const r = t - d;
    const hasData = t > 0 || d > 0;
    badge.style.display = hasData ? 'flex' : 'none';
    badge.innerHTML = hasData
        ? `<span style="opacity:0.7;">📊 القيم الحالية في الشيت:</span>
           <span>الإجمالي: <strong style="color:rgba(255,200,66,0.9);">${t.toLocaleString('en-US')}</strong></span>
           <span>المنفذ: <strong style="color:rgba(39,200,100,0.9);">${d.toLocaleString('en-US')}</strong></span>
           <span>المتبقي: <strong style="color:rgba(91,173,223,0.9);">${r.toLocaleString('en-US')}</strong></span>`
        : '';
}
/* ════════════════════════════════════════════════════
   Band Picker للتبويب التراكمي
   ════════════════════════════════════════════════════ */
function eqOpenBandPickerCumul() {
    window._eqBandPickerTarget = 'cumul';
    eqOpenBandPicker();
}

const _origEqSelectBand_cumul = window.eqSelectBand;
window.eqSelectBand = function(name, sheetId, catName, catId) {
    if (window._eqBandPickerTarget === 'cumul') {
        window._eqBandPickerTarget = null;
        document.getElementById('eqfc_item_name').value  = name;
        document.getElementById('eqfc_band_sheet').value = sheetId || '';
        const lbl = document.getElementById('eqfc_band_label');
        if (lbl) { lbl.textContent = name; lbl.style.color = 'rgba(255,255,255,0.9)'; }
        const btn = document.getElementById('eqfc_band_btn');
        if (btn) btn.style.borderColor = 'rgba(33,150,243,0.5)';
        document.getElementById('eqfc_cat_name').value = catName || '';
        document.getElementById('eqfc_cat_id').value   = catId   || '';
        const sub = (categories || []).flatMap(c => c.subitems).find(s => s.sheetId === sheetId && s.name === name);
        const group = sub ? getGroupForSub(sub.id) : null;
        document.getElementById('eqfc_group_name').value = group ? (group.name || '—') : '—';
        document.getElementById('eqfc_group_id').value   = group ? (group.id   || '')  : '';
        eqCloseBandPicker();
    } else {
        window._eqBandPickerTarget = null;
        _origEqSelectBand_cumul(name, sheetId, catName, catId);
    }
};

/* ════════════════════════════════════════════════════
   Feedback للتبويب التراكمي
   ════════════════════════════════════════════════════ */
function eqShowCumulFeedback(msg, type) {
    const fb = document.getElementById('eqfc_feedback');
    if (!fb) return;
    fb.className = 'eqf-' + type;
    fb.textContent = msg;
    fb.style.display = 'block';
    if (type === 'success') setTimeout(() => { fb.style.display = 'none'; fb.className = ''; }, 4000);
}

/* ════════════════════════════════════════════════════
   إعادة تعيين تبويب التراكمي
   ════════════════════════════════════════════════════ */
function eqResetCumulForm() {
    ['eqfc_element_id','eqfc_element_name','eqfc_element_search',
     'eqfc_item_name','eqfc_band_sheet','eqfc_cat_name','eqfc_cat_id',
     'eqfc_group_name','eqfc_group_id','eqfc_total_qty','eqfc_cumul_qty'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const sel = document.getElementById('eqfc_contractor');
    if (sel) sel.value = '';
    const today = new Date().toISOString().split('T')[0];
    const cDate = document.getElementById('eqfc_date');
    if (cDate) cDate.value = today;
    const info = document.getElementById('eqfc_element_info');
    if (info) info.style.display = 'none';
    const lbl = document.getElementById('eqfc_band_label');
    if (lbl) { lbl.textContent = '-- اختر البند --'; lbl.style.color = ''; }
    const btn = document.getElementById('eqfc_band_btn');
    if (btn) { btn.style.borderColor = ''; btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = ''; btn.title = ''; }
    const fb = document.getElementById('eqfc_feedback');
    if (fb) { fb.style.display = 'none'; fb.className = ''; }
    const badge = document.getElementById('eqfc_current_badge');
    if (badge) badge.style.display = 'none';
}

/* ════════════════════════════════════════════════════
   إرسال بيانات التراكمي → Sheet1 مباشرة
   يُحدِّث TOTAL-QTY و DONE-QTY ويحسب REMANING-QTY تلقائياً
   ════════════════════════════════════════════════════ */
async function eqSubmitCumulForm() {
    const element_id   = document.getElementById('eqfc_element_id').value.trim();
    const element_name = document.getElementById('eqfc_element_name').value.trim();
    const item_name    = document.getElementById('eqfc_item_name').value.trim();
    const cat_name     = document.getElementById('eqfc_cat_name').value.trim();
    const group_name   = document.getElementById('eqfc_group_name').value.trim();
    const contractor   = document.getElementById('eqfc_contractor').value.trim();
    const date         = document.getElementById('eqfc_date').value.trim();
    const total_qty    = parseFloat(document.getElementById('eqfc_total_qty').value) || 0;
    const cumul_qty    = parseFloat(document.getElementById('eqfc_cumul_qty').value) || 0;
    const band_sheet   = document.getElementById('eqfc_band_sheet').value.trim();

    // Validation
    if (!element_id)   { eqShowCumulFeedback('❌ يرجى اختيار العنصر', 'error'); return; }
    if (!item_name)    { eqShowCumulFeedback('❌ يرجى اختيار البند', 'error'); return; }
    if (!contractor)   { eqShowCumulFeedback('❌ يرجى اختيار المقاول', 'error'); return; }
    if (!date)         { eqShowCumulFeedback('❌ يرجى اختيار التاريخ', 'error'); return; }
    if (!band_sheet)   { eqShowCumulFeedback('❌ البند المختار ليس له شيت مرتبط', 'error'); return; }
    if (!total_qty && !cumul_qty) {
        eqShowCumulFeedback('❌ يرجى إدخال الكمية الإجمالية أو التراكمية', 'error');
        return;
    }

    const btn = document.getElementById('eqf_submit_btn');
    btn.disabled = true;
    btn.textContent = '⏳ جاري الحفظ...';
    eqShowCumulFeedback('⏳ جاري إرسال البيانات...', 'loading');

    // جيب scriptUrl من البند الفرعي
    let scriptUrl = '';
    try {
        const allSubs = (categories || []).flatMap(c => c.subitems || []);
        const matchedSub = allSubs.find(s => s.sheetId === band_sheet);
        if (matchedSub && matchedSub.scriptUrl) scriptUrl = matchedSub.scriptUrl.trim();
        if (!scriptUrl) throw new Error(
            'لم يتم العثور على رابط السكريبت\n' +
            'تأكد من دبل كليك على البند الفرعي وإدخال رابط Apps Script'
        );
    } catch (fetchErr) {
        eqShowCumulFeedback('❌ ' + fetchErr.message, 'error');
        btn.disabled = false;
        btn.textContent = '💾 حفظ الكمية التراكمية';
        return;
    }

    // المتبقي يُحسب في السكريبت، لكن نرسله أيضاً للتوثيق
    const remaining_qty = total_qty - cumul_qty;

    const payload = {
        form_type:     'cumulative',       // ← السكريبت يميّز بهذا الحقل
        sheet_target:  'Sheet1',           // ← يكتب في Sheet1
        element_id,
        element_name,
        item_name,
        cat_name,
        group_name,
        contractor,
        date,
        total_qty,
        cumul_qty,
        remaining_qty  // للعرض، السكريبت يحسبها بنفسه أيضاً
    };

    try {
        const r = await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });
        const text = await r.text();
        let resp = {};
        try { resp = JSON.parse(text); } catch(e) {}

        if (resp.status === 'success' || r.ok) {
            eqShowCumulFeedback('✅ تم تحديث الكمية التراكمية في الشيت!', 'success');
            showAlert('✅ تم حفظ الكمية التراكمية بنجاح', 'success');
            setTimeout(() => eqResetCumulForm(), 2500);
        } else {
            throw new Error(resp.message || 'فشل الحفظ');
        }
    } catch(e) {
        console.error('Cumulative form submit error:', e);
        eqShowCumulFeedback('❌ تعذر الحفظ: ' + (e.message || 'خطأ في الاتصال'), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '💾 حفظ الكمية التراكمية';
    }
}

/* ════════════════════════════════════════════════════
   تعديل eqResetForm و eqSubmitForm
   لتوجيه الطلب للتبويب الصحيح
   ════════════════════════════════════════════════════ */
const _origEqResetForm_cumul = window.eqResetForm;
window.eqResetForm = function() {
    if (_eqFormActiveTab === 'cumulative') {
        eqResetCumulForm();
    } else {
        _origEqResetForm_cumul();
    }
};

const _origEqSubmitForm_cumul = window.eqSubmitForm;
window.eqSubmitForm = function() {
    if (_eqFormActiveTab === 'cumulative') {
        eqSubmitCumulForm();
    } else {
        _origEqSubmitForm_cumul();
    }
}
