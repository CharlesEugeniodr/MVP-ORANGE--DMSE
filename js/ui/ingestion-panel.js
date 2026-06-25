/**
 * ingestion-panel.js — IngestionPanel
 * Data ingestion interface: drag-and-drop upload, column mapping,
 * validation, overlay comparison, RMSE calculation, and sample export.
 *
 * @module ui/ingestion-panel
 */

import { ChartManager } from './charts.js';

const SAMPLE_CSV = `radius_kpc,v_obs_km_s,v_err_km_s
1.0,100,8
3.0,140,6
5.0,150,5
7.0,155,5
9.0,155,5
11.0,153,6
13.0,150,6
15.0,150,7
18.0,148,8
21.0,147,9
25.0,146,10
29.0,145,12`;

const REQUIRED_COLUMNS = ['radius', 'velocity'];
const OPTIONAL_COLUMNS = ['error', 'name', 'id'];

export class IngestionPanel {
  constructor(container) {
    this.root = container;
    this._parsedData = null;
    this._columnMap = {};
    this._fileType = 'csv';
  }

  /* ─── Main render ─── */
  render() {
    this.root.innerHTML = '';
    this.root.classList.add('ingestion-root');

    // Title
    const title = _el('h2', 'section-title'); title.textContent = 'Data Ingestion';
    this.root.appendChild(title);

    // File type selector
    const typeRow = _el('div', 'ingestion-type-row');
    const typeLabel = _el('span', 'param-label'); typeLabel.textContent = 'File type: ';
    const typeSelect = document.createElement('select');
    typeSelect.className = 'param-select';
    ['csv', 'json'].forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t.toUpperCase();
      typeSelect.appendChild(o);
    });
    typeSelect.addEventListener('change', () => { this._fileType = typeSelect.value; });
    typeRow.append(typeLabel, typeSelect);
    this.root.appendChild(typeRow);

    // Drop zone
    const dropZone = _el('div', 'ingestion-dropzone');
    dropZone.innerHTML = `
      <div class="dropzone-icon">📂</div>
      <div class="dropzone-text">Drag &amp; drop a <strong>CSV</strong> or <strong>JSON</strong> file here</div>
      <div class="dropzone-sub">or click to browse</div>
    `;
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = '.csv,.json,.txt'; fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) this._handleFile(fileInput.files[0]); });
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this._handleFile(e.dataTransfer.files[0]);
    });
    dropZone.appendChild(fileInput);
    this.root.appendChild(dropZone);

    // Post-upload containers (hidden until data loaded)
    this._mappingDiv   = _el('div', 'ingestion-mapping');   this._mappingDiv.style.display = 'none';
    this._previewDiv   = _el('div', 'ingestion-preview');   this._previewDiv.style.display = 'none';
    this._validationDiv = _el('div', 'ingestion-validation'); this._validationDiv.style.display = 'none';
    this._chartDiv     = _el('div', 'ingestion-chart');     this._chartDiv.style.display = 'none';
    this._rmseDiv      = _el('div', 'ingestion-rmse');      this._rmseDiv.style.display = 'none';
    this.root.append(this._mappingDiv, this._previewDiv, this._validationDiv, this._chartDiv, this._rmseDiv);

    // Download sample button
    const sampleBtn = _el('div', 'ingestion-sample-row');
    sampleBtn.appendChild(_btn('⬇ Download Sample CSV', 'sim-btn btn-start', () => this._downloadSample()));
    this.root.appendChild(sampleBtn);
  }

  /* ─── File handling ─── */
  _handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        if (this._fileType === 'json' || file.name.endsWith('.json')) {
          this._parsedData = JSON.parse(text);
          if (!Array.isArray(this._parsedData)) {
            // Try to coerce object-of-arrays to array-of-objects
            const keys = Object.keys(this._parsedData);
            const len = this._parsedData[keys[0]].length;
            this._parsedData = Array.from({ length: len }, (_, i) => {
              const row = {};
              keys.forEach(k => { row[k] = this._parsedData[k][i]; });
              return row;
            });
          }
        } else {
          this._parsedData = this._parseCSV(text);
        }
        this._showMapping();
        this._showPreview();
        this._validate();
      } catch (err) {
        this._showValidationError('Parse error: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  _parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error('CSV must have header + at least 1 data row.');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const vals = line.split(',');
      const row = {};
      headers.forEach((h, i) => { row[h] = isNaN(vals[i]) ? vals[i]?.trim() : parseFloat(vals[i]); });
      return row;
    });
  }

  /* ─── Column mapping ─── */
  _showMapping() {
    if (!this._parsedData || this._parsedData.length === 0) return;
    this._mappingDiv.style.display = '';
    const cols = Object.keys(this._parsedData[0]);
    let html = '<h3 class="section-subtitle">Column Mapping</h3><div class="mapping-grid">';
    REQUIRED_COLUMNS.concat(OPTIONAL_COLUMNS).forEach(req => {
      const guess = cols.find(c => c.toLowerCase().includes(req)) || '';
      html += `<div class="mapping-row">
        <label class="param-label">${req}:</label>
        <select class="param-select mapping-select" data-target="${req}">
          <option value="">— skip —</option>
          ${cols.map(c => `<option value="${c}" ${c === guess ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>`;
      this._columnMap[req] = guess;
    });
    html += '</div><button class="sim-btn btn-start mapping-apply">Apply Mapping</button>';
    this._mappingDiv.innerHTML = html;

    this._mappingDiv.querySelectorAll('.mapping-select').forEach(sel => {
      sel.addEventListener('change', () => { this._columnMap[sel.dataset.target] = sel.value; });
    });
    this._mappingDiv.querySelector('.mapping-apply').addEventListener('click', () => {
      this._validate();
      this._showOverlay();
    });
  }

  /* ─── Data preview ─── */
  _showPreview() {
    if (!this._parsedData) return;
    this._previewDiv.style.display = '';
    const preview = this._parsedData.slice(0, 10);
    const cols = Object.keys(preview[0]);
    let html = '<h3 class="section-subtitle">Data Preview (first 10 rows)</h3>';
    html += '<div class="preview-table-wrap"><table class="audit-table"><thead><tr>';
    cols.forEach(c => { html += `<th>${c}</th>`; });
    html += '</tr></thead><tbody>';
    preview.forEach(row => {
      html += '<tr>';
      cols.forEach(c => { html += `<td>${row[c] ?? ''}</td>`; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    this._previewDiv.innerHTML = html;
  }

  /* ─── Validation ─── */
  _validate() {
    this._validationDiv.style.display = '';
    const issues = [];
    const radiusCol = this._columnMap.radius;
    const velCol    = this._columnMap.velocity;
    if (!radiusCol) issues.push({ level: 'fail', msg: 'Radius column not mapped.' });
    if (!velCol)    issues.push({ level: 'fail', msg: 'Velocity column not mapped.' });

    if (this._parsedData && radiusCol && velCol) {
      this._parsedData.forEach((row, i) => {
        if (typeof row[radiusCol] !== 'number') issues.push({ level: 'warning', msg: `Row ${i + 1}: non-numeric radius "${row[radiusCol]}"` });
        if (typeof row[velCol] !== 'number')    issues.push({ level: 'warning', msg: `Row ${i + 1}: non-numeric velocity "${row[velCol]}"` });
      });
      if (issues.length === 0) issues.push({ level: 'pass', msg: `All ${this._parsedData.length} rows valid.` });
    }

    let html = '<h3 class="section-subtitle">Validation</h3>';
    issues.forEach(iss => {
      const cls = iss.level === 'pass' ? 'status-pass' : iss.level === 'fail' ? 'status-fail' : 'status-warning';
      const emoji = iss.level === 'pass' ? '🟢' : iss.level === 'fail' ? '🔴' : '🟡';
      html += `<div class="validation-line ${cls}">${emoji} ${iss.msg}</div>`;
    });
    this._validationDiv.innerHTML = html;
  }

  _showValidationError(msg) {
    this._validationDiv.style.display = '';
    this._validationDiv.innerHTML = `<div class="validation-line status-fail">🔴 ${msg}</div>`;
  }

  /* ─── Overlay chart + RMSE ─── */
  _showOverlay() {
    if (!this._parsedData) return;
    const radiusCol = this._columnMap.radius;
    const velCol    = this._columnMap.velocity;
    const errCol    = this._columnMap.error;
    if (!radiusCol || !velCol) return;

    const r = this._parsedData.map(d => d[radiusCol]).filter(v => typeof v === 'number');
    const v = this._parsedData.map(d => d[velCol]).filter(v => typeof v === 'number');
    // Simple model prediction (placeholder Orange-DMS)
    const vModel = r.map(ri => 150 * Math.sqrt(1 - Math.exp(-ri / 8)));

    this._chartDiv.style.display = '';
    this._chartDiv.style.height = '320px';
    ChartManager.createComparisonOverlay(this._chartDiv, [
      { name: 'Uploaded Data', x: r, y: v, mode: 'markers', color: '#FFFFFF',
        marker: { color: '#FFFFFF', size: 6 } },
      { name: 'Orange-DMS Model', x: r, y: vModel, color: '#FF5E00', width: 3 }
    ], {
      title: { text: 'Uploaded Data vs Model', font: { family: 'Space Grotesk, sans-serif', size: 14, color: '#E2E8F0' } },
      xaxis: { title: 'Radius' }, yaxis: { title: 'Velocity' }
    });

    // RMSE
    const n = Math.min(v.length, vModel.length);
    const ss = v.slice(0, n).reduce((s, vi, i) => s + (vi - vModel[i]) ** 2, 0);
    const rmse = Math.sqrt(ss / n);

    this._rmseDiv.style.display = '';
    this._rmseDiv.innerHTML = `
      <div class="hud-card" style="display:inline-block;min-width:180px">
        <div class="hud-label">RMSE</div>
        <div class="hud-value hud-value-gradient">${rmse.toFixed(4)}</div>
        <div class="hud-unit">km/s</div>
      </div>
    `;

    this.root.dispatchEvent(new CustomEvent('data-ingested', {
      bubbles: true,
      detail: { rows: this._parsedData.length, rmse, columnMap: { ...this._columnMap } }
    }));
  }

  /* ─── Sample download ─── */
  _downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'orange-dms-sample.csv';
    a.click(); URL.revokeObjectURL(a.href);
  }
}

function _el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function _btn(text, cls, handler) {
  const b = document.createElement('button'); b.className = cls; b.textContent = text;
  b.addEventListener('click', handler); return b;
}

export default IngestionPanel;
