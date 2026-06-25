/**
 * dimension-audit.js — DimensionAuditPanel
 * 30-dimension validation matrix with semaphore status indicators,
 * summary distribution chart, row drill-down, and export.
 *
 * @module ui/dimension-audit
 */

import { ChartManager } from './charts.js';

/* ── Status definitions ── */
const STATUS = {
  PROVEN:        { emoji: '🟢', label: 'PROVEN',        color: '#66BB6A', cls: 'status-pass' },
  SATURATED:     { emoji: '🟡', label: 'SATURATED',     color: '#FFA726', cls: 'status-warning' },
  FALLIBLE:      { emoji: '🔴', label: 'FALLIBLE',      color: '#EF5350', cls: 'status-fail' },
  INDETERMINATE: { emoji: '⚪', label: 'INDETERMINATE', color: '#718096', cls: 'status-indeterminate' }
};

const COLUMNS = [
  'Convergence', 'Saturation', 'Stability',
  'Pair Impact', 'Sensitivity', 'Cross-Falsifiability'
];

export class DimensionAuditPanel {
  constructor(container) {
    this.root = container;
    this._expanded = null;
  }

  /* ─── Main render ─── */
  render(validationResults = {}) {
    this.root.innerHTML = '';
    this.root.classList.add('audit-root');

    const dims = validationResults.dimensions || this._generatePlaceholder();

    // ── Title
    const header = _el('div', 'audit-header');
    header.innerHTML = `
      <h2 class="section-title">Dimensional Audit — 30D Validation Matrix</h2>
      <p class="section-subtitle">${dims.length} dimensions evaluated across ${COLUMNS.length} criteria</p>
    `;
    this.root.appendChild(header);

    // ── Summary bar
    const counts = this._countStatuses(dims);
    const summaryRow = _el('div', 'audit-summary');
    for (const [key, st] of Object.entries(STATUS)) {
      const badge = _el('span', `audit-summary-badge ${st.cls}`);
      badge.innerHTML = `${st.emoji} ${st.label}: <strong>${counts[key] || 0}</strong>`;
      summaryRow.appendChild(badge);
    }
    this.root.appendChild(summaryRow);

    // ── Summary chart
    const chartDiv = _el('div', 'audit-chart'); chartDiv.style.height = '180px';
    this.root.appendChild(chartDiv);
    this._drawSummaryChart(chartDiv, counts);

    // ── Table
    const tableWrap = _el('div', 'audit-table-wrap');
    const table = _el('table', 'audit-table');

    // thead
    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    ['Dim', ...COLUMNS, 'Overall'].forEach(c => {
      const th = document.createElement('th'); th.textContent = c; hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement('tbody');
    dims.forEach((dim, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'audit-row';
      tr.dataset.dim = idx;

      // Dim #
      const tdNum = document.createElement('td');
      tdNum.textContent = `D${idx + 1}`;
      tdNum.className = 'dim-num';
      tr.appendChild(tdNum);

      // Criterion cells
      const overall = { PROVEN: 0, SATURATED: 0, FALLIBLE: 0, INDETERMINATE: 0 };
      COLUMNS.forEach(col => {
        const key = dim[col] || 'INDETERMINATE';
        overall[key]++;
        const td = document.createElement('td');
        const s = STATUS[key] || STATUS.INDETERMINATE;
        td.innerHTML = `<span class="status-badge ${s.cls}">${s.emoji} ${s.label}</span>`;
        tr.appendChild(td);
      });

      // Overall
      const overallStatus = this._deriveOverall(overall);
      const os = STATUS[overallStatus];
      const tdO = document.createElement('td');
      tdO.innerHTML = `<span class="status-badge ${os.cls}">${os.emoji} ${os.label}</span>`;
      tr.appendChild(tdO);

      // Click to expand
      tr.addEventListener('click', () => this._toggleDetail(idx, dim, tr));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    this.root.appendChild(tableWrap);

    // ── Export buttons
    const exportRow = _el('div', 'audit-export-row');
    exportRow.appendChild(_btn('⬇ Export JSON', 'sim-btn btn-start', () => this._exportJSON(dims)));
    exportRow.appendChild(_btn('⬇ Export CSV',  'sim-btn btn-pause', () => this._exportCSV(dims)));
    this.root.appendChild(exportRow);
  }

  /* ─── Detail drill-down ─── */
  _toggleDetail(idx, dim, tr) {
    // Remove existing detail row
    const existing = this.root.querySelector('.audit-detail-row');
    if (existing) existing.remove();
    if (this._expanded === idx) { this._expanded = null; return; }
    this._expanded = idx;

    const detailTr = document.createElement('tr');
    detailTr.className = 'audit-detail-row';
    const td = document.createElement('td');
    td.colSpan = COLUMNS.length + 2;
    td.innerHTML = `
      <div class="audit-detail-card hud-card">
        <h4>Dimension ${idx + 1} — Detailed Analysis</h4>
        <ul style="list-style:none;padding:0;margin:8px 0">
          ${COLUMNS.map(col => {
            const key = dim[col] || 'INDETERMINATE';
            const s = STATUS[key];
            const reason = dim[`${col}_reason`] || 'No detailed reason recorded.';
            return `<li style="margin:6px 0"><span class="status-badge ${s.cls}">${s.emoji} ${col}</span> — ${reason}</li>`;
          }).join('')}
        </ul>
      </div>
    `;
    detailTr.appendChild(td);
    tr.after(detailTr);
    this.root.dispatchEvent(new CustomEvent('dimension-inspected', { bubbles: true, detail: { dimension: idx } }));
  }

  /* ─── Summary chart ─── */
  _drawSummaryChart(div, counts) {
    const labels = Object.keys(STATUS);
    const values = labels.map(k => counts[k] || 0);
    const colors = labels.map(k => STATUS[k].color);
    ChartManager.createBarChart(div, [{
      x: labels, y: values, marker: { color: colors }
    }], {
      title: { text: 'Status Distribution', font: { family: 'Space Grotesk, sans-serif', size: 13, color: '#E2E8F0' } },
      margin: { t: 32, b: 30, l: 36, r: 12 },
      yaxis: { title: 'Count', dtick: 5 }
    });
  }

  /* ─── Helpers ─── */
  _countStatuses(dims) {
    const c = {};
    dims.forEach(dim => {
      COLUMNS.forEach(col => {
        const k = dim[col] || 'INDETERMINATE';
        c[k] = (c[k] || 0) + 1;
      });
    });
    return c;
  }

  _deriveOverall(counts) {
    if (counts.FALLIBLE > 0) return 'FALLIBLE';
    if (counts.INDETERMINATE >= 3) return 'INDETERMINATE';
    if (counts.SATURATED >= 2) return 'SATURATED';
    return 'PROVEN';
  }

  _generatePlaceholder() {
    const pick = () => ['PROVEN','PROVEN','PROVEN','SATURATED','FALLIBLE','INDETERMINATE'][Math.floor(Math.random()*6)];
    return Array.from({ length: 30 }, () => {
      const d = {};
      COLUMNS.forEach(c => { d[c] = pick(); d[`${c}_reason`] = 'Placeholder — awaiting engine results.'; });
      return d;
    });
  }

  _exportJSON(dims) {
    const blob = new Blob([JSON.stringify(dims, null, 2)], { type: 'application/json' });
    _download(blob, 'dimension-audit.json');
  }

  _exportCSV(dims) {
    const header = ['Dim', ...COLUMNS].join(',');
    const rows = dims.map((d, i) => [i + 1, ...COLUMNS.map(c => d[c] || 'INDETERMINATE')].join(','));
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    _download(blob, 'dimension-audit.csv');
  }
}

/* ─── Utilities ─── */
function _el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function _btn(text, cls, handler) {
  const b = document.createElement('button'); b.className = cls; b.textContent = text;
  b.addEventListener('click', handler); return b;
}
function _download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default DimensionAuditPanel;
