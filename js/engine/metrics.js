/**
 * @fileoverview Statistical metrics for model comparison and goodness-of-fit.
 *
 * Every function is pure (no side-effects) and operates on plain arrays.
 *
 * Exported metrics:
 *   gaussianLogLikFromRSS, aicBicFromRSS, chiSquared, rSquaredAdjusted,
 *   mape, bayesFactor, cohensD, rmse
 *
 * @module metrics
 */

/**
 * Gaussian log-likelihood computed from the residual sum of squares.
 *
 *   ℓ = −(N/2)·ln(2π) − (N/2)·ln(RSS/N) − N/2
 *
 * @param {number} rss - Residual sum of squares Σ(obs − model)²
 * @param {number} N   - Number of data points
 * @returns {number} Log-likelihood
 */
export function gaussianLogLikFromRSS(rss, N) {
  if (N <= 0) return -Infinity;
  const sigma2 = rss / N;
  if (sigma2 <= 0) return 0;
  return -0.5 * N * Math.log(2 * Math.PI) - 0.5 * N * Math.log(sigma2) - 0.5 * N;
}

/**
 * Akaike (AIC) and Bayesian (BIC) information criteria from RSS.
 *
 *   AIC = 2k − 2ℓ
 *   BIC = k·ln(N) − 2ℓ
 *
 * @param {number} rss - Residual sum of squares
 * @param {number} N   - Number of observations
 * @param {number} k   - Number of free parameters
 * @returns {{ aic: number, bic: number }}
 */
export function aicBicFromRSS(rss, N, k) {
  const logLik = gaussianLogLikFromRSS(rss, N);
  const aic = 2 * k - 2 * logLik;
  const bic = k * Math.log(N) - 2 * logLik;
  return { aic, bic };
}

/**
 * Chi-squared and reduced chi-squared.
 *
 *   χ² = Σ [(obs_i − model_i) / err_i]²
 *   χ²_red = χ² / (N − nParams)
 *
 * @param {number[]} vObs    - Observed values
 * @param {number[]} vErr    - Measurement uncertainties (1σ)
 * @param {number[]} vModel  - Model predictions
 * @param {number}   nParams - Number of free model parameters
 * @returns {{ chi2: number, chi2_reduced: number, dof: number }}
 */
export function chiSquared(vObs, vErr, vModel, nParams) {
  const N = vObs.length;
  let chi2 = 0;

  for (let i = 0; i < N; i++) {
    const residual = (vObs[i] - vModel[i]) / (vErr[i] || 1);
    chi2 += residual * residual;
  }

  const dof = N - nParams;
  const chi2_reduced = dof > 0 ? chi2 / dof : Infinity;

  return { chi2, chi2_reduced, dof };
}

/**
 * Adjusted R² (coefficient of determination corrected for model complexity).
 *
 *   R² = 1 − SS_res / SS_tot
 *   R²_adj = 1 − (1 − R²)·(N − 1) / (N − k − 1)
 *
 * @param {number[]} vObs   - Observed values
 * @param {number[]} vModel - Model predictions
 * @param {number}   nParams - Number of free parameters
 * @returns {{ r2: number, r2_adj: number }}
 */
export function rSquaredAdjusted(vObs, vModel, nParams) {
  const N = vObs.length;

  let mean = 0;
  for (let i = 0; i < N; i++) mean += vObs[i];
  mean /= N;

  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < N; i++) {
    ssTot += (vObs[i] - mean) ** 2;
    ssRes += (vObs[i] - vModel[i]) ** 2;
  }

  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const denom = N - nParams - 1;
  const r2_adj = denom > 0 ? 1 - (1 - r2) * (N - 1) / denom : r2;

  return { r2, r2_adj };
}

/**
 * Mean Absolute Percentage Error.
 *
 *   MAPE = (100 / N) Σ |obs − model| / |obs|
 *
 * Points where obs ≈ 0 are excluded to avoid division by zero.
 *
 * @param {number[]} vObs   - Observed values
 * @param {number[]} vModel - Model predictions
 * @returns {number} MAPE (%)
 */
export function mape(vObs, vModel) {
  const N = vObs.length;
  let sum   = 0;
  let count = 0;

  for (let i = 0; i < N; i++) {
    const absObs = Math.abs(vObs[i]);
    if (absObs < 1e-12) continue;
    sum += Math.abs(vObs[i] - vModel[i]) / absObs;
    count++;
  }

  return count > 0 ? (100 * sum) / count : 0;
}

/**
 * Bayes Factor (BF₁₂) approximated from BIC differences.
 *
 *   ln(BF₁₂) ≈ (BIC₂ − BIC₁) / 2
 *   BF₁₂ = exp((BIC₂ − BIC₁) / 2)
 *
 * BF > 1 favours model 1, BF < 1 favours model 2.
 *
 * @param {number} bic1 - BIC of model 1
 * @param {number} bic2 - BIC of model 2
 * @returns {{ bayesFactor: number, logBF: number, interpretation: string }}
 */
export function bayesFactor(bic1, bic2) {
  const logBF = (bic2 - bic1) / 2;
  const bf    = Math.exp(logBF);

  let interpretation;
  const absBF = Math.abs(logBF);
  if (absBF < 0.5)       interpretation = 'Not worth more than a bare mention';
  else if (absBF < 1.0)  interpretation = 'Substantial';
  else if (absBF < 1.5)  interpretation = 'Strong';
  else if (absBF < 2.0)  interpretation = 'Very strong';
  else                    interpretation = 'Decisive';

  return { bayesFactor: bf, logBF, interpretation };
}

/**
 * Cohen's d effect size between two independent groups.
 *
 *   d = (M₁ − M₂) / s_pooled
 *
 * @param {number[]} group1
 * @param {number[]} group2
 * @returns {{ d: number, interpretation: string }}
 */
export function cohensD(group1, group2) {
  const n1 = group1.length;
  const n2 = group2.length;

  let m1 = 0, m2 = 0;
  for (let i = 0; i < n1; i++) m1 += group1[i];
  for (let i = 0; i < n2; i++) m2 += group2[i];
  m1 /= n1;
  m2 /= n2;

  let v1 = 0, v2 = 0;
  for (let i = 0; i < n1; i++) v1 += (group1[i] - m1) ** 2;
  for (let i = 0; i < n2; i++) v2 += (group2[i] - m2) ** 2;

  const sPooled = Math.sqrt((v1 + v2) / (n1 + n2 - 2));
  const d = sPooled > 0 ? (m1 - m2) / sPooled : 0;

  let interpretation;
  const absD = Math.abs(d);
  if (absD < 0.2)      interpretation = 'Negligible';
  else if (absD < 0.5) interpretation = 'Small';
  else if (absD < 0.8) interpretation = 'Medium';
  else                  interpretation = 'Large';

  return { d, interpretation };
}

/**
 * Root Mean Square Error.
 *
 *   RMSE = sqrt( Σ(obs − pred)² / N )
 *
 * @param {number[]} observed
 * @param {number[]} predicted
 * @returns {number}
 */
export function rmse(observed, predicted) {
  const N = observed.length;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const d = observed[i] - predicted[i];
    sum += d * d;
  }
  return Math.sqrt(sum / N);
}
