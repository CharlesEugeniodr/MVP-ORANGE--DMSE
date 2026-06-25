/**
 * @fileoverview SPARC (Spitzer Photometry and Accurate Rotation Curves)
 * galaxy rotation-curve catalog.
 *
 * Contains observational data for three galaxies used in the Orange-DMSE
 * validation pipeline.  All velocities are in km/s, radii in kpc.
 *
 * Data source: SPARC database (Lelli, McGaugh & Schombert 2016)
 *
 * @module sparc-catalog
 */

/**
 * @typedef {Object} GalaxyData
 * @property {string}   name        - Galaxy identifier
 * @property {string}   description - Short description
 * @property {number[]} R           - Galactocentric radii (kpc)
 * @property {number[]} Vobs        - Observed rotation velocity (km/s)
 * @property {number[]} Vobs_err    - 1σ uncertainty on Vobs (km/s)
 * @property {number[]} Vdisk       - Disk (stellar) velocity component (km/s)
 * @property {number[]} Vbulge      - Bulge velocity component (km/s)
 * @property {number[]} Vgas        - Gas velocity component (km/s)
 */

/**
 * SPARC catalog containing rotation-curve data for three galaxies.
 * @type {Object.<string, GalaxyData>}
 */
export const SPARC_CATALOG = Object.freeze({

  // ─── NGC 3198 ──────────────────────────────────────────────────────
  NGC_3198: Object.freeze({
    name:        'NGC 3198',
    description: 'Late-type spiral (Sc) in Ursa Major; classic example of '
               + 'a flat rotation curve requiring dark matter or modified gravity.',
    R:        [1.36, 2.72, 4.08, 5.44, 6.80, 9.52, 12.24, 14.96, 17.68, 20.40, 24.48, 28.56, 32.64],
    Vobs:     [55,   92,   110,  122,  135,  148,  150,   149,   147,   148,   149,   150,   148],
    Vobs_err: [4,    5,    5,    4,    4,    3,    3,     3,     4,     4,     5,     5,     6],
    Vdisk:    [40,   75,   90,   95,   92,   85,   78,    70,    64,    58,    50,    44,    38],
    Vbulge:   [0,    0,    0,    0,    0,    0,    0,     0,     0,     0,     0,     0,     0],
    Vgas:     [15,   22,   28,   31,   33,   35,   36,    37,    36,    35,    34,    32,    30],
  }),

  // ─── NGC 2403 ──────────────────────────────────────────────────────
  NGC_2403: Object.freeze({
    name:        'NGC 2403',
    description: 'Intermediate spiral (SABcd) in Camelopardalis; well-studied '
               + 'rotation curve with extended H I measurements.',
    R:        [0.47, 0.93, 1.86, 2.79, 3.72, 4.65, 5.58, 7.44, 9.30, 11.16, 13.95, 16.74, 19.53],
    Vobs:     [28,   45,   70,   85,   98,   105,  112,  122,  128,  131,   133,   134,   133],
    Vobs_err: [3,    3,    4,    4,    3,    3,    2.5,  2.5,  3,    3,     4,     4,     5],
    Vdisk:    [20,   35,   58,   70,   74,   73,   70,   62,   55,   48,    40,    33,    28],
    Vbulge:   [0,    0,    0,    0,    0,    0,    0,    0,    0,    0,     0,     0,     0],
    Vgas:     [10,   15,   22,   26,   28,   29,   30,   31,   31,   30,    29,    28,    26],
  }),

  // ─── UGC 128 ───────────────────────────────────────────────────────
  UGC_128: Object.freeze({
    name:        'UGC 128',
    description: 'Low surface brightness (LSB) galaxy; ideal test for '
               + 'dark matter models due to dominant dark-matter fraction.',
    R:        [2.40, 4.80, 7.20, 9.60, 12.00, 14.40, 16.80, 19.20, 21.60, 24.00, 28.80, 33.60],
    Vobs:     [32,   50,   68,   82,   95,    108,   118,   124,   128,   131,   132,   131],
    Vobs_err: [4,    4,    3.5,  3,    3,     2.5,   2.5,   3,     3,     4,     5,     6],
    Vdisk:    [12,   25,   38,   45,   48,    49,    48,    46,    43,    40,    34,    28],
    Vbulge:   [0,    0,    0,    0,    0,     0,     0,     0,     0,     0,     0,     0],
    Vgas:     [8,    16,   24,   29,   32,    34,    35,    36,    36,    35,    33,    31],
  }),
});

/**
 * Get a list of all galaxy names in the catalog.
 * @returns {string[]}
 */
export function getGalaxyNames() {
  return Object.keys(SPARC_CATALOG);
}

/**
 * Retrieve a single galaxy's data by key.
 * @param {string} key - e.g. 'NGC_3198'
 * @returns {GalaxyData|undefined}
 */
export function getGalaxy(key) {
  return SPARC_CATALOG[key];
}
