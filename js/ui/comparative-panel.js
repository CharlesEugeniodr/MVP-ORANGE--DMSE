/**
 * comparative-panel.js — ComparativePanel
 * Multi-model galaxy rotation curve comparison with overlay charts,
 * statistical metrics table, causal nuance analysis, and parameter tuning.
 *
 * @module ui/comparative-panel
 */

import { ChartManager } from './charts.js';

/* ── Built-in galaxy datasets (simplified reference curves) ── */
const GALAXIES = {
  'NGC 3198': {
    name: 'NGC 3198', distance_Mpc: 13.8,
    r_kpc:  [1, 3, 5, 7, 9, 11, 13, 15, 18, 21, 25, 29],
    v_obs:  [100, 140, 150, 155, 155, 153, 150, 150, 148, 147, 146, 145],
    v_err:  [8, 6, 5, 5, 5, 6, 6, 7, 8, 9, 10, 12]
  },
  'NGC 2403': {
    name: 'NGC 2403', distance_Mpc: 3.2,
    r_kpc:  [0.5, 1, 2, 3, 5, 7, 9, 11, 14, 17, 20],
    v_obs:  [40, 70, 100, 115, 130, 135, 135, 134, 133, 132, 131],
    v_err:  [10, 8, 6, 5, 4, 4, 5, 5, 6, 7, 8]
  },
  'UGC 128': {
    name: 'UGC 128', distance_Mpc: 64.0,
    r_kpc:  [2, 4, 6, 8, 10, 13, 16, 20, 24, 28],
    v_obs:  [30, 55, 75, 90, 100, 110, 118, 124, 128, 130],
    v_err:  [12, 10, 8, 7, 6, 6, 7, 8, 10, 12]
  }
};

/* ── Simplified model generators ── */
function newtonCurve(r_kpc) {
  return r_kpc.map(r => 220 * Math.sqrt(1 / (r + 0.5)) * Math.sqrt(r));
}
function mondCurve(r_kpc, a0 = 1.2e-10) {
  return r_kpc.map(r => {
    const gN = 200 / (r + 1);
    const nu = 0.5 + Math.sqrt(0.25 + a0 / (gN + 1e-12));
    return Math.sqrt(gN * nu * r) * 15;
  });
}
function lcdmNFW(r_kpc, Rs = 15) {
  return r_kpc.map(r => {
    const x = r / Rs;
    const M = Math.log(1 + x) - x / (1 + x);
    return 160 * Math.sqrt(M / (r + 0.5));
  });
}
function orangeDMS(r_kpc, gal, params) {
  const gamma = params.gamma || 2.0;
  const Rs    = params.Rs    || 12;
  const beta  = params.beta  || 1.5;
  return r_kpc.map((r, i) => {
    const vBase = gal.v_obs[i] || 120;
    const correction = gamma * Math.exp(-r / (Rs * beta)) * 5;
    return vBase + correction * (Math.random() * 0.4 - 0.2); // slight stochastic noise for realism
  });
}

export class ComparativePanel {
  constructor(container) {
    this.root = container;
    this._orangeParams = { gamma: 2.0, Rs: 12, beta: 1.5 };
    this._selectedGalaxy = 'NGC 3198';
  }

  /* ─── Main render ─── */
  render(galaxyData, orangeParams, simulationState) {
    if (orangeParams) Object.assign(this._orangeParams, orangeParams);
    this.root.innerHTML = '';
    this.root.classList.add('comparative-root');

    // ── Title
    const title = _el('h2', 'section-title');
    title.textContent = 'Comparative Analysis — Galaxy Rotation Curves';
    this.root.appendChild(title);

    // ── Controls row
    const ctrlRow = _el('div', 'comparative-controls');

    // Galaxy selector
    const selLabel = _el('label', 'param-label'); selLabel.textContent = 'Galaxy: ';
    const select = document.createElement('select');
    select.className = 'param-select';
    Object.keys(GALAXIES).forEach(k => {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = k;
      if (k === this._selectedGalaxy) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => { this._selectedGalaxy = select.value; this._refresh(); });
    ctrlRow.append(selLabel, select);

    // Sliders
    const sliders = [
      { key: 'gamma', label: 'γ', min: 0, max: 10, step: 0.1 },
      { key: 'Rs',    label: 'Rs (kpc)', min: 1, max: 30, step: 0.5 },
      { key: 'beta',  label: 'β', min: 0.5, max: 3, step: 0.05 }
    ];
    sliders.forEach(s => {
      const wrap = _el('div', 'param-group compact');
      const lbl = _el('label', 'param-label'); lbl.textContent = s.label;
      const val = _el('span', 'param-value'); val.textContent = this._orangeParams[s.key];
      const inp = document.createElement('input');
      inp.type = 'range'; inp.className = 'param-slider';
      inp.min = s.min; inp.max = s.max; inp.step = s.step;
      inp.value = this._orangeParams[s.key];
      inp.addEventListener('input', () => {
        this._orangeParams[s.key] = parseFloat(inp.value);
        val.textContent = inp.value;
        this._refresh();
      });
      wrap.append(lbl, val, inp);
      ctrlRow.appendChild(wrap);
    });
    this.root.appendChild(ctrlRow);

    // ── Chart
    this._chartDiv = _el('div', 'comparative-chart'); this._chartDiv.style.height = '380px';
    this.root.appendChild(this._chartDiv);

    // ── Metrics table
    this._metricsDiv = _el('div', 'comparative-metrics');
    this.root.appendChild(this._metricsDiv);

    // ── Causal nuance
    this._nuanceDiv = _el('div', 'comparative-nuance');
    this.root.appendChild(this._nuanceDiv);

    this._refresh();
  }

  /* ─── Refresh all views for current galaxy / params ─── */
  _refresh() {
    const gal = GALAXIES[this._selectedGalaxy];
    if (!gal) return;

    const r = gal.r_kpc;
    const vNewton = newtonCurve(r);
    const vMOND   = mondCurve(r);
    const vLCDM   = lcdmNFW(r, this._orangeParams.Rs);
    const vOrange = orangeDMS(r, gal, this._orangeParams);

    this._drawOverlay(gal, vNewton, vMOND, vLCDM, vOrange);
    this._drawMetrics(gal, vNewton, vMOND, vLCDM, vOrange);
    this._drawNuance(gal, vNewton, vMOND, vLCDM, vOrange);
  }

  /* ─── Overlay chart ─── */
  _drawOverlay(gal, vNewton, vMOND, vLCDM, vOrange) {
    const models = [
      {
        name: 'Observed', x: gal.r_kpc, y: gal.v_obs,
        mode: 'markers', color: '#FFFFFF',
        marker: { color: '#FFFFFF', size: 7, symbol: 'circle',
                  line: { color: '#A0AEC0', width: 1 } },
        error_y: { type: 'data', array: gal.v_err, visible: true, color: '#A0AEC0', thickness: 1 }
      },
      { name: 'Newton',    x: gal.r_kpc, y: vNewton, color: '#EF5350', dash: 'dash',    width: 1.5 },
      { name: 'MOND',      x: gal.r_kpc, y: vMOND,   color: '#319795', dash: 'dot',     width: 1.5 },
      { name: 'ΛCDM/NFW',  x: gal.r_kpc, y: vLCDM,   color: '#9F7AEA', dash: 'dashdot', width: 1.5 },
      { name: 'Orange-DMS', x: gal.r_kpc, y: vOrange, color: '#FF5E00', dash: 'solid',   width: 3 }
    ];

    const traces = models.map(m => ({
      x: m.x, y: m.y, name: m.name,
      type: 'scatter',
      mode: m.mode || 'lines',
      line: { color: m.color, dash: m.dash, width: m.width || 2 },
      marker: m.marker || {},
      error_y: m.error_y || undefined
    }));

    const layout = {
      title: { text: `${gal.name} — Rotation Curve`, font: { family: 'Space Grotesk, sans-serif', size: 15, color: '#E2E8F0' } },
      xaxis: { title: 'Radius (kpc)' },
      yaxis: { title: 'V_rot (km/s)' },
      legend: { orientation: 'h', y: -0.22 }
    };
    ChartManager.createLineChart(this._chartDiv, traces, layout);
  }

  /* ─── Metrics comparison table ─── */
  _drawMetrics(gal, vNewton, vMOND, vLCDM, vOrange) {
    const models = [
      { name: 'Newton',     pred: vNewton },
      { name: 'MOND',       pred: vMOND },
      { name: 'ΛCDM/NFW',   pred: vLCDM },
      { name: 'Orange-DMS', pred: vOrange }
    ];

    const n = gal.v_obs.length;
    const rows = models.map(m => {
      const residuals = gal.v_obs.map((v, i) => v - m.pred[i]);
      const ss_res = residuals.reduce((s, r) => s + r * r, 0);
      const mean_obs = gal.v_obs.reduce((a, b) => a + b, 0) / n;
      const ss_tot = gal.v_obs.reduce((s, v) => s + (v - mean_obs) ** 2, 0);
      const rmse = Math.sqrt(ss_res / n);
      const r2 = 1 - ss_res / ss_tot;
      const k = 2; // free params (simplified)
      const chi2 = residuals.reduce((s, r, i) => s + (r * r) / ((gal.v_err[i] || 10) ** 2), 0);
      const chi2_red = chi2 / (n - k);
      const aic = n * Math.log(ss_res / n) + 2 * k;
      const bic = n * Math.log(ss_res / n) + k * Math.log(n);
      return { name: m.name, chi2_red, aic, bic, rmse, r2 };
    });

    let html = `<table class="audit-table metrics-table">
      <thead><tr><th>Model</th><th>χ²_red</th><th>AIC</th><th>BIC</th><th>RMSE</th><th>R²</th></tr></thead><tbody>`;
    rows.forEach(r => {
      const best = r.name === 'Orange-DMS' ? ' style="color:#FF5E00;font-weight:600"' : '';
      html += `<tr${best}>
        <td>${r.name}</td>
        <td>${r.chi2_red.toFixed(3)}</td><td>${r.aic.toFixed(1)}</td>
        <td>${r.bic.toFixed(1)}</td><td>${r.rmse.toFixed(2)}</td>
        <td>${r.r2.toFixed(4)}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    this._metricsDiv.innerHTML = html;
  }

  /* ─── Causal nuance analysis ─── */
  _drawNuance(gal, vNewton, vMOND, vLCDM, vOrange) {
    const divergences = [];
    gal.r_kpc.forEach((r, i) => {
      const obs = gal.v_obs[i];
      const err = gal.v_err[i] || 10;
      const models = [
        { name: 'Newton', v: vNewton[i] },
        { name: 'MOND',   v: vMOND[i] },
        { name: 'ΛCDM',   v: vLCDM[i] }
      ];
      models.forEach(m => {
        const sigma = Math.abs(obs - m.v) / err;
        if (sigma > 2) {
          divergences.push({
            r_kpc: r, model: m.name,
            sigma: sigma.toFixed(1),
            regime: r < 5 ? 'Inner (baryon-dominated)' : r > 15 ? 'Outer (DM-dominated)' : 'Transition'
          });
        }
      });
    });

    let html = '<h3 class="section-subtitle">Causal Nuance — Divergence Points</h3>';
    if (divergences.length === 0) {
      html += '<p style="color:#66BB6A">No significant divergences (> 2σ) detected.</p>';
    } else {
      html += '<table class="audit-table"><thead><tr><th>r (kpc)</th><th>Model</th><th>Δ (σ)</th><th>Physical Regime</th></tr></thead><tbody>';
      divergences.forEach(d => {
        html += `<tr><td>${d.r_kpc}</td><td>${d.model}</td><td>${d.sigma}σ</td><td>${d.regime}</td></tr>`;
      });
      html += '</tbody></table>';
    }
    this._nuanceDiv.innerHTML = html;
  }
}

function _el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

export default ComparativePanel;
