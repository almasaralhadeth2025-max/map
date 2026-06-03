/* ============================================================
   contractors.js
   كل ما يخص زر المقاولين 👷 — مُستخرَج من main.js

   الترتيب في index.html (بعد main.js وقبل ui_panels.js):
       <script src="main.js"></script>
       ...
       <script src="contractors.js"></script>
       <script src="ui_panels.js"></script>

   ما يُحذف من main.js ويُستبدل بـ  // → contractors.js :
   ──────────────────────────────────────────────────────────
   • السطر ~904-906  : تعريفات contractorMap / activeContractorFilter / contractorsLoaded
   • السطر ~909-953  : fetchSheetContractors()
   • السطر ~956-979  : buildContractorPanel()
   • السطر ~983-1053 : renderContractorList()
   • السطر ~1057-1129: handleContractorCheckbox()
   • السطر ~1132-1153: _activeContractorTab + switchContractorTab()
   • السطر ~1156-1227: renderContractorGroupList()
   • السطر ~1230-1337: toggleGroupFilter()
   • السطر ~1340-1346: getContractorsForSheet()
   • السطر ~1349-1380: applyContractorFilter()
   • السطر ~1383-1387: syncContractorCheckboxes()
   • السطر ~1389-1400: toggleContractor()

   المتغيرات والدوال التي يعتمد عليها من main.js (تبقى هناك):
       categories, similarGroups, selectedItems
       allData, allLayers, loadTokens, map
       getGroupForSub(), loadLayer(), refreshLayerColors()
       featureStyle(), renderItems(), updateNavTabsState(), updateStats()
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════ */
var contractorMap          = {};
var activeContractorFilter = new Set(); // "sheetId|contractorName"
var contractorsLoaded      = false;     // سحب المقاولين مرة واحدة فقط
var _activeContractorTab   = 'contractor';


/* ══════════════════════════════════════════════════════════
   FETCH  —  جلب المقاولين من شيت بند فرعي واحد
   ══════════════════════════════════════════════════════════ */
async function fetchSheetContractors(sub) {
    const cat = categories.find(c => c.subitems.some(s => s.id === sub.id));

    const addEntry = function (cname) {
        if (!contractorMap[cname]) contractorMap[cname] = [];
        if (!contractorMap[cname].find(e => e.subId === sub.id)) {
            contractorMap[cname].push({
                catId       : cat ? cat.id    : "",
                catName     : cat ? cat.name  : "",
                catEmoji    : cat ? cat.emoji : "📍",
                catOrder    : categories.indexOf(cat),
                subId       : sub.id,
                subName     : sub.name,
                sheetId     : sub.sheetId,
                geoJsonFile : sub.geoJsonFile
            });
        }
    };

    // استخدم allData المُحمَّل مسبقاً إن وُجد
    if (allData[sub.sheetId]) {
        Object.values(allData[sub.sheetId]).forEach(function (row) {
            var cname = (row["CONTRACTOR"] || "").trim();
            if (cname) addEntry(cname);
        });
        return;
    }

    try {
        var url = "https://docs.google.com/spreadsheets/d/" + sub.sheetId + "/export?format=csv&gid=0";
        var r   = await fetch(url);
        if (!r.ok) return;
        var csv = await r.text();
        if (csv.trim().startsWith('<')) return;
        var lines   = csv.split('\n').filter(function (l) { return l.trim(); });
        if (!lines.length) return;
        var headers = lines[0].split(',').map(function (h) { return h.trim().toUpperCase(); });
        var cIdx    = headers.findIndex(function (h) { return h === 'CONTRACTOR'; });
        if (cIdx === -1) return;
        for (var i = 1; i < lines.length; i++) {
            var vals  = lines[i].split(',').map(function (v) { return v.trim(); });
            var cname = (vals[cIdx] || "").trim();
            if (cname) addEntry(cname);
        }
    } catch (e) { console.warn("contractor fetch failed:", sub.name, e); }
}


/* ══════════════════════════════════════════════════════════
   BUILD  —  بناء panel المقاولين (يجلب البيانات إذا لزم)
   ══════════════════════════════════════════════════════════ */
async function buildContractorPanel({ forceRefresh = false } = {}) {
    var list = document.getElementById("contractorList");
    if (!list) return;

    if (contractorsLoaded && !forceRefresh) {
        renderContractorList();
        return;
    }

    list.innerHTML = '<div class="contractor-empty">⏳ جاري التحميل...</div>';
    contractorMap  = {};

    var allSubs = [];
    categories.forEach(function (cat) {
        cat.subitems.forEach(function (sub) { allSubs.push(sub); });
    });

    if (!allSubs.length) {
        list.innerHTML = '<div class="contractor-empty">لا توجد بنود مضافة بعد</div>';
        return;
    }

    await Promise.all(allSubs.map(function (sub) { return fetchSheetContractors(sub); }));
    contractorsLoaded = true;
    renderContractorList();
}


/* ══════════════════════════════════════════════════════════
   RENDER LIST  —  رسم قائمة المقاولين (بدون fetch)
   ══════════════════════════════════════════════════════════ */
function renderContractorList() {
    var list = document.getElementById("contractorList");
    if (!list) return;

    var names = Object.keys(contractorMap).sort(function (a, b) {
        return a.localeCompare(b, 'ar');
    });

    if (!names.length) {
        list.innerHTML = '<div class="contractor-empty">لم يتم العثور على مقاولين</div>';
        return;
    }

    list.innerHTML = names.map(function (name) {
        // ترتيب البنود: حسب الكاتيغوري ثم داخله
        var subs = contractorMap[name].slice().sort(function (a, b) {
            if (a.catOrder !== b.catOrder) return a.catOrder - b.catOrder;
            var cat = categories.find(function (c) { return c.id === a.catId; });
            if (!cat) return 0;
            return cat.subitems.findIndex(function (s) { return s.id === a.subId; }) -
                   cat.subitems.findIndex(function (s) { return s.id === b.subId; });
        });

        // تجميع حسب الكاتيغوري
        var byCategory = {};
        subs.forEach(function (s) {
            if (!byCategory[s.catId]) byCategory[s.catId] = { label: s.catEmoji + " " + s.catName, items: [] };
            byCategory[s.catId].items.push(s);
        });

        var subsHTML = Object.values(byCategory).map(function (group) {
            return '<div class="c-cat-group">' +
                '<div class="c-cat-label">' + group.label + '</div>' +
                group.items.map(function (s) {
                    var filterKey = s.sheetId + '|' + name;
                    var checked   = activeContractorFilter.has(filterKey) ? 'checked' : '';
                    return '<div class="contractor-subitem">' +
                        '<input type="checkbox" class="contractor-cb"' +
                        ' data-cat-id="' + s.catId + '"' +
                        ' data-sub-id="' + s.subId + '"' +
                        ' data-sheet="'  + s.sheetId + '"' +
                        ' data-geo="'    + s.geoJsonFile + '"' +
                        ' data-contractor="' + name + '"' +
                        ' data-filter-key="' + filterKey + '"' +
                        ' ' + checked + ' onclick="event.stopPropagation()">' +
                        '<label>' + s.subName + '</label>' +
                        '</div>';
                }).join('') +
                '</div>';
        }).join('');

        return '<div class="contractor-item">' +
            '<div class="contractor-name" onclick="toggleContractor(this)">' +
            '<span>' + name + '</span>' +
            '<div style="display:flex;align-items:center;gap:5px">' +
            '<span class="contractor-count">' + subs.length + '</span>' +
            '<span class="c-arrow">◀</span>' +
            '</div></div>' +
            '<div class="contractor-subitems">' + subsHTML + '</div>' +
            '</div>';
    }).join('');

    // ربط أحداث الـ checkboxes
    list.querySelectorAll('.contractor-cb').forEach(function (cb) {
        cb.addEventListener('change', function () { handleContractorCheckbox(this); });
    });
}


/* ══════════════════════════════════════════════════════════
   HANDLE CHECKBOX  —  تبديل تحديد مقاول (مع دعم المجموعات)
   ══════════════════════════════════════════════════════════ */
function handleContractorCheckbox(cb) {
    var filterKey = cb.dataset.filterKey;
    var sheetId   = cb.dataset.sheet;
    var geoFile   = cb.dataset.geo;
    var catId     = cb.dataset.catId;
    var subId     = cb.dataset.subId;

    if (cb.checked) {
        var newSub      = categories.flatMap(function (c) { return c.subitems; }).find(function (s) { return s.id === subId; });
        var newSubGroup = newSub ? getGroupForSub(newSub.id) : null;

        // اكتشف الشيتات المتعارضة
        var activeSheets   = new Set([...activeContractorFilter].map(function (k) { return k.split('|')[0]; }));
        var sheetsToRemove = new Set();

        activeSheets.forEach(function (sid) {
            if (sid === sheetId) return;
            var existingSub   = categories.flatMap(function (c) { return c.subitems; }).find(function (s) { return s.sheetId === sid; });
            var existingGroup = existingSub ? getGroupForSub(existingSub.id) : null;
            var conflict = !newSubGroup || !existingGroup || newSubGroup.id !== existingGroup.id;
            if (conflict) sheetsToRemove.add(sid);
        });

        // أزل الشيتات المتعارضة
        sheetsToRemove.forEach(function (sid) {
            [...activeContractorFilter].forEach(function (k) {
                if (k.startsWith(sid + '|')) activeContractorFilter.delete(k);
            });
            loadTokens[sid] = null;
            if (allLayers[sid]) { map.removeLayer(allLayers[sid]); delete allLayers[sid]; }
            delete allData[sid];
        });

        // أزل اختيارات السايدبار
        categories.flatMap(function (c) { return c.subitems; }).forEach(function (s) {
            if (selectedItems[s.id]) {
                loadTokens[s.sheetId] = null;
                if (allLayers[s.sheetId]) { map.removeLayer(allLayers[s.sheetId]); delete allLayers[s.sheetId]; }
                delete allData[s.sheetId];
                delete selectedItems[s.id];
            }
        });

        activeContractorFilter.add(filterKey);

        if (!allLayers[sheetId]) {
            if (newSub) loadLayer(sheetId, newSub.name, geoFile, catId);
        } else {
            applyContractorFilter();
        }

    } else {
        activeContractorFilter.delete(filterKey);
        var stillActive = [...activeContractorFilter].some(function (k) { return k.startsWith(sheetId + '|'); });
        if (!stillActive) {
            loadTokens[sheetId] = null;
            if (allLayers[sheetId]) { map.removeLayer(allLayers[sheetId]); delete allLayers[sheetId]; }
            delete allData[sheetId];
        } else {
            applyContractorFilter();
        }
    }

    renderItems();
    updateNavTabsState();
    updateStats();
    syncContractorCheckboxes();
}


/* ══════════════════════════════════════════════════════════
   TABS  —  التبديل بين "حسب المقاول" و "حسب المجموعة"
   ══════════════════════════════════════════════════════════ */
function switchContractorTab(tab) {
    _activeContractorTab = tab;
    var isContractor = tab === 'contractor';

    document.getElementById('contractorTabContractor').style.display = isContractor ? 'block' : 'none';
    document.getElementById('contractorTabGroup').style.display      = isContractor ? 'none'  : 'block';

    var btnC = document.getElementById('cTabContractor');
    var btnG = document.getElementById('cTabGroup');
    if (btnC) {
        btnC.style.background = isContractor ? 'rgba(255,255,255,0.9)' : 'transparent';
        btnC.style.color      = isContractor ? '#6a2d91' : 'rgba(255,255,255,0.75)';
    }
    if (btnG) {
        btnG.style.background = !isContractor ? 'rgba(255,255,255,0.9)' : 'transparent';
        btnG.style.color      = !isContractor ? '#6a2d91' : 'rgba(255,255,255,0.75)';
    }

    if (!isContractor) renderContractorGroupList();
}


/* ══════════════════════════════════════════════════════════
   GROUP LIST  —  تبويب "حسب المجموعة"
   ══════════════════════════════════════════════════════════ */
function renderContractorGroupList() {
    var list = document.getElementById('contractorGroupList');
    if (!list) return;

    var groupedSubIds = new Set(similarGroups.flatMap(function (g) { return g.subIds; }));

    // بنود منفردة (غير مُجمَّعة)
    var soloGroups = [];
    categories.forEach(function (cat) {
        cat.subitems.forEach(function (sub) {
            if (!groupedSubIds.has(sub.id)) {
                soloGroups.push({ id: 'solo_' + sub.id, name: sub.name, subIds: [sub.id] });
            }
        });
    });

    var allGroups = similarGroups.concat(soloGroups);

    // عدد المقاولين لمجموعة
    var countContractors = function (group) {
        var s = new Set();
        group.subIds.forEach(function (sid) {
            var sub = categories.flatMap(function (c) { return c.subitems; }).find(function (x) { return x.id === sid; });
            if (!sub) return;
            if (allData[sub.sheetId]) {
                Object.values(allData[sub.sheetId]).forEach(function (row) {
                    var c = (row['CONTRACTOR'] || '').trim();
                    if (c) s.add(c);
                });
            }
            Object.keys(contractorMap).forEach(function (name) {
                if (contractorMap[name].some(function (e) { return e.subId === sid; })) s.add(name);
            });
        });
        return s.size;
    };

    var groupRows = [];
    allGroups.forEach(function (group) {
        var contractorCount = countContractors(group);
        if (!contractorCount) return;

        var isActive = group.subIds.some(function (sid) {
            var sub = categories.flatMap(function (c) { return c.subitems; }).find(function (s) { return s.id === sid; });
            return sub && [...activeContractorFilter].some(function (k) { return k.startsWith(sub.sheetId + '|'); });
        });

        groupRows.push(
            '<div class="cgroup-row ' + (isActive ? 'active-group' : '') + '" onclick="toggleGroupFilter(\'' + group.id + '\', this)">' +
            '<input type="checkbox" class="cgroup-cb" data-group-id="' + group.id + '" ' + (isActive ? 'checked' : '') + ' onclick="event.stopPropagation()">' +
            '<div class="cgroup-row-info"><div class="cgroup-row-name">' + (group.name || 'مجموعة') + '</div></div>' +
            '<span class="cgroup-row-badge">' + contractorCount + ' مقاول</span>' +
            '</div>'
        );
    });

    if (!groupRows.length) {
        list.innerHTML = '<div class="cgroup-no-groups">لا توجد بنود بها مقاولين بعد<br><span style="font-size:10px;opacity:0.7;">تأكد من تحميل البيانات أولاً</span></div>';
        return;
    }

    list.innerHTML = groupRows.join('');

    list.querySelectorAll('.cgroup-cb').forEach(function (cb) {
        cb.addEventListener('change', function (e) {
            e.stopPropagation();
            toggleGroupFilter(this.dataset.groupId, this.closest('.cgroup-row'));
        });
    });
}


/* ══════════════════════════════════════════════════════════
   TOGGLE GROUP FILTER  —  تفعيل/إيقاف مجموعة كاملة
   ══════════════════════════════════════════════════════════ */
async function toggleGroupFilter(groupId, rowEl) {
    var group = similarGroups.find(function (g) { return g.id === groupId; });
    if (!group && groupId.startsWith('solo_')) {
        var subId = groupId.replace('solo_', '');
        var sub   = categories.flatMap(function (c) { return c.subitems; }).find(function (s) { return s.id === subId; });
        if (sub) group = { id: groupId, name: sub.name, subIds: [subId] };
    }
    if (!group) return;

    var cb = rowEl ? rowEl.querySelector('.cgroup-cb') : null;

    var anyActive = group.subIds.some(function (sid) {
        var sub = categories.flatMap(function (c) { return c.subitems; }).find(function (s) { return s.id === sid; });
        return sub && [...activeContractorFilter].some(function (k) { return k.startsWith(sub.sheetId + '|'); });
    });

    if (anyActive) {
        // ── إيقاف ──
        group.subIds.forEach(function (sid) {
            var sub = categories.flatMap(function (c) { return c.subitems; }).find(function (s) { return s.id === sid; });
            if (!sub) return;
            [...activeContractorFilter].forEach(function (k) {
                if (k.startsWith(sub.sheetId + '|')) activeContractorFilter.delete(k);
            });
            var stillUsed = [...activeContractorFilter].some(function (k) { return k.startsWith(sub.sheetId + '|'); });
            if (!stillUsed) {
                loadTokens[sub.sheetId] = null;
                if (allLayers[sub.sheetId]) { map.removeLayer(allLayers[sub.sheetId]); delete allLayers[sub.sheetId]; }
                delete allData[sub.sheetId];
            }
        });
        if (rowEl) { rowEl.classList.remove('active-group'); if (cb) cb.checked = false; }

    } else {
        // ── تفعيل: أزل الشيتات المتعارضة ──
        var otherSheets = new Set(
            [...activeContractorFilter]
                .map(function (k) { return k.split('|')[0]; })
                .filter(function (sid) {
                    return !group.subIds.some(function (gsid) {
                        var s = categories.flatMap(function (c) { return c.subitems; }).find(function (x) { return x.id === gsid; });
                        return s && s.sheetId === sid;
                    });
                })
        );
        otherSheets.forEach(function (sid) {
            [...activeContractorFilter].forEach(function (k) { if (k.startsWith(sid + '|')) activeContractorFilter.delete(k); });
            loadTokens[sid] = null;
            if (allLayers[sid]) { map.removeLayer(allLayers[sid]); delete allLayers[sid]; }
            delete allData[sid];
        });

        // أزل اختيارات السايدبار
        categories.flatMap(function (c) { return c.subitems; }).forEach(function (s) {
            if (selectedItems[s.id]) {
                loadTokens[s.sheetId] = null;
                if (allLayers[s.sheetId]) { map.removeLayer(allLayers[s.sheetId]); delete allLayers[s.sheetId]; }
                delete allData[s.sheetId];
                delete selectedItems[s.id];
            }
        });

        // حمّل كل بند في المجموعة
        for (var sid of group.subIds) {
            var sub = categories.flatMap(function (c) { return c.subitems; }).find(function (s) { return s.id === sid; });
            if (!sub || !sub.sheetId || !sub.geoJsonFile) continue;
            var cat = categories.find(function (c) { return c.subitems.some(function (s) { return s.id === sid; }); });
            if (!cat) continue;

            var contractors = getContractorsForSheet(sub.sheetId);
            if (contractors.length) {
                contractors.forEach(function (name) { activeContractorFilter.add(sub.sheetId + '|' + name); });
            } else {
                activeContractorFilter.add(sub.sheetId + '|*');
            }

            if (!allLayers[sub.sheetId]) loadLayer(sub.sheetId, sub.name, sub.geoJsonFile, cat.id);
        }

        if (rowEl) { rowEl.classList.add('active-group'); if (cb) cb.checked = true; }
    }

    // ألغِ تحديد باقي صفوف المجموعات
    document.querySelectorAll('.cgroup-row').forEach(function (r) {
        var gid = r.querySelector('.cgroup-cb')?.dataset.groupId;
        if (gid && gid !== groupId && !anyActive) {
            r.classList.remove('active-group');
            var rcb = r.querySelector('.cgroup-cb');
            if (rcb) rcb.checked = false;
        }
    });

    renderItems();
    updateNavTabsState();
    updateStats();
    syncContractorCheckboxes();
    setTimeout(function () { renderContractorGroupList(); }, 300);
}


/* ══════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════ */

/* أسماء المقاولين لشيت معين */
function getContractorsForSheet(sheetId) {
    var names = [];
    Object.keys(contractorMap).forEach(function (name) {
        if (contractorMap[name].some(function (e) { return e.sheetId === sheetId; })) names.push(name);
    });
    return names;
}

/* تطبيق فلتر اللون (gray-out) على الخريطة */
function applyContractorFilter() {
    if (!activeContractorFilter.size) {
        refreshLayerColors();
        return;
    }

    Object.entries(allLayers).forEach(function ([sheetId, layer]) {
        if (!layer || !allData[sheetId]) return;

        var activeForSheet = [...activeContractorFilter]
            .filter(function (k) { return k.startsWith(sheetId + '|'); })
            .map(function (k) { return k.split('|')[1].trim().toLowerCase(); });

        var isWildcard = activeForSheet.includes('*');

        layer.eachLayer(function (f) {
            var row = allData[sheetId][f.feature.properties.ID];
            if (!row) return;
            var featureCon = (row["CONTRACTOR"] || "").trim().toLowerCase();
            var match = activeForSheet.length === 0 || isWildcard || activeForSheet.includes(featureCon);

            if (match) {
                f.setStyle(featureStyle(row));
                if (f.setZIndexOffset) f.setZIndexOffset(100);
            } else {
                f.setStyle({ color: '#aaaaaa', fillColor: '#cccccc', fillOpacity: 0.18, weight: 1 });
            }
        });
    });
}

/* مزامنة checkboxes مع activeContractorFilter */
function syncContractorCheckboxes() {
    document.querySelectorAll('.contractor-cb').forEach(function (cb) {
        cb.checked = activeContractorFilter.has(cb.dataset.filterKey);
    });
}

/* فتح/إغلاق بنود مقاول في القائمة */
function toggleContractor(el) {
    var subitems = el.nextElementSibling;
    var isOpen   = subitems.classList.contains('active');
    document.querySelectorAll('.contractor-name.open').forEach(function (e) {
        e.classList.remove('open');
        e.nextElementSibling.classList.remove('active');
    });
    if (!isOpen) {
        el.classList.add('open');
        subitems.classList.add('active');
    }
}
