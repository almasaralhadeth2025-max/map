/* ============================================================
   ui_panels.js  — نسخة مُصلَحة
   ============================================================ */

(function () {
    'use strict';

    /* ══════════════════════════════════════════════════════
       1. MOBILE DETECTION
       ══════════════════════════════════════════════════════ */
    function isMobile() { return window.innerWidth <= 1024; }


    /* ══════════════════════════════════════════════════════
       2. MOBILE MENU
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

    window.openPanelFromMobile = function (id) {
        window.closeMobileMenu();
        window.setTimeout(() => {
            if (typeof window.togglePanel === 'function') window.togglePanel(id);
        }, 50);
    };


    /* ══════════════════════════════════════════════════════
       3. NAV-BAR DROPDOWNS (تقارير / إضافة)
       ══════════════════════════════════════════════════════ */
    function _getDropdown(id) { return document.getElementById(id); }

    function _openDropdown(ddId, triggerEl) {
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

        if (triggerEl) {
            const rect = triggerEl.getBoundingClientRect();
            dd.style.position = 'fixed';
            dd.style.top      = rect.bottom + 'px';
            dd.style.right    = 'auto';
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

    document.addEventListener('click', function (e) {
        if (!e.target.closest('#navTabReports') && !e.target.closest('#reportsDropdown')) {
            window.closeReportsDropdown();
        }
        if (!e.target.closest('#navTabAdd') && !e.target.closest('#addDropdown')) {
            window.closeAddDropdown();
        }
    });


    /* ══════════════════════════════════════════════════════
       4. TOGGLE PANEL
       ══════════════════════════════════════════════════════ */

    /* ── CSS ── */
    (function injectPanelCSS() {
        if (document.getElementById('uiPanelsCSS')) return;
        const s = document.createElement('style');
        s.id = 'uiPanelsCSS';
        s.textContent = `
            /*
             * إصلاح 1: #userGroup مخفي على الناف بار الديسكتوب فقط
             * لكن يظهر طبيعياً داخل الـ bottom-sheet (userPanel)
             */
            @media (max-width: 1024px) {
                .nav-right #userGroup { display: none !important; }
            }

            /* ── overlay ── */
            #uiPanelOverlay {
                display: none;
                position: fixed;
                inset: 0;
                /* إصلاح 2: z-index أقل من الـ panel بـ 5 درجات */
                z-index: 29990;
                background: rgba(0,0,0,0.52);
                /* لا يوجد pointer-events block — الـ panel فوقه */
            }

            /* ── bottom-sheet ── */
            @media (max-width: 1024px) {
                .ui-panel-sheet {
                    position: fixed !important;
                    top: 68px !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    max-height: calc(100dvh - 68px) !important;
                    min-height: 140px !important;
                    border-radius: 22px 22px 0 0 !important;
                    /* إصلاح 2: z-index أعلى من الـ overlay */
                    z-index: 29997 !important;
                    box-shadow: 0 -4px 40px rgba(0,0,0,0.35) !important;
                    overflow-y: auto !important;
                    overflow-x: hidden !important;
                    animation: uiSlideUp 0.28s cubic-bezier(0.34,1.1,0.64,1) forwards !important;
                    display: flex !important;
                    flex-direction: column !important;
                    padding-bottom: env(safe-area-inset-bottom, 14px) !important;
                    /* إصلاح 3: احتفظ بالخلفية الأصلية للعنصر */
                    background-color: var(--panel-bg, var(--bg-card, #fff)) !important;
                    color: var(--text-main, #222) !important;
                    /* تأكد إن التفاعل شغال */
                    pointer-events: auto !important;
                    -webkit-overflow-scrolling: touch !important;
                }
            }

            @keyframes uiSlideUp {
                from { transform: translateY(60px); opacity: 0; }
                to   { transform: translateY(0);    opacity: 1; }
            }
        `;
        document.head.appendChild(s);
    })();

    /* ── overlay element ── */
    const _overlay = document.createElement('div');
    _overlay.id = 'uiPanelOverlay';
    _overlay.addEventListener('click', function(e) {
        e.stopPropagation();
        _closeMobilePanelSheet();
    });
    document.body.appendChild(_overlay);

    /* إصلاح 3: عند الإغلاق لا نمسح cssText كاملاً (كان يمسح background) */
    function _closeMobilePanelSheet() {
        document.querySelectorAll('.ui-panel-sheet').forEach(p => {
            p.classList.remove('active', 'ui-panel-sheet');
            /* احذف فقط الـ inline styles اللي أضفناها نحن */
            p.style.removeProperty('position');
            p.style.removeProperty('top');
            p.style.removeProperty('left');
            p.style.removeProperty('right');
            p.style.removeProperty('bottom');
            p.style.removeProperty('z-index');
            p.style.removeProperty('width');
            p.style.removeProperty('max-width');
            p.style.removeProperty('max-height');
            p.style.removeProperty('min-height');
            p.style.removeProperty('border-radius');
            p.style.removeProperty('box-shadow');
            p.style.removeProperty('overflow-y');
            p.style.removeProperty('overflow-x');
            p.style.removeProperty('animation');
            p.style.removeProperty('display');
            p.style.removeProperty('flex-direction');
            p.style.removeProperty('padding-bottom');
            p.style.removeProperty('pointer-events');
        });
        _overlay.style.display = 'none';
    }

    /* ── الدالة الرئيسية ── */
    window.togglePanel = function (id) {
        const panel = document.getElementById(id);
        if (!panel) return;

        const isOpen = isMobile()
            ? panel.classList.contains('ui-panel-sheet')
            : panel.classList.contains('active');

        /* أغلق كل الـ panels */
        document.querySelectorAll(
            '.notif-panel,.theme-panel,.user-dropdown,.coords-panel,.contractor-panel,.settings-panel'
        ).forEach(p => {
            p.classList.remove('active');
            if (isMobile()) p.classList.remove('ui-panel-sheet');
        });
        _overlay.style.display = 'none';

        if (isOpen) return;

        /* افتح الـ panel */
        panel.classList.add('active');
        if (isMobile()) {
            panel.classList.add('ui-panel-sheet');
            _overlay.style.display = 'block';
        }

        /* side-effects */
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

    /* ── إغلاق panels عند الضغط خارج nav-right (ديسكتوب فقط) ── */
    document.addEventListener('click', function (e) {
        if (isMobile()) return;
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
       5. MODALS
       ══════════════════════════════════════════════════════ */
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

    window.openBillsModal = function () {
        document.getElementById('billsModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        window.loadBillsData?.();
    };
    window.closeBillsModal = function () {
        document.getElementById('billsModal').classList.remove('active');
        document.body.style.overflow = '';
    };

    window.openEquipmentModal = function () {
        document.getElementById('equipmentViewModal')?.classList.add('active');
        document.body.style.overflow = 'hidden';
        window.loadEquipmentViewData?.();
    };
    window.closeEquipmentModal = function () {
        document.getElementById('equipmentViewModal')?.classList.remove('active');
        document.body.style.overflow = '';
    };

    window.openEquipmentFormModal = function () {
        document.getElementById('equipmentFormModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        window.eqInitForm?.();
    };
    window.closeEquipmentFormModal = function () {
        document.getElementById('equipmentFormModal').classList.remove('active');
        document.body.style.overflow = '';
    };

    window.openCompanyCashflowForm = function () {
        document.getElementById('companyCashflowModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        window.ccfInit?.();
    };
    window.closeCompanyCashflowForm = function () {
        document.getElementById('companyCashflowModal').classList.remove('active');
        document.body.style.overflow = '';
    };

    window.openContractorCashflowForm = function () {
        document.getElementById('contractorCashflowModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        window.concfInit?.();
    };
    window.closeContractorCashflowForm = function () {
        document.getElementById('contractorCashflowModal').classList.remove('active');
        document.body.style.overflow = '';
    };

    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', e => {
            if (e.target === m) m.classList.remove('active');
        });
    });

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
        document.querySelectorAll(
            '.notif-panel,.theme-panel,.user-dropdown,.coords-panel,.contractor-panel,.settings-panel'
        ).forEach(p => p.classList.remove('active'));
    });


    /* ══════════════════════════════════════════════════════
       6. SEARCH DROPDOWN
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
        if (!isMobile()) _closeMobilePanelSheet();
    });

})();
