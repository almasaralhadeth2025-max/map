/* ── Equipment Modal ── */
function openEquipmentModal() {
    _eqActiveTab = 'overview';
    openModal('equipmentModal');
    loadEquipmentModal();
}

function closeEquipmentModal() {
    closeModal('equipmentModal');
}

/* ── Equipment Pro: state ── */
let _eqActiveTab   = 'overview';
let _eqChartInst   = null;
const EQ_PALETTE   = ['#f5c842','#27ae6a','#2196f3','#9c27b0','#ff9800','#e91e63','#00bcd4','#8bc34a','#ff5722','#607d8b'];
const EQ_SKIP      = new Set(['ID','BAYAN','البيان','DESCRIPTION','بيان','البند','BAND','ALBND','ITEM','ALBAYAN']);

function _eqGetCols() {
    const idIdx = equipmentRawHeaders.findIndex(h => h.toUpperCase() === 'ID');
    return equipmentRawHeaders
        .map((h, i) => ({ name: h, key: h.trim().toUpperCase(), idx: i }))
        .filter(c => c.idx !== idIdx && c.name.trim() && !EQ_SKIP.has(c.key) && !EQ_SKIP.has(c.name.trim()));
}

function _eqGetBandKey() {
    return (equipmentRawHeaders.find(h => {
        const u = h.trim().toUpperCase();
        return u === 'البند' || u === 'BAND' || u === 'ALBND' || u === 'ITEM';
    }) || '').trim().toUpperCase() || null;
}

function _eqGetContractorKey() {
    return (equipmentRawHeaders.find(h => {
        const u = h.trim().toUpperCase();
        return u === 'CONTRACTOR' || u === 'المقاول' || u === 'ALMUKAWIL';
    }) || '').trim().toUpperCase() || null;
}

function _eqSumCols(rows, cols) {
    const t = {};
    cols.forEach(col => {
        let s = 0;
        rows.forEach(r => { const v = parseFloat(r[col.key] || 0); if (!isNaN(v)) s += v; });
        if (s > 0) t[col.name] = s;
    });
    return t;
}

function eqSwitchTab(tab) {
    _eqActiveTab = tab;
    ['overview','contractor','band','matrix'].forEach(t => {
        const btn = document.getElementById('eqTab' + t.charAt(0).toUpperCase() + t.slice(1));
        const sec = document.getElementById('eqSec'  + t.charAt(0).toUpperCase() + t.slice(1));
        if (btn) btn.classList.toggle('active', t === tab);
        if (sec) sec.style.display = t === tab ? 'block' : 'none';
    });
}

function eqFilterSearch() {
    const q = (document.getElementById('eqSearchInput').value || '').trim().toLowerCase();
    ['eqContractorTableWrap','eqBandTableWrap'].forEach(wid => {
        const wrap = document.getElementById(wid);
        if (!wrap) return;
        wrap.querySelectorAll('tbody tr').forEach(tr => {
            const txt = tr.querySelector('td')?.textContent?.toLowerCase() || '';
            tr.style.display = (!q || txt.includes(q)) ? '' : 'none';
        });
    });
}

function loadEquipmentModal() {
    const loadMsg = document.getElementById('eqLoadMsg');
    if (!equipmentRawRows.length) {
        if (loadMsg) loadMsg.style.display = 'block';
        ['eqSecOverview','eqSecContractor','eqSecBand','eqSecMatrix'].forEach(id => {
            const el = document.getElementById(id); if (el) el.style.display = 'none';
        });
        setTimeout(() => { if (equipmentRawRows.length) loadEquipmentModal(); }, 1200);
        return;
    }
    if (loadMsg) loadMsg.style.display = 'none';

    const cols    = _eqGetCols();
    const bKey    = _eqGetBandKey();
    const cKey    = _eqGetContractorKey();
    const allRows = equipmentRawRows;

    /* ── KPIs ── */
    const totalsByType  = _eqSumCols(allRows, cols);
    const grandTotal    = Object.values(totalsByType).reduce((a,b) => a+b, 0);
    const contractors   = new Set(allRows.map(r => (r[cKey] || '').trim()).filter(Boolean));
    const bands         = new Set(allRows.map(r => (r[bKey] || '').trim()).filter(Boolean));

    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('eqKpiTypes',       Object.keys(totalsByType).length);
    setEl('eqKpiTotal',       fmtNum(grandTotal));
    setEl('eqKpiContractors', contractors.size || '—');
    setEl('eqKpiBands',       bands.size || '—');
    setEl('eqLastUpdate',     'آخر تحديث: ' + new Date().toLocaleTimeString('ar-SA'));

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
    }

    /* ── By Contractor ── */
    const contractorWrap = document.getElementById('eqContractorTableWrap');
    if (contractorWrap) {
        if (!cKey) {
            contractorWrap.innerHTML = '<div class="bd-msg bd-msg-load">لا يوجد عمود مقاول في الشيت</div>';
        } else {
            const byC = {};
            allRows.forEach(row => {
                const c = (row[cKey] || '').trim();
                if (!c) return;
                if (!byC[c]) byC[c] = { rows: [], bands: new Set() };
                byC[c].rows.push(row);
                if (bKey && row[bKey]) byC[c].bands.add(row[bKey].trim());
            });
            const sortedC = Object.entries(byC).sort((a,b) => {
                const ta = Object.values(_eqSumCols(a[1].rows, cols)).reduce((x,y)=>x+y,0);
                const tb = Object.values(_eqSumCols(b[1].rows, cols)).reduce((x,y)=>x+y,0);
                return tb - ta;
            });
            let html = '<table class="bd-tbl"><thead><tr>' +
                '<th>المقاول</th><th>البند</th><th style="min-width:90px;text-align:center;">الإجمالي</th><th>تفاصيل المعدات</th>' +
                '</tr></thead><tbody>';
            sortedC.forEach(([name, data]) => {
                const t = _eqSumCols(data.rows, cols);
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
            html += '</tbody></td>';
            contractorWrap.innerHTML = html;
        }
    }

    /* ── By Band ── */
    const bandWrap = document.getElementById('eqBandTableWrap');
    if (bandWrap) {
        if (!bKey) {
            bandWrap.innerHTML = '<div class="bd-msg bd-msg-load">لا يوجد عمود بند في الشيت</div>';
        } else {
            const byB = {};
            allRows.forEach(row => {
                const b = (row[bKey] || '').trim();
                if (!b) return;
                if (!byB[b]) byB[b] = { rows: [], contractors: new Set() };
                byB[b].rows.push(row);
                if (cKey && row[cKey]) byB[b].contractors.add(row[cKey].trim());
            });
            const sortedB = Object.entries(byB).sort((a,b) => a[0].localeCompare(b[0], 'ar'));
            let html = '<table class="bd-tbl"><thead><tr>' +
                '<th>البند</th><th>المقاولون</th><th style="min-width:90px;text-align:center;">الإجمالي</th><th>تفاصيل المعدات</th>' +
                '</table></thead><tbody>';
            sortedB.forEach(([name, data]) => {
                const t = _eqSumCols(data.rows, cols);
                const tot = Object.values(t).reduce((a,b)=>a+b,0);
                const cStr = [...data.contractors].join(' • ') || '—';
                const pillsArr = Object.entries(t).sort((a,b)=>b[1]-a[1]);
                const pills = pillsArr.slice(0,5).map(([pn,pv]) =>
                    `<span class="eq-pill-dark">${pn}: <strong>${fmtNum(pv)}</strong></span>`).join(' ');
                const more = pillsArr.length > 5 ? `<span class="eq-pill-dark">+${pillsArr.length-5} أخرى</span>` : '';
                html += `<tr>
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
        if (!cKey) {
            matrixWrap.innerHTML = '<div class="bd-msg bd-msg-load">لا يوجد عمود مقاول في الشيت</div>';
        } else {
            const contractorList = [...contractors].sort();
            const activeCols = cols.filter(col => {
                let s = 0; allRows.forEach(r => { const v = parseFloat(r[col.key]||0); if(!isNaN(v)) s+=v; });
                return s > 0;
            });
            const byC2 = {};
            allRows.forEach(row => {
                const c = (row[cKey]||'').trim();
                if (!c) return;
                if (!byC2[c]) byC2[c] = {};
                activeCols.forEach(col => {
                    const v = parseFloat(row[col.key]||0);
                    if (!isNaN(v)) byC2[c][col.name] = (byC2[c][col.name]||0) + v;
                });
            });
            const colMaxes = {};
            activeCols.forEach(col => {
                colMaxes[col.name] = Math.max(...contractorList.map(c => (byC2[c]||{})[col.name]||0), 1);
            });
            let html = `<table class="bd-tbl" style="min-width:${activeCols.length*75+180}px;">
                <thead><tr>
                    <th style="min-width:160px;">المقاول</th>
                    ${activeCols.map(c => `<th style="min-width:70px;text-align:center;font-size:10px;">${c.name}</th>`).join('')}
                    <th style="min-width:80px;text-align:center;">المجموع</th>
                </tr></thead><tbody>`;
            contractorList.forEach(c => {
                const cData = byC2[c] || {};
                const rowTot = activeCols.reduce((a, col) => a + (cData[col.name]||0), 0);
                html += `<tr>
                    <td style="font-weight:700;color:rgba(255,255,255,0.85);">${c}</td>
                    ${activeCols.map(col => {
                        const v = cData[col.name] || 0;
                        const pct = v / colMaxes[col.name];
                        const bg = v > 0 ? `rgba(245,200,66,${0.1 + pct * 0.65})` : 'transparent';
                        return `<td style="text-align:center;background:${bg};font-variant-numeric:tabular-nums;color:${v>0?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.2)'};">${v>0?fmtNum(v):'—'}</td>`;
                    }).join('')}
                    <td style="text-align:center;"><span style="background:rgba(245,200,66,0.12);border:1px solid rgba(245,200,66,0.3);color:var(--gold);padding:2px 8px;border-radius:4px;font-weight:900;font-size:12px;">${fmtNum(rowTot)}</span></td>
                </tr>`;
            });
            /* totals row */
            html += `<tr style="border-top:1px solid rgba(255,255,255,0.12);">
                <td style="font-weight:900;color:rgba(255,255,255,0.6);font-size:11px;">الإجمالي الكلي</td>
                ${activeCols.map(col => {
                    const s = contractorList.reduce((a,c) => a + ((byC2[c]||{})[col.name]||0), 0);
                    return `<td style="text-align:center;font-weight:700;color:rgba(255,255,255,0.55);font-size:11px;">${s>0?fmtNum(s):'—'}</td>`;
                }).join('')}
                <td style="text-align:center;"><span style="background:rgba(255,152,0,0.15);border:1px solid rgba(255,152,0,0.4);color:#ff9800;padding:2px 8px;border-radius:4px;font-weight:900;">${fmtNum(grandTotal)}</span></td>
            </table>`;
            html += '</tbody></table>';
            matrixWrap.innerHTML = html;
        }
    }

    /* ── Show active tab ── */
    eqSwitchTab(_eqActiveTab);

    /* ── Load Chart.js if not loaded yet ── */
    if (typeof Chart === 'undefined') {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
        s.onload = () => { if (_eqActiveTab === 'overview') eqSwitchTab('overview'); };
        document.head.appendChild(s);
    }
}

/* ── Number helpers ── */
