/**
 * @fileoverview Comparative astrophysical rotation-curve models.
 *
 * Models implemented:
 *   1. Newtonian   — baryonic only: V = √(Vdisk² + Vbulge² + Vgas²)
 *   2. MOND        — Modified Newtonian Dynamics, simple µ(x) = x/(1+x)
 *   3. ΛCDM / NFW  — Navarro-Frenk-White dark-matter halo profile
 *   4. Orange-DMS  — Dimensional Mesh Simulation additional acceleration
 *
 * The `compareModels()` function fits all four to a given galaxy's data
 * and returns a full suite of comparison metrics.
 *
 * @module comparative-models
 */

import {
  chiSquared,
  rSquaredAdjusted,
  mape,
  aicBicFromRSS,
  bayesFactor,
  cohensD,
  rmse,
} from './metrics.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** MOND critical acceleration (m/s²) */
const A0_MOND = 1.2e-10;

/** Gravitational constant (m³ kg⁻¹ s⁻²) – used only for unit context */
const G = 6.674e-11;

// ─── Model functions ───────────────────────────────────────────────────────────

/**
 * Newtonian (baryonic-only) circular velocity.
 *
 *   V = √(V_disk² + V_bulge² + V_gas²)
 *
 * @param {number} disk  - Disk contribution (km/s)
 * @param {number} bulge - Bulge contribution (km/s)
 * @param {number} gas   - Gas contribution (km/s)
 * @returns {number} Total Newtonian velocity (km/s)
 */
export function velocityNewtonian(disk, bulge, gas) {
  return Math.sqrt(disk * disk + bulge * bulge + gas * gas);
}

/**
 * MOND circular velocity using the simple interpolation function.
 *
 * Given the baryonic (Newtonian) velocity V_bar at radius R, the MOND
 * effective gravitational acceleration satisfies:
 *
 *   µ(g/a₀) · g = g_N        where µ(x) = x / (1 + x)
 *
 * Solving the resulting quadratic:
 *   g_N = V_bar² / R
 *   g = [ -a₀ + √(a₀² + 4·a₀·g_N) ] / 2
 *   V_MOND = √(g · R)
 *
 * @param {number} vBar  - Baryonic velocity √(Vd²+Vb²+Vg²) in km/s
 * @param {number} R_kpc - Galactocentric radius in kpc
 * @returns {number} MOND velocity (km/s)
 */
export function velocityMOND(vBar, R_kpc) {
  // Convert to SI for the acceleration calculation
  const R_m  = R_kpc * 3.0857e19;           // kpc → m
  const vBar_ms = vBar * 1e3;               // km/s → m/s
  const gN   = (vBar_ms * vBar_ms) / R_m;   // Newtonian acceleration (m/s²)

  // Solve quadratic: µ(x)·g = gN  with µ(x)=x/(1+x)  ⇒  g² + a0·g − a0·gN = 0
  //   (taking the positive root)
  const discriminant = A0_MOND * A0_MOND + 4.0 * A0_MOND * gN;
  const gMond = (-A0_MOND + Math.sqrt(discriminant)) / 2.0;

  // Back to km/s
  const vMond = Math.sqrt(gMond * R_m) / 1e3;
  return vMond;
}

/**
 * NFW (Navarro-Frenk-White) dark-matter halo circular velocity.
 *
 *   V_halo(R) = V₂₀₀ · √{ [ln(1 + c·x) − c·x/(1 + c·x)] / [x · (ln(1+c) − c/(1+c))] }
 *
 * where x = R / R₂₀₀,  R₂₀₀ = c · Rs.
 *
 * @param {number} R_kpc - Radius in kpc
 * @param {number} V200  - Virial velocity (km/s)
 * @param {number} c     - Concentration parameter
 * @param {number} Rs    - Scale radius (kpc)
 * @returns {number} NFW halo velocity (km/s)
 */
export function velocityNFW(R_kpc, V200, c, Rs) {
  const R200 = c * Rs;
  const x    = R_kpc / R200;
  const cx   = c * x;

  const numerator   = Math.log(1 + cx) - cx / (1 + cx);
  const denominator = x * (Math.log(1 + c) - c / (1 + c));

  if (denominator <= 0 || x <= 0) return 0;

  return V200 * Math.sqrt(numerator / denominator);
}

/**
 * Orange-DMS additional acceleration model.
 *
 * Adds a DMS-derived acceleration to the baryonic velocity:
 *
 *   a_add = γ · E_mean · √κ · 1e−10 / (1 + (R/Rs)^β)
 *   V_DMS = √(V_bar² + a_add · R)
 *
 * @param {number} vBar    - Baryonic velocity (km/s)
 * @param {number} R_kpc   - Radius (kpc)
 * @param {number} gamma   - DMS coupling strength
 * @param {number} Rs      - Scale radius (kpc)
 * @param {number} beta    - Radial fall-off exponent
 * @param {number} E_mean  - Mean field amplitude from PDE
 * @param {number} kappa   - κ value from the adaptive controller
 * @returns {number} Orange-DMS velocity (km/s)
 */
export function velocityOrangeDMS(vBar, R_kpc, gamma, Rs, beta, E_mean, kappa) {
  const R_m   = R_kpc * 3.0857e19;           // kpc → m
  const a_add = (gamma * E_mean * Math.sqrt(kappa) * 1e-10)
              / (1.0 + Math.pow(R_kpc / Rs, beta));

  const vBar_ms  = vBar * 1e3;               // km/s → m/s
  const vDMS_ms  = Math.sqrt(vBar_ms * vBar_ms + a_add * R_m);
  return vDMS_ms / 1e3;                      // m/s → km/s
}

// ─── compareModels ─────────────────────────────────────────────────────────────

/**
 * Fit all four models to a galaxy's rotation-curve data and return
 * comparative metrics.
 *
 * @param {Object} galaxyData - From SPARC_CATALOG:
 *   { R, Vobs, Vobs_err, Vdisk, Vbulge, Vgas }
 * @param {Object} orangeParams - Orange-DMS model parameters:
 *   { gamma, Rs, beta, E_mean, kappa }
 * @param {Object} [nfwParams] - NFW parameters { V200, c, Rs }
 * @returns {Object} Comparison results with per-model metrics
 */
export function compareModels(galaxyData, orangeParams, nfwParams) {
  const { R, Vobs, Vobs_err, Vdisk, Vbulge, Vgas } = galaxyData;
  const N = R.length;

  // Default NFW parameters if not provided
  const nfw = nfwParams || { V200: 120, c: 12, Rs: 15 };

  // ── Compute model predictions ──────────────────────────────────────
  const vNewton = [];
  const vMond   = [];
  const vNfw    = [];
  const vOrange = [];

  for (let i = 0; i < N; i++) {
    const d = Vdisk[i];
    const b = Vbulge[i];
    const g = Vgas[i];
    const r = R[i];

    // 1. Newtonian
    vNewton.push(velocityNewtonian(d, b, g));

    // 2. MOND
    const vBar = velocityNewtonian(d, b, g);
    vMond.push(velocityMOND(vBar, r));

    // 3. NFW (total = sqrt(baryonic² + halo²))
    const vHalo = velocityNFW(r, nfw.V200, nfw.c, nfw.Rs);
    vNfw.push(Math.sqrt(vBar * vBar + vHalo * vHalo));

    // 4. Orange-DMS
    vOrange.push(velocityOrangeDMS(
      vBar, r,
      orangeParams.gamma,
      orangeParams.Rs,
      orangeParams.beta,
      orangeParams.E_mean,
      orangeParams.kappa
    ));
  }

  // ── Compute metrics for each model ─────────────────────────────────
  const models = [
    { name: 'Newtonian',  predictions: vNewton, nParams: 0 },
    { name: 'MOND',       predictions: vMond,   nParams: 1 },  // a0
    { name: 'NFW/LCDM',   predictions: vNfw,    nParams: 3 },  // V200, c, Rs
    { name: 'Orange-DMS',  predictions: vOrange, nParams: 4 },  // gamma, Rs, beta, E_mean
  ];

  const results = {};

  for (const model of models) {
    const { name, predictions, nParams } = model;

    // RSS
    let rss = 0;
    for (let i = 0; i < N; i++) {
      rss += (Vobs[i] - predictions[i]) ** 2;
    }

    // Chi-squared
    const chi2Result = chiSquared(Vobs, Vobs_err, predictions, nParams);

    // R² adjusted
    const r2Result = rSquaredAdjusted(Vobs, predictions, nParams);

    // MAPE
    const mapeVal = mape(Vobs, predictions);

    // RMSE
    const rmseVal = rmse(Vobs, predictions);

    // AIC / BIC
    const { aic, bic } = aicBicFromRSS(rss, N, nParams);

    results[name] = {
      predictions,
      nParams,
      rss,
      rmse:          rmseVal,
      chi2:          chi2Result.chi2,
      chi2_reduced:  chi2Result.chi2_reduced,
      dof:           chi2Result.dof,
      r2:            r2Result.r2,
      r2_adj:        r2Result.r2_adj,
      mape:          mapeVal,
      aic,
      bic,
    };
  }

  // ── Cross-model comparisons ────────────────────────────────────────
  const comparisons = {};

  // Bayes Factor: Orange-DMS vs each alternative
  for (const altName of ['Newtonian', 'MOND', 'NFW/LCDM']) {
    const bf = bayesFactor(results['Orange-DMS'].bic, results[altName].bic);
    comparisons[`Orange-DMS_vs_${altName}`] = bf;
  }

  // Cohen's d: Orange-DMS residuals vs each alternative residuals
  const orangeResiduals = Vobs.map((v, i) => v - results['Orange-DMS'].predictions[i]);
  for (const altName of ['Newtonian', 'MOND', 'NFW/LCDM']) {
    const altResiduals = Vobs.map((v, i) => v - results[altName].predictions[i]);
    const cd = cohensD(
      orangeResiduals.map(Math.abs),
      altResiduals.map(Math.abs)
    );
    comparisons[`cohensD_Orange-DMS_vs_${altName}`] = cd;
  }

  return { models: results, comparisons, N };
}
