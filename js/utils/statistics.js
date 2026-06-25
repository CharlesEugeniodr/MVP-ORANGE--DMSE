/**
 * @fileoverview Statistical hypothesis-testing utilities.
 *
 * Implements:
 *   • Two-sample Kolmogorov-Smirnov test
 *   • Nonparametric bootstrap confidence interval
 *   • Shapiro-Wilk normality test (approximation)
 *
 * All functions are pure, use no external dependencies, and work on plain
 * number arrays.
 *
 * @module statistics
 */

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return a sorted (ascending) copy of an array.
 * @param {number[]} arr
 * @returns {number[]}
 */
function sortedCopy(arr) {
  return Float64Array.from(arr).sort();
}

/**
 * Compute the empirical CDF value at a given point.
 * @param {Float64Array} sorted - Sorted sample
 * @param {number}       x
 * @returns {number} Proportion of sorted ≤ x
 */
function ecdf(sorted, x) {
  // Binary search for upper bound
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/**
 * Simple seeded PRNG (mulberry32).
 * @param {number} seed
 * @returns {() => number} Returns float in [0, 1)
 */
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Kolmogorov-Smirnov Test ───────────────────────────────────────────────────

/**
 * Two-sample Kolmogorov-Smirnov test.
 *
 * Tests the null hypothesis that two samples come from the same
 * continuous distribution.
 *
 * The KS statistic D is the supremum of |F₁(x) − F₂(x)| over
 * the union of both samples.
 *
 * The approximate p-value uses the Kolmogorov distribution:
 *   p ≈ 2 · Σ_{k=1}^{∞} (−1)^{k+1} · exp(−2k²λ²)
 * where λ = (√n_eff + 0.12 + 0.11/√n_eff) · D
 * and   n_eff = n₁·n₂ / (n₁+n₂).
 *
 * @param {number[]} sample1 - First sample
 * @param {number[]} sample2 - Second sample
 * @returns {{ D: number, p: number, significant: boolean }}
 */
export function ksTest(sample1, sample2) {
  const n1 = sample1.length;
  const n2 = sample2.length;

  if (n1 === 0 || n2 === 0) {
    return { D: NaN, p: NaN, significant: false };
  }

  const s1 = sortedCopy(sample1);
  const s2 = sortedCopy(sample2);

  // Merge all unique points
  const allPoints = new Set([...s1, ...s2]);
  let D = 0;

  for (const x of allPoints) {
    const f1 = ecdf(s1, x);
    const f2 = ecdf(s2, x);
    const diff = Math.abs(f1 - f2);
    if (diff > D) D = diff;
  }

  // Approximate p-value via Kolmogorov distribution
  const nEff   = (n1 * n2) / (n1 + n2);
  const sqrtNe = Math.sqrt(nEff);
  const lambda = (sqrtNe + 0.12 + 0.11 / sqrtNe) * D;

  let p = 0;
  for (let k = 1; k <= 100; k++) {
    const sign = (k % 2 === 1) ? 1 : -1;
    p += sign * Math.exp(-2 * k * k * lambda * lambda);
  }
  p = Math.max(0, Math.min(1, 2 * p));

  return { D, p, significant: p < 0.05 };
}

// ─── Bootstrap Confidence Interval ─────────────────────────────────────────────

/**
 * Nonparametric bootstrap confidence interval for a statistic.
 *
 * Resamples `data` with replacement `nBoot` times, computes `statFn`
 * on each resample, and returns the (α/2, 1−α/2) percentile interval.
 *
 * @param {number[]}           data   - Original sample
 * @param {(arr: number[]) => number} statFn - Statistic function (e.g. mean)
 * @param {number}             [nBoot=1000] - Number of bootstrap replicates
 * @param {number}             [alpha=0.05] - Significance level (default 5 %)
 * @param {number}             [seed=12345] - PRNG seed for reproducibility
 * @returns {{ lower: number, upper: number, estimate: number, bootstrapDist: number[] }}
 */
export function bootstrapCI(data, statFn, nBoot = 1000, alpha = 0.05, seed = 12345) {
  const n   = data.length;
  const rng = mulberry32(seed);
  const estimates = new Float64Array(nBoot);

  for (let b = 0; b < nBoot; b++) {
    // Resample with replacement
    const resample = new Array(n);
    for (let i = 0; i < n; i++) {
      resample[i] = data[Math.floor(rng() * n)];
    }
    estimates[b] = statFn(resample);
  }

  // Sort bootstrap distribution
  estimates.sort();

  const loIdx = Math.floor((alpha / 2) * nBoot);
  const hiIdx = Math.floor((1 - alpha / 2) * nBoot) - 1;

  return {
    lower:         estimates[Math.max(0, loIdx)],
    upper:         estimates[Math.min(nBoot - 1, hiIdx)],
    estimate:      statFn(data),
    bootstrapDist: Array.from(estimates),
  };
}

// ─── Shapiro-Wilk Approximation ────────────────────────────────────────────────

/**
 * Shapiro-Wilk test for normality (Royston's approximation).
 *
 * Returns the W statistic and an approximate p-value.
 * Accurate for 3 ≤ N ≤ 5000.
 *
 * The W statistic measures how well the ordered sample matches the
 * expected order statistics of a normal distribution.
 *
 * Implementation notes:
 *   • Uses Blom's approximation for expected normal order statistics
 *   • P-value approximation via Royston's log-normal transform
 *
 * @param {number[]} data - Sample data (at least 3 observations)
 * @returns {{ W: number, p: number, normal: boolean }}
 */
export function shapiroWilkApprox(data) {
  const n = data.length;

  if (n < 3) {
    return { W: NaN, p: NaN, normal: false };
  }

  // Sort the data
  const x = sortedCopy(data);

  // Mean
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;

  // SS_total = Σ(x_i − x̄)²
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (x[i] - mean) * (x[i] - mean);
  }

  if (ssTot < 1e-30) {
    // Constant data: perfectly normal but degenerate
    return { W: 1.0, p: 1.0, normal: true };
  }

  // ── Compute expected normal order statistics (Blom approximation) ──
  // m_i = Φ⁻¹( (i − 3/8) / (n + 1/4) )
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i + 1 - 0.375) / (n + 0.25);
    m[i] = normalQuantile(p);
  }

  // Σ m_i²
  let mSq = 0;
  for (let i = 0; i < n; i++) mSq += m[i] * m[i];

  // Coefficients: a_i = m_i / √(Σ m²)
  const a = new Float64Array(n);
  const sqrtMSq = Math.sqrt(mSq);
  for (let i = 0; i < n; i++) a[i] = m[i] / sqrtMSq;

  // W = (Σ a_i · x_(i))² / SS_total
  let aTimesX = 0;
  for (let i = 0; i < n; i++) {
    aTimesX += a[i] * x[i];
  }
  const W = (aTimesX * aTimesX) / ssTot;

  // ── Approximate p-value (Royston's method) ──
  // Transform W to a roughly normal variable, then compute p
  const logN = Math.log(n);
  let mu, sigma, z;

  if (n <= 11) {
    // Small-sample coefficients (approximate)
    const gamma = 0.459 * n - 2.273;
    mu    = -1.2725 + 1.0521 * gamma;
    sigma = 1.0308 - 0.26758 * gamma;
    z     = (Math.log(1 - W) - mu) / sigma;
  } else {
    // Royston's log-normal approximation for larger samples
    mu    = -1.2725 + 1.0521 * (logN - Math.log(3));
    sigma = 1.0308 - 0.26758 * (logN - Math.log(3));
    z     = (Math.log(1 - W) - mu) / sigma;
  }

  // One-sided p-value: P(Z > z) for standard normal
  const p = 1 - normalCDF(z);

  return {
    W,
    p:      Math.max(0, Math.min(1, p)),
    normal: p >= 0.05,
  };
}

// ─── Normal distribution helpers ───────────────────────────────────────────────

/**
 * Standard normal CDF (Abramowitz & Stegun approximation 26.2.17).
 * Max error ≈ 7.5e-8.
 *
 * @param {number} x
 * @returns {number} Φ(x)
 */
function normalCDF(x) {
  if (x < -8) return 0;
  if (x >  8) return 1;

  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  const z    = Math.abs(x) / Math.SQRT2;
  const t    = 1.0 / (1.0 + p * z);
  const y    = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Standard normal quantile function (inverse CDF).
 * Rational approximation (Beasley-Springer-Moro).
 *
 * @param {number} p - Probability in (0, 1)
 * @returns {number} z such that Φ(z) = p
 */
function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return  Infinity;
  if (p === 0.5) return 0;

  // Rational approximation constants
  const a = [
    -3.969683028665376e+01,
     2.209460984245205e+02,
    -2.759285104469687e+02,
     1.383577518672690e+02,
    -3.066479806614716e+01,
     2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,
     1.615858368580409e+02,
    -1.556989798598866e+02,
     6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e+00,
    -2.549732539343734e+00,
     4.374664141464968e+00,
     2.938163982698783e+00,
  ];
  const d = [
     7.784695709041462e-03,
     3.224671290700398e-01,
     2.445134137142996e+00,
     3.754408661907416e+00,
  ];

  const pLow  = 0.02425;
  const pHigh = 1 - pLow;

  let q, r;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}
