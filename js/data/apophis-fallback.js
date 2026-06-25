/**
 * @fileoverview Apophis 2029 close-approach trajectory — analytical fallback.
 *
 * Provides a precomputed trajectory for asteroid 99942 Apophis during its
 * April 13 2029 Earth flyby, spanning ±12 hours around perigee.
 *
 * The trajectory uses the analytical hyperbolic approximation from the
 * Orange-DMSE Python reference:
 *
 *   v_scale = 7.4 km/s × 3600 s/h  (= 26 640 km/h)
 *   X(h) = v_scale · h / 2
 *   Y(h) = √( 38000² + (X · 0.7)² )
 *   R(h) = √( X² + Y² )
 *
 * Perigee distance ≈ 38 000 km (inside the geostationary belt).
 *
 * @module apophis-fallback
 */

// ─── Precompute 120 trajectory points ──────────────────────────────────────────

const N_POINTS      = 120;
const H_MIN         = -12;      // hours before perigee
const H_MAX         = 12;       // hours after perigee
const PERIGEE_KM    = 38000;    // closest approach distance (km)
const V_APPROACH    = 7.4;      // approach speed (km/s)
const V_SCALE       = V_APPROACH * 3600;   // km/h  (= 26 640)

/**
 * Generate the time array (hours) linearly spaced from H_MIN to H_MAX.
 * @param {number} n
 * @returns {number[]}
 */
function linspace(a, b, n) {
  const arr = new Array(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) arr[i] = a + i * step;
  return arr;
}

/** Time grid: 120 points from -12 h to +12 h */
const hours = linspace(H_MIN, H_MAX, N_POINTS);

/** @type {number[]} X coordinate (km) — along approach asymptote */
const X_nasa = hours.map(h => V_SCALE * h / 2);

/** @type {number[]} Y coordinate (km) — lateral distance (minimum = perigee) */
const Y_nasa = X_nasa.map(x => Math.sqrt(PERIGEE_KM * PERIGEE_KM + (x * 0.7) * (x * 0.7)));

/** @type {number[]} Total distance from Earth centre (km) */
const R_nasa = X_nasa.map((x, i) => Math.sqrt(x * x + Y_nasa[i] * Y_nasa[i]));

// ─── Exports ───────────────────────────────────────────────────────────────────

/**
 * Precomputed Apophis flyby data (frozen for immutability).
 *
 * @type {Object}
 * @property {number}   n_points   - Number of trajectory points
 * @property {number}   perigee_km - Closest approach distance (km)
 * @property {number}   v_approach - Approach velocity (km/s)
 * @property {number[]} hours      - Time relative to perigee (h)
 * @property {number[]} X_nasa     - X coordinate (km)
 * @property {number[]} Y_nasa     - Y coordinate (km)
 * @property {number[]} R_nasa     - Geocentric distance (km)
 */
export const APOPHIS_DATA = Object.freeze({
  n_points:    N_POINTS,
  perigee_km:  PERIGEE_KM,
  v_approach:  V_APPROACH,
  v_scale:     V_SCALE,
  hours:       Object.freeze(hours),
  X_nasa:      Object.freeze(X_nasa),
  Y_nasa:      Object.freeze(Y_nasa),
  R_nasa:      Object.freeze(R_nasa),
});

/**
 * Compute the Orange-DMS predicted trajectory and its discrepancy with the
 * NASA/JPL analytical baseline.
 *
 * The DMS model adds a small additional acceleration that alters the
 * effective trajectory:
 *
 *   a_dms(R) = γ · E_mean · √κ · 1e-10 / (1 + (R / Rs)^β)
 *
 * We integrate this perturbatively: at each point the DMS trajectory
 * radius is adjusted by a first-order correction proportional to a_dms·Δt².
 *
 * @param {number[]} hoursArray - Time grid (hours relative to perigee)
 * @param {number}   gamma      - DMS coupling parameter
 * @param {Object}   [opts]     - Optional parameters
 * @param {number}   [opts.E_mean=1]    - Mean field amplitude
 * @param {number}   [opts.kappa=1]     - Adaptive κ value
 * @param {number}   [opts.Rs=38000]    - Scale radius (km)
 * @param {number}   [opts.beta=1.5]    - Radial fall-off exponent
 * @returns {Object} { R_dms, R_nasa, discrepancy_km, discrepancy_pct, max_discrepancy_km }
 */
export function getApophisComparison(hoursArray, gamma, opts = {}) {
  const E_mean = opts.E_mean ?? 1.0;
  const kappa  = opts.kappa  ?? 1.0;
  const Rs     = opts.Rs     ?? PERIGEE_KM;
  const beta   = opts.beta   ?? 1.5;

  const hrs  = hoursArray || APOPHIS_DATA.hours;
  const n    = hrs.length;
  const dt_s = hrs.length > 1 ? Math.abs(hrs[1] - hrs[0]) * 3600 : 1; // seconds

  // NASA baseline at requested times
  const xNasa = hrs.map(h => V_SCALE * h / 2);
  const yNasa = xNasa.map(x => Math.sqrt(PERIGEE_KM ** 2 + (x * 0.7) ** 2));
  const rNasa = xNasa.map((x, i) => Math.sqrt(x * x + yNasa[i] * yNasa[i]));

  // DMS perturbation
  const R_dms            = new Array(n);
  const discrepancy_km   = new Array(n);
  const discrepancy_pct  = new Array(n);
  let   maxDisc          = 0;

  for (let i = 0; i < n; i++) {
    const R = rNasa[i];
    // DMS additional acceleration (km/s² — note the 1e-10 keeps it tiny)
    const a_dms = (gamma * E_mean * Math.sqrt(kappa) * 1e-10)
                / (1.0 + Math.pow(R / Rs, beta));

    // Perturbative radial correction: δR ≈ ½ a_dms · t²   (t from perigee)
    const t_s = hrs[i] * 3600; // seconds from perigee
    const deltaR = 0.5 * a_dms * t_s * t_s;

    R_dms[i]           = R + deltaR;
    discrepancy_km[i]  = Math.abs(deltaR);
    discrepancy_pct[i] = R > 0 ? (Math.abs(deltaR) / R) * 100 : 0;

    if (discrepancy_km[i] > maxDisc) maxDisc = discrepancy_km[i];
  }

  return {
    hours:              hrs,
    R_dms,
    R_nasa:             rNasa,
    discrepancy_km,
    discrepancy_pct,
    max_discrepancy_km: maxDisc,
  };
}
