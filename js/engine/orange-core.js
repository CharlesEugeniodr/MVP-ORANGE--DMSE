/**
 * @fileoverview Orange-DMSE Core PDE Engine
 *
 * Translates the Python PDE simulation engine to JavaScript for browser execution.
 * Simulates a 30-channel dimensional mesh with:
 *   - Paired cross-channel coupling (channel d couples to channel C-1-d)
 *   - Adaptive κ (kappa) controller targeting a residual RMS
 *   - Verlet 2nd-order time integration on a 2D spatial grid
 *
 * Physical constants:
 *   C_LIGHT  = 299 792 458.0  m/s
 *   Z0_VACUUM = 376.730313    Ω
 *
 * @module orange-core
 */

// ─── Physical Constants ────────────────────────────────────────────────────────
export const C_LIGHT   = 299792458.0;
export const Z0_VACUUM = 376.730313;

// ─── Default Parameters ────────────────────────────────────────────────────────

/**
 * @typedef {Object} DMSEParams
 * @property {number[]} grid            - [Ny, Nx] spatial grid dimensions
 * @property {number}   n_channels      - Number of field channels (dimensions)
 * @property {number}   dx              - Spatial step size
 * @property {number}   dt              - Temporal step size
 * @property {number}   rho             - Inertial density coefficient
 * @property {number}   eta             - Damping coefficient
 * @property {number}   alpha           - Diffusion coefficient (Laplacian weight)
 * @property {number}   E0              - Reference field amplitude
 * @property {number}   kappa_init      - Initial κ value
 * @property {number}   kappa_gain      - Adaptive κ gain factor
 * @property {number}   r_rms_target    - Target RMS residual for convergence
 * @property {number}   kappa_min       - Minimum κ clamp
 * @property {number}   kappa_max       - Maximum κ clamp
 * @property {string}   boundary        - Boundary condition type ('neumann'|'periodic')
 * @property {number}   coupling_strength - Cross-channel coupling strength
 * @property {boolean}  pairwise_coupling - Enable paired channel coupling
 */
export const DEFAULT_PARAMS = Object.freeze({
  grid:              [64, 64],
  n_channels:        30,
  dx:                1.0,
  dt:                0.02,
  rho:               1.0,
  eta:               0.1,
  alpha:             0.5,
  E0:                1.0,
  kappa_init:        1.0,
  kappa_gain:        0.5,
  r_rms_target:      0.02,
  kappa_min:         1e-6,
  kappa_max:         1e3,
  boundary:          'neumann',
  coupling_strength: 0.02,
  pairwise_coupling: true,
});

// ─── Seeded PRNG (xoshiro128**) ────────────────────────────────────────────────

/**
 * Simple seeded PRNG based on splitmix32 → xoshiro128**.
 * Returns a function that yields floats in [0, 1).
 * @param {number} seed - Integer seed
 * @returns {() => number}
 */
function makeRng(seed) {
  // splitmix32 to expand the seed into four 32-bit state words
  function splitmix32(s) {
    s |= 0;
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return [t >>> 0, s];
  }
  let st, s0, s1, s2, s3;
  [s0, st] = splitmix32(seed);
  [s1, st] = splitmix32(st);
  [s2, st] = splitmix32(st);
  [s3, st] = splitmix32(st);

  return function () {
    const result = Math.imul(s1 * 5, 1 << 7 | 1) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = (s3 << 11 | s3 >>> 21) >>> 0;
    return (result >>> 0) / 4294967296;
  };
}

// ─── DMSEState ─────────────────────────────────────────────────────────────────

/**
 * Holds mutable simulation state for all channels on the 2D grid.
 *
 * Each channel stores three flat Float32Arrays of length Ny*Nx:
 *   E       – current field
 *   E_prev  – field at previous time step (Verlet history)
 *   E_lap   – scratch buffer for the Laplacian
 */
export class DMSEState {
  /**
   * @param {DMSEParams} params
   */
  constructor(params) {
    const [Ny, Nx] = params.grid;
    const C        = params.n_channels;
    const N        = Ny * Nx;

    /** @type {number} */ this.Ny = Ny;
    /** @type {number} */ this.Nx = Nx;
    /** @type {number} */ this.C  = C;
    /** @type {number} */ this.N  = N;

    /** Current field per channel    @type {Float32Array[]} */
    this.E      = Array.from({ length: C }, () => new Float32Array(N));
    /** Previous field (Verlet)      @type {Float32Array[]} */
    this.E_prev = Array.from({ length: C }, () => new Float32Array(N));
    /** Laplacian scratch buffer     @type {Float32Array[]} */
    this.E_lap  = Array.from({ length: C }, () => new Float32Array(N));

    /** Per-channel κ values         @type {Float64Array}   */
    this.kappa  = new Float64Array(C).fill(params.kappa_init);

    /** Global simulation time       @type {number}         */
    this.time   = 0;
    /** Completed steps counter      @type {number}         */
    this.step   = 0;

    /** Per-channel residual RMS history @type {number[][]}  */
    this.r_rms_history = Array.from({ length: C }, () => []);

    /** Per-channel kinetic energy history @type {number[][]} */
    this.E_kin_history = Array.from({ length: C }, () => []);
  }
}

// ─── Utility helpers ───────────────────────────────────────────────────────────

/**
 * Compute the 2D 5-point Laplacian of `src` into `dst`.
 * Boundary condition is selected by `mode`.
 *
 * @param {Float32Array} src   - Input field (Ny × Nx, row-major)
 * @param {Float32Array} dst   - Output Laplacian (same shape)
 * @param {number}       Ny    - Grid rows
 * @param {number}       Nx    - Grid columns
 * @param {number}       dx    - Grid spacing
 * @param {string}       mode  - 'neumann' | 'periodic'
 */
export function laplacian2d(src, dst, Ny, Nx, dx, mode = 'neumann') {
  const invDx2 = 1.0 / (dx * dx);
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      const idx = j * Nx + i;
      const c   = src[idx];

      let left, right, up, down;

      if (mode === 'periodic') {
        left  = src[j * Nx + ((i - 1 + Nx) % Nx)];
        right = src[j * Nx + ((i + 1) % Nx)];
        up    = src[((j - 1 + Ny) % Ny) * Nx + i];
        down  = src[((j + 1) % Ny) * Nx + i];
      } else {
        // Neumann (zero-gradient): clamp indices
        left  = i > 0      ? src[j * Nx + (i - 1)] : c;
        right = i < Nx - 1 ? src[j * Nx + (i + 1)] : c;
        up    = j > 0      ? src[(j - 1) * Nx + i]  : c;
        down  = j < Ny - 1 ? src[(j + 1) * Nx + i]  : c;
      }

      dst[idx] = (left + right + up + down - 4.0 * c) * invDx2;
    }
  }
}

/**
 * Dimensionless residual for channel d at a single grid point.
 *
 *   r = (ω̃ · Z0 · E / E0) / c  − 1
 *
 * Here ω̃ is approximated as |E| (the local field magnitude acts as
 * an effective angular frequency proxy in the dimensionless mesh).
 *
 * @param {number} E   - Local field value
 * @param {number} E0  - Reference amplitude
 * @returns {number}
 */
export function residualR(E, E0) {
  const omega_tilde = Math.abs(E);
  return (omega_tilde * Z0_VACUUM * E / E0) / C_LIGHT - 1.0;
}

/**
 * Nonlinear attractor term.
 *
 *   NL = (κ / E0) · ω · r
 *
 * @param {number} kappa - Coupling constant
 * @param {number} E0    - Reference amplitude
 * @param {number} omega - Effective angular frequency (|E|)
 * @param {number} r     - Residual at this point
 * @returns {number}
 */
export function nonlinearAttractor(kappa, E0, omega, r) {
  return (kappa / E0) * omega * r;
}

/**
 * Cross-channel coupling force for channel `d`.
 *
 * Each channel d is paired with channel (C − 1 − d).
 * The coupling force is: strength · (E_pair − E_d)
 *
 * @param {Float32Array} E_d     - Field of channel d
 * @param {Float32Array} E_pair  - Field of the paired channel
 * @param {number}       strength - Coupling coefficient
 * @param {Float32Array} [out]   - Optional output buffer
 * @returns {Float32Array} Coupling force array
 */
export function crossChannelCoupling(E_d, E_pair, strength, out) {
  const N   = E_d.length;
  const dst = out || new Float32Array(N);
  for (let i = 0; i < N; i++) {
    dst[i] = strength * (E_pair[i] - E_d[i]);
  }
  return dst;
}

/**
 * Advance a single channel by one Verlet time step.
 *
 * Verlet 2nd-order:
 *   E_next = 2·E − E_prev − (dt²/ρ) · (η·E' + force)
 *
 * where E' ≈ (E − E_prev)/dt   (backward difference)
 * and   force = −α·∇²E + NL + coupling
 *
 * @param {Float32Array} E       - Current field
 * @param {Float32Array} E_prev  - Previous field
 * @param {Float32Array} E_lap   - Pre-computed Laplacian of E
 * @param {Float32Array} coupling - Coupling force array
 * @param {number}       kappa   - κ for this channel
 * @param {DMSEParams}   p       - Simulation parameters
 * @returns {Float32Array} E_next (new Float32Array)
 */
export function pdeStep(E, E_prev, E_lap, coupling, kappa, p) {
  const N     = E.length;
  const dt    = p.dt;
  const dt2   = dt * dt;
  const rho   = p.rho;
  const eta   = p.eta;
  const alpha = p.alpha;
  const E0    = p.E0;
  const invRhoDt2 = dt2 / rho;

  const E_next = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const e      = E[i];
    const e_prev = E_prev[i];

    // Velocity estimate (backward difference)
    const ePrime = (e - e_prev) / dt;

    // Residual & nonlinear attractor
    const r     = residualR(e, E0);
    const omega = Math.abs(e);
    const nl    = nonlinearAttractor(kappa, E0, omega, r);

    // Diffusion
    const diffusion = -alpha * E_lap[i];

    // Total RHS force (damping + diffusion + attractor + coupling)
    const force = eta * ePrime + diffusion + nl + coupling[i];

    // Verlet integration
    E_next[i] = 2.0 * e - e_prev - invRhoDt2 * force;
  }

  return E_next;
}

/**
 * Compute per-channel and global metrics for the current state.
 *
 * @param {DMSEState}  state
 * @param {DMSEParams} params
 * @returns {{ r_rms: Float64Array, r_rms_global: number, E_kin: Float64Array }}
 */
export function computeMetrics(state, params) {
  const C  = state.C;
  const N  = state.N;
  const E0 = params.E0;
  const dt = params.dt;

  const r_rms = new Float64Array(C);
  const E_kin = new Float64Array(C);
  let   sumR2Global = 0;
  let   countGlobal = 0;

  for (let d = 0; d < C; d++) {
    const Ed      = state.E[d];
    const Ed_prev = state.E_prev[d];
    let sumR2 = 0;
    let sumV2 = 0;

    for (let i = 0; i < N; i++) {
      const r = residualR(Ed[i], E0);
      sumR2 += r * r;

      const v = (Ed[i] - Ed_prev[i]) / dt;
      sumV2 += v * v;
    }

    r_rms[d] = Math.sqrt(sumR2 / N);
    E_kin[d] = 0.5 * sumV2 / N;

    sumR2Global += sumR2;
    countGlobal += N;
  }

  const r_rms_global = Math.sqrt(sumR2Global / countGlobal);

  return { r_rms, r_rms_global, E_kin };
}

/**
 * Adapt κ for each channel using a proportional controller.
 *
 *   κ_new = clamp( κ · (1 + gain · (r_rms − target)), κ_min, κ_max )
 *
 * @param {DMSEState}    state
 * @param {Float64Array}  r_rms  - Per-channel residual RMS
 * @param {DMSEParams}    params
 */
export function adaptKappa(state, r_rms, params) {
  const { kappa_gain, r_rms_target, kappa_min, kappa_max } = params;
  for (let d = 0; d < state.C; d++) {
    const error = r_rms[d] - r_rms_target;
    let newKappa = state.kappa[d] * (1.0 + kappa_gain * error);
    newKappa = Math.max(kappa_min, Math.min(kappa_max, newKappa));
    state.kappa[d] = newKappa;
  }
}

/**
 * Compute Hamiltonian-like energy for symplectic stability monitoring.
 *
 *   H = Σ_d [ ½ ρ |E'|² + ½ α |∇E|² ]   (kinetic + potential)
 *
 * @param {DMSEState}  state
 * @param {DMSEParams} params
 * @returns {number} Total Hamiltonian energy
 */
export function computeHamiltonianEnergy(state, params) {
  const { rho, alpha, dt } = params;
  const { C, N, Ny, Nx }  = state;
  const dx = params.dx;
  let H = 0;

  for (let d = 0; d < C; d++) {
    const Ed      = state.E[d];
    const Ed_prev = state.E_prev[d];
    let kinetic   = 0;
    let potential  = 0;

    for (let i = 0; i < N; i++) {
      const v = (Ed[i] - Ed_prev[i]) / dt;
      kinetic += v * v;
    }

    // Gradient energy via Laplacian identity: ½ α Σ E·(-∇²E) ≈ ½ α Σ |∇E|²
    laplacian2d(Ed, state.E_lap[d], Ny, Nx, dx, params.boundary);
    for (let i = 0; i < N; i++) {
      potential += -Ed[i] * state.E_lap[d][i];
    }

    H += 0.5 * rho * kinetic / N + 0.5 * alpha * potential / N;
  }

  return H;
}

/**
 * Check whether the Hamiltonian energy drift remains within acceptable bounds.
 *
 * @param {number[]} H_history - Array of Hamiltonian energy values over time
 * @param {number}   tolerance - Maximum allowed relative drift (default 0.1 = 10 %)
 * @returns {{ stable: boolean, drift: number }}
 */
export function checkSymplecticStability(H_history, tolerance = 0.1) {
  if (H_history.length < 2) return { stable: true, drift: 0 };

  const H0   = H_history[0];
  const Hlast = H_history[H_history.length - 1];
  const drift = H0 !== 0 ? Math.abs((Hlast - H0) / H0) : Math.abs(Hlast - H0);

  return { stable: drift <= tolerance, drift };
}

// ─── DMSEngine ─────────────────────────────────────────────────────────────────

/**
 * Main simulation engine.
 *
 * Usage:
 * ```js
 * const engine = new DMSEngine();
 * engine.reset(42);
 * const results = engine.run(500, (step, metrics) => { ... });
 * ```
 */
export class DMSEngine {
  /**
   * @param {Partial<DMSEParams>} [overrides] - Override any default parameter
   */
  constructor(overrides = {}) {
    /** @type {DMSEParams} */
    this.params = { ...DEFAULT_PARAMS, ...overrides };

    /** @type {DMSEState|null} */
    this.state = null;

    /** @type {number[]} */
    this.H_history = [];
  }

  /**
   * Initialise (or re-initialise) the simulation state.
   *
   * Each channel is seeded with small random perturbations around zero so
   * the nonlinear attractor has something to latch onto.
   *
   * @param {number} [seed=42] - PRNG seed for reproducibility
   */
  reset(seed = 42) {
    const p     = this.params;
    this.state  = new DMSEState(p);
    this.H_history = [];

    const rng = makeRng(seed);
    const s   = this.state;

    for (let d = 0; d < p.n_channels; d++) {
      for (let i = 0; i < s.N; i++) {
        const noise = (rng() - 0.5) * 0.01 * p.E0;
        s.E[d][i]      = noise;
        s.E_prev[d][i] = noise;
      }
    }
  }

  /**
   * Advance the simulation by a single time step.
   *
   * 1. Compute Laplacians for all channels.
   * 2. Compute coupling forces.
   * 3. Verlet-step each channel.
   * 4. Rotate buffers  (E → E_prev, E_next → E).
   * 5. Compute metrics & adapt κ.
   *
   * @returns {{ r_rms: Float64Array, r_rms_global: number, E_kin: Float64Array }}
   */
  step() {
    const p = this.params;
    const s = this.state;

    // 1. Laplacians
    for (let d = 0; d < s.C; d++) {
      laplacian2d(s.E[d], s.E_lap[d], s.Ny, s.Nx, p.dx, p.boundary);
    }

    // 2 & 3. Coupling + Verlet step
    const E_next = new Array(s.C);
    const couplingBuf = new Float32Array(s.N);

    for (let d = 0; d < s.C; d++) {
      if (p.pairwise_coupling) {
        const pairIdx = s.C - 1 - d;
        crossChannelCoupling(s.E[d], s.E[pairIdx], p.coupling_strength, couplingBuf);
      } else {
        couplingBuf.fill(0);
      }

      E_next[d] = pdeStep(s.E[d], s.E_prev[d], s.E_lap[d], couplingBuf, s.kappa[d], p);
    }

    // 4. Rotate buffers
    for (let d = 0; d < s.C; d++) {
      s.E_prev[d].set(s.E[d]);
      s.E[d].set(E_next[d]);
    }

    s.time += p.dt;
    s.step += 1;

    // 5. Metrics & adaptive κ
    const metrics = computeMetrics(s, p);
    adaptKappa(s, metrics.r_rms, p);

    // Record histories
    for (let d = 0; d < s.C; d++) {
      s.r_rms_history[d].push(metrics.r_rms[d]);
      s.E_kin_history[d].push(metrics.E_kin[d]);
    }

    // Hamiltonian tracking
    const H = computeHamiltonianEnergy(s, p);
    this.H_history.push(H);

    return metrics;
  }

  /**
   * Run the simulation for `nSteps` steps.
   *
   * @param {number}   nSteps            - Number of steps to execute
   * @param {function} [callback]        - Optional (stepIndex, metrics) => void
   * @returns {{ finalMetrics: object, H_history: number[], symplectic: object }}
   */
  run(nSteps, callback) {
    let lastMetrics = null;

    for (let i = 0; i < nSteps; i++) {
      lastMetrics = this.step();

      if (callback) {
        callback(i, lastMetrics);
      }
    }

    const symplectic = checkSymplecticStability(this.H_history);

    return {
      finalMetrics: lastMetrics,
      H_history:    this.H_history,
      symplectic,
    };
  }
}
