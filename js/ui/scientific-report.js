/**
 * scientific-report.js — ScientificReportPanel
 * Formal certification report: sanity tests, motor PDE audit (the "open" motor),
 * SHA-256 integrity, dimensional summary, and export capabilities.
 *
 * @module ui/scientific-report
 */

/* ── Status helpers ── */
const ST = {
  PASS:    { emoji: '🟢', label: 'PASS',    cls: 'status-pass',    color: '#66BB6A' },
  WARNING: { emoji: '🟡', label: 'WARNING', cls: 'status-warning', color: '#FFA726' },
  FAIL:    { emoji: '🔴', label: 'FAIL',    cls: 'status-fail',    color: '#EF5350' }
};

/* ── Sanity test definitions ── */
const SANITY_TESTS = [
  {
    id: 'dimensional_consistency',
    name: 'Dimensional Consistency',
    description: 'Verify that all 30 channels have consistent physical units (energy density, field strength, coupling constants).',
    run: (sim) => {
      const d = sim.dimensionCheck || {};
      if (d.allConsistent) return { status: 'PASS', detail: 'All 30 channels dimensionally consistent.' };
      if (d.inconsistentCount <= 2) return { status: 'WARNING', detail: `${d.inconsistentCount} channel(s) show marginal dimensional mismatch.` };
      return { status: 'FAIL', detail: `${d.inconsistentCount || '?'} channels dimensionally inconsistent.` };
    }
  },
  {
    id: 'energy_conservation',
    name: 'Energy Conservation',
    description: 'ΔE_total / E_total < threshold over full simulation run.',
    run: (sim) => {
      const drift = sim.energy_drift ?? null;
      if (drift === null) return { status: 'WARNING', detail: 'Energy drift not computed (insufficient iterations).' };
      if (Math.abs(drift) < 1e-6) return { status: 'PASS', detail: `ΔE/E = ${drift.toExponential(2)} — within symplectic tolerance.` };
      if (Math.abs(drift) < 1e-3) return { status: 'WARNING', detail: `ΔE/E = ${drift.toExponential(2)} — marginal drift detected.` };
      return { status: 'FAIL', detail: `ΔE/E = ${drift.toExponential(2)} — energy NOT conserved.` };
    }
  },
  {
    id: 'attractor_stability',
    name: 'Attractor Stability',
    description: 'r_rms converges to target within tolerance after κ adaptation.',
    run: (sim) => {
      const conv = sim.r_rms_converged;
      if (conv === true) return { status: 'PASS', detail: `r_rms converged to target (final: ${(sim.r_rms_final ?? 0).toExponential(3)}).` };
      if (conv === false) return { status: 'FAIL', detail: 'r_rms did NOT converge within allocated iterations.' };
      return { status: 'WARNING', detail: 'Convergence status indeterminate.' };
    }
  },
  {
    id: 'parameter_universality',
    name: 'Parameter Universality',
    description: 'Orange-DMS parameters produce consistent results across 3+ galaxy datasets.',
    run: (sim, _val, comp) => {
      const galaxiesOK = comp?.universality_count ?? 0;
      if (galaxiesOK >= 3) return { status: 'PASS', detail: `Parameters universal across ${galaxiesOK} galaxies.` };
      if (galaxiesOK >= 1) return { status: 'WARNING', detail: `Only ${galaxiesOK} galaxy(ies) fitted — universality unproven.` };
      return { status: 'FAIL', detail: 'No galaxy fits achieved.' };
    }
  },
  {
    id: 'symplectic_stability',
    name: 'Symplectic Stability',
    description: 'Leapfrog / Störmer-Verlet integrator preserves phase-space volume.',
    run: (sim) => {
      const poincare = sim.poincare_invariant ?? null;
      if (poincare === null) return { status: 'WARNING', detail: 'Poincaré invariant not yet computed.' };
      if (Math.abs(poincare - 1) < 0.01) return { status: 'PASS', detail: `Poincaré invariant = ${poincare.toFixed(4)} ≈ 1.` };
      return { status: 'FAIL', detail: `Poincaré invariant = ${poincare.toFixed(4)} — symplecticity broken.` };
    }
  },
  {
    id: 'cross_falsifiability',
    name: 'Cross-Falsifiability',
    description: 'At least one dimension yields a testable, non-trivial prediction that could be falsified by future observations.',
    run: (_sim, val) => {
      const falsifiable = val?.falsifiable_count ?? 0;
      if (falsifiable >= 5) return { status: 'PASS', detail: `${falsifiable} dimensions produce falsifiable predictions.` };
      if (falsifiable >= 1) return { status: 'WARNING', detail: `Only ${falsifiable} falsifiable prediction(s).` };
      return { status: 'FAIL', detail: 'No falsifiable predictions identified.' };
    }
  }
];

export class ScientificReportPanel {
  constructor(container) {
    this.root = container;
  }

  /* ─── Main render ─── */
  async render(simulationData = {}, validationResults = {}, comparativeResults = {}) {
    this.root.innerHTML = '';
    this.root.classList.add('report-root');

    const testResults = SANITY_TESTS.map(t => ({
      ...t,
      result: t.run(simulationData, validationResults, comparativeResults)
    }));

    const verdict = this._computeVerdict(testResults);
    const hash = await this._computeHash(simulationData, validationResults);

    // ── Certificate wrapper
    const cert = _el('div', 'certificate');

    // Header
    const header = _el('div', 'cert-header');
    const verdictColor = verdict === 'APPROVED' ? '#66BB6A' : verdict === 'APPROVED_WITH_CAVEATS' ? '#FFA726' : '#EF5350';
    header.innerHTML = `
      <h1 class="cert-title" style="border-color:${verdictColor}">
        CERTIFICADO DE CONFORMIDADE DMS-2026
      </h1>
      <div class="cert-subtitle">Orange Dynamic Matter Simulation Engine — Audit Report</div>
      <div class="cert-date">${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC</div>
      <div class="cert-verdict" style="color:${verdictColor};border-color:${verdictColor}">
        ${verdict === 'APPROVED' ? '✅' : verdict === 'APPROVED_WITH_CAVEATS' ? '⚠️' : '❌'}
        ${verdict.replace(/_/g, ' ')}
      </div>
    `;
    cert.appendChild(header);

    // ── Sanity tests
    const testsSection = _el('div', 'cert-section');
    testsSection.innerHTML = '<h2 class="cert-section-title">Automated Sanity Tests</h2>';
    testResults.forEach(t => {
      const s = ST[t.result.status];
      const card = _el('div', `cert-test-card ${s.cls}`);
      card.innerHTML = `
        <div class="cert-test-header">
          <span class="status-badge ${s.cls}">${s.emoji} ${s.label}</span>
          <strong>${t.name}</strong>
        </div>
        <div class="cert-test-desc">${t.description}</div>
        <div class="cert-test-detail">${t.result.detail}</div>
      `;
      testsSection.appendChild(card);
    });
    cert.appendChild(testsSection);

    // ── Motor PDE Audit (Open Motor)
    const motorSection = _el('div', 'cert-section');
    motorSection.innerHTML = `
      <h2 class="cert-section-title">Motor PDE Audit — Open Computation Log</h2>
      <p class="cert-motor-intro">The following is a step-by-step record of the internal PDE integration, 
      exposing the "closed motor" for full transparency and reproducibility.</p>
      <div class="cert-motor-log">
        ${this._buildMotorLog(simulationData)}
      </div>
    `;
    cert.appendChild(motorSection);

    // ── Parameter table
    const paramSection = _el('div', 'cert-section');
    paramSection.innerHTML = `
      <h2 class="cert-section-title">Engine Parameters</h2>
      ${this._buildParamTable(simulationData.params || {})}
    `;
    cert.appendChild(paramSection);

    // ── Dimensional map summary
    const dimSection = _el('div', 'cert-section');
    dimSection.innerHTML = `
      <h2 class="cert-section-title">30-D Dimensional Map Summary</h2>
      ${this._buildDimSummary(validationResults)}
    `;
    cert.appendChild(dimSection);

    // ── Integrity hash
    const hashSection = _el('div', 'cert-section');
    hashSection.innerHTML = `
      <h2 class="cert-section-title">Integrity Verification</h2>
      <div class="cert-hash-card hud-card">
        <div class="hud-label">SHA-256 Hash (parameters + results)</div>
        <div class="cert-hash-value">${hash}</div>
      </div>
    `;
    cert.appendChild(hashSection);

    // ── Export buttons
    const exportRow = _el('div', 'cert-export-row');
    exportRow.appendChild(_btn('⬇ Export JSON Report', 'sim-btn btn-start', () =>
      this._exportJSON(simulationData, validationResults, comparativeResults, testResults, verdict, hash)));
    exportRow.appendChild(_btn('🖨 Print Report', 'sim-btn btn-pause', () => this._printReport()));
    cert.appendChild(exportRow);

    this.root.appendChild(cert);
  }

  /* ─── Verdict logic ─── */
  _computeVerdict(tests) {
    const statuses = tests.map(t => t.result.status);
    if (statuses.includes('FAIL')) return 'REJECTED';
    if (statuses.includes('WARNING')) return 'APPROVED_WITH_CAVEATS';
    return 'APPROVED';
  }

  /* ─── SHA-256 ─── */
  async _computeHash(simData, valData) {
    const payload = JSON.stringify({ params: simData.params, metrics: simData.metrics, validation: valData });
    try {
      const msgBuffer = new TextEncoder().encode(payload);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback if crypto.subtle unavailable
      let h = 0;
      for (let i = 0; i < payload.length; i++) { h = ((h << 5) - h) + payload.charCodeAt(i); h |= 0; }
      return 'fallback-' + Math.abs(h).toString(16).padStart(16, '0');
    }
  }

  /* ─── Motor PDE log ─── */
  _buildMotorLog(sim) {
    const steps = sim.motor_log || [
      { step: 1, operation: 'Initialize E-field grid',      detail: `N = ${sim.params?.grid_size || 128}, Δx = L/N` },
      { step: 2, operation: 'Set boundary conditions',      detail: `Type: ${sim.params?.boundary || 'periodic'}` },
      { step: 3, operation: 'Compute Laplacian ∇²E',        detail: 'Central-difference stencil, 2nd order' },
      { step: 4, operation: 'Apply diffusion: ∂E/∂t += α∇²E', detail: `α = ${sim.params?.alpha || 1.0}` },
      { step: 5, operation: 'Apply nonlinear source: -ρE³ + E₀', detail: `ρ = ${sim.params?.rho || 1.0}, E₀ = ${sim.params?.E0 || 1.0}` },
      { step: 6, operation: 'Apply damping: -η·E',          detail: `η = ${sim.params?.eta || 0.05}` },
      { step: 7, operation: 'Inter-channel coupling',       detail: `strength = ${sim.params?.coupling_strength || 0.05}` },
      { step: 8, operation: 'Compute r_rms = √(⟨E²⟩)',     detail: 'Spatial RMS over grid' },
      { step: 9, operation: 'κ adaptation: κ += gain·(r_rms − target)', detail: `target = ${sim.params?.r_rms_target || 0.01}` },
      { step: 10, operation: 'Update dt (CFL condition)',   detail: 'dt = CFL·Δx² / max(α, ρ)' }
    ];

    return `<table class="audit-table motor-table">
      <thead><tr><th>#</th><th>Operation</th><th>Detail</th></tr></thead>
      <tbody>${steps.map(s =>
        `<tr><td class="dim-num">${s.step}</td><td>${s.operation}</td><td class="motor-detail">${s.detail}</td></tr>`
      ).join('')}</tbody>
    </table>`;
  }

  /* ─── Parameter table ─── */
  _buildParamTable(params) {
    const keys = Object.keys(params);
    if (keys.length === 0) {
      return '<p class="muted">No parameters recorded. Run a simulation first.</p>';
    }
    let html = '<table class="audit-table"><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>';
    keys.forEach(k => { html += `<tr><td>${k}</td><td class="motor-detail">${params[k]}</td></tr>`; });
    html += '</tbody></table>';
    return html;
  }

  /* ─── 30-D summary ─── */
  _buildDimSummary(val) {
    const dims = val?.dimensions || [];
    if (dims.length === 0) return '<p class="muted">Dimensional validation not yet available.</p>';

    let html = '<table class="audit-table"><thead><tr><th>Dim</th><th>Overall</th><th>Notes</th></tr></thead><tbody>';
    dims.forEach((d, i) => {
      const statusKey = d.overall || 'INDETERMINATE';
      const s = ST[statusKey] || { emoji: '⚪', label: statusKey, cls: 'status-indeterminate' };
      html += `<tr>
        <td class="dim-num">D${i + 1}</td>
        <td><span class="status-badge ${s.cls}">${s.emoji} ${s.label}</span></td>
        <td>${d.notes || '—'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    return html;
  }

  /* ─── Export ─── */
  _exportJSON(sim, val, comp, tests, verdict, hash) {
    const report = {
      title: 'CERTIFICADO DE CONFORMIDADE DMS-2026',
      generated: new Date().toISOString(),
      verdict,
      sha256: hash,
      tests: tests.map(t => ({ id: t.id, name: t.name, ...t.result })),
      params: sim.params || {},
      metrics: sim.metrics || {},
      validation: val,
      comparative: comp
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'orange-dms-report.json';
    a.click(); URL.revokeObjectURL(a.href);
  }

  _printReport() {
    this.root.classList.add('print-mode');
    window.print();
    setTimeout(() => this.root.classList.remove('print-mode'), 1000);
  }
}

/* ─── Helpers ─── */
function _el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function _btn(text, cls, handler) {
  const b = document.createElement('button'); b.className = cls; b.textContent = text;
  b.addEventListener('click', handler); return b;
}

export default ScientificReportPanel;
