/**
 * octagonal-mesh-3d.js — OctagonalMesh3D
 * Interactive 3-D spheroidal visualisation of the 30-channel Orange-DMS field.
 * Each longitudinal "orange-slice" segment is colored by its E-field amplitude.
 *
 * @module ui/octagonal-mesh-3d
 */

import { ChartManager } from './charts.js';

const N_CHANNELS    = 30;
const N_LATITUDES   = 20;         // rings from pole to pole
const PTS_PER_SLICE = 6;          // azimuthal samples within each slice
const A = 1.0, B = 1.0, C = 0.75; // spheroid semi-axes (oblate)

export class OctagonalMesh3D {
  constructor(container) {
    this.root = container;
    this._selectedChannel = null;
    this._rotating = true;
    this._rotationTimer = null;
  }

  /* ─── Main render ─── */
  render(engineState = {}, params = {}) {
    this.root.innerHTML = '';
    this.root.classList.add('mesh3d-root');

    const nCh = params.n_channels || N_CHANNELS;
    const E_means = engineState.E_means || new Array(nCh).fill(0).map(() => Math.random());
    const r_rms_arr = engineState.r_rms_channels || new Array(nCh).fill(0).map(() => Math.random() * 0.05);

    // Container layout
    const wrapper = _el('div', 'mesh3d-wrapper');
    const plotDiv = _el('div', 'mesh3d-plot'); plotDiv.id = 'mesh3d-main';
    const infoPanel = _el('div', 'mesh3d-info');

    // Toggle buttons
    const btnBar = _el('div', 'mesh3d-btnbar');
    const btn3d  = _btn('3-D Mesh',  'mesh3d-toggle active', () => this._show3D(plotDiv, nCh, E_means, r_rms_arr));
    const btn2d  = _btn('2-D Heatmap','mesh3d-toggle',       () => this._showHeatmap(plotDiv, nCh, E_means));
    btnBar.append(btn3d, btn2d);

    // Detail card
    this._detailCard = _el('div', 'mesh3d-detail hud-card');
    this._detailCard.innerHTML = '<div class="hud-label">Select a channel</div>';
    infoPanel.append(btnBar, this._detailCard);

    wrapper.append(plotDiv, infoPanel);
    this.root.appendChild(wrapper);

    // Initial 3-D view
    this._show3D(plotDiv, nCh, E_means, r_rms_arr);
  }

  /* ─── 3-D scatter view ─── */
  _show3D(plotDiv, nCh, E_means, r_rms_arr) {
    const traces = [];

    for (let c = 0; c < nCh; c++) {
      const phiStart = (c * 2 * Math.PI) / nCh;
      const phiEnd   = ((c + 1) * 2 * Math.PI) / nCh;
      const xs = [], ys = [], zs = [], texts = [], colors = [];

      for (let li = 0; li <= N_LATITUDES; li++) {
        const theta = (li / N_LATITUDES) * Math.PI;  // 0 → π
        for (let pi = 0; pi <= PTS_PER_SLICE; pi++) {
          const phi = phiStart + (pi / PTS_PER_SLICE) * (phiEnd - phiStart);
          xs.push(A * Math.sin(theta) * Math.cos(phi));
          ys.push(B * Math.sin(theta) * Math.sin(phi));
          zs.push(C * Math.cos(theta));
          colors.push(E_means[c]);
          texts.push(
            `Ch ${c}  |  E_mean: ${E_means[c].toFixed(4)}<br>r_rms: ${r_rms_arr[c].toFixed(5)}`
          );
        }
      }

      traces.push({
        type: 'scatter3d',
        mode: 'markers',
        x: xs, y: ys, z: zs,
        text: texts,
        hoverinfo: 'text',
        marker: {
          size: 2.5,
          color: colors,
          colorscale: 'YlOrRd',
          cmin: 0,
          cmax: Math.max(...E_means, 1),
          showscale: c === 0,
          colorbar: c === 0 ? {
            title: 'E amplitude',
            titlefont: { color: '#A0AEC0' },
            tickfont:  { color: '#A0AEC0', family: 'JetBrains Mono, monospace', size: 10 },
            len: 0.6
          } : undefined
        },
        name: `Ch ${c}`,
        showlegend: false,
        customdata: new Array(xs.length).fill(c)
      });
    }

    const layout = {
      ...ChartManager.darkDefaults,
      title: { text: '30-Channel Spheroidal Mesh', font: { family: 'Space Grotesk, sans-serif', size: 15, color: '#E2E8F0' } },
      scene: {
        bgcolor: 'rgba(0,0,0,0)',
        xaxis: { visible: false },
        yaxis: { visible: false },
        zaxis: { visible: false },
        camera: { eye: { x: 1.6, y: 1.6, z: 0.9 } },
        aspectmode: 'data'
      },
      margin: { t: 40, r: 0, b: 0, l: 0 }
    };

    window.Plotly.newPlot(plotDiv, traces, layout, { responsive: true, displaylogo: false });

    // Click handler → inspect channel
    plotDiv.on('plotly_click', (eventData) => {
      if (eventData.points && eventData.points.length) {
        const ch = eventData.points[0].customdata;
        this._selectChannel(ch, E_means, r_rms_arr);
      }
    });

    // Auto-rotation
    this._startAutoRotation(plotDiv);

    plotDiv.on('plotly_hover', () => this._pauseRotation());
    plotDiv.on('plotly_unhover', () => this._startAutoRotation(plotDiv));
  }

  /* ─── 2-D heatmap of selected channel (or full map) ─── */
  _showHeatmap(plotDiv, nCh, E_means) {
    // Generate a synthetic 2-D field for display
    const rows = N_LATITUDES;
    const cols = nCh;
    const z = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        // Simulated intensity: E_mean modulated by latitude
        const theta = (r / rows) * Math.PI;
        row.push(E_means[c] * Math.sin(theta) + (Math.random() * 0.05));
      }
      z.push(row);
    }

    const layout = {
      title: { text: 'E-Field Heatmap (θ × Channel)', font: { family: 'Space Grotesk, sans-serif', size: 14, color: '#E2E8F0' } },
      xaxis: { title: 'Channel', dtick: 5 },
      yaxis: { title: 'Latitude index' }
    };
    ChartManager.createHeatmap(plotDiv, z, layout);
  }

  /* ─── Channel detail card ─── */
  _selectChannel(ch, E_means, r_rms_arr) {
    this._selectedChannel = ch;
    this._detailCard.innerHTML = `
      <div class="hud-label">Channel ${ch}</div>
      <div class="hud-value hud-value-gradient">${E_means[ch].toFixed(5)}</div>
      <div class="hud-unit">E_mean</div>
      <div style="margin-top:8px">
        <span class="hud-label">r_rms</span>
        <span class="hud-value" style="font-size:1.1rem;margin-left:8px">${r_rms_arr[ch].toFixed(6)}</span>
      </div>
    `;
    this.root.dispatchEvent(new CustomEvent('channel-selected', { bubbles: true, detail: { channel: ch } }));
  }

  /* ─── Auto-rotation helpers ─── */
  _startAutoRotation(plotDiv) {
    this._pauseRotation();
    let angle = 0;
    this._rotationTimer = setInterval(() => {
      angle += 0.5;
      const rad = (angle * Math.PI) / 180;
      const eye = { x: 1.8 * Math.cos(rad), y: 1.8 * Math.sin(rad), z: 0.9 };
      window.Plotly.relayout(plotDiv, { 'scene.camera.eye': eye }).catch(() => {});
    }, 60);
  }
  _pauseRotation() {
    if (this._rotationTimer) { clearInterval(this._rotationTimer); this._rotationTimer = null; }
  }
}

/* ─── Helpers ─── */
function _el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function _btn(text, cls, handler) {
  const b = document.createElement('button'); b.className = cls; b.textContent = text;
  b.addEventListener('click', handler); return b;
}

export default OctagonalMesh3D;
