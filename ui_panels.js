/* ============================================================
   ui_panels.js
   كل ما يخص إدارة الشاشات والـ panels والـ modals والـ dropdowns
   والموبايل مِن main.js — مُستخرَج في ملف مستقل.

   الترتيب في index.html:
       <script src="main.js"></script>
       ...باقي السكريبتات...
       <script src="ui_panels.js"></script>   ← آخر سكريبت

   ما يُحذف من main.js (استبدله بتعليق "// → ui_panels.js"):
   ─────────────────────────────────────────────────────────
   1. دالة togglePanel()                         (السطر ~87)
   2. مستمع "click" لإغلاق panels خارج nav-right (السطر ~112)
   3. مستمع "keydown" Escape                     (السطر ~1431)
   4. مستمع "input" على searchInput              (السطر ~2863)
   5. مستمع "resize" على window                 (السطر ~2864)
   6. مستمع backdrop لإغلاق .modal              (السطر ~2870)
   ============================================================ */

(function () {
    'use strict';

    /* ══════════════════════════════════════════════════════
       1. MOBILE DETECTION
       ══════════════════════════════════════════════════════ */
    function isMobile() { return window.innerWidth <= 1024; }


    /* ══════════════════════════════════════════════════════
       2. MOBILE MENU  (toggleMobileMenu / closeMobileMenu)
          الدالتان كانتا inline في index.html — نُعيد تعريفهما
          هنا حتى يمكن تغليفهما لاحقاً
       ══════════════════════════════════════════════════════ */
    window.toggleMobileMenu = function () {
        const m = document.getElementById('mobileMenu');
        const o = document.getElementById('mobileMenuOverlay');
        const b = document.getElementById('mobileMenuBtn');
        const open = m.style.display === 'flex';
        m.style.display = open ? 'none' : 'flex';
        o.style.display = open ? 'none' : 'block';
        b.innerHTML = open ? '☰' : '✕';
        b.style.background = open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.18)';
        // إغلاق أي panel مفتوح عند إغلاق القائمة
        if (open) _closeMobilePanelSheet();
    };

    window.closeMobileMenu = function () {
        const m = document.getElementById('mobileMenu');
        const o = document.getElementById('mobileMenuOverlay');
        const b = document.getElementById('mobileMenuBtn');
        if (m) m.style.display = 'none';
        if (o) o.style.display = 'none';
        if (b) { b.innerHTML = '☰'; b.style.background = 'rgba(255,255,255,0.07)'; }
        _closeMobilePanelSheet();
    };

    window.openPanelFromMobile = function (id, event) {
        if (event) {
            event.stopPropagation();   // منع انتشار النقر
            event.preventDefault();
        }
        // إغلاق القائمة أولاً
        closeMobileMenu();
        // انتظار حتى تختفي القائمة تماماً ثم فتح اللوحة
        window.setTimeout(() => {
            if (typeof togglePanel === 'function') togglePanel(id);
        }, 100);
    };


    /* ══════════════════════════════════════════════════════
       3. NAV-BAR DROPDOWNS (تقارير / إضافة)
       ══════════════════════════════════════════════════════ */
    function _getDropdown(id) { return document.getElementById(id); }

    function _openDropdown(ddId, triggerEl) {
        // أغلق الآخر أولاً
        ['reportsDropdown', 'addDropdown'].forEach(id => {
            if (id !== ddId) {
                const d = _getDropdown(id);
                if (d) d.style.display = 'none';
            }
        });
        const dd = _getDropdown(ddId);
        if (!dd) return;
        const isOpen = dd.style.display === 'flex';
        if (isOpen) { dd.style.display = 'none'; return; }

        // حدد الموضع
        if (triggerEl) {
            const rect = triggerEl.getBoundingClientRect();
            dd.style.position = 'fixed';
            dd.style.top      = rect.bottom + 'px';
            dd.style.right    = 'auto';
            // على الموبايل: عرض كامل من اليمين
            if (isMobile()) {
                dd.style.left  = '8px';
                dd.style.right = '8px';
                dd.style.width = 'auto';
            } else {
                dd.style.left = rect.left + 'px';
            }
        }
        dd.style.display = 'flex';
    }

    window.toggleReportsDropdown = function (e) {
        if (e) e.stopPropagation();
        _openDropdown('reportsDropdown', e && e.currentTarget);
    };
    window.closeReportsDropdown = function () {
        const d = _getDropdown('reportsDropdown');
        if (d) d.style.display = 'none';
    };

    window.toggleAddDropdown = function (e) {
        if (e) e.stopPropagation();
        _openDropdown('addDropdown', e && e.currentTarget);
    };
    window.closeAddDropdown = function () {
        const d = _getDropdown('addDropdown');
        if (d) d.style.display = 'none';
    };

    // إغلاق dropdowns عند الضغط خارجها
    document.addEventListener('click', function (e) {
        if (!e.target.closest('#navTabReports') && !e.target.closest('#reportsDropdown')) {
            window.closeReportsDropdown();
        }
        if (!e.target.closest('#navTabAdd') && !e.target.closest('#addDropdown')) {
            window.closeAddDropdown();
        }
    });


    /* ══════════════════════════════════════════════════════
       4. TOGGLE PANEL  (panels الـ navbar: إشعارات، مقاولون…)
          يستبدل دالة togglePanel() في main.js بالكامل.
          على الديسكتوب: يعمل كما كان (position:absolute).
          على الموبايل/تابلت: bottom-sheet بـ position:fixed.
       ══════════════════════════════════════════════════════ */

    /* ── CSS bottom-sheet (يُحقن مرة واحدة) ── */
    (function injectPanelCSS() {
        if (document.getElementById('uiPanelsCSS')) return;
        const s = document.createElement('style');
        s.id = 'uiPanelsCSS';
        s.textContent = `
            /* إخفاء chip المستخدم في navbar على موبايل/تابلت */
            @media (max-width: 1024px) {
                #userGroup { display: none !important; }
            }

            /* overlay خلف الـ bottom-sheet */
            #uiPanelOverlay {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 29990;
                background: rgba(0,0,0,0.52);
                backdrop-filter: blur(3px);
                /* لا يمنع التفاعل مع اللوحة التي فوقه */
                pointer-events: none;
            }
            /* اجعل الـ overlay يلتقط الأحداث فقط عند النقر عليه مباشرة */
            #uiPanelOverlay.clickable {
                pointer-events: auto;
            }

            /* bottom-sheet على الموبايل */
            @media (max-width: 1024px) {
                .ui-panel-sheet {
                    position: fixed !important;
                    top: 68px !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 12px !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    max-height: calc(100vh - 80px) !important;
                    min-height: 140px !important;
                    border-radius: 22px 22px 0 0 !important;
                    z-index: 29995 !important;
                    box-shadow: 0 8px 40px rgba(0,0,0,0.35) !important;
                    overflow-y: auto !important;
                    animation: uiSlideUp 0.28s cubic-bezier(0.34,1.1,0.64,1) !important;
                    display: flex !important;
                    flex-direction: column !important;
                    padding-bottom: env(safe-area-inset-bottom, 14px) !important;
                    pointer-events: auto !important;
                }
            }
            @keyframes uiSlideUp {
                from { transform: translateY(55px); opacity: 0; }
                to   { transform: translateY(0);    opacity: 1; }
            }
        `;
        document.head.appendChild(s);
    })();

    /* ── overlay element ── */
    const _overlay = document.createElement('div');
    _overlay.id = 'uiPanelOverlay';
    // نجعل الـ overlay يلتقط النقرات فقط عند إضافة class "clickable"
    _overlay.addEventListener('click', function(e) {
        // فقط إذا كان الـ overlay نفسه هو الهدف (وليس اللوحة المنبثقة)
        if (e.target === _overlay) {
            _closeMobilePanelSheet();
        }
    });
    document.body.appendChild(_overlay);

    function _closeMobilePanelSheet() {
        document.querySelectorAll('.ui-panel-sheet').forEach(p => {
            p.classList.remove('active', 'ui-panel-sheet');
            p.style.cssText = '';
        });
        _overlay.style.display = 'none';
        _overlay.classList.remove('clickable');
    }

    /* ── الدالة الرئيسية ── */
    window.togglePanel = function (id) {
        const panel = document.getElementById(id);
        if (!panel) return;

        const isOpen = isMobile()
            ? panel.classList.contains('ui-panel-sheet')
            : panel.classList.contains('active');

        /* --- أغلق كل الـ panels --- */
        document.querySelectorAll(
            '.notif-panel,.theme-panel,.user-dropdown,.coords-panel,.contractor-panel,.settings-panel'
        ).forEach(p => {
            p.classList.remove('active');
            if (isMobile()) p.classList.remove('ui-panel-sheet');
        });
        _overlay.style.display = 'none';
        _overlay.classList.remove('clickable');

        if (isOpen) return; // كان مفتوحاً → نغلق فقط

        /* --- افتح الـ panel --- */
        panel.classList.add('active');
        if (isMobile()) {
            panel.classList.add('ui-panel-sheet');
            _overlay.style.display = 'block';
            // نجعل الـ overlay قابل للنقر (لإغلاق اللوحة عند النقر خارجها)
            _overlay.classList.add('clickable');
            // منع انتشار أي نقر داخل اللوحة إلى الـ overlay
            panel.addEventListener('click', function stopProp(e) {
                e.stopPropagation();
            }, { once: false });
        }

        /* --- side-effects (محفوظة من main.js) --- */
        if (id === 'settingsPanel') {
            const sl = document.getElementById('settingsLat');
            const sg = document.getElementById('settingsLng');
            const sz = document.getElementById('settingsZoom');
            const sd = document.getElementById('settingsDefaultSub');
            if (sl) sl.value = window.defaultCoords?.lat ?? '';
            if (sg) sg.value = window.defaultCoords?.lng ?? '';
            if (sz) sz.value = window.defaultCoords?.zoom ?? '';
            if (sd) sd.value = window.defaultSubNumber ?? '';
            window.renderDefaultSubPreview?.();
            if (document.getElementById('eqTypesList')) {
                window.renderEquipmentTypesList?.();
                window.updateEqTypesCount?.();
            }
        }
        if (id === 'contractorPanel' && window._activeContractorTab === 'group') {
            window.renderContractorGroupList?.();
        }
        if (id === 'notifPanel') {
            const list = document.getElementById('notifList');
            if (list && list.children.length <= 1) window.loadNotifications?.();
        }
    };

    /* ── إغلاق panels عند الضغط خارج nav-right (ديسكتوب) ── */
    document.addEventListener('click', function (e) {
        if (isMobile()) return; // الموبايل يُدار بالـ overlay
        if (!e.target.closest('.nav-right') && !e.target.closest('#similarGroupModal')) {
            document.querySelectorAll(
                '.notif-panel,.theme-panel,.user-dropdown,.coords-panel,.contractor-panel,.equipment-panel,.settings-panel'
            ).forEach(p => p.classList.remove('active'));
        }
        if (!e.target.closest('.search-wrap')) {
            document.getElementById('searchDropdown')?.classList.remove('active');
        }
    });


    /* ══════════════════════════════════════════════════════
       5. MODALS  (open / close / backdrop)
       ══════════════════════════════════════════════════════ */

    /* --- Cashflow --- */
    window.openCashflowModal = function () {
        document.getElementById('cashflowModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        const tab = window.cfActiveTab || 'contractors';
        if (!window.cashflowData?.[tab]) {
            const sheetId = tab === 'contractors'
                ? window.CASHFLOW_CONTRACTORS_SHEET
                : window.CASHFLOW_COMPANY_SHEET;
            window.loadCfData?.(tab, sheetId);
        } else {
            window.renderCfKpis?.(tab);
        }
    };
    window.closeCashflowModal = function () {
        document.getElementById('cashflowModal').classList.remove('active');
        document.body.style.overflow = '';
    };

    /* --- Bills Dashboard --- */
    window.openBillsModal = function () {
        document.getElementById('billsModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        window.loadBillsData?.();
    };
    window.closeBillsModal = function () {
        document.getElementById('billsModal').classList.remove('active');
        document.body.style.overflow = '';
    };

    /* --- Equipment View Modal --- */
    window.openEquipmentModal = function () {
        document.getElementById('equipmentViewModal')?.classList.add('active');
        document.body.style.overflow = 'hidden';
        window.loadEquipmentViewData?.();
    };
    window.closeEquipmentModal = function () {
        document.getElementById('equipmentViewModal')?.classList.remove('active');
        document.body.style.overflow = '';
    };

    /* --- Equipment Form Modal --- */
    window.openEquipmentFormModal = function () {
        document.getElementById('equipmentFormModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        window.eqInitForm?.();
    };
    window.closeEquipmentFormModal = function () {
        document.getElementById('equipmentFormModal').classList.remove('active');
        document.body.style.overflow = '';
    };

    /* --- Company Cashflow Form --- */
    window.openCompanyCashflowForm = function () {
        document.getElementById('companyCashflowModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        window.ccfInit?.();
    };
    window.closeCompanyCashflowForm = function () {
        document.getElementById('companyCashflowModal').classList.remove('active');
        document.body.style.overflow = '';
    };

    /* --- Contractor Cashflow Form --- */
    window.openContractorCashflowForm = function () {
        document.getElementById('contractorCashflowModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        window.concfInit?.();
    };
    window.closeContractorCashflowForm = function () {
        document.getElementById('contractorCashflowModal').classList.remove('active');
        document.body.style.overflow = '';
    };

    /* --- backdrop click لإغلاق أي modal --- */
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', e => {
            if (e.target === m) m.classList.remove('active');
        });
    });

    /* --- Escape key: يغلق كل شيء --- */
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        window.closeCashflowModal?.();
        window.closeBillsModal?.();
        window.closeEquipmentModal?.();
        window.closeEquipmentFormModal?.();
        window.closeCompanyCashflowForm?.();
        window.closeContractorCashflowForm?.();
        window.closeReportsDropdown?.();
        window.closeAddDropdown?.();
        _closeMobilePanelSheet();
        // أغلق panels الديسكتوب
        document.querySelectorAll(
            '.notif-panel,.theme-panel,.user-dropdown,.coords-panel,.contractor-panel,.settings-panel'
        ).forEach(p => p.classList.remove('active'));
    });


    /* ══════════════════════════════════════════════════════
       6. SEARCH DROPDOWN POSITIONING
       ══════════════════════════════════════════════════════ */
    window.positionDropdown = function () {
        const dd  = document.getElementById('searchDropdown');
        const box = document.querySelector('.search-wrap');
        if (!box || !dd?.classList.contains('active')) return;
        const r = box.getBoundingClientRect();
        dd.style.top   = r.bottom + 'px';
        dd.style.left  = r.left   + 'px';
        dd.style.width = r.width  + 'px';
        dd.style.right = 'auto';
    };

    document.getElementById('searchInput')
        ?.addEventListener('input', () => window.updateSearchDropdown?.());


    /* ══════════════════════════════════════════════════════
       7. WINDOW RESIZE
       ══════════════════════════════════════════════════════ */
    window.addEventListener('resize', function () {
        if (window.map) window.map.invalidateSize();
        window.positionDropdown?.();
        // إذا تغير الوضع من موبايل لديسكتوب أو العكس، أغلق الـ sheets
        if (!isMobile()) _closeMobilePanelSheet();
    });

})();
