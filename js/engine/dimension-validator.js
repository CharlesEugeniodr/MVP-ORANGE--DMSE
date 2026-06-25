/**
 * @fileoverview Dimension Validator — 30-channel falsifiability tester.
 *
 * For every channel (dimension) d ∈ [0, 29] the validator runs six
 * independent tests and classifies the dimension as one of:
 *
 *   PROVEN        — converged, stable, contributes uniquely
 *   SATURATED     — converged but kinetic energy has flatlined
 *   FALLIBLE      — failed one or more tests
 *   INDETERMINATE — not enough data or borderline results
 *
 * Tests
 * ─────
 * 1. Convergence       r_rms(d) ≤ target
 * 2. Energy saturation ΔE_kin(d) in last 20 % of history
 * 3. Temporal stability σ(E(d)) in last 50 % of history
 * 4. Pair impact       Δ(r_rms_global) when pair is decoupled
 * 5. Parametric sensitivity  ∂(r_rms)/∂(E(d))
 * 6. Cross-falsifiability    saturating one dim → effect on others
 *
 * @module dimension-validator
 */

import { DMSEngine, computeMetrics } from './orange-core.js';

// ─── Status enum ───────────────────────────────────────────────────────────────

/** @enum {string} */
export const DimensionStatus = Object.freeze({
  PROVEN:        'PROVEN',
  SATURATED:     'SATURATED',
  FALLIBLE:      'FALLIBLE',
  INDETERMINATE: 'INDETERMINATE',
});

// ─── Thresholds ────────────────────────────────────────────────────────────────

/** @type {Object} Default thresholds used by the six tests. */
const THRESHOLDS = Object.freeze({
  /** Test 1 – Convergence: r_rms must be ≤ this multiple of r_rms_target */
  convergenceFactor: 1.5,

  /** Test 2 – Saturation: relative change in E_kin in last 20 % must exceed this */
  saturationRelChange: 0.01,

  /** Test 3 – Stability: coefficient of variation of r_rms in last 50 % must be ≤ this */
  stabilityCV: 0.25,

  /** Test 4 – Pair impact: r_rms_global must change by at least this fraction */
  pairImpactMinDelta: 0.005,

  /** Test 5 – Sensitivity: relative Δ(r_rms) per unit perturbation */
  sensitivityMinDelta: 0.001,

  /** Test 6 – Cross-falsifiability: max allowed fraction of other dims whose status flips */
  crossFalsifiabilityMaxFlip: 0.5,
});

// ─── DimensionResult ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} TestDetail
 * @property {string}  name    - Human-readable test name
 * @property {boolean} passed  - Whether this test passed
 * @property {number}  value   - Measured metric value
 * @property {number}  threshold - Threshold used
 * @property {string}  [note]  - Optional explanatory note
 */

/**
 * @typedef {Object} DimensionResult
 * @property {number}        dimension - Channel index (0–29)
 * @property {string}        status    - One of DimensionStatus values
 * @property {TestDetail[]}  tests     - Array of 6 test results
 * @property {number}        r_rms     - Final residual RMS for this channel
 * @property {number}        kappa     - Final κ for this channel
 */

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mean of an array.
 * @param {number[]} arr
 * @returns {number}
 */
function mean(arr) {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/**
 * Standard deviation (population) of an array.
 * @param {number[]} arr
 * @returns {number}
 */
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += (arr[i] - m) ** 2;
  return Math.sqrt(s / arr.length);
}

/**
 * Run a short engine simulation and return final metrics.
 * @param {object} paramOverrides
 * @param {number} steps
 * @param {number} seed
 * @returns {{ engine: DMSEngine, metrics: object }}
 */
function quickRun(paramOverrides, steps, seed = 42) {
  const engine = new DMSEngine(paramOverrides);
  engine.reset(seed);
  let metrics;
  for (let i = 0; i < steps; i++) {
    metrics = engine.step();
  }
  return { engine, metrics };
}

// ─── DimensionValidator ────────────────────────────────────────────────────────

/**
 * Validates all 30 dimensions of the Orange-DMSE engine through a battery
 * of six falsifiability tests.
 */
export class DimensionValidator {
  /**
   * @param {Object} [thresholdOverrides] - Override any default threshold
   */
  constructor(thresholdOverrides = {}) {
    /** @type {Object} */
    this.thresholds = { ...THRESHOLDS, ...thresholdOverrides };
  }

  /**
   * Run all six tests on all 30 channels.
   *
   * @param {DMSEngine}  engine  - A fully-initialised engine (call reset first)
   * @param {object}     params  - Engine params (engine.params)
   * @param {number}     [steps=200] - Number of simulation steps to run
   * @returns {DimensionResult[]} Array of 30 results
   */
  validateAll(engine, params, steps = 200) {
    // ── Phase 1: Run the baseline simulation ────────────────────────────
    engine.reset(42);
    let baseMetrics;
    for (let i = 0; i < steps; i++) {
      baseMetrics = engine.step();
    }

    const C       = params.n_channels;
    const state   = engine.state;
    const results = [];

    // ── Phase 2: Per-dimension tests ────────────────────────────────────
    for (let d = 0; d < C; d++) {
      const tests = [];

      // ─ Test 1: Convergence ─────────────────────────────────────────
      const rRms     = baseMetrics.r_rms[d];
      const convThresh = params.r_rms_target * this.thresholds.convergenceFactor;
      const convPass = rRms <= convThresh;
      tests.push({
        name:      'convergence',
        passed:    convPass,
        value:     rRms,
        threshold: convThresh,
        note:      convPass ? 'r_rms within target' : 'r_rms exceeds target',
      });

      // ─ Test 2: Energy saturation ───────────────────────────────────
      const eKinHist = state.E_kin_history[d];
      const tail20   = eKinHist.slice(Math.floor(eKinHist.length * 0.8));
      let satValue   = 0;
      if (tail20.length >= 2) {
        const first = mean(tail20.slice(0, Math.ceil(tail20.length / 2)));
        const last  = mean(tail20.slice(Math.floor(tail20.length / 2)));
        satValue = first > 0 ? Math.abs(last - first) / first : 0;
      }
      const satPass = satValue >= this.thresholds.saturationRelChange;
      tests.push({
        name:      'energy_saturation',
        passed:    satPass,
        value:     satValue,
        threshold: this.thresholds.saturationRelChange,
        note:      satPass ? 'Energy still evolving' : 'Kinetic energy has flatlined',
      });

      // ─ Test 3: Temporal stability ──────────────────────────────────
      const rHist   = state.r_rms_history[d];
      const tail50  = rHist.slice(Math.floor(rHist.length * 0.5));
      const cv      = tail50.length > 1 ? stddev(tail50) / (mean(tail50) || 1) : 0;
      const stabPass = cv <= this.thresholds.stabilityCV;
      tests.push({
        name:      'temporal_stability',
        passed:    stabPass,
        value:     cv,
        threshold: this.thresholds.stabilityCV,
        note:      stabPass ? 'r_rms is stable' : 'r_rms is oscillating',
      });

      // ─ Test 4: Pair impact ─────────────────────────────────────────
      // Run a simulation with pairwise coupling disabled
      const baseGlobal = baseMetrics.r_rms_global;
      const { metrics: noPairMetrics } = quickRun(
        { ...params, pairwise_coupling: false },
        steps,
        42
      );
      const noPairGlobal = noPairMetrics.r_rms_global;
      const pairDelta    = Math.abs(noPairGlobal - baseGlobal) / (baseGlobal || 1);
      const pairPass     = pairDelta >= this.thresholds.pairImpactMinDelta;
      tests.push({
        name:      'pair_impact',
        passed:    pairPass,
        value:     pairDelta,
        threshold: this.thresholds.pairImpactMinDelta,
        note:      pairPass
          ? `Decoupling changes r_rms_global by ${(pairDelta * 100).toFixed(2)}%`
          : 'Pair coupling has negligible impact',
      });

      // ─ Test 5: Parametric sensitivity ──────────────────────────────
      // Perturb E0 for this channel and see if r_rms changes
      const perturbFrac = 0.05;
      const perturbedEngine = new DMSEngine(params);
      perturbedEngine.reset(42);
      // Run to same point, then perturb
      for (let i = 0; i < steps; i++) perturbedEngine.step();
      // Apply perturbation to channel d
      const N = perturbedEngine.state.N;
      for (let i = 0; i < N; i++) {
        perturbedEngine.state.E[d][i] *= (1 + perturbFrac);
      }
      // Run a few more steps
      let perturbMetrics;
      for (let i = 0; i < 10; i++) {
        perturbMetrics = perturbedEngine.step();
      }
      const sensValue = Math.abs(perturbMetrics.r_rms[d] - rRms) / (rRms || 1) / perturbFrac;
      const sensPass  = sensValue >= this.thresholds.sensitivityMinDelta;
      tests.push({
        name:      'parametric_sensitivity',
        passed:    sensPass,
        value:     sensValue,
        threshold: this.thresholds.sensitivityMinDelta,
        note:      sensPass ? 'Dimension responds to perturbation' : 'Dimension insensitive',
      });

      // ─ Test 6: Cross-falsifiability ────────────────────────────────
      // Saturate channel d (set to constant) and see how many other
      // channels change convergence status
      const satEngine = new DMSEngine(params);
      satEngine.reset(42);
      // Clamp channel d to zero throughout
      for (let i = 0; i < steps; i++) {
        satEngine.state.E[d].fill(0);
        satEngine.state.E_prev[d].fill(0);
        satEngine.step();
      }
      const satMetrics = computeMetrics(satEngine.state, params);
      let flippedCount = 0;
      for (let j = 0; j < C; j++) {
        if (j === d) continue;
        const baseConv = baseMetrics.r_rms[j] <= convThresh;
        const satConv  = satMetrics.r_rms[j] <= convThresh;
        if (baseConv !== satConv) flippedCount++;
      }
      const crossFrac = flippedCount / (C - 1);
      const crossPass = crossFrac <= this.thresholds.crossFalsifiabilityMaxFlip;
      tests.push({
        name:      'cross_falsifiability',
        passed:    crossPass,
        value:     crossFrac,
        threshold: this.thresholds.crossFalsifiabilityMaxFlip,
        note:      crossPass
          ? `Saturating dim ${d} flips ${flippedCount} other dims`
          : `Saturating dim ${d} flips too many dims (${flippedCount})`,
      });

      // ── Classify ──────────────────────────────────────────────────
      const passCount = tests.filter(t => t.passed).length;
      let status;

      if (passCount === 6) {
        status = DimensionStatus.PROVEN;
      } else if (convPass && !satPass && stabPass) {
        status = DimensionStatus.SATURATED;
      } else if (passCount <= 3) {
        status = DimensionStatus.FALLIBLE;
      } else {
        status = DimensionStatus.INDETERMINATE;
      }

      results.push({
        dimension: d,
        status,
        tests,
        r_rms:  rRms,
        kappa:  state.kappa[d],
      });
    }

    return results;
  }
}
