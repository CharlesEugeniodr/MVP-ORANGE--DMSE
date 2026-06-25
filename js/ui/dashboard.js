/**
 * dashboard.js — DashboardPanel
 * Main simulation control centre with HUD cards, parameter sliders,
 * convergence charts, and simulation lifecycle buttons.
 *
 * @module ui/dashboard
 */

import { ChartManager } from './charts.js';

/* ── Slider specifications ── */
const PARAM_SLIDERS = [
  { key: 'rho',              label: 'ρ  (density)',       min: 0.1,   max: 5,     step: 0.01, default: 1.0   },
  { key: 'eta',              label: 'η  (viscosity)',     min: 0,     max: 1,     step: 0.01, default: 0.05  },
  { key: 'alpha',            label: 'α  (diffusion)',     min: 0.1,   max: 2,     step: 0.01, default: 1.0   },
  { key: 'E0',               label: 'E₀ (field amp.)',    min: 0.1,   max: 10,    step: 0.1,  default: 1.0   },
  { key: 'kappa_init',       label: 'κ_init',             min: 0.01,  max: 100,   step: 0.01, default: 1.0   },
  { key: 'kappa_gain',       label: 'κ_gain',             min: 0.01,  max: 2,     step: 0.01, default: 0.1   },
  { key: 'r_rms_target',     label: 'r_rms target',       min: 0.001, max: 0.2,   step: 0.001,default: 0.01  },
  { key: 'n_channels',       label: 'Channels (n)',       min: 1,     max: 30,    step: 1,    default: 30    },
  { key: 'coupling_strength',label: 'Coupling',           min: 0,     max: 0.5,   step: 0.01, default: 0.05  }
];

const GRID_OPTIONS  = [64, 128, 256];
const BOUNDARY_OPTS = ['periodic', 'dirichlet', 'neumann', 'absorbing'];

export class DashboardPanel {
  constructor(container) {
    this.root = container;
    this._paramValues = {};
    this._chartDivs = {};
    this._running = false;
    PARAM_SLIDERS.forEach(s => { this._paramValues[s.key] = s.default; });
    this._paramValues.grid_size = 128;
    this._paramValues.boundary = 'periodic';
  }

  /* ─── Main render ─── */
  render(engine, params = {}, metricsHistory = {}) {
    // Merge incoming params
    Object.assign(this._paramValues, params);
    this.root.innerHTML = '';
    this.root.classList.add('dashboard-root');

    // Top: HUD row
    const hudRow = _el('div', 'hud-row');
    this._hudCards = {};
    const hudDefs = [
      { id: 'r_rms',      label: 'r_rms Divergence', unit: '', fmt: v => v.toExponential(3) },
      { id: 'kappa',      label: 'κ Controller',     unit: '',  fmt: v => v.toFixed(4) },
      { id: 'energy_kin', label: 'Kinetic Energy',    unit: 'J', fmt: v => v.toExponential(3) },
      { id: 'tv',         label: 'Total Variation',   unit: '',  fmt: v => v.toFixed(4) }
    ];
    hudDefs.forEach(h => {
      const card = _el('div', 'hud-card');
      const lbl  = _el('div', 'hud-label');  lbl.textContent = h.label;
      const val  = _el('div', 'hud-value hud-value-gradient'); val.textContent = '--';
      const unit = _el('div', 'hud-unit');   unit.textContent = h.unit;
      card.append(lbl, val, unit);
      hudRow.appendChild(card);
      this._hudCards[h.id] = { el: val, fmt: h.fmt };
    });
    this.root.appendChild(hudRow);

    // Main body: sidebar + content
    const body = _el('div', 'dashboard-body');

    /* — Sidebar — */
    const sidebar = _el('aside', 'dashboard-sidebar');
    const sideTitle = _el('h3', 'sidebar-title'); sideTitle.textContent = 'Engine Parameters';
    sidebar.appendChild(sideTitle);

    // Sliders
    PARAM_SLIDERS.forEach(spec => {
      const group = this._createSlider(spec);
      sidebar.appendChild(group);
    });

    // Grid selector
    sidebar.appendChild(this._createSelect('grid_size', 'Grid Resolution', GRID_OPTIONS));
    // Boundary selector
    sidebar.appendChild(this._createSelect('boundary', 'Boundary Condition', BOUNDARY_OPTS));

    body.appendChild(sidebar);

    /* — Content area — */
    const content = _el('div', 'dashboard-content');

    // Controls bar
    const controls = _el('div', 'sim-controls');
    const btnStart = _btn('▶  Start', 'btn-start', () => this._onStart());
    const btnPause = _btn('⏸  Pause', 'btn-pause', () => this._onPause());
    const btnReset = _btn('↺  Reset', 'btn-reset', () => this._onReset());
    controls.append(btnStart, btnPause, btnReset);
    this._btnStart = btnStart;
    this._btnPause = btnPause;
    content.appendChild(controls);

    // Chart grid
    const chartGrid = _el('div', 'chart-grid');
    ['chart-rrms', 'chart-kappa', 'chart-energy'].forEach(id => {
      const div = _el('div', 'chart-cell');
      div.id = id;
      chartGrid.appendChild(div);
      this._chartDivs[id] = div;
    });
    content.appendChild(chartGrid);

    body.appendChild(content);
    this.root.appendChild(body);

    // Draw initial (empty) charts
    this._drawCharts(metricsHistory);
  }

  /* ─── HUD update (call per tick) ─── */
  updateHUD(metrics) {
    for (const [key, entry] of Object.entries(this._hudCards)) {
      const val = metrics[key];
      if (val !== undefined && val !== null) {
        entry.el.textContent = entry.fmt(val);
      }
    }
  }

  /* ─── Append streaming data to charts ─── */
  appendMetrics(iteration, metrics) {
    try {
      ChartManager.extendTraces(this._chartDivs['chart-rrms'],  { x: [[iteration]], y: [[metrics.r_rms   || 0]] }, [0]);
      ChartManager.extendTraces(this._chartDivs['chart-kappa'], { x: [[iteration]], y: [[metrics.kappa   || 0]] }, [0]);
      ChartManager.extendTraces(this._chartDivs['chart-energy'],{ x: [[iteration]], y: [[metrics.energy_kin || 0]] }, [0]);
    } catch { /* chart not ready yet */ }
  }

  /* ─── Private: charts ─── */
  _drawCharts(history = {}) {
    const iters = history.iterations || [];
    ChartManager.createConvergenceChart(this._chartDivs['chart-rrms'], {
      x: iters, y: history.r_rms || [], title: 'r_rms Over Time', yLabel: 'r_rms'
    });
    ChartManager.createConvergenceChart(this._chartDivs['chart-kappa'], {
      x: iters, y: history.kappa || [], title: 'κ Adaptation', yLabel: 'κ'
    });
    ChartManager.createConvergenceChart(this._chartDivs['chart-energy'], {
      x: iters, y: history.energy_kin || [], title: 'Energy Evolution', yLabel: 'E_kin', logScale: true
    });
  }

  /* ─── Private: slider builder ─── */
  _createSlider(spec) {
    const group = _el('div', 'param-group');
    const row   = _el('div', 'param-row');
    const label = _el('label', 'param-label'); label.textContent = spec.label;
    const valSpan = _el('span', 'param-value'); valSpan.textContent = this._paramValues[spec.key];
    row.append(label, valSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'param-slider';
    input.min = spec.min; input.max = spec.max; input.step = spec.step;
    input.value = this._paramValues[spec.key];

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      this._paramValues[spec.key] = v;
      valSpan.textContent = v;
      this._fireParamsChange();
    });

    group.append(row, input);
    return group;
  }

  /* ─── Private: select builder ─── */
  _createSelect(key, label, options) {
    const group = _el('div', 'param-group');
    const lbl = _el('label', 'param-label'); lbl.textContent = label;
    const sel = document.createElement('select');
    sel.className = 'param-select';
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o == this._paramValues[key]) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      this._paramValues[key] = isNaN(sel.value) ? sel.value : Number(sel.value);
      this._fireParamsChange();
    });
    group.append(lbl, sel);
    return group;
  }

  /* ─── Lifecycle events ─── */
  _onStart() {
    this._running = true;
    this._btnStart.disabled = true;
    this.root.dispatchEvent(new CustomEvent('simulation-start', { bubbles: true, detail: { params: { ...this._paramValues } } }));
  }
  _onPause() {
    this._running = false;
    this._btnStart.disabled = false;
    this.root.dispatchEvent(new CustomEvent('simulation-pause', { bubbles: true }));
  }
  _onReset() {
    this._running = false;
    this._btnStart.disabled = false;
    this.root.dispatchEvent(new CustomEvent('simulation-reset', { bubbles: true, detail: { params: { ...this._paramValues } } }));
  }
  _fireParamsChange() {
    this.root.dispatchEvent(new CustomEvent('params-change', { bubbles: true, detail: { params: { ...this._paramValues } } }));
  }

  /** Expose current param snapshot */
  get params() { return { ...this._paramValues }; }
}

/* ─── Tiny DOM helpers (file-local) ─── */
function _el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function _btn(text, cls, handler) {
  const b = document.createElement('button');
  b.className = `sim-btn ${cls}`;
  b.textContent = text;
  b.addEventListener('click', handler);
  return b;
}

export default DashboardPanel;
