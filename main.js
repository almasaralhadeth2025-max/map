/* ====================================================
   CONSTANTS & STATE
   ==================================================== */

const USERS_SHEET_ID     = "1maViL4HSsI5XsjnAOGM-2D98g0Ow_pawZ-A_R_Y9I_0";
const EQUIPMENT_SHEET_ID = "1v40HIukVDqs6KBmQnl6HqlbS6IS4WmNKS87rFxbl63c";
const CONFIG_FILE        = "categories.json";

// Inactivity timeout: 2 hours in ms
const INACTIVITY_MS = 2 * 60 * 60 * 1000;
let inactivityTimer = null;

const STATUSES = [
    { value: "جاري",        color: "#3aaa5c", cls: "ongoing"     },
    { value: "متاح",        color: "#2196f3", cls: "available"   },
    { value: "غير متاح",    color: "#ff9800", cls: "unavailable" },
    { value: "تم الانتهاء", color: "#9c27b0", cls: "completed"   },
    { value: "متوقف",       color: "#f44336", cls: "stopped"     }
];

const LABELS = {
    "ID"           : "معرف",
    "ROAD NAME"    : "اسم الطريق",
    "BLOCK NAME"   : "اسم القطعة",
    "TOTAL-QTY"    : "الإجمالي",
    "DONE-QTY"     : "المنفذ",
    "REMANING-QTY" : "المتبقي",
    "STATUS"       : "الحالة",
    "CONTRACTOR"   : "المقاول",
    "EQUIPMENT"    : "المعدات"
};

let map;
let currentUser    = null;
let categories     = [];
let selectedItems  = {};   // subitemId → true (only one per category enforced)
let selectedStatuses = ["جاري","متاح","غير متاح","تم الانتهاء","متوقف"];
let allLayers      = {};   // sheetId → Leaflet GeoJSON layer
let allData        = {};   // sheetId → { id: rowObj }
let allFeatures    = {};   // `${sheetId}-${name}` → Leaflet layer
let equipmentData  = {};
let similarGroups  = [];        // [{id, name, subIds:[]}] — مجموعات البنود المتشابهة
let _editingGroupId = null;     // for editing existing group
let defaultCoords  = { lat: 21.292, lng: 39.71, zoom: 14 };
let defaultSubNumber = ""; // رقم البند الافتراضي الذي يُحمَّل عند بدء النظام

/* ====================================================
   HELPERS
   ==================================================== */

function fmtNum(v) {
    const n = parseFloat(v);
    if (isNaN(n)) return v || "";
    return n.toLocaleString('en-US');
}

function toNum(v) { return (!isNaN(v) && v !== "") ? Number(v) : 0; }

function statusColor(s) {
    const f = STATUSES.find(x => x.value.toLowerCase() === (s||"").trim().toLowerCase());
    return f ? f.color : "#9e9e9e";
}

function statusCls(s) {
    const f = STATUSES.find(x => x.value.toLowerCase() === (s||"").trim().toLowerCase());
    return f ? f.cls : "";
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2,5); }

function sheetIdFromUrl(url) {
    const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : url.trim();
}

function showAlert(msg, type="error") {
    const el = document.createElement("div");
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function openModal(id)  { document.getElementById(id).classList.add("active"); }
function closeModal(id) { document.getElementById(id).classList.remove("active"); }

function togglePanel(id) {
    const panel = document.getElementById(id);
    const isOpen = panel.classList.contains("active");
    // Close all panels first
    document.querySelectorAll('.notif-panel,.theme-panel,.user-dropdown,.coords-panel,.contractor-panel,.settings-panel').forEach(p => p.classList.remove('active'));
        if (!isOpen) {
        panel.classList.add("active");
        // Render similar groups when settings opens on similar tab
        if (id === 'settingsPanel') {
            const sl = document.getElementById("settingsLat"); if(sl) sl.value = defaultCoords.lat;
            const sg = document.getElementById("settingsLng"); if(sg) sg.value = defaultCoords.lng;
            const sz = document.getElementById("settingsZoom"); if(sz) sz.value = defaultCoords.zoom;
            const sd = document.getElementById("settingsDefaultSub"); if(sd) sd.value = defaultSubNumber || "";
            renderDefaultSubPreview();
            // Pre-render equipment types list so count shows immediately
            if (document.getElementById('eqTypesList')) { renderEquipmentTypesList(); updateEqTypesCount(); }
        }
        // Refresh group tab if it's the active one
        if (id === 'contractorPanel' && _activeContractorTab === 'group') {
            renderContractorGroupList();
        }
    }
}

// Close panels when clicking outside
document.addEventListener("click", e => {
    if (!e.target.closest('.nav-right') && !e.target.closest('#similarGroupModal')) {
        document.querySelectorAll('.notif-panel,.theme-panel,.user-dropdown,.coords-panel,.contractor-panel,.equipment-panel,.settings-panel').forEach(p => p.classList.remove('active'));
    }
    if (!e.target.closest('.search-wrap')) {
        document.getElementById("searchDropdown").classList.remove("active");
    }
});

/* ====================================================
   THEMES
   ==================================================== */

function applyTheme(name) {
    // Remove all theme classes
    document.body.classList.remove('theme-ocean','theme-dark','theme-emerald','theme-sunset');
    if (name) document.body.classList.add('theme-' + name);
    localStorage.setItem('mapTheme', name);
    // Update active marker
    document.querySelectorAll('.theme-option').forEach(el => {
        el.classList.toggle('active', el.dataset.theme === name);
    });
    // Update map tiles on dark theme
    if (map) {
        map.eachLayer(l => { if (l._url) map.removeLayer(l); });
        const tileUrl = name === 'dark'
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        L.tileLayer(tileUrl, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    }
}

/* ====================================================
   INACTIVITY SESSION
   ==================================================== */

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        if (currentUser) {
            showAlert("⏰ انتهت جلستك بسبب عدم النشاط", "error");
            setTimeout(doLogout, 2000);
        }
    }, INACTIVITY_MS);
}

function initInactivityWatcher() {
    ['mousemove','keydown','click','scroll','touchstart'].forEach(ev => {
        document.addEventListener(ev, resetInactivityTimer, { passive: true });
    });
    resetInactivityTimer();
}

/* ====================================================
   SESSION PERSISTENCE (auto-login after page reload)
   ==================================================== */

function saveSession(user) {
    sessionStorage.setItem("currentUser", JSON.stringify(user));
    sessionStorage.setItem("sessionTime", Date.now().toString());
}

function clearSession() {
    sessionStorage.removeItem("currentUser");
    sessionStorage.removeItem("sessionTime");
    sessionStorage.removeItem("selectedStatuses");
    sessionStorage.removeItem("selectedItems");
}

async function tryRestoreSession() {
    const saved     = sessionStorage.getItem("currentUser");
    const savedTime = sessionStorage.getItem("sessionTime");
    if (!saved || !savedTime) return false;
    // If more than 2 hours have passed since last save, clear session
    if (Date.now() - parseInt(savedTime) > INACTIVITY_MS) {
        clearSession();
        return false;
    }
    currentUser = JSON.parse(saved);
    return true;
}

/* ====================================================
   LOGIN
   ==================================================== */

// Robust CSV parser that handles quoted fields — global scope
function parseCSVLine(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
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
}

async function fetchUsers() {
    const url = `https://docs.google.com/spreadsheets/d/${USERS_SHEET_ID}/export?format=csv&gid=0`;
    const r   = await fetch(url);
    const csv = await r.text();

    const lines   = csv.split('\n').filter(l => l.trim());
    const headers = parseCSVLine(lines[0]).map(h => h.toUpperCase());
    const users   = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        const obj  = {};
        headers.forEach((h, idx) => { obj[h] = vals[idx] || ""; });
        users.push(obj);
    }
    return users;
}

function togglePasswordVisibility() {
    const input = document.getElementById("loginPassword");
    const btn = document.getElementById("togglePassword");
    if (input.type === "password") {
        input.type = "text";
        btn.textContent = "🙈";
        btn.style.opacity = "1";
    } else {
        input.type = "password";
        btn.textContent = "👁️";
        btn.style.opacity = "0.6";
    }
}

async function doLogin() {
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const pass  = document.getElementById("loginPassword").value.trim();

    if (!email || !pass) { showLoginError("يرجى إدخال البريد وكلمة المرور"); return; }

    document.getElementById("loginLoading").style.display = "block";
    document.getElementById("loginError").style.display   = "none";
    document.getElementById("loginBtn").disabled = true;

    try {
        const users = await fetchUsers();
        const found = users.find(u =>
            u["EMAIL"] && u["EMAIL"].toLowerCase() === email &&
            u["PASSWORD"] && u["PASSWORD"]          === pass
        );

        if (!found) { showLoginError("البريد الإلكتروني أو كلمة المرور غير صحيحة"); return; }

        currentUser = {
            email  : found["EMAIL"],
            name   : found["NAME"]  || found["EMAIL"],
            role   : found["ROLE"]  || "2",
            isAdmin: (found["ROLE"] || "").toString().trim() === "1",
            avatar : found["PHOTO"] || found["AVATAR"] || ""
        };

        saveSession(currentUser);
        enterApp();

    } catch(e) {
        console.error(e);
        showLoginError("خطأ في الاتصال - تأكد من إعدادات الشيت");
    } finally {
        document.getElementById("loginLoading").style.display = "none";
        document.getElementById("loginBtn").disabled = false;
    }
}

function showLoginError(msg) {
    const el = document.getElementById("loginError");
    el.textContent = msg;
    el.style.display = "block";
}

document.addEventListener("DOMContentLoaded", async () => {
    ["loginEmail","loginPassword"].forEach(id => {
        document.getElementById(id).addEventListener("keydown", e => {
            if (e.key === "Enter") doLogin();
        });
    });

    // Apply saved theme
    const savedTheme = localStorage.getItem('mapTheme') || '';
    if (savedTheme) applyTheme(savedTheme);

    // Load default coords
    const dc = localStorage.getItem('defaultCoords');
    if (dc) {
        try { defaultCoords = JSON.parse(dc); } catch(e) {}
    }

    // Try restore session
    const restored = await tryRestoreSession();
    if (restored) {
        enterApp();
    }
});

/* ====================================================
   ENTER / LEAVE APP
   ==================================================== */

async function enterApp() {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("mainApp").classList.add("visible");



    if (currentUser.isAdmin) {
        document.body.classList.add("is-admin");
    } else {
        document.body.classList.remove("is-admin");
    }

    // Update UI
    updateUserUI();

    // Init map
    initMap();
    loadEquipmentData();

    await loadCategoriesConfig();
    await loadDefaultCoords();
    loadSimilarGroups();

    const savedSel = sessionStorage.getItem("selectedStatuses");
    if (savedSel) selectedStatuses = JSON.parse(savedSel);

    const savedItems = sessionStorage.getItem("selectedItems");
    if (savedItems) selectedItems = JSON.parse(savedItems);

    renderItems();
    renderNavTabs();

    // Auto-select البند الافتراضي إذا لم يكن هناك اختيار سابق
    const hasAnySelection = Object.keys(selectedItems).length > 0;
    if (!hasAnySelection && defaultSubNumber) {
        const defaultSub = categories.flatMap(c => c.subitems)
            .find(s => (s.number || "").trim() === defaultSubNumber.trim());
        if (defaultSub) {
            selectedItems[defaultSub.id] = true;
        }
    }

    // Re-load previously selected layers
    categories.forEach(cat => {
        cat.subitems.forEach(sub => {
            if (selectedItems[sub.id]) loadLayer(sub.sheetId, sub.name, sub.geoJsonFile, cat.id);
        });
    });

    document.querySelectorAll(".status-checkbox").forEach(cb => {
        cb.checked = selectedStatuses.includes(cb.dataset.status);
    });

    updateStats();
    initInactivityWatcher();

    // Load notifications (sheet last-updated info)
    loadNotifications();

    // سحب بيانات المقاولين مرة واحدة عند بدء التطبيق
    contractorsLoaded = false;
    buildContractorPanel();
}

function updateUserUI() {
    const initial = (currentUser.name || "؟").charAt(0);

    // Nav avatar
    const navAv = document.getElementById("navAvatar");
    navAv.innerHTML = currentUser.avatar
        ? `<img src="${currentUser.avatar}" alt="صورة">`
        : initial;

    document.getElementById("navUserName").textContent = currentUser.name;

    // Dropdown
    const udWrap = document.getElementById("udAvatarWrap");
    udWrap.innerHTML = currentUser.avatar
        ? `<img src="${currentUser.avatar}" alt="صورة"><div class="ud-avatar-overlay" onclick="triggerAvatarUpload()">📷</div>`
        : `<span>${initial}</span><div class="ud-avatar-overlay" onclick="triggerAvatarUpload()">📷</div>`;

    document.getElementById("udName").textContent    = currentUser.name;
    document.getElementById("udRole").textContent    = currentUser.isAdmin ? "مدير النظام" : "مستخدم";
    document.getElementById("udNameInput").value     = currentUser.name;
    document.getElementById("udPassInput").value     = "";

    // Default coords inputs (nav panel only)
    if (defaultCoords) {
        const l2 = document.getElementById("defLat2"); if(l2) l2.value = defaultCoords.lat;
        const g2 = document.getElementById("defLng2"); if(g2) g2.value = defaultCoords.lng;
        const z2 = document.getElementById("defZoom2"); if(z2) z2.value = defaultCoords.zoom;
        // Settings panel
        const sl = document.getElementById("settingsLat"); if(sl) sl.value = defaultCoords.lat;
        const sg = document.getElementById("settingsLng"); if(sg) sg.value = defaultCoords.lng;
        const sz = document.getElementById("settingsZoom"); if(sz) sz.value = defaultCoords.zoom;
    }
}

function doLogout() {
    clearSession();
    clearTimeout(inactivityTimer);
    currentUser = null;
    Object.values(allLayers).forEach(l => { if (map) map.removeLayer(l); });
    allLayers = {}; allData = {}; allFeatures = {};
    selectedItems = {};
    contractorMap = {}; contractorsLoaded = false; activeContractorFilter = new Set();
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("loginEmail").value    = "";
    document.getElementById("loginPassword").value = "";
    document.getElementById("loginError").style.display = "none";
    document.querySelectorAll('.notif-panel,.theme-panel,.user-dropdown').forEach(p => p.classList.remove('active'));
}

// Apps Script Web App URL for writing back to the Users sheet.
// Admin must deploy an Apps Script with doPost(e) that handles: action, email, name, password, avatar.
// Leave empty string if not configured — changes will only persist in session.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXQqn8MfdZOozZgPlNSNFS4Ji4jY0jy24FNB1aIyzIdaYQz3eTMQ6_ORBU2hGowMld/exec";

async function writeUserToSheet(payload) {
    if (!APPS_SCRIPT_URL) return false;
    try {
        const r = await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain" }, // Apps Script reads e.postData.contents as JSON
            body: JSON.stringify(payload),
            redirect: "follow"
        });
        const text = await r.text();
        return text.trim() === "OK" || r.ok;
    } catch(e) {
        console.warn("Apps Script write failed:", e);
        return false;
    }
}

/* ====================================================
   USER PROFILE EDIT
   ==================================================== */

function triggerAvatarUpload() {
    document.getElementById("avatarFileInput").click();
}

function compressImage(dataUrl, maxWidth = 120) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, maxWidth / img.width);
            canvas.width  = img.width  * scale;
            canvas.height = img.height * scale;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = dataUrl;
    });
}

async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
        // Compress to small size before saving/sending
        const compressed = await compressImage(ev.target.result, 120);
        currentUser.avatar = compressed;
        updateUserUI();
        saveSession(currentUser);

        showAlert("⏳ جاري حفظ الصورة...", "success");

        const ok = await writeUserToSheet({
            action: "updateUser",
            role: currentUser.role,
            photo: compressed
        });

        if (ok) {
            showAlert("✅ تم حفظ الصورة في الشيت — ستظهر من أي جهاز", "success");
        } else {
            showAlert("✅ الصورة محفوظة في الجلسة الحالية", "success");
        }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
}

async function saveUserProfile() {
    const newName = document.getElementById("udNameInput").value.trim();
    const newPass = document.getElementById("udPassInput").value.trim();

    if (!newName) { showAlert("❌ يرجى إدخال الاسم"); return; }

    currentUser.name = newName;
    saveSession(currentUser);
    updateUserUI();

    showAlert("⏳ جاري الحفظ...", "success");

    const payload = { role: currentUser.role };
    if (newName) payload.name = newName;
    if (newPass) payload.password = newPass;

    const ok = await writeUserToSheet(payload);

    if (ok) {
        showAlert("✅ تم حفظ التغييرات في الشيت", "success");
    } else {
        showAlert("✅ تم حفظ الاسم محلياً — تأكد من إعدادات الـ Apps Script", "success");
    }

    document.getElementById("userDropdown").classList.remove("active");
}

/* ====================================================
   MAP
   ==================================================== */

function initMap() {
    if (map) { map.remove(); map = null; }
    const tileUrl = document.body.classList.contains('theme-dark')
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    map = L.map('map', { zoomControl: true }).setView([defaultCoords.lat, defaultCoords.lng], defaultCoords.zoom);
    L.tileLayer(tileUrl, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
}

/* ====================================================
   DEFAULT COORDINATES (admin)
   ==================================================== */

async function loadDefaultCoords() {
    const dc = localStorage.getItem('defaultCoords');
    if (dc) {
        try {
            defaultCoords = JSON.parse(dc);
            if (map) map.setView([defaultCoords.lat, defaultCoords.lng], defaultCoords.zoom);
        } catch(e) {}
    }
    // تحميل رقم البند الافتراضي من localStorage كـ fallback
    const dsn = localStorage.getItem('defaultSubNumber');
    if (dsn !== null && !defaultSubNumber) defaultSubNumber = dsn;
}

function saveDefaultCoordsNav() {
    const lat  = parseFloat(document.getElementById("defLat2").value);
    const lng  = parseFloat(document.getElementById("defLng2").value);
    const zoom = parseInt(document.getElementById("defZoom2").value);
    if (isNaN(lat) || isNaN(lng) || isNaN(zoom)) { showAlert("❌ أدخل إحداثيات صحيحة"); return; }
    defaultCoords = { lat, lng, zoom };
    localStorage.setItem('defaultCoords', JSON.stringify(defaultCoords));
    if (map) map.setView([lat, lng], zoom);
    syncCoordsInputs();
    document.getElementById("coordsPanel").classList.remove("active");
    showAlert("✅ تم حفظ الإحداثيات — اضغط ⬇ في البنود لتصدير categories.json ليتشاركها الجميع", "success");
}

function syncCoordsInputs() {
    const l2 = document.getElementById("defLat2"); if(l2) l2.value = defaultCoords.lat;
    const g2 = document.getElementById("defLng2"); if(g2) g2.value = defaultCoords.lng;
    const z2 = document.getElementById("defZoom2"); if(z2) z2.value = defaultCoords.zoom;
    // Also sync new settings panel inputs
    const sl = document.getElementById("settingsLat"); if(sl) sl.value = defaultCoords.lat;
    const sg = document.getElementById("settingsLng"); if(sg) sg.value = defaultCoords.lng;
    const sz = document.getElementById("settingsZoom"); if(sz) sz.value = defaultCoords.zoom;
}

/* ====================================================
   SETTINGS PANEL
   ==================================================== */

function switchSettingsTab(tab) {
    document.querySelectorAll('.settings-tab').forEach((t, i) => {
        const tabs = ['coords', 'default', 'similar', 'eqtypes'];
        t.classList.toggle('active', tabs[i] === tab);
    });
    document.getElementById('settingsTabCoords').classList.toggle('active', tab === 'coords');
    document.getElementById('settingsTabDefault').classList.toggle('active', tab === 'default');
    document.getElementById('settingsTabSimilar').classList.toggle('active', tab === 'similar');
    document.getElementById('settingsTabEqtypes').classList.toggle('active', tab === 'eqtypes');
    if (tab === 'similar') renderSimilarGroupsList();
    if (tab === 'default') renderDefaultSubPreview();
    if (tab === 'eqtypes') { renderEquipmentTypesList(); updateEqTypesCount(); }
}

function saveSettingsCoords() {
    const lat  = parseFloat(document.getElementById("settingsLat").value);
    const lng  = parseFloat(document.getElementById("settingsLng").value);
    const zoom = parseInt(document.getElementById("settingsZoom").value);
    if (isNaN(lat) || isNaN(lng) || isNaN(zoom)) { showAlert("❌ أدخل إحداثيات صحيحة"); return; }
    defaultCoords = { lat, lng, zoom };
    localStorage.setItem('defaultCoords', JSON.stringify(defaultCoords));
    if (map) map.setView([lat, lng], zoom);
    syncCoordsInputs();
    showAlert("✅ تم حفظ الإحداثيات الافتراضية", "success");
}

function saveSettingsDefaultSub() {
    const num = document.getElementById("settingsDefaultSub").value.trim();
    // تحقق إن الرقم موجود فعلاً في البنود
    const found = categories.flatMap(c => c.subitems).find(s => (s.number || "").trim() === num);
    if (num && !found) {
        showAlert("❌ رقم البند غير موجود — تأكد من الرقم");
        return;
    }
    defaultSubNumber = num;
    localStorage.setItem('defaultSubNumber', num);
    renderDefaultSubPreview();
    showAlert(num ? "✅ تم حفظ البند الافتراضي: " + (found ? found.name : num) : "✅ تم مسح البند الافتراضي", "success");
}

function renderDefaultSubPreview() {
    const inp     = document.getElementById("settingsDefaultSub");
    const preview = document.getElementById("settingsDefaultSubPreview");
    if (!inp || !preview) return;
    inp.value = defaultSubNumber || "";
    if (!defaultSubNumber) { preview.style.display = "none"; return; }
    const found = categories.flatMap(c => c.subitems).find(s => (s.number || "").trim() === defaultSubNumber);
    if (found) {
        const cat = categories.find(c => c.subitems.some(s => s.id === found.id));
        preview.textContent = "✔ " + (cat ? cat.name + " ← " : "") + found.name;
        preview.style.display = "block";
        preview.style.color = "var(--green)";
    } else {
        preview.textContent = "⚠ رقم البند غير موجود في البنود الحالية";
        preview.style.display = "block";
        preview.style.color = "var(--orange)";
    }
}

/* ====================================================
   SIMILAR GROUPS MANAGEMENT
   ==================================================== */

function loadSimilarGroups() {
    try {
        const saved = localStorage.getItem('similarGroups');
        if (saved) similarGroups = JSON.parse(saved);
    } catch(e) { similarGroups = []; }
}

function saveSimilarGroupsToStorage() {
    localStorage.setItem('similarGroups', JSON.stringify(similarGroups));
}

/* ── Get group that a subitem belongs to ── */
function getGroupForSub(subId) {
    return similarGroups.find(g => g.subIds.includes(subId)) || null;
}

/* ── Render the groups list in settings panel ── */
function renderSimilarGroupsList() {
    const list = document.getElementById('similarGroupsList');
    if (!list) return;

    if (!similarGroups.length) {
        list.innerHTML = '<div style="text-align:center;color:var(--text-soft);font-size:11px;padding:12px 0;">لا توجد مجموعات بعد</div>';
        return;
    }

    list.innerHTML = similarGroups.map(group => {
        const subNames = group.subIds.map(sid => {
            let name = sid;
            categories.forEach(c => {
                const sub = c.subitems.find(s => s.id === sid);
                if (sub) name = sub.name;
            });
            return name;
        });

        return `
        <div class="similar-group-card">
            <div class="similar-group-card-header">
                <button class="similar-group-del" onclick="deleteSimilarGroup('${group.id}')" title="حذف المجموعة">✕</button>
                <span class="similar-group-name">${group.name || 'مجموعة بدون اسم'}</span>
                <button onclick="openSimilarGroupModal('${group.id}')" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--purple);font-weight:700;font-family:'Cairo',sans-serif;padding:0 4px;" title="تعديل">✎ تعديل</button>
            </div>
            <div class="similar-group-items">
                ${subNames.map(n => `<span class="similar-group-pill">${n}</span>`).join('')}
            </div>
        </div>`;
    }).join('');
}

function deleteSimilarGroup(groupId) {
    similarGroups = similarGroups.filter(g => g.id !== groupId);
    saveSimilarGroupsToStorage();
    renderSimilarGroupsList();
    showAlert("✅ تم حذف المجموعة", "success");
}

/* ── Open modal to add/edit a similar group ── */
function openSimilarGroupModal(editId = null) {
    _editingGroupId = editId;
    const modal = document.getElementById('similarGroupModal');
    modal.style.display = 'flex';

    // Set name
    const existing = editId ? similarGroups.find(g => g.id === editId) : null;
    document.getElementById('similarGroupNameInput').value = existing ? (existing.name || '') : '';

    // Build subitems grid
    const grid = document.getElementById('similarSubitemsGrid');
    grid.innerHTML = '';

    categories.forEach(cat => {
        if (!cat.subitems.length) return;
        const section = document.createElement('div');
        section.className = 'similar-cat-section';
        section.innerHTML = `<div class="similar-cat-label">${cat.emoji} ${cat.name}</div>`;

        cat.subitems.forEach(sub => {
            const row = document.createElement('div');
            row.className = 'similar-subitem-row';

            const isChecked = existing && existing.subIds.includes(sub.id);

            // Check if this sub belongs to another group (not the one being edited)
            const otherGroup = similarGroups.find(g => g.id !== editId && g.subIds.includes(sub.id));
            const isInOtherGroup = !!otherGroup;

            row.innerHTML = `
                <input type="checkbox" id="sg_${sub.id}"
                    data-sub-id="${sub.id}"
                    ${isChecked ? 'checked' : ''}
                    ${isInOtherGroup ? 'disabled title="هذا البند موجود في مجموعة أخرى: ' + (otherGroup.name || 'بدون اسم') + '"' : ''}>
                <label for="sg_${sub.id}" style="${isInOtherGroup ? 'opacity:0.45;' : ''}">${sub.name}${sub.number ? ' (' + sub.number + ')' : ''}</label>
                ${isInOtherGroup ? `<span class="similar-subitem-cat-badge" title="المجموعة: ${otherGroup.name || 'بدون اسم'}">مُجمَّع</span>` : ''}`;

            if (isChecked) row.classList.add('selected');

            row.addEventListener('click', e => {
                if (isInOtherGroup) return;
                const cb = row.querySelector('input[type="checkbox"]');
                if (e.target !== cb) cb.checked = !cb.checked;
                row.classList.toggle('selected', cb.checked);
            });

            section.appendChild(row);
        });
        grid.appendChild(section);
    });
}

function closeSimilarGroupModal() {
    document.getElementById('similarGroupModal').style.display = 'none';
    _editingGroupId = null;
}

function saveSimilarGroup() {
    const name = document.getElementById('similarGroupNameInput').value.trim();
    const checked = [...document.querySelectorAll('#similarSubitemsGrid input[type="checkbox"]:checked')]
        .map(cb => cb.dataset.subId);

    if (checked.length < 2) {
        showAlert("❌ اختر بندين فرعيين على الأقل");
        return;
    }

    if (_editingGroupId) {
        const g = similarGroups.find(g => g.id === _editingGroupId);
        if (g) { g.name = name || 'مجموعة'; g.subIds = checked; }
    } else {
        similarGroups.push({ id: uid(), name: name || 'مجموعة', subIds: checked });
    }

    saveSimilarGroupsToStorage();
    renderSimilarGroupsList();
    closeSimilarGroupModal();
    showAlert("✅ تم حفظ المجموعة", "success");
}

/* ── Show conflict toast ── */
function showFilterConflict(msg) {
    const t = document.createElement('div');
    t.className = 'filter-conflict-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

/* ====================================================
   EQUIPMENT DATA
   ==================================================== */

// equipmentData: id → last-column string (للـ popup)
// equipmentRawRows: كل صفوف شيت المعدات كاملة (للتبويب)
let equipmentRawRows    = [];
let equipmentRawHeaders = [];

function loadEquipmentData() {
    const url = `https://docs.google.com/spreadsheets/d/${EQUIPMENT_SHEET_ID}/export?format=csv&gid=0`;
    fetch(url).then(r => r.text()).then(csv => {
        const lines   = csv.split('\n').filter(l => l.trim());
        if (!lines.length) return;
        equipmentRawHeaders = lines[0].split(',').map(h => h.trim());
        const headers = equipmentRawHeaders.map(h => h.toUpperCase());
        const idIdx   = headers.findIndex(h => h === 'ID');
        equipmentRawRows = [];
        for (let i = 1; i < lines.length; i++) {
            const v = lines[i].split(',').map(x => x.trim());
            if (!v[idIdx]) continue;
            // للـ popup: آخر عمود
            equipmentData[v[idIdx]] = v[v.length - 1] || "غير محدد";
            // للتبويب: كل الصف
            const row = {};
            headers.forEach((h, idx) => { row[h] = v[idx] || ""; });
            equipmentRawRows.push(row);
        }
    }).catch(e => console.warn("equipment load failed:", e));
}

/* ── بناء تبويب المعدات: إجمالي عدد كل معدة ── */
function buildEquipmentPanel() {
    const list     = document.getElementById("equipmentList");
    const subEl    = document.getElementById("equipmentPanelSub");
    const totalRow = document.getElementById("equipmentTotalRow");
    const totalVal = document.getElementById("equipmentTotalVal");
    if (!list) return;

    if (!equipmentRawRows.length) {
        list.innerHTML = '<div class="equipment-empty">⏳ جاري التحميل...</div>';
        subEl.textContent = "";
        totalRow.style.display = "none";
        setTimeout(() => { if (equipmentRawRows.length) buildEquipmentPanel(); }, 1200);
        return;
    }

    // الأعمدة المستثناة من العرض
    const SKIP_COLS = new Set(['ID', 'BAYAN', 'البيان', 'DESCRIPTION', 'بيان', 'البند', 'ALBND', 'BAND', 'ITEM']);

    // التبويب يعرض كل المعدات بغض النظر عن البند المحدد
    const rows = equipmentRawRows;

    const idCol    = equipmentRawHeaders.findIndex(h => h.toUpperCase() === 'ID');
    const equipCols = equipmentRawHeaders
        .map((h, i) => ({ name: h, idx: i }))
        .filter(c => c.idx !== idCol
                  && c.name.trim() !== ""
                  && !SKIP_COLS.has(c.name.trim())
                  && !SKIP_COLS.has(c.name.trim().toUpperCase()));

    // مجموع كل عمود معدة
    const totals = {};
    equipCols.forEach(col => {
        let sum = 0;
        rows.forEach(row => {
            const val = parseFloat(row[col.name.trim().toUpperCase()] || 0);
            if (!isNaN(val)) sum += val;
        });
        if (sum > 0) totals[col.name] = sum;
    });

    const entries = Object.entries(totals).sort((a,b) => b[1] - a[1]);

    if (!entries.length) {
        list.innerHTML = '<div class="equipment-empty">لا توجد بيانات معدات</div>';
        subEl.textContent = "";
        totalRow.style.display = "none";
        return;
    }

    const grandTotal = entries.reduce((s, [,v]) => s + v, 0);
    subEl.textContent = `${entries.length} نوع — إجمالي كل المعدات`;

    list.innerHTML = entries.map(([name, count]) => `
        <div class="equipment-row">
            <div class="equipment-row-name">${name}</div>
            <div class="equipment-row-count">${fmtNum(count)}</div>
        </div>`).join('');

    totalRow.style.display = "flex";
    totalVal.textContent = fmtNum(grandTotal);
}

/* ====================================================
   CONTRACTOR PANEL
   contractorMap: contractorName → [ { catId, catName, catEmoji, subId, subName, sheetId, geoJsonFile } ]
   activeContractorFilter: Set of "sheetId|contractorName" — drives gray-out logic
   ==================================================== */

let contractorMap         = {};
let activeContractorFilter = new Set(); // "sheetId|contractorName"
let contractorsLoaded     = false; // ← flag: سحب المقاولين مرة واحدة فقط

/* ── fetch one subitem's contractors (uses cached allData if available) ── */
async function fetchSheetContractors(sub) {
    const cat = categories.find(c => c.subitems.some(s => s.id === sub.id));

    const addEntry = (cname) => {
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

    if (allData[sub.sheetId]) {
        Object.values(allData[sub.sheetId]).forEach(row => {
            const cname = (row["CONTRACTOR"] || "").trim();
            if (cname) addEntry(cname);
        });
        return;
    }

    try {
        const url  = `https://docs.google.com/spreadsheets/d/${sub.sheetId}/export?format=csv&gid=0`;
        const r    = await fetch(url);
        if (!r.ok) return;
        const csv  = await r.text();
        if (csv.trim().startsWith('<')) return;
        const lines   = csv.split('\n').filter(l => l.trim());
        if (!lines.length) return;
        const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
        const cIdx    = headers.findIndex(h => h === 'CONTRACTOR');
        if (cIdx === -1) return;
        for (let i = 1; i < lines.length; i++) {
            const vals  = lines[i].split(',').map(v => v.trim());
            const cname = (vals[cIdx] || "").trim();
            if (cname) addEntry(cname);
        }
    } catch(e) { console.warn("contractor fetch failed:", sub.name, e); }
}

/* ── build & render the full contractor panel ── */
async function buildContractorPanel({ forceRefresh = false } = {}) {
    const list = document.getElementById("contractorList");
    if (!list) return;

    // إذا البيانات محملة مسبقاً وما في طلب إعادة تحميل، اكتفِ بإعادة الرسم فقط
    if (contractorsLoaded && !forceRefresh) {
        renderContractorList();
        return;
    }

    list.innerHTML = '<div class="contractor-empty">⏳ جاري التحميل...</div>';

    contractorMap = {};
    const allSubs = [];
    categories.forEach(cat => cat.subitems.forEach(sub => allSubs.push(sub)));

    if (!allSubs.length) {
        list.innerHTML = '<div class="contractor-empty">لا توجد بنود مضافة بعد</div>';
        return;
    }

    await Promise.all(allSubs.map(sub => fetchSheetContractors(sub)));
    contractorsLoaded = true;
    renderContractorList();
}

/* ── render contractor list HTML (no fetch) ── */
function renderContractorList() {
    const list = document.getElementById("contractorList");
    if (!list) return;

    const names = Object.keys(contractorMap).sort((a,b) => a.localeCompare(b, 'ar'));

    if (!names.length) {
        list.innerHTML = '<div class="contractor-empty">لم يتم العثور على مقاولين</div>';
        return;
    }

    list.innerHTML = names.map(name => {
        // Sort subitems: by category order first, then subitem order within category
        const subs = [...contractorMap[name]].sort((a, b) => {
            if (a.catOrder !== b.catOrder) return a.catOrder - b.catOrder;
            const cat = categories.find(c => c.id === a.catId);
            if (!cat) return 0;
            return cat.subitems.findIndex(s => s.id === a.subId) -
                   cat.subitems.findIndex(s => s.id === b.subId);
        });

        // Group by category
        const byCategory = {};
        subs.forEach(s => {
            if (!byCategory[s.catId]) byCategory[s.catId] = { label: `${s.catEmoji} ${s.catName}`, items: [] };
            byCategory[s.catId].items.push(s);
        });

        const subsHTML = Object.values(byCategory).map(group => `
            <div class="c-cat-group">
                <div class="c-cat-label">${group.label}</div>
                ${group.items.map(s => {
                    const filterKey = s.sheetId + '|' + name;
                    const checked   = activeContractorFilter.has(filterKey) ? 'checked' : '';
                    return `
                    <div class="contractor-subitem">
                        <input type="checkbox" class="contractor-cb"
                            data-cat-id="${s.catId}"
                            data-sub-id="${s.subId}"
                            data-sheet="${s.sheetId}"
                            data-geo="${s.geoJsonFile}"
                            data-contractor="${name}"
                            data-filter-key="${filterKey}"
                            ${checked}
                            onclick="event.stopPropagation()">
                        <label>${s.subName}</label>
                    </div>`;
                }).join('')}
            </div>`).join('');

        return `
        <div class="contractor-item">
            <div class="contractor-name" onclick="toggleContractor(this)">
                <span>${name}</span>
                <div style="display:flex;align-items:center;gap:5px">
                    <span class="contractor-count">${subs.length}</span>
                    <span class="c-arrow">◀</span>
                </div>
            </div>
            <div class="contractor-subitems">
                ${subsHTML}
            </div>
        </div>`;
    }).join('');

    // Bind checkbox events
    list.querySelectorAll('.contractor-cb').forEach(cb => {
        cb.addEventListener('change', function() {
            handleContractorCheckbox(this);
        });
    });
}

/* ── handle contractor checkbox toggle — group-aware ── */
function handleContractorCheckbox(cb) {
    const filterKey = cb.dataset.filterKey;
    const sheetId   = cb.dataset.sheet;
    const geoFile   = cb.dataset.geo;
    const catId     = cb.dataset.catId;
    const subId     = cb.dataset.subId;

    if (cb.checked) {
        // ── الشيت الجديد في أي مجموعة؟
        const newSub      = categories.flatMap(c => c.subitems).find(s => s.id === subId);
        const newSubGroup = newSub ? getGroupForSub(newSub.id) : null;

        // ── هل في تعارض مع الشيتات النشطة حالياً؟
        const activeSheets = new Set([...activeContractorFilter].map(k => k.split('|')[0]));
        const sheetsToRemove = new Set();

        activeSheets.forEach(sid => {
            if (sid === sheetId) return; // نفس الشيت → يبقى دائماً
            const existingSub   = categories.flatMap(c => c.subitems).find(s => s.sheetId === sid);
            const existingGroup = existingSub ? getGroupForSub(existingSub.id) : null;

            // تعارض: مجموعتان مختلفتان، أو أحدهما غير مُجمَّع
            const conflict = !newSubGroup || !existingGroup || newSubGroup.id !== existingGroup.id;
            if (conflict) sheetsToRemove.add(sid);
        });

        // أزل الشيتات المتعارضة
        sheetsToRemove.forEach(sid => {
            [...activeContractorFilter].forEach(k => {
                if (k.startsWith(sid + '|')) activeContractorFilter.delete(k);
            });
            loadTokens[sid] = null;
            if (allLayers[sid]) { map.removeLayer(allLayers[sid]); delete allLayers[sid]; }
            delete allData[sid];
        });

        // أزل جميع اختيارات السايدبار
        categories.flatMap(c => c.subitems).forEach(s => {
            if (selectedItems[s.id]) {
                loadTokens[s.sheetId] = null;
                if (allLayers[s.sheetId]) { map.removeLayer(allLayers[s.sheetId]); delete allLayers[s.sheetId]; }
                delete allData[s.sheetId];
                delete selectedItems[s.id];
            }
        });

        // أضف الفلتر الجديد
        activeContractorFilter.add(filterKey);

        // حمّل الطبقة
        if (!allLayers[sheetId]) {
            if (newSub) loadLayer(sheetId, newSub.name, geoFile, catId);
        } else {
            applyContractorFilter();
        }

    } else {
        activeContractorFilter.delete(filterKey);
        const stillActive = [...activeContractorFilter].some(k => k.startsWith(sheetId + '|'));
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

/* ── switch between "by contractor" and "by group" tabs ── */
let _activeContractorTab = 'contractor';

function switchContractorTab(tab) {
    _activeContractorTab = tab;
    const isContractor = tab === 'contractor';

    document.getElementById('contractorTabContractor').style.display = isContractor ? 'block' : 'none';
    document.getElementById('contractorTabGroup').style.display      = isContractor ? 'none'  : 'block';

    const btnC = document.getElementById('cTabContractor');
    const btnG = document.getElementById('cTabGroup');
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

/* ── render "by group" tab content ── */
function renderContractorGroupList() {
    const list = document.getElementById('contractorGroupList');
    if (!list) return;

    // جمع كل subIds المضمنة في مجموعة
    const groupedSubIds = new Set(similarGroups.flatMap(g => g.subIds));

    // بناء virtual groups للبنود المنفردة
    const soloGroups = [];
    categories.forEach(cat => {
        cat.subitems.forEach(sub => {
            if (!groupedSubIds.has(sub.id)) {
                soloGroups.push({ id: 'solo_' + sub.id, name: sub.name, subIds: [sub.id] });
            }
        });
    });

    const allGroups = [...similarGroups, ...soloGroups];

    // احسب عدد المقاولين لمجموعة
    const countContractors = (group) => {
        const s = new Set();
        group.subIds.forEach(sid => {
            const sub = categories.flatMap(c => c.subitems).find(x => x.id === sid);
            if (!sub) return;
            if (allData[sub.sheetId]) {
                Object.values(allData[sub.sheetId]).forEach(row => {
                    const c = (row['CONTRACTOR'] || '').trim(); if (c) s.add(c);
                });
            }
            if (contractorMap) {
                Object.keys(contractorMap).forEach(name => {
                    if (contractorMap[name].some(e => e.subId === sid)) s.add(name);
                });
            }
        });
        return s.size;
    };

    const groupRows = [];
    allGroups.forEach(group => {
        const contractorCount = countContractors(group);
        if (!contractorCount) return;

        const isActive = group.subIds.some(sid => {
            const sub = categories.flatMap(c => c.subitems).find(s => s.id === sid);
            return sub && [...activeContractorFilter].some(k => k.startsWith(sub.sheetId + '|'));
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

    list.querySelectorAll('.cgroup-cb').forEach(cb => {
        cb.addEventListener('change', function(e) {
            e.stopPropagation();
            toggleGroupFilter(this.dataset.groupId, this.closest('.cgroup-row'));
        });
    });
}

/* ── activate/deactivate a whole group filter ── */
async function toggleGroupFilter(groupId, rowEl) {
    // ابحث في similarGroups أولاً، ثم بناء solo group إذا كان ID يبدأ بـ solo_
    let group = similarGroups.find(g => g.id === groupId);
    if (!group && groupId.startsWith('solo_')) {
        const subId = groupId.replace('solo_', '');
        const sub   = categories.flatMap(c => c.subitems).find(s => s.id === subId);
        if (sub) group = { id: groupId, name: sub.name, subIds: [subId] };
    }
    if (!group) return;

    const cb = rowEl ? rowEl.querySelector('.cgroup-cb') : null;

    // Is this group currently active?
    const anyActive = group.subIds.some(sid => {
        const sub = categories.flatMap(c => c.subitems).find(s => s.id === sid);
        return sub && [...activeContractorFilter].some(k => k.startsWith(sub.sheetId + '|'));
    });

    if (anyActive) {
        // ── deactivate: remove all filters for this group's sheets ──
        group.subIds.forEach(sid => {
            const sub = categories.flatMap(c => c.subitems).find(s => s.id === sid);
            if (!sub) return;
            [...activeContractorFilter].forEach(k => {
                if (k.startsWith(sub.sheetId + '|')) activeContractorFilter.delete(k);
            });
            const stillUsed = [...activeContractorFilter].some(k => k.startsWith(sub.sheetId + '|'));
            if (!stillUsed) {
                loadTokens[sub.sheetId] = null;
                if (allLayers[sub.sheetId]) { map.removeLayer(allLayers[sub.sheetId]); delete allLayers[sub.sheetId]; }
                delete allData[sub.sheetId];
            }
        });
        if (rowEl) { rowEl.classList.remove('active-group'); if(cb) cb.checked = false; }

    } else {
        // ── activate: clear conflicting filters, load all sheets in group ──

        // أزل أي فلاتر من مجموعات أخرى
        const otherSheets = new Set(
            [...activeContractorFilter]
                .map(k => k.split('|')[0])
                .filter(sid => !group.subIds.some(gsid => {
                    const s = categories.flatMap(c => c.subitems).find(x => x.id === gsid);
                    return s && s.sheetId === sid;
                }))
        );
        otherSheets.forEach(sid => {
            [...activeContractorFilter].forEach(k => { if(k.startsWith(sid+'|')) activeContractorFilter.delete(k); });
            loadTokens[sid] = null;
            if (allLayers[sid]) { map.removeLayer(allLayers[sid]); delete allLayers[sid]; }
            delete allData[sid];
        });

        // أزل اختيارات السايدبار
        categories.flatMap(c => c.subitems).forEach(s => {
            if (selectedItems[s.id]) {
                loadTokens[s.sheetId] = null;
                if (allLayers[s.sheetId]) { map.removeLayer(allLayers[s.sheetId]); delete allLayers[s.sheetId]; }
                delete allData[s.sheetId];
                delete selectedItems[s.id];
            }
        });

        // لكل بند فرعي في المجموعة: حمّل الطبقة وأضف فلاتر كل المقاولين فيها
        for (const sid of group.subIds) {
            const sub = categories.flatMap(c => c.subitems).find(s => s.id === sid);
            if (!sub || !sub.sheetId || !sub.geoJsonFile) continue;
            const cat = categories.find(c => c.subitems.some(s => s.id === sid));
            if (!cat) continue;

            // احصل على المقاولين لهذا الشيت
            const contractors = getContractorsForSheet(sub.sheetId);

            if (contractors.length) {
                contractors.forEach(name => {
                    activeContractorFilter.add(sub.sheetId + '|' + name);
                });
            } else {
                // لا يوجد مقاولون محددون → أضف فلتر wildcard بـ "*" لإظهار الكل
                activeContractorFilter.add(sub.sheetId + '|*');
            }

            if (!allLayers[sub.sheetId]) {
                loadLayer(sub.sheetId, sub.name, sub.geoJsonFile, cat.id);
            }
        }

        if (rowEl) { rowEl.classList.add('active-group'); if(cb) cb.checked = true; }
    }

    // Deactivate all other group rows
    document.querySelectorAll('.cgroup-row').forEach(r => {
        const gid = r.querySelector('.cgroup-cb')?.dataset.groupId;
        if (gid && gid !== groupId && !anyActive) {
            r.classList.remove('active-group');
            const rcb = r.querySelector('.cgroup-cb');
            if (rcb) rcb.checked = false;
        }
    });

    renderItems();
    updateNavTabsState();
    updateStats();
    syncContractorCheckboxes();
    // re-render group tab to refresh counts
    setTimeout(() => renderContractorGroupList(), 300);
}

/* ── get all contractor names for a sheetId from contractorMap ── */
function getContractorsForSheet(sheetId) {
    const names = [];
    Object.keys(contractorMap).forEach(name => {
        if (contractorMap[name].some(e => e.sheetId === sheetId)) names.push(name);
    });
    return names;
}

/* ── apply gray-out: highlight only features whose CONTRACTOR matches active filters ── */
function applyContractorFilter() {
    if (!activeContractorFilter.size) {
        refreshLayerColors();
        return;
    }

    Object.entries(allLayers).forEach(([sheetId, layer]) => {
        if (!layer || !allData[sheetId]) return;

        const activeForSheet = [...activeContractorFilter]
            .filter(k => k.startsWith(sheetId + '|'))
            .map(k => k.split('|')[1].trim().toLowerCase());

        // wildcard '*' → show all features with normal colors
        const isWildcard = activeForSheet.includes('*');

        layer.eachLayer(f => {
            const row = allData[sheetId][f.feature.properties.ID];
            if (!row) return;
            const featureCon = (row["CONTRACTOR"] || "").trim().toLowerCase();
            const match = activeForSheet.length === 0 || isWildcard ||
                          activeForSheet.includes(featureCon);

            if (match) {
                f.setStyle(featureStyle(row));
                f.setZIndexOffset && f.setZIndexOffset(100);
            } else {
                f.setStyle({ color: '#aaaaaa', fillColor: '#cccccc', fillOpacity: 0.18, weight: 1 });
            }
        });
    });
}

/* ── keep contractor checkboxes in sync with selectedItems ── */
function syncContractorCheckboxes() {
    document.querySelectorAll('.contractor-cb').forEach(cb => {
        cb.checked = activeContractorFilter.has(cb.dataset.filterKey);
    });
}

function toggleContractor(el) {
    const subitems = el.nextElementSibling;
    const isOpen   = subitems.classList.contains('active');
    document.querySelectorAll('.contractor-name.open').forEach(e => {
        e.classList.remove('open');
        e.nextElementSibling.classList.remove('active');
    });
    if (!isOpen) {
        el.classList.add('open');
        subitems.classList.add('active');
    }
}

/* ====================================================
   CASH FLOW DASHBOARD MODAL
   ==================================================== */

const CASHFLOW_CONTRACTORS_SHEET = "1xmSUQNR02prdGK9P6QiJo8ybVKwdVZAE74yUkUTbVYA";
const CASHFLOW_COMPANY_SHEET     = "1HTV35zXKroQdPJJ0XDew5rFgLwRX73-16AbtI1IymYA";

let cashflowData = { contractors: null, company: null };
let cfActiveTab  = 'contractors';

function openCashflowModal() {
    document.getElementById('cashflowModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    // load active tab data
    if (!cashflowData[cfActiveTab]) {
        const sheetId = cfActiveTab === 'contractors' ? CASHFLOW_CONTRACTORS_SHEET : CASHFLOW_COMPANY_SHEET;
        loadCfData(cfActiveTab, sheetId);
    } else {
        renderCfKpis(cfActiveTab);
    }
}

function closeCashflowModal() {
    document.getElementById('cashflowModal').classList.remove('active');
    document.body.style.overflow = '';
}

// Close on Escape key
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeCashflowModal(); closeBillsModal(); closeEquipmentModal(); closeReportsDropdown(); closeAddDropdown(); closeCompanyCashflowForm(); closeContractorCashflowForm(); }
});

function switchCfTab(tab) {
    cfActiveTab = tab;
    document.querySelectorAll('.cf-tab-pill').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.cf-content').forEach(c => {
        c.classList.toggle('active', c.id === 'cf-' + tab);
    });
    if (!cashflowData[tab]) {
        const sheetId = tab === 'contractors' ? CASHFLOW_CONTRACTORS_SHEET : CASHFLOW_COMPANY_SHEET;
        loadCfData(tab, sheetId);
    } else {
        renderCfKpis(tab);
    }
}

async function loadCfData(type, sheetId) {
    const container = document.getElementById('cf-' + type);
    container.innerHTML = '<div class="cf-loading">⏳ جاري تحميل البيانات...</div>';
    // Reset KPIs
    ['cfKpiTotal','cfKpiPaid','cfKpiRemaining','cfKpiPct'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
    });
    const bar = document.getElementById('cfKpiBar');
    if (bar) bar.style.width = '0%';

    try {
        const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
        const r   = await fetch(url);
        if (!r.ok) throw new Error('Failed to fetch');
        const csv = await r.text();
        if (csv.trim().startsWith('<')) {
            container.innerHTML = '<div class="cf-error">⚠️ الشيت يحتاج إعداد المشاركة العامة</div>';
            return;
        }
        const data = parseCfCSV(csv);
        cashflowData[type] = data;
        renderCfKpis(type);
        renderCfTable(type, data);
        document.getElementById('cfLastUpdate').textContent = 'آخر تحديث: ' + new Date().toLocaleTimeString('ar-SA');
    } catch(e) {
        console.error('Cashflow load error:', e);
        container.innerHTML = '<div class="cf-error">❌ تعذر تحميل البيانات — تأكد من إعدادات الشيت</div>';
    }
}

function parseCfCSV(csv) {
    const lines = csv.split('\n').filter(l => l.trim());
    if (!lines.length) return { headers: [], rows: [] };
    const headers = parseCSVLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
        rows.push(row);
    }
    return { headers, rows };
}

/* ── Smart KPI detection: scan all columns for money-like totals ── */
function renderCfKpis(type) {
    const data = cashflowData[type];
    if (!data || !data.rows.length) return;

    // Try to detect numeric columns that look like money
    const numericCols = data.headers.filter(h => {
        let hasNum = false;
        data.rows.slice(0, 10).forEach(row => {
            const v = (row[h] || '').replace(/,/g, '');
            if (!isNaN(parseFloat(v)) && parseFloat(v) > 0) hasNum = true;
        });
        return hasNum;
    });

    if (numericCols.length === 0) {
        // Can't compute KPIs — hide KPI row
        document.getElementById('cfKpiRow').style.display = 'none';
        return;
    }

    document.getElementById('cfKpiRow').style.display = 'grid';

    // Sum each numeric column
    const colSums = {};
    numericCols.forEach(col => {
        let s = 0;
        data.rows.forEach(row => {
            const v = parseFloat((row[col] || '').replace(/,/g, ''));
            if (!isNaN(v)) s += v;
        });
        colSums[col] = s;
    });

    const sums = Object.values(colSums).sort((a, b) => b - a);

    // Heuristic: biggest sum = total, second biggest = paid, difference = remaining
    const total     = sums[0] || 0;
    const paid      = sums[1] || 0;
    const remaining = Math.max(0, total - paid);
    const pct       = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

    const fmt = n => n >= 1_000_000
        ? (n / 1_000_000).toFixed(1) + ' م'
        : n.toLocaleString('en-US');

    document.getElementById('cfKpiTotal').textContent     = fmt(total);
    document.getElementById('cfKpiPaid').textContent      = fmt(paid);
    document.getElementById('cfKpiRemaining').textContent = fmt(remaining);
    document.getElementById('cfKpiPct').textContent       = pct + '%';

    const bar = document.getElementById('cfKpiBar');
    if (bar) {
        bar.style.width = '0%';
        setTimeout(() => { bar.style.width = pct + '%'; }, 80);
        bar.style.background = pct < 30
            ? 'linear-gradient(90deg,#e74c3c,#c0392b)'
            : pct < 70
            ? 'linear-gradient(90deg,#f39c12,#e67e22)'
            : 'linear-gradient(90deg,#27ae60,#1e8449)';
    }
}

/* ── Render table with smart number detection & color coding ── */
function renderCfTable(type, data) {
    const container = document.getElementById('cf-' + type);
    if (!data.rows.length) {
        container.innerHTML = '<div class="cf-empty">لا توجد بيانات</div>';
        return;
    }

    // Detect which columns are numeric
    const numericHeaders = new Set(data.headers.filter(h => {
        let cnt = 0;
        data.rows.slice(0, Math.min(15, data.rows.length)).forEach(row => {
            const v = (row[h] || '').replace(/,/g, '');
            if (!isNaN(parseFloat(v)) && v.trim() !== '') cnt++;
        });
        return cnt > data.rows.length * 0.3;
    }));

    const numericCols = [...numericHeaders];
    const colSums = {};
    numericCols.forEach(col => {
        let s = 0;
        data.rows.forEach(row => {
            const v = parseFloat((row[col] || '').replace(/,/g, ''));
            if (!isNaN(v)) s += v;
        });
        colSums[col] = s;
    });
    const maxSum = Math.max(...Object.values(colSums), 1);

    // Assign color classes: highest-sum col = gold, 2nd = green, 3rd = blue
    const sortedCols = numericCols.sort((a, b) => colSums[b] - colSums[a]);
    const colClass = {};
    if (sortedCols[0]) colClass[sortedCols[0]] = '';          // gold (default cf-num)
    if (sortedCols[1]) colClass[sortedCols[1]] = 'cf-num-green';
    if (sortedCols[2]) colClass[sortedCols[2]] = 'cf-num-blue';

    let html = `<div class="cf-table-wrap"><table class="cf-table"><thead><tr>`;
    data.headers.forEach(h => { html += `<th>${h}</th>`; });
    html += `<tr></thead><tbody>`;

    data.rows.forEach((row, i) => {
        html += `<tr>`;
        data.headers.forEach(h => {
            const raw = row[h] || '';
            const isNum = numericHeaders.has(h);
            let display = raw;
            if (isNum) {
                const n = parseFloat(raw.replace(/,/g, ''));
                display = !isNaN(n) ? n.toLocaleString('en-US') : raw;
            }
            const cls = isNum ? ('cf-num ' + (colClass[h] || '')) : '';
            html += `<td class="${cls}">${display}</td>`;
        });
        html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
}

// Legacy compat — keep old function names harmless
function switchCashflowTab(tab) { switchCfTab(tab); }
function onCashflowPanelOpen()  { /* no-op: replaced by modal */ }

/* ====================================================
   NOTIFICATIONS — from dedicated sheet (column A, each row = one notification)
   ==================================================== */

const NOTIFICATIONS_SHEET_ID = "1AV4umnW_s_bUOIrLBQouCsoAmPJI4yV3aOfPhKfM9C8";

async function loadNotifications() {
    const badge = document.getElementById("notifBadge");
    const list  = document.getElementById("notifList");

    list.innerHTML = '<div class="notif-empty">جاري التحميل...</div>';

    try {
        const url = `https://docs.google.com/spreadsheets/d/${NOTIFICATIONS_SHEET_ID}/export?format=csv&gid=0`;
        const r   = await fetch(url, { redirect: "follow" });

        const csv = await r.text();

        // If the sheet is not public, Google returns an HTML login page
        if (csv.trim().startsWith('<') || csv.includes('accounts.google.com')) {
            list.innerHTML = '<div class="notif-empty">⚠️ الشيت يحتاج إعداد المشاركة العامة</div>';
            badge.style.display = 'none';
            return;
        }

        const lines = csv.split('\n').map(l => l.trim()).filter(l => l);

        // Read ALL rows from column A (no header skip — treat every row as a notification)
        const items = lines.map(line => {
            if (line.startsWith('"')) {
                // Quoted field
                const end = line.indexOf('"', 1);
                return line.slice(1, end === -1 ? undefined : end).trim();
            }
            return line.split(',')[0].trim();
        }).filter(v => v);

        if (!items.length) {
            list.innerHTML = '<div class="notif-empty">لا توجد إشعارات</div>';
            badge.style.display = 'none';
            return;
        }

        badge.style.display = 'flex';
        badge.textContent = items.length;
        list.innerHTML = items.map(text => `
            <div class="notif-item">
                <div class="notif-item-title">${text}</div>
            </div>`).join('');

    } catch(e) {
        console.warn("Notifications load failed:", e);
        list.innerHTML = '<div class="notif-empty">تعذر تحميل الإشعارات</div>';
        badge.style.display = 'none';
    }
}

/* ====================================================
   CATEGORIES CONFIG
   ==================================================== */

async function loadCategoriesConfig() {
    try {
        const r = await fetch(CONFIG_FILE + "?t=" + Date.now());
        if (!r.ok) throw new Error("not found");
        const data = await r.json();
        categories = Array.isArray(data) ? data : (data.categories || []);
        // Load defaultCoords from config if present (shared across all users)
        if (!Array.isArray(data) && data.defaultCoords) {
            defaultCoords = data.defaultCoords;
            // Also store locally
            localStorage.setItem('defaultCoords', JSON.stringify(defaultCoords));
        }
        // Load similarGroups from config if present (shared across all users)
        if (!Array.isArray(data) && data.similarGroups) {
            similarGroups = data.similarGroups;
            localStorage.setItem('similarGroups', JSON.stringify(similarGroups));
        }
        // Load defaultSubNumber from config if present
        if (!Array.isArray(data) && data.defaultSubNumber !== undefined) {
            defaultSubNumber = data.defaultSubNumber || "";
            localStorage.setItem('defaultSubNumber', defaultSubNumber);
        }
        // Load equipmentTypes from config if present (admin-managed list)
        if (!Array.isArray(data) && data.equipmentTypes && Array.isArray(data.equipmentTypes)) {
            equipmentTypes = data.equipmentTypes;
        }
    } catch(e) {
        console.warn("categories.json not found — starting empty");
        categories = [];
    }
    categories.forEach(c => { if (!c.subitems) c.subitems = []; if (!c.id) c.id = uid(); });
}

/* ====================================================
   EXPORT / IMPORT CONFIG
   ==================================================== */

function exportConfig() {
    const payload = JSON.stringify({
        categories: categories,
        defaultCoords: defaultCoords,
        similarGroups: similarGroups,
        defaultSubNumber: defaultSubNumber,
        equipmentTypes: equipmentTypes,
        // Include current UI state for persistence
        selectedItems: selectedItems,
        selectedStatuses: selectedStatuses,
        activeContractorFilter: [...activeContractorFilter],
        currentTheme: localStorage.getItem('mapTheme') || '',
        navRightOrder: (function() {
            const order = [];
            document.querySelectorAll('.nav-right > div').forEach(div => {
                const btn = div.querySelector('.nav-icon-btn, .user-chip');
                if (btn && btn.id) order.push(btn.id);
            });
            return order;
        })()
    }, null, 2);
    const blob    = new Blob([payload], { type: "application/json" });
    const link    = document.createElement("a");
    link.href     = URL.createObjectURL(blob);
    link.download = "categories.json";
    link.click();
    showAlert("✅ تم تحميل categories.json — ارفعه على GitHub يدوياً", "success");
}

function importConfig(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const data = JSON.parse(ev.target.result);
            categories = Array.isArray(data) ? data : (data.categories || []);
            categories.forEach(c => { if (!c.subitems) c.subitems = []; if (!c.id) c.id = uid(); });
            // Import defaultCoords if present
            if (!Array.isArray(data) && data.defaultCoords) {
                defaultCoords = data.defaultCoords;
                localStorage.setItem('defaultCoords', JSON.stringify(defaultCoords));
                if (map) map.setView([defaultCoords.lat, defaultCoords.lng], defaultCoords.zoom);
                syncCoordsInputs();
            }
            // Restore state if present
            if (!Array.isArray(data)) {
                if (data.similarGroups) {
                    similarGroups = data.similarGroups;
                    localStorage.setItem('similarGroups', JSON.stringify(similarGroups));
                }
                if (data.defaultSubNumber !== undefined) {
                    defaultSubNumber = data.defaultSubNumber || "";
                    localStorage.setItem('defaultSubNumber', defaultSubNumber);
                }
                if (data.equipmentTypes && Array.isArray(data.equipmentTypes)) {
                    equipmentTypes = data.equipmentTypes;
                    refreshEquipmentDatalist();
                    if (document.getElementById('eqTypesList')) renderEquipmentTypesList();
                }
                if (data.selectedItems) selectedItems = data.selectedItems;
                if (data.selectedStatuses) selectedStatuses = data.selectedStatuses;
                if (data.activeContractorFilter) {
                    activeContractorFilter.clear();
                    data.activeContractorFilter.forEach(k => activeContractorFilter.add(k));
                }
                if (data.currentTheme) {
                    applyTheme(data.currentTheme);
                }
                if (data.navRightOrder && Array.isArray(data.navRightOrder)) {
                    const navRight = document.querySelector('.nav-right');
                    if (navRight) {
                        data.navRightOrder.forEach(id => {
                            const el = document.getElementById(id)?.parentElement;
                            if (el) navRight.appendChild(el);
                        });
                    }
                }
            }
            renderItems();
            renderNavTabs();
            updateStats();
            showAlert("✅ تم استيراد الإعدادات والحالات", "success");
        } catch { showAlert("❌ الملف غير صالح", "error"); }
    };
    reader.readAsText(file);
    e.target.value = "";
}

/* ====================================================
   STATS BAR
   ==================================================== */

/* ── helper: calc totals for a subitem, respecting contractor filter & status filter ── */
function calcSubTotals(sub) {
    let total = 0, done = 0;
    if (!allData[sub.sheetId]) return { total, done };

    // Build set of active contractors for this sheet (if filter is on)
    const filterOn = activeContractorFilter && activeContractorFilter.size > 0;
    const activeContractorsForSheet = filterOn
        ? [...activeContractorFilter]
            .filter(k => k.startsWith(sub.sheetId + '|'))
            .map(k => k.split('|')[1].trim().toLowerCase())
        : null;

    Object.values(allData[sub.sheetId]).forEach(row => {
        // Status filter
        const st = (row["STATUS"] || "").trim().toLowerCase();
        if (!selectedStatuses.some(s => s.toLowerCase() === st)) return;

        // Contractor filter — only count visible features
        if (activeContractorsForSheet && activeContractorsForSheet.length > 0) {
            const featureCon = (row["CONTRACTOR"] || "").trim().toLowerCase();
            if (!activeContractorsForSheet.includes(featureCon)) return;
        }

        total += toNum(row["TOTAL-QTY"]);
        done  += toNum(row["DONE-QTY"]);
    });

    return { total, done };
}

/* ── build one stat card element ── */
function makeStatCard(title, subtitle, total, done, isTotal = false) {
    const card = document.createElement("div");
    card.className = "stats-group" + (isTotal ? " stats-group-total" : "");
    card.innerHTML = `
        <div class="stats-group-title">${title}</div>
        <div class="stats-group-type">${subtitle}</div>
        <div class="stat-row">
            <div class="stat-item"><div class="stat-label">الإجمالي</div><div class="stat-value">${fmtNum(total)}</div></div>
            <div class="stat-item"><div class="stat-label">المنفذ</div><div class="stat-value">${fmtNum(done)}</div></div>
            <div class="stat-item"><div class="stat-label">المتبقي</div><div class="stat-value">${fmtNum(total - done)}</div></div>
        </div>`;
    return card;
}

/* ── build contractors card for the active subitems ── */
function makeContractorsCard(sheetIds, subLabel = "البند المحدد") {
    // اجمع المقاولين مع عدد الصفوف لكل مقاول
    const contractorCounts = {};
    sheetIds.forEach(sid => {
        if (!allData[sid]) return;
        Object.values(allData[sid]).forEach(row => {
            const c = (row["CONTRACTOR"] || "").trim();
            if (!c) return;
            contractorCounts[c] = (contractorCounts[c] || 0) + 1;
        });
    });

    if (!Object.keys(contractorCounts).length) return null;

    const sorted = Object.entries(contractorCounts)
        .sort((a, b) => b[1] - a[1]); // ترتيب تنازلي بالعدد

    const total = sorted.length;

    const card = document.createElement("div");
    card.className = "stats-group stats-group-contractors";
    card.innerHTML = `
        <div class="stats-group-title">👷 المقاولون</div>
        <div class="stats-group-type">${total} مقاول في بند ${subLabel}</div>
        <div class="contractor-chips">
            ${sorted.map(([name, count]) =>
                `<span class="contractor-chip">
                    <span class="contractor-chip-name">${name}</span>
                    <span class="contractor-chip-badge">${count}</span>
                </span>`
            ).join('')}
        </div>`;
    return card;
}

/* ── build equipment card filtered by عمود البند ── */
function makeEquipmentCard(sheetIds, subLabel = "البند المحدد") {
    if (!equipmentRawRows.length || !equipmentRawHeaders.length) return null;

    // الأعمدة المستثناة
    const SKIP = new Set(['ID', 'BAYAN', 'البيان', 'DESCRIPTION', 'بيان', 'البند', 'BAND', 'ALBND', 'ITEM']);

    // اسم البند الفرعي النشط — unique names only, no duplicates
    const activeSubs = categories.flatMap(c => c.subitems).filter(s => selectedItems[s.id]);
    const activeSubNames = [...new Set(activeSubs.map(s => s.name.trim()))];

    // عمود البند
    const bandColOrig = equipmentRawHeaders.find(h => {
        const u = h.trim().toUpperCase();
        return u === 'البند' || u === 'BAND' || u === 'ALBND' || u === 'ITEM';
    });

    // فلترة الصفوف
    let rows = equipmentRawRows;
    if (bandColOrig && activeSubNames.length) {
        const bKey = bandColOrig.trim().toUpperCase();
        rows = equipmentRawRows.filter(row => {
            const val = (row[bKey] || "").trim();
            if (!val) return false; // صف بدون بند → لا يُدرج في الكارت
            return activeSubNames.includes(val);
        });
    }

    if (!rows.length) return null;

    // أعمدة المعدات
    const idIdx = equipmentRawHeaders.findIndex(h => h.toUpperCase() === 'ID');
    const totals = {};
    equipmentRawHeaders.forEach((h, i) => {
        const hUp = h.trim().toUpperCase();
        if (i === idIdx || !h.trim() || SKIP.has(hUp) || SKIP.has(h.trim())) return;
        let sum = 0;
        rows.forEach(row => {
            const val = parseFloat(row[hUp] || 0);
            if (!isNaN(val)) sum += val;
        });
        if (sum > 0) totals[h.trim()] = sum;
    });

    const entries = Object.entries(totals).sort((a,b) => b[1] - a[1]);
    if (!entries.length) return null;

    // Build label: unique subitem names joined with " و " — no repetition
    const uniqueSubNames = activeSubNames.length
        ? activeSubNames.join(' و ')
        : subLabel;

    const card = document.createElement("div");
    card.className = "stats-group stats-group-equipment";
    card.innerHTML = `
        <div class="stats-group-title">🚜 المعدات</div>
        <div class="stats-group-type">إجمالي المعدات في بند ${uniqueSubNames}</div>
        <div class="equipment-chips">
            ${entries.map(([name, count]) =>
                `<span class="equipment-chip">${name}<span class="equipment-chip-count">${fmtNum(count)}</span></span>`
            ).join('')}
        </div>`;
    return card;
}

/* ── update the progress ring in the search bar ── */
function updateProgressRing(total, done) {
    const wrap   = document.getElementById("progressRingWrap");
    const circle = document.getElementById("progressRingCircle");
    const pctEl  = document.getElementById("progressRingPct");

    if (!wrap) return;

    if (!total || total === 0) {
        wrap.classList.remove("visible");
        return;
    }

    const pct          = Math.min(100, Math.round((done / total) * 100));
    const circumference = 94.25; // 2 * π * 15
    const offset        = circumference - (pct / 100) * circumference;

    wrap.classList.add("visible");
    circle.style.strokeDashoffset = offset;
    pctEl.textContent = pct + "%";

    // Color: red < 30%, orange 30-70%, gold >= 70%
    circle.style.stroke = pct < 30 ? "#f44336" : pct < 70 ? "#ff9800" : "var(--gold)";
}

function updateStats() {
    const wrapper = document.getElementById("statsWrapper");
    wrapper.innerHTML = "";
    const contractorMode = activeContractorFilter && activeContractorFilter.size > 0;

    let grandTotal = 0, grandDone = 0, cardCount = 0;

    if (contractorMode) {
        /* ── وضع فلتر المقاول: كارت لكل مقاول/شيت ── */
        const bySheet = {};
        [...activeContractorFilter].forEach(key => {
            const pipeIdx = key.indexOf('|');
            const sid   = key.slice(0, pipeIdx);
            const cname = key.slice(pipeIdx + 1);
            if (!bySheet[sid]) bySheet[sid] = [];
            bySheet[sid].push(cname);
        });

        Object.entries(bySheet).forEach(([sid, contractors]) => {
            if (!allData[sid]) return;
            let subLabel = sid, catLabel = "";
            categories.forEach(cat => {
                cat.subitems.forEach(sub => {
                    if (sub.sheetId === sid) { subLabel = sub.name; catLabel = cat.emoji + " " + cat.name; }
                });
            });
            let total = 0, done = 0;
            const cLow = contractors.map(c => c.toLowerCase());
            Object.values(allData[sid]).forEach(row => {
                const st = (row["STATUS"] || "").trim().toLowerCase();
                if (!selectedStatuses.some(s => s.toLowerCase() === st)) return;
                if (!cLow.includes((row["CONTRACTOR"] || "").trim().toLowerCase())) return;
                total += toNum(row["TOTAL-QTY"]);
                done  += toNum(row["DONE-QTY"]);
            });
            const title = contractors.length === 1
                ? ("👷 " + contractors[0])
                : ("👷 " + contractors.length + " مقاولين");
            wrapper.appendChild(makeStatCard(title, catLabel + " ← " + subLabel, total, done));
            grandTotal += total; grandDone += done; cardCount++;
        });

        if (cardCount > 1) {
            wrapper.appendChild(makeStatCard("📊 الإجمالي الكلي", "مجموع المقاولين المحددين", grandTotal, grandDone, true));
        }

    } else {
        /* ── الوضع العادي: الترتيب: مقاولون → معدات → إجماليات البنود → الإجمالي الكلي ── */

        // 1. اجمع كل البيانات اللازمة أولاً
        const activeSheetIds = [];
        const catCards = []; // {el, total, done}

        categories.forEach(cat => {
            const activeSubs = cat.subitems.filter(s => selectedItems[s.id] && allData[s.sheetId]);
            if (!activeSubs.length) return;
            let catTotal = 0, catDone = 0;

            activeSubs.forEach(sub => {
                const { total, done } = calcSubTotals(sub);
                catTotal += total; catDone += done;
                activeSheetIds.push(sub.sheetId);
            });
            catCards.push({
                el: makeStatCard(
                    cat.emoji + " " + cat.name,
                    activeSubs.map(s => s.name).join(" + "),
                    catTotal, catDone
                ),
                total: catTotal,
                done: catDone
            });
            grandTotal += catTotal; grandDone += catDone; cardCount++;
        });

        // 2. أنشئ اسم البند
        const activeNames = categories.flatMap(c => c.subitems)
            .filter(s => selectedItems[s.id])
            .map(s => s.name.trim());
        const subLabel = [...new Set(activeNames)].join(' و ') || "البند المحدد";

        // 3. أضف كارت المقاولين أولاً
        if (activeSheetIds.length) {
            const cCard = makeContractorsCard(activeSheetIds, subLabel);
            if (cCard) wrapper.appendChild(cCard);
        }

        // 4. أضف كارت المعدات ثانياً
        if (activeSheetIds.length) {
            const eCard = makeEquipmentCard(activeSheetIds, subLabel);
            if (eCard) wrapper.appendChild(eCard);
        }

        // 5. أضف كروت إجماليات البنود
        catCards.forEach(c => wrapper.appendChild(c.el));

        // 6. أضف الإجمالي الكلي أخيراً إن وُجد أكثر من بند
        if (cardCount > 1) {
            wrapper.appendChild(makeStatCard("📊 الإجمالي الكلي", "مجموع جميع البنود", grandTotal, grandDone, true));
        }
    }

    // Progress ring
    updateProgressRing(grandTotal, grandDone);

    sessionStorage.setItem("selectedStatuses", JSON.stringify(selectedStatuses));
    sessionStorage.setItem("selectedItems",    JSON.stringify(selectedItems));
    sessionStorage.setItem("sessionTime",      Date.now().toString());
}

/* ====================================================
   LAYER STYLE
   ==================================================== */

function featureStyle(row) {
    const st  = (row["STATUS"]||"").trim().toLowerCase();
    const ok  = selectedStatuses.some(s => s.toLowerCase() === st);
    const col = ok ? statusColor(row["STATUS"]) : "#cccccc";
    return { color: col, fillColor: col, fillOpacity: ok ? 0.6 : 0.15, weight: ok ? 2 : 1 };
}

function refreshLayerColors() {
    if (activeContractorFilter && activeContractorFilter.size > 0) {
        applyContractorFilter();
    } else {
        Object.entries(allLayers).forEach(([sheetId, layer]) => {
            if (!layer || !allData[sheetId]) return;
            layer.eachLayer(f => {
                const row = allData[sheetId][f.feature.properties.ID];
                if (row) f.setStyle(featureStyle(row));
            });
        });
    }
}

/* ====================================================
   FLASH EFFECT (for search highlight)
   ==================================================== */

function flashLayer(leafletLayer) {
    if (!leafletLayer || typeof leafletLayer.setStyle !== 'function') return;
    const origStyle = {
        color: leafletLayer.options.color,
        fillColor: leafletLayer.options.fillColor,
        weight: leafletLayer.options.weight
    };
    const flashColor = '#ffffff';
    let count = 0;
    const interval = setInterval(() => {
        if (count % 2 === 0) {
            leafletLayer.setStyle({ color: flashColor, fillColor: flashColor, weight: 4 });
        } else {
            leafletLayer.setStyle(origStyle);
        }
        count++;
        if (count >= 6) {
            clearInterval(interval);
            leafletLayer.setStyle(origStyle);
        }
    }, 250);
}

/* ====================================================
   LOAD / REMOVE LAYER
   ==================================================== */

// Per-sheetId load token — prevents stale async responses from adding old layers
const loadTokens = {};

function loadLayer(sheetId, subitemName, geoJsonFile, catId) {
    // Generate a unique token for THIS load request
    const token = Date.now() + '_' + Math.random();
    loadTokens[sheetId] = token;

    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;

    fetch(csvUrl)
        .then(r => r.text())
        .then(csv => {
            // ── STALE CHECK 1: was a newer load started for this sheet? ──
            if (loadTokens[sheetId] !== token) return;
            // ── STALE CHECK 2: is this sheetId still wanted? ──
            const isWanted = () =>
                categories.flatMap(c => c.subitems).some(s => s.sheetId === sheetId && selectedItems[s.id])
                || [...activeContractorFilter].some(k => k.startsWith(sheetId + '|'));
            if (!isWanted()) return;

            const data  = {};
            const lines = csv.split('\n').filter(l => l.trim());
            if (!lines.length) return;
            const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
            const idIdx   = headers.findIndex(h => h === 'ID');
            if (idIdx === -1) { showAlert("❌ لا يوجد عمود ID في الشيت"); return; }

            for (let i = 1; i < lines.length; i++) {
                const vals = lines[i].split(',').map(v => v.trim());
                if (!vals[idIdx]) continue;
                const id = vals[idIdx];
                data[id] = {};
                headers.forEach((h, idx) => { data[id][h] = vals[idx] || ""; });
            }

            allData[sheetId] = data;

            return fetch(geoJsonFile + "?t=" + Date.now()).then(r => r.json()).then(geo => {
                // ── STALE CHECK 3: final guard before touching the map ──
                if (loadTokens[sheetId] !== token) return;
                if (!isWanted()) { delete allData[sheetId]; return; }

                // If a previous layer for this sheet is still on the map, remove it first
                if (allLayers[sheetId]) {
                    map.removeLayer(allLayers[sheetId]);
                    delete allLayers[sheetId];
                }

                const layer = L.geoJSON(geo, {
                    onEachFeature: (f, l) => {
                        const id      = f.properties.ID;
                        const row     = data[id];
                        if (!row) return;

                        const nameKey = row["ROAD NAME"] ? "ROAD NAME" : row["BLOCK NAME"] ? "BLOCK NAME" : "NAME";
                        const name    = row[nameKey] || "بدون اسم";
                        allFeatures[`${sheetId}-${name}`] = l;

                        l.setStyle(featureStyle(row));

                        let html = `<div class="popup-card"><div class="popup-header">
                            <div class="popup-title">مشروع ولي العهد</div>
                            <div class="popup-subtitle">${subitemName}</div>
                        </div><div class="popup-body">`;

                        Object.keys(row).forEach(k => {
                            if (k === "ID") return;
                            const isSt = k === "STATUS";
                            const cls  = isSt ? `status ${statusCls(row[k])}` : "";
                            const val  = isSt ? row[k] : fmtNum(row[k]);
                            html += `<div class="popup-row">
                                <div class="popup-label">${LABELS[k]||k}</div>
                                <div class="popup-value ${cls}">${val}</div>
                            </div>`;
                        });

                        html += `<div class="popup-row">
                            <div class="popup-label">المعدات</div>
                            <div class="popup-value">${equipmentData[id]||"غير محدد"}</div>
                        </div></div></div>`;

                        l.bindPopup(html);
                        l.on('click', () => l.openPopup());
                    }
                });

                allLayers[sheetId] = layer;
                layer.addTo(map);

                if (defaultCoords) {
                    map.setView([defaultCoords.lat, defaultCoords.lng], defaultCoords.zoom);
                }

                updateStats();
                if (activeContractorFilter && activeContractorFilter.size > 0) {
                    applyContractorFilter();
                }
                // تحديث واجهة المقاولين فقط بدون إعادة تحميل البيانات
                if (contractorsLoaded) renderContractorList();
                else buildContractorPanel();
            });
        })
        .catch(e => { console.error(e); showAlert("❌ خطأ في تحميل البيانات"); });
}

function removeLayer(sheetId) {
    // Invalidate any in-flight load for this sheet
    loadTokens[sheetId] = null;
    if (allLayers[sheetId]) { map.removeLayer(allLayers[sheetId]); delete allLayers[sheetId]; }
    delete allData[sheetId];
    if (activeContractorFilter) {
        [...activeContractorFilter].forEach(k => { if (k.startsWith(sheetId + '|')) activeContractorFilter.delete(k); });
    }
    updateStats();
    renderContractorList();
}

/* ====================================================
   NAV TABS (top navigation tabs per category)
   ==================================================== */

/* ── بناء قوائم البنود — يُستدعى مرة واحدة أو عند تغيير هيكل الكاتيغوريز ── */
function buildNavTabs() {
    const tabsEl = document.getElementById("navTabs");
    document.querySelectorAll('.bunood-sub-flyout').forEach(el => el.remove());
    const oldMainDd = document.getElementById('bunoodMainDd');
    if (oldMainDd) oldMainDd.remove();
    tabsEl.innerHTML = "";

    if (!categories.length) return;

    const tab = document.createElement("div");
    tab.className = "nav-tab nav-tab-bunood";
    tab.id = "navTabBunood";
    tab.innerHTML = `<span>📋 البنود</span>`;
    tabsEl.appendChild(tab);

    const mainDd = document.createElement("div");
    mainDd.className = "tab-sub-dropdown bunood-main-dd";
    mainDd.id = "bunoodMainDd";
    document.body.appendChild(mainDd);

    categories.forEach(cat => {
        const catRow = document.createElement("div");
        catRow.className = "bunood-cat-row";
        catRow.dataset.catId = cat.id;
        catRow.innerHTML = `
            <span class="bunood-cat-label">${cat.emoji} ${cat.number ? '<span style="font-size:9px;opacity:0.65;margin-left:3px;">['+cat.number+']</span>' : ''} ${cat.name}</span>
            <span class="bunood-cat-arrow">&#x25B6;</span>`;

        const subDd = document.createElement("div");
        subDd.className = "bunood-sub-flyout";
        subDd.id = "bunoodSub_" + cat.id;
        document.body.appendChild(subDd);

        if (cat.subitems.length) {
            cat.subitems.forEach(sub => {
                const subRow = document.createElement("div");
                subRow.className = "tab-sub-item bunood-sub-item";
                subRow.innerHTML = `
                    <input type="checkbox" id="tabcb_${sub.id}"
                        data-sub-id="${sub.id}"
                        data-cat-id="${cat.id}"
                        data-sheet="${sub.sheetId}"
                        data-geo="${sub.geoJsonFile}">
                    <label for="tabcb_${sub.id}">
                        ${sub.number ? `<span style="font-size:9px;opacity:0.6;margin-left:4px;">${sub.number}</span>` : ''}
                        ${sub.name}
                    </label>`;
                subRow.querySelector('input').addEventListener('change', function(e) {
                    e.stopPropagation();
                    handleSubitemToggle(this.dataset.catId, this.dataset.subId, this.dataset.sheet, this.dataset.geo, this.checked);
                });
                subDd.appendChild(subRow);
            });
        } else {
            subDd.innerHTML = '<div style="padding:10px 14px;color:#aaa;font-size:11px;text-align:right">لا توجد بنود فرعية</div>';
        }

        catRow.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = catRow.classList.contains('bunood-cat-open');
            document.querySelectorAll('.bunood-sub-flyout').forEach(d => d.style.display = 'none');
            mainDd.querySelectorAll('.bunood-cat-row').forEach(r => r.classList.remove('bunood-cat-open'));
            if (!isOpen) {
                catRow.classList.add('bunood-cat-open');
                const catRect  = catRow.getBoundingClientRect();
                const mainRect = mainDd.getBoundingClientRect();
                subDd.style.display = 'flex';
                subDd.style.top = catRect.top + 'px';
                const subW = 230;
                const spaceRight = window.innerWidth - mainRect.right;
                if (spaceRight >= subW) {
                    subDd.style.left  = mainRect.right + 'px';
                    subDd.style.right = 'auto';
                } else {
                    subDd.style.right = (window.innerWidth - mainRect.left) + 'px';
                    subDd.style.left  = 'auto';
                }
            }
        });

        subDd.addEventListener('click', e => e.stopPropagation());
        mainDd.appendChild(catRow);
    });

    tab.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = mainDd.style.display === 'flex';
        document.querySelectorAll('.bunood-sub-flyout').forEach(d => d.style.display = 'none');
        mainDd.querySelectorAll('.bunood-cat-row').forEach(r => r.classList.remove('bunood-cat-open'));
        if (isOpen) {
            mainDd.style.display = 'none';
        } else {
            const rect = tab.getBoundingClientRect();
            mainDd.style.left  = rect.left + 'px';
            mainDd.style.right = 'auto';
            mainDd.style.display = 'flex';
            setTimeout(() => {
                const ddRect = mainDd.getBoundingClientRect();
                if (ddRect.right > window.innerWidth - 8) {
                    mainDd.style.left = 'auto';
                    mainDd.style.right = (window.innerWidth - rect.right) + 'px';
                }
            }, 0);
        }
    });

    mainDd.addEventListener('click', e => e.stopPropagation());

    // مستمع إغلاق عند الكليك خارج — مرة واحدة فقط
    if (!window._bunoodClickListenerAdded) {
        window._bunoodClickListenerAdded = true;
        document.addEventListener('click', () => {
            const md = document.getElementById('bunoodMainDd');
            if (md) md.style.display = 'none';
            document.querySelectorAll('.bunood-sub-flyout').forEach(d => d.style.display = 'none');
            document.querySelectorAll('.bunood-cat-row').forEach(r => r.classList.remove('bunood-cat-open'));
        });
    }

    // تحديث الحالة بعد البناء
    updateNavTabsState();
}

/* ── تحديث الشيك بوكسات والألوان فقط بدون إعادة بناء ── */
function updateNavTabsState() {
    const tab = document.getElementById('navTabBunood');
    if (!tab) return;

    const hasAnyActive = categories.some(cat => cat.subitems.some(s => selectedItems[s.id]));
    tab.classList.toggle('active', hasAnyActive);

    categories.forEach(cat => {
        const catHasActive = cat.subitems.some(s => selectedItems[s.id]);
        const catRow = document.querySelector(`.bunood-cat-row[data-cat-id="${cat.id}"]`);
        if (catRow) catRow.classList.toggle('bunood-cat-active', catHasActive);

        cat.subitems.forEach(sub => {
            const cb = document.getElementById('tabcb_' + sub.id);
            if (cb) cb.checked = !!selectedItems[sub.id];
        });
    });
}

/* ── renderNavTabs: إعادة بناء كاملة فقط عند تغيير هيكل الكاتيغوريز ── */
function renderNavTabs() {
    buildNavTabs();
}

/* ONE SUBITEM GLOBALLY — but allow subitems in the SAME similar-group to coexist.
   Subitems from different groups (or ungrouped) cannot be selected together. */
function handleSubitemToggle(catId, subId, sheetId, geoFile, checked) {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;

    if (checked) {
        // ── Determine the group of the subitem being selected ──
        const myGroup = getGroupForSub(subId);

        // ── Check conflict with currently selected items ──
        const alreadySelected = Object.keys(selectedItems);
        let conflict = false;
        let conflictMsg = '';

        for (const selId of alreadySelected) {
            if (selId === subId) continue;
            const selGroup = getGroupForSub(selId);

            // Conflict: one is grouped + other is in different group, or one is ungrouped
            if (!myGroup || !selGroup || myGroup.id !== selGroup.id) {
                // Find name for conflict message
                let selName = selId;
                categories.forEach(c => { const s = c.subitems.find(s => s.id === selId); if(s) selName = s.name; });
                conflict = true;
                conflictMsg = myGroup
                    ? `"${cat.subitems.find(s=>s.id===subId)?.name}" و "${selName}" في مجموعات مختلفة — لا يمكن الجمع بينهما`
                    : `لا يمكن الجمع بين بندين غير متشابهين`;
                break;
            }
        }

        if (conflict) {
            // Deselect everything and start fresh with this subitem
            // But first ask implicitly by clearing others and selecting this one
            const allSubItems = categories.flatMap(c => c.subitems);
            Object.keys(selectedItems).forEach(selSubId => {
                if (selSubId === subId) return;
                const selSub = allSubItems.find(s => s.id === selSubId);
                if (!selSub) { delete selectedItems[selSubId]; return; }
                loadTokens[selSub.sheetId] = null;
                if (allLayers[selSub.sheetId]) { map.removeLayer(allLayers[selSub.sheetId]); delete allLayers[selSub.sheetId]; }
                delete allData[selSub.sheetId];
                delete selectedItems[selSubId];
            });
        }

        // 1. وقف أي فلتر مقاول نشط
        if (activeContractorFilter.size > 0) {
            const contractorSheets = new Set([...activeContractorFilter].map(k => k.split('|')[0]));
            activeContractorFilter.clear();
            contractorSheets.forEach(sid => {
                const usedBySidebar = categories.flatMap(c => c.subitems)
                    .some(s => s.sheetId === sid && selectedItems[s.id]);
                if (!usedBySidebar) {
                    loadTokens[sid] = null;
                    if (allLayers[sid]) { map.removeLayer(allLayers[sid]); delete allLayers[sid]; }
                    delete allData[sid];
                }
            });
        }

        // 2. اختر هذا البند وحمل طبقته
        selectedItems[subId] = true;
        const sub = cat.subitems.find(s => s.id === subId);
        if (sub) loadLayer(sheetId, sub.name, geoFile, catId);

    } else {
        delete selectedItems[subId];
        removeLayer(sheetId);
        refreshLayerColors();
    }

    renderItems();
    updateNavTabsState();
    updateStats();
    syncContractorCheckboxes();
}

/* ====================================================
   RENDER SIDEBAR ITEMS
   ==================================================== */

function renderItems() {
    const section = document.getElementById("itemsSection");
    section.innerHTML = "";
    const isAdmin = currentUser && currentUser.isAdmin;

    categories.forEach(cat => {
        const div = document.createElement("div");
        div.className = "sidebar-section";
        div.dataset.catId = cat.id;

        // عنوان البند الرئيسي: رقم البند + الاسم
        const catLabel = (cat.number ? `<span style="font-size:9px;opacity:0.7;margin-left:3px;background:rgba(255,255,255,0.15);padding:1px 5px;border-radius:4px;">${cat.number}</span>` : '') + cat.emoji + ' ' + cat.name;

        div.innerHTML = `
            <div class="section-title">
                <button class="expand-btn" data-cat="${cat.id}">+</button>
                <span class="section-title-text">${catLabel}</span>
                ${isAdmin ? `<button class="del-cat-btn admin-only" onclick="deleteCategory('${cat.id}')">✕</button>` : ""}
            </div>
            <div class="dropdown-items" data-cat="${cat.id}">
                ${cat.subitems.map(sub => {
                    // رقم البند الفرعي
                    const numBadge = sub.number
                        ? `<span style="font-size:9px;font-weight:700;color:var(--purple);background:rgba(106,45,145,0.1);padding:1px 5px;border-radius:4px;flex-shrink:0;border:1px solid rgba(106,45,145,0.2);">${sub.number}</span>`
                        : '';
                    // مؤشر بيانات مفقودة (شيت أو geo فارغ)
                    const missingData = !sub.sheetId || !sub.geoJsonFile;
                    const warningIcon = (isAdmin && missingData)
                        ? `<span title="بيانات مفقودة — دبل كليك للتعديل" style="color:#ff9800;font-size:11px;flex-shrink:0;">⚠️</span>`
                        : '';
                    return `
                    <div class="dropdown-item ${selectedItems[sub.id]?'selected':''}" data-sub="${sub.id}"
                         ${isAdmin ? `title="دبل كليك لتعديل البند"` : ''}>
                        <input type="checkbox" class="subitem-cb"
                            data-sub-id="${sub.id}"
                            data-cat-id="${cat.id}"
                            data-sheet="${sub.sheetId}"
                            data-geo="${sub.geoJsonFile}"
                            ${selectedItems[sub.id]?'checked':''}>
                        ${numBadge}
                        <label style="flex:1">${sub.name}</label>
                        ${warningIcon}
                        ${isAdmin ? `<button class="del-sub-btn admin-only" onclick="deleteSubitem('${cat.id}','${sub.id}')">✕</button>` : ""}
                    </div>`;
                }).join('')}
                ${isAdmin ? `<div class="add-sub-row admin-only" onclick="openAddSubitemModalFor('${cat.id}')">+ إضافة فرعي</div>` : ""}
            </div>`;

        section.appendChild(div);

        div.querySelector(".expand-btn").addEventListener("click", function() {
            this.classList.toggle("active");
            div.querySelector(".dropdown-items").classList.toggle("active");
        });

        div.querySelectorAll(".subitem-cb").forEach(cb => {
            cb.addEventListener("change", function() {
                handleSubitemToggle(this.dataset.catId, this.dataset.subId, this.dataset.sheet, this.dataset.geo, this.checked);
            });
        });

        // دبل كليك على البند الفرعي — للأدمن فقط
        if (isAdmin) {
            div.querySelectorAll(".dropdown-item[data-sub]").forEach(item => {
                item.addEventListener("dblclick", function(e) {
                    // تجاهل الدبل كليك على الأزرار
                    if (e.target.closest('.del-sub-btn') || e.target.closest('.subitem-cb')) return;
                    const subId = this.dataset.sub;
                    openEditSubitemModal(cat.id, subId);
                });
            });
        }
    });

    // Update modal select
    const sel = document.getElementById("inSubCat");
    if (sel) {
        sel.innerHTML = '<option value="">-- اختر --</option>';
        categories.forEach(c => {
            const o = document.createElement("option");
            o.value = c.id;
            o.textContent = (c.number ? `[${c.number}] ` : '') + c.name;
            sel.appendChild(o);
        });
    }
}

/* ====================================================
   ADD / DELETE — ADMIN ONLY
   ==================================================== */

function openAddCategoryModal() {
    document.getElementById("inCatNumber").value = "";
    document.getElementById("inCatName").value  = "";
    document.getElementById("inCatEmoji").value = "📍";
    openModal("modalAddCategory");
}

function addCategory() {
    const number = document.getElementById("inCatNumber").value.trim();
    const name   = document.getElementById("inCatName").value.trim();
    const emoji  = document.getElementById("inCatEmoji").value.trim() || "📍";
    if (!name) { showAlert("❌ يرجى إدخال اسم البند"); return; }
    categories.push({ id: uid(), number, name, emoji, subitems: [] });
    renderItems();
    renderNavTabs();
    closeModal("modalAddCategory");
    showAlert("✅ تمت إضافة البند الرئيسي", "success");
}

let _addSubForCat = null;

function openAddSubitemModal() {
    _addSubForCat = null;
    document.getElementById("inSubNumber").value = "";
    document.getElementById("inSubName").value  = "";
    document.getElementById("inSubSheet").value = "";
    document.getElementById("inSubGeo").value   = "";
    document.getElementById("inSubCat").value   = "";
    openModal("modalAddSubitem");
}

function openAddSubitemModalFor(catId) {
    _addSubForCat = catId;
    document.getElementById("inSubNumber").value = "";
    document.getElementById("inSubName").value  = "";
    document.getElementById("inSubSheet").value = "";
    document.getElementById("inSubGeo").value   = "";
    document.getElementById("inSubCat").value   = catId;
    openModal("modalAddSubitem");
}

function addSubitem() {
    const catId    = document.getElementById("inSubCat").value || _addSubForCat;
    const number   = document.getElementById("inSubNumber").value.trim();
    const name     = document.getElementById("inSubName").value.trim();
    const sheetRaw = document.getElementById("inSubSheet").value.trim();
    const geo      = document.getElementById("inSubGeo").value.trim();
    if (!catId || !name) { showAlert("❌ يرجى اختيار البند الرئيسي وإدخال الاسم"); return; }

    const cat = categories.find(c => c.id === catId);
    if (!cat) { showAlert("❌ البند غير موجود"); return; }

    // الشيت والـ GeoJSON اختياريان — يمكن إضافتهما لاحقاً عبر دبل كليك
    const sheetId = sheetRaw ? (sheetIdFromUrl(sheetRaw) || sheetRaw) : "";

    cat.subitems.push({ id: uid(), number, name, sheetId, geoJsonFile: geo });
    renderItems();
    renderNavTabs();
    closeModal("modalAddSubitem");
    showAlert("✅ تمت إضافة البند الفرعي" + (!sheetId || !geo ? " — أضف الشيت والـ GeoJSON لاحقاً بدبل كليك" : ""), "success");
}

function deleteCategory(catId) {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    if (!confirm(`حذف "${cat.name}" وجميع بنوده الفرعية؟`)) return;
    cat.subitems.forEach(sub => { delete selectedItems[sub.id]; removeLayer(sub.sheetId); });
    categories = categories.filter(c => c.id !== catId);
    renderItems();
    renderNavTabs();
    updateStats();
    showAlert("✅ تم الحذف", "success");
}

function deleteSubitem(catId, subId) {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    const sub = cat.subitems.find(s => s.id === subId);
    if (!sub) return;
    if (!confirm(`حذف "${sub.name}"؟`)) return;
    delete selectedItems[subId];
    removeLayer(sub.sheetId);
    cat.subitems = cat.subitems.filter(s => s.id !== subId);
    renderItems();
    renderNavTabs();
    updateStats();
    showAlert("✅ تم الحذف", "success");
}

/* ====================================================
   EDIT SUBITEM (double-click — admin only)
   ==================================================== */

function openEditSubitemModal(catId, subId) {
    if (!currentUser || !currentUser.isAdmin) return;
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    const sub = cat.subitems.find(s => s.id === subId);
    if (!sub) return;

    document.getElementById("editSubCatId").value    = catId;
    document.getElementById("editSubId").value       = subId;
    document.getElementById("editSubNumber").value   = sub.number || "";
    document.getElementById("editSubName").value     = sub.name   || "";
    document.getElementById("editSubGeo").value      = sub.geoJsonFile || "";
    document.getElementById("editSubScriptUrl").value = sub.scriptUrl || "";

    // Sheet: show full URL if sheetId looks like an ID, else show as-is
    const sheetVal = sub.sheetId || "";
    const sheetUrl = sheetVal.startsWith('http')
        ? sheetVal
        : `https://docs.google.com/spreadsheets/d/${sheetVal}`;
    document.getElementById("editSubSheet").value = sheetUrl;

    // Show "فتح الشيت" link
    const linkEl = document.getElementById("editSubSheetLink");
    if (sheetVal) {
        linkEl.href = sheetUrl;
        linkEl.style.display = "inline-flex";
        linkEl.style.alignItems = "center";
        linkEl.style.gap = "4px";
    } else {
        linkEl.style.display = "none";
    }

    // Update link when URL changes
    document.getElementById("editSubSheet").oninput = function() {
        const v = this.value.trim();
        const id = sheetIdFromUrl(v) || v;
        if (id) {
            linkEl.href = v.startsWith('http') ? v : `https://docs.google.com/spreadsheets/d/${id}`;
            linkEl.style.display = "inline-flex";
            linkEl.style.alignItems = "center";
            linkEl.style.gap = "4px";
        } else {
            linkEl.style.display = "none";
        }
    };

    openModal("modalEditSubitem");
}

function saveSubitemEdit() {
    const catId    = document.getElementById("editSubCatId").value;
    const subId    = document.getElementById("editSubId").value;
    const number    = document.getElementById("editSubNumber").value.trim();
    const name      = document.getElementById("editSubName").value.trim();
    const sheetRaw  = document.getElementById("editSubSheet").value.trim();
    const geo       = document.getElementById("editSubGeo").value.trim();
    const scriptUrl = document.getElementById("editSubScriptUrl").value.trim();

    if (!name || !sheetRaw || !geo) { showAlert("❌ يرجى ملء الاسم والشيت والـ GeoJSON"); return; }

    const sheetId = sheetIdFromUrl(sheetRaw) || sheetRaw;
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    const sub = cat.subitems.find(s => s.id === subId);
    if (!sub) return;

    const oldSheetId = sub.sheetId;
    const sheetChanged = oldSheetId !== sheetId;
    const geoChanged = sub.geoJsonFile !== geo;

    sub.number      = number;
    sub.name        = name;
    sub.sheetId     = sheetId;
    sub.geoJsonFile = geo;
    sub.scriptUrl   = scriptUrl;

    // إذا تغير الشيت أو الـ GeoJSON وكانت الطبقة محملة، أعد تحميلها
    if ((sheetChanged || geoChanged) && selectedItems[subId]) {
        loadTokens[oldSheetId] = null;
        if (allLayers[oldSheetId]) { map.removeLayer(allLayers[oldSheetId]); delete allLayers[oldSheetId]; }
        delete allData[oldSheetId];
        loadLayer(sheetId, name, geo, catId);
    }

    renderItems();
    renderNavTabs();
    closeModal("modalEditSubitem");
    showAlert("✅ تم حفظ التعديلات", "success");
}

/* ====================================================
   STATUS LEGEND CHECKBOXES
   ==================================================== */

document.querySelectorAll(".status-checkbox").forEach(cb => {
    cb.addEventListener("change", function() {
        const st = this.dataset.status;
        if (this.checked) { if (!selectedStatuses.includes(st)) selectedStatuses.push(st); }
        else              { selectedStatuses = selectedStatuses.filter(s => s !== st); }
        refreshLayerColors();
        updateStats();
    });
});

/* ====================================================
   SEARCH — no zoom, use defaultCoords, flash + popup
   ==================================================== */

function positionDropdown() {
    const dd  = document.getElementById("searchDropdown");
    const box = document.querySelector(".search-wrap");
    if (!box || !dd.classList.contains("active")) return;
    const r = box.getBoundingClientRect();
    dd.style.top   = r.bottom + "px";
    dd.style.left  = r.left   + "px";
    dd.style.width = r.width  + "px";
    dd.style.right = "auto";
}

function updateSearchDropdown() {
    const dd    = document.getElementById("searchDropdown");
    const input = document.getElementById("searchInput");
    const q     = input.value.trim().toLowerCase();
    dd.innerHTML = "";

    if (!q) { dd.classList.remove("active"); return; }

    const results = [];
    Object.entries(allData).forEach(([sheetId, data]) => {
        Object.values(data).forEach(row => {
            const name = (row["ROAD NAME"]||row["BLOCK NAME"]||row["NAME"]||"").trim().toLowerCase();
            if (name.includes(q)) {
                const dispName = row["ROAD NAME"]||row["BLOCK NAME"]||row["NAME"]||"بدون اسم";
                results.push({ name: dispName, status: row["STATUS"]||"", key: `${sheetId}-${dispName}` });
            }
        });
    });

    if (!results.length) {
        dd.innerHTML = "<div style='padding:10px;text-align:right;color:#999;font-size:12px'>لا توجد نتائج</div>";
    } else {
        results.forEach(item => {
            const el = document.createElement("div");
            el.className = "search-item";
            el.innerHTML = `
                <span class="search-badge" style="background:${statusColor(item.status)}">${item.status||"-"}</span>
                <div class="search-item-name">${item.name}</div>`;
            el.addEventListener("click", () => {
                const layer = allFeatures[item.key];
                if (layer) {
                    // Use default coords zoom (no fitBounds)
                    if (map && defaultCoords) {
                        map.setView([defaultCoords.lat, defaultCoords.lng], defaultCoords.zoom);
                    }
                    // Flash the layer then open popup
                    setTimeout(() => {
                        flashLayer(layer);
                        setTimeout(() => layer.openPopup(), 700);
                    }, 100);
                }
                input.value = "";
                dd.classList.remove("active");
            });
            dd.appendChild(el);
        });
    }

    dd.classList.add("active");
    positionDropdown();
}

document.getElementById("searchInput").addEventListener("input", updateSearchDropdown);
window.addEventListener("resize", () => { if (map) map.invalidateSize(); positionDropdown(); });

/* ====================================================
   CLOSE MODALS ON BACKDROP CLICK
   ==================================================== */

document.querySelectorAll(".modal").forEach(m => {
    m.addEventListener("click", e => { if (e.target === m) m.classList.remove("active"); });
});

/* ====================================================
   DRAG & DROP — ADMIN ONLY
   Supports: Nav Tabs (categories), Sidebar Items (subitems within cat), Status Legend,
             Nav-Right Icons (contractors, equipment, notifications, themes, coords, user)
   ==================================================== */

/* ── Silent in-memory save (no download, no GitHub, no prompts) ── */
async function saveConfigToFile(silent = true) {
    // This function now only updates the in-memory state.
    // To export categories.json, use exportConfig() manually.
    return true;
}

/* ── CSS for drag states (injected once) ── */
(function injectDragCSS() {
    const style = document.createElement('style');
    style.textContent = `
        /* Drag handle indicator for admin */
        body.is-admin .nav-tab          { cursor: grab; }
        body.is-admin .sidebar-section  { cursor: grab; }
        body.is-admin .dropdown-item    { cursor: grab; }
        body.is-admin .legend-item      { cursor: grab; }
        body.is-admin .nav-right > div  { cursor: grab; }

        .drag-dragging {
            opacity: 0.38;
            transform: scale(0.97);
            transition: opacity 0.15s, transform 0.15s;
        }
        .drag-over-top {
            border-top: 2.5px solid var(--gold) !important;
        }
        .drag-over-bottom {
            border-bottom: 2.5px solid var(--gold) !important;
        }
        .drag-over-left {
            border-left: 2.5px solid var(--gold) !important;
        }
        .drag-over-right {
            border-right: 2.5px solid var(--gold) !important;
        }
        .drag-ghost {
            position: fixed;
            z-index: 999999;
            pointer-events: none;
            background: var(--white, white);
            border: 2px solid var(--gold, #f5c842);
            border-radius: 8px;
            padding: 6px 14px;
            font-family: 'Cairo', sans-serif;
            font-size: 12px;
            font-weight: 700;
            color: var(--text, #2a1a40);
            box-shadow: 0 8px 28px rgba(0,0,0,0.25);
            white-space: nowrap;
            max-width: 240px;
            overflow: hidden;
            text-overflow: ellipsis;
            opacity: 0.92;
        }
        /* Drag handle icon shown on hover for admin */
        body.is-admin .nav-tab::before,
        body.is-admin .sidebar-section > .section-title::before,
        body.is-admin .dropdown-item::before,
        body.is-admin .legend-item::before,
        body.is-admin .nav-right > div > .nav-icon-btn::before,
        body.is-admin .nav-right > div > .user-chip::before {
            content: '⠿';
            font-size: 13px;
            opacity: 0;
            transition: opacity 0.2s;
            margin-left: 4px;
            color: var(--gold, #f5c842);
            flex-shrink: 0;
        }
        body.is-admin .nav-tab:hover::before,
        body.is-admin .sidebar-section:hover > .section-title::before,
        body.is-admin .dropdown-item:hover::before,
        body.is-admin .legend-item:hover::before,
        body.is-admin .nav-right > div:hover > .nav-icon-btn::before,
        body.is-admin .nav-right > div:hover > .user-chip::before {
            opacity: 0.7;
        }
    `;
    document.head.appendChild(style);
})();

/* ── Ghost element ── */
let dragGhost = null;

function createGhost(text) {
    removeGhost();
    dragGhost = document.createElement('div');
    dragGhost.className = 'drag-ghost';
    dragGhost.textContent = text;
    document.body.appendChild(dragGhost);
}

function moveGhost(x, y) {
    if (!dragGhost) return;
    dragGhost.style.left = (x + 16) + 'px';
    dragGhost.style.top  = (y + 10) + 'px';
}

function removeGhost() {
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
}

/* ── Generic drag-and-drop for an ordered list ──
   items: array of DOM elements
   getKey(el): returns unique key for the element
   onReorder(newOrder): called with new ordered keys array
   options: { silent: true/false, horizontal: true/false }
*/
function makeDraggable(items, getKey, onReorder, getLabel, options = {}) {
    if (!currentUser || !currentUser.isAdmin) return;

    const isHorizontal = options.horizontal || false;
    const silent = options.silent !== false; // default true

    let draggingEl   = null;
    let draggingKey  = null;
    let overEl       = null;
    let overPosition = null; // 'top' | 'bottom' | 'left' | 'right'

    function clearOver() {
        if (overEl) {
            overEl.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-left', 'drag-over-right');
            overEl = null;
        }
    }

    items.forEach(el => {
        el.draggable = true;

        el.addEventListener('dragstart', e => {
            draggingEl  = el;
            draggingKey = getKey(el);
            el.classList.add('drag-dragging');
            const label = getLabel ? getLabel(el) : (el.textContent.trim().slice(0, 30));
            createGhost(label);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setDragImage(new Image(), 0, 0); // hide default ghost
        });

        el.addEventListener('drag', e => {
            if (e.clientX || e.clientY) moveGhost(e.clientX, e.clientY);
        });

        el.addEventListener('dragend', () => {
            draggingEl  = null;
            draggingKey = null;
            el.classList.remove('drag-dragging');
            clearOver();
            removeGhost();
        });

        el.addEventListener('dragover', e => {
            e.preventDefault();
            if (el === draggingEl) return;
            const rect   = el.getBoundingClientRect();
            let newPos;
            if (isHorizontal) {
                const midX = rect.left + rect.width / 2;
                newPos = e.clientX < midX ? 'left' : 'right';
            } else {
                const midY = rect.top + rect.height / 2;
                newPos = e.clientY < midY ? 'top' : 'bottom';
            }
            if (overEl !== el || overPosition !== newPos) {
                clearOver();
                overEl       = el;
                overPosition = newPos;
                el.classList.add('drag-over-' + newPos);
            }
            e.dataTransfer.dropEffect = 'move';
        });

        el.addEventListener('dragleave', e => {
            if (!el.contains(e.relatedTarget)) clearOver();
        });

        el.addEventListener('drop', e => {
            e.preventDefault();
            if (!draggingKey || el === draggingEl) { clearOver(); return; }
            const targetKey = getKey(el);
            clearOver();

            // Build new order
            const keys    = items.map(i => getKey(i));
            const fromIdx = keys.indexOf(draggingKey);
            const toIdx   = keys.indexOf(targetKey);
            if (fromIdx === -1 || toIdx === -1) return;

            const newKeys = [...keys];
            newKeys.splice(fromIdx, 1);

            let adjustedInsert;
            if (isHorizontal) {
                adjustedInsert = overPosition === 'left'
                    ? (fromIdx < toIdx ? toIdx - 1 : toIdx)
                    : (fromIdx < toIdx ? toIdx : toIdx + 1);
            } else {
                adjustedInsert = overPosition === 'top'
                    ? (fromIdx < toIdx ? toIdx - 1 : toIdx)
                    : (fromIdx < toIdx ? toIdx : toIdx + 1);
            }
            newKeys.splice(adjustedInsert, 0, draggingKey);

            onReorder(newKeys);
        });
    });
}

/* ── 1. NAV TABS (category order) ── */
function initNavTabsDrag() {
    // تاب البنود الآن عنصر واحد فقط — الترتيب يتم عبر السايدبار
}

/* ── 2. SIDEBAR SECTIONS (category order, same as tabs) ── */
function initSidebarSectionsDrag() {
    if (!currentUser || !currentUser.isAdmin) return;
    const section = document.getElementById('itemsSection');
    if (!section) return;

    const items = [...section.querySelectorAll('.sidebar-section')];
    makeDraggable(
        items,
        el => el.dataset.catId,
        newCatIds => {
            categories = newCatIds
                .map(id => categories.find(c => c.id === id))
                .filter(Boolean);
            renderItems();
            renderNavTabs();
            initSidebarSectionsDrag();
            initSubitemsDrag();
            saveConfigToFile(true); // silent save
        },
        el => el.querySelector('.section-title-text')?.textContent.trim().slice(0, 40) || '',
        { silent: true }
    );
}

/* ── 3. SUBITEMS within each sidebar section ── */
function initSubitemsDrag() {
    if (!currentUser || !currentUser.isAdmin) return;
    const section = document.getElementById('itemsSection');
    if (!section) return;

    section.querySelectorAll('.dropdown-items[data-cat]').forEach(container => {
        const catId  = container.dataset.cat;
        const cat    = categories.find(c => c.id === catId);
        if (!cat) return;

        const items = [...container.querySelectorAll('.dropdown-item[data-sub]')];
        if (items.length < 2) return;

        makeDraggable(
            items,
            el => el.dataset.sub,
            newSubIds => {
                cat.subitems = newSubIds
                    .map(id => cat.subitems.find(s => s.id === id))
                    .filter(Boolean);
                renderItems();
                renderNavTabs();
                initSidebarSectionsDrag();
                initSubitemsDrag();
                saveConfigToFile(true); // silent save
            },
            el => el.querySelector('label')?.textContent.trim().slice(0, 40) || '',
            { silent: true }
        );
    });
}

/* ── 4. STATUS LEGEND — DRAG DISABLED per user request ── */
function initLegendDrag() {
    // Legend drag & drop has been disabled.
    // Status order is fixed: جاري التنفيذ → متاح → غير متاح → تم الانتهاء → متوقف
}

/* ── 5. NAV-RIGHT GROUPS (Tools, Settings, User) ── */
function initNavRightDrag() {
    if (!currentUser || !currentUser.isAdmin) return;
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;

    // Get all group containers (nav-right-group) and dividers
    const groups = [...navRight.querySelectorAll('.nav-right-group')];
    if (groups.length < 2) return;

    makeDraggable(
        groups,
        el => el.id || el.querySelector('.nav-icon-btn')?.id || 'group',
        newOrder => {
            // Reorder groups in DOM
            newOrder.forEach(id => {
                const el = groups.find(g => (g.id || '') === id);
                if (el) {
                    // Move divider before this group if exists
                    const prev = el.previousElementSibling;
                    if (prev && prev.classList.contains('nav-right-divider')) {
                        navRight.appendChild(prev);
                    }
                    navRight.appendChild(el);
                }
            });
            saveConfigToFile(true); // silent save
        },
        el => {
            const firstBtn = el.querySelector('.nav-icon-btn');
            return firstBtn ? (firstBtn.title || firstBtn.id || 'مجموعة').slice(0, 40) : 'مجموعة';
        },
        { silent: true, horizontal: true }
    );

    // Also make individual buttons draggable WITHIN each group
    groups.forEach(group => {
        const items = [...group.querySelectorAll(':scope > div[position]')];
        if (items.length < 2) return;

        makeDraggable(
            items,
            el => {
                const btn = el.querySelector('.nav-icon-btn, .user-chip');
                return btn ? (btn.id || 'item') : 'item';
            },
            newOrder => {
                newOrder.forEach(key => {
                    const el = items.find(i => {
                        const btn = i.querySelector('.nav-icon-btn, .user-chip');
                        return btn && btn.id === key;
                    });
                    if (el) group.appendChild(el);
                });
                saveConfigToFile(true);
            },
            el => {
                const btn = el.querySelector('.nav-icon-btn, .user-chip');
                return btn ? (btn.title || btn.id || 'عنصر').slice(0, 40) : 'عنصر';
            },
            { silent: true, horizontal: true }
        );
    });
}

/* ── Hook: patch renderItems and renderNavTabs to re-init drag after render ── */
const _origRenderItems = renderItems;
window.renderItems = function() {
    _origRenderItems();
    setTimeout(() => {
        initSidebarSectionsDrag();
        initSubitemsDrag();
    }, 50);
};

const _origRenderNavTabs = renderNavTabs;
window.renderNavTabs = function() {
    _origRenderNavTabs();
};

/* ── Legend drag removed per user request ── */

// Also hook enterApp to init all drag systems after login
const _afterEnterApp = () => {
    setTimeout(() => {
        initNavTabsDrag();
        initSidebarSectionsDrag();
        initSubitemsDrag();
        initNavRightDrag();
    }, 600);
};

// Patch enterApp by wrapping it
(function() {
    const orig = window.enterApp;
    window.enterApp = async function() {
        await orig.apply(this, arguments);
        _afterEnterApp();
    };
})();
