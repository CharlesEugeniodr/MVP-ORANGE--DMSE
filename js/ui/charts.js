/**
 * charts.js — ChartManager
 * Unified Plotly.js wrapper for the Orange-DMSE visualization layer.
 * All charts share a consistent dark-theme aesthetic with orange/red accents.
 *
 * @module ui/charts
 */

const ORANGE_PALETTE = [
  '#FF5E00', '#FF9E00', '#FF2E00',
  '#3182CE', '#319795', '#EF5350'
];

const DARK_LAYOUT_DEFAULTS = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(15,20,30,0.4)',
  font: {
    family: 'Outfit, sans-serif',
    color: '#A0AEC0',
    size: 12
  },
  margin: { t: 36, r: 24, b: 40, l: 48 },
  legend: {
    bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#A0AEC0', size: 11 },
    orientation: 'h',
    y: -0.18
  },
  xaxis: {
    gridcolor: 'rgba(160,174,192,0.10)',
    zerolinecolor: 'rgba(160,174,192,0.15)',
    tickfont: { family: 'JetBrains Mono, monospace', size: 10 }
  },
  yaxis: {
    gridcolor: 'rgba(160,174,192,0.10)',
    zerolinecolor: 'rgba(160,174,192,0.15)',
    tickfont: { family: 'JetBrains Mono, monospace', size: 10 }
  },
  hoverlabel: {
    bgcolor: 'rgba(25,30,40,0.92)',
    bordercolor: '#FF5E00',
    font: { family: 'JetBrains Mono, monospace', size: 11, color: '#E2E8F0' }
  }
};

const PLOTLY_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d']
};

export class ChartManager {

  /**
   * Merge user layout with dark defaults. User values win.
   */
  static _mergeLayout(userLayout = {}) {
    const merged = JSON.parse(JSON.stringify(DARK_LAYOUT_DEFAULTS));
    // Deep-merge top-level keys
    for (const key of Object.keys(userLayout)) {
      if (typeof userLayout[key] === 'object' && !Array.isArray(userLayout[key]) && merged[key]) {
        merged[key] = { ...merged[key], ...userLayout[key] };
      } else {
        merged[key] = userLayout[key];
      }
    }
    return merged;
  }

  /**
   * Assign palette colors to traces that lack explicit color.
   */
  static _applyPalette(traces) {
    return traces.map((t, i) => {
      const trace = { ...t };
      if (!trace.marker) trace.marker = {};
      if (!trace.line) trace.line = {};
      const color = ORANGE_PALETTE[i % ORANGE_PALETTE.length];
      if (!trace.marker.color) trace.marker.color = color;
      if (!trace.line.color) trace.line.color = color;
      return trace;
    });
  }

  /* ─── Public API ─── */

  /**
   * Generic line chart.
   * @param {HTMLElement} container
   * @param {Array} traces   — Plotly trace objects (x, y, name, …)
   * @param {Object} layout  — optional overrides
   */
  static createLineChart(container, traces, layout = {}) {
    const coloredTraces = this._applyPalette(
      traces.map(t => ({ mode: 'lines', type: 'scatter', ...t }))
    );
    const merged = this._mergeLayout(layout);
    window.Plotly.newPlot(container, coloredTraces, merged, PLOTLY_CONFIG);
  }

  /**
   * Bar chart.
   */
  static createBarChart(container, data, layout = {}) {
    const coloredData = data.map((d, i) => ({
      type: 'bar',
      marker: { color: d.marker?.color || ORANGE_PALETTE[i % ORANGE_PALETTE.length],
                 opacity: 0.85 },
      ...d
    }));
    const merged = this._mergeLayout({ bargap: 0.25, ...layout });
    window.Plotly.newPlot(container, coloredData, merged, PLOTLY_CONFIG);
  }

  /**
   * 3-D scatter plot.
   */
  static createScatter3D(container, data, layout = {}) {
    const traces = data.map((d, i) => ({
      type: 'scatter3d',
      mode: 'markers',
      marker: { size: 3, color: d.marker?.color || ORANGE_PALETTE[i % ORANGE_PALETTE.length],
                 opacity: 0.8 },
      ...d
    }));
    const scene = {
      bgcolor: 'rgba(0,0,0,0)',
      xaxis: { gridcolor: 'rgba(160,174,192,0.08)', color: '#A0AEC0' },
      yaxis: { gridcolor: 'rgba(160,174,192,0.08)', color: '#A0AEC0' },
      zaxis: { gridcolor: 'rgba(160,174,192,0.08)', color: '#A0AEC0' }
    };
    const merged = this._mergeLayout({ scene, ...layout });
    window.Plotly.newPlot(container, traces, merged, PLOTLY_CONFIG);
  }

  /**
   * Heatmap.
   * @param {Array<Array<number>>} zData — 2-D matrix
   */
  static createHeatmap(container, zData, layout = {}) {
    const trace = {
      z: zData,
      type: 'heatmap',
      colorscale: 'YlOrRd',
      colorbar: {
        tickfont: { color: '#A0AEC0', family: 'JetBrains Mono, monospace', size: 10 },
        titlefont: { color: '#A0AEC0' }
      }
    };
    const merged = this._mergeLayout(layout);
    window.Plotly.newPlot(container, [trace], merged, PLOTLY_CONFIG);
  }

  /**
   * Update existing chart in-place (e.g. streaming new data).
   * @param {HTMLElement} container — the same div used in create*
   * @param {Array} traces — updated trace objects (same index order)
   * @param {Object} layoutUpdate — optional layout patches
   */
  static updateChart(container, traces, layoutUpdate = {}) {
    const indices = traces.map((_, i) => i);
    window.Plotly.update(container, traces, layoutUpdate, indices);
  }

  /**
   * Extend existing traces with new points (append).
   */
  static extendTraces(container, update, traceIndices) {
    window.Plotly.extendTraces(container, update, traceIndices);
  }

  /**
   * Convenience: convergence line chart (r_rms, κ, or energy over iterations).
   */
  static createConvergenceChart(container, { x, y, title, yLabel, logScale = false }) {
    const traces = [{ x, y, name: yLabel || title, line: { width: 2 } }];
    const layout = {
      title: { text: title, font: { family: 'Space Grotesk, sans-serif', size: 14, color: '#E2E8F0' } },
      xaxis: { title: 'Iteration' },
      yaxis: { title: yLabel || '', type: logScale ? 'log' : 'linear' }
    };
    this.createLineChart(container, traces, layout);
  }

  /**
   * Convenience: multi-model comparison overlay.
   */
  static createComparisonOverlay(container, models, layout = {}) {
    // models: [{ name, x, y, dash, color, mode }]
    const traces = models.map(m => ({
      x: m.x,
      y: m.y,
      name: m.name,
      mode: m.mode || 'lines',
      line: { color: m.color, dash: m.dash || 'solid', width: m.width || 2 },
      marker: m.marker || {}
    }));
    this.createLineChart(container, traces, layout);
  }

  /**
   * Convenience: energy evolution (log-scale y-axis).
   */
  static createEnergyEvolution(container, { x, kinetic, potential, total }) {
    const traces = [
      { x, y: kinetic,   name: 'E_kin',   line: { color: '#FF5E00', width: 2 } },
      { x, y: potential,  name: 'E_pot',   line: { color: '#3182CE', width: 2, dash: 'dot' } },
      { x, y: total,      name: 'E_total', line: { color: '#FF9E00', width: 2.5 } }
    ];
    const layout = {
      title: { text: 'Energy Evolution', font: { family: 'Space Grotesk, sans-serif', size: 14, color: '#E2E8F0' } },
      yaxis: { title: 'Energy', type: 'log' }
    };
    this.createLineChart(container, traces, layout);
  }

  /** Expose palette for external consumers. */
  static get palette() { return [...ORANGE_PALETTE]; }
  static get darkDefaults() { return JSON.parse(JSON.stringify(DARK_LAYOUT_DEFAULTS)); }
}

export default ChartManager;
