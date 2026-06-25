/**
 * @fileoverview Data ingestion utilities for the Orange-DMSE pipeline.
 *
 * Handles parsing, validation, column mapping, and unit normalisation of
 * external rotation-curve data so it can be fed into the comparative-models
 * module.
 *
 * @module data-ingestion
 */

// ─── Known column aliases ──────────────────────────────────────────────────────

/**
 * Map of canonical column names to arrays of recognised aliases.
 * Used by `autoDetectColumns()`.
 * @type {Object.<string, string[]>}
 */
const COLUMN_ALIASES = {
  R:        ['R', 'r', 'radius', 'Radius', 'R_kpc', 'r_kpc', 'Rad', 'rad'],
  Vobs:     ['Vobs', 'vobs', 'V_obs', 'v_obs', 'Vrot', 'vrot', 'V_rot'],
  Vobs_err: ['Vobs_err', 'vobs_err', 'V_err', 'v_err', 'eVobs', 'Verr', 'verr', 'err'],
  Vdisk:    ['Vdisk', 'vdisk', 'V_disk', 'v_disk', 'Vd', 'vd', 'Vstar'],
  Vbulge:   ['Vbulge', 'vbulge', 'V_bulge', 'v_bulge', 'Vb', 'vb'],
  Vgas:     ['Vgas', 'vgas', 'V_gas', 'v_gas', 'Vg', 'vg', 'VHI'],
};

/**
 * Required columns that must be present after mapping.
 * @type {string[]}
 */
const REQUIRED_COLUMNS = ['R', 'Vobs'];

// ─── DataIngestion ─────────────────────────────────────────────────────────────

/**
 * Ingestion pipeline for galaxy rotation-curve data.
 *
 * Usage:
 * ```js
 * const di = new DataIngestion();
 * const raw = di.parseCSV(csvString);
 * const mapped = di.mapColumns(raw);        // auto-detect
 * const valid = di.validateData(mapped);     // throws on error
 * const final = di.normalizeUnits(valid, 'pc', 'kpc'); // radius conversion
 * ```
 */
export class DataIngestion {
  constructor() {
    /** @type {string[]} */
    this.warnings = [];
  }

  // ── CSV Parser ───────────────────────────────────────────────────────

  /**
   * Parse a CSV string into an array of row objects keyed by the header.
   *
   * Handles:
   *   • Comma, semicolon, or tab delimiters (auto-detected)
   *   • Quoted fields
   *   • Comment lines starting with `#`
   *   • Trailing blank lines
   *
   * @param {string} text - Raw CSV text
   * @returns {Object[]} Array of { header1: value1, ... } objects
   */
  parseCSV(text) {
    const lines = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter(l => l.trim() !== '' && !l.trim().startsWith('#'));

    if (lines.length < 2) {
      throw new Error('CSV must have at least a header row and one data row.');
    }

    // Auto-detect delimiter
    const delimiters = [',', ';', '\t'];
    let delimiter = ',';
    let maxCols   = 0;
    for (const d of delimiters) {
      const n = lines[0].split(d).length;
      if (n > maxCols) {
        maxCols   = n;
        delimiter = d;
      }
    }

    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    const rows    = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(delimiter).map(p => p.trim().replace(/^"|"$/g, ''));
      const row   = {};
      for (let j = 0; j < headers.length; j++) {
        const val = parts[j] !== undefined ? parts[j] : '';
        row[headers[j]] = isNaN(Number(val)) ? val : Number(val);
      }
      rows.push(row);
    }

    return rows;
  }

  // ── JSON Parser ──────────────────────────────────────────────────────

  /**
   * Parse a JSON string.  Accepts either:
   *   • An array of row objects  [{ R: ..., Vobs: ... }, ...]
   *   • A column-oriented object { R: [...], Vobs: [...] }
   *
   * Always returns an array of row objects.
   *
   * @param {string} text - Raw JSON text
   * @returns {Object[]} Array of row objects
   */
  parseJSON(text) {
    const data = JSON.parse(text);

    if (Array.isArray(data)) {
      return data;
    }

    // Column-oriented → row-oriented
    const keys   = Object.keys(data);
    const length = data[keys[0]].length;
    const rows   = [];

    for (let i = 0; i < length; i++) {
      const row = {};
      for (const k of keys) {
        row[k] = data[k][i];
      }
      rows.push(row);
    }

    return rows;
  }

  // ── Column Mapping ───────────────────────────────────────────────────

  /**
   * Map raw column names to canonical names.
   *
   * If `mapping` is provided it is used directly; otherwise columns are
   * auto-detected from `COLUMN_ALIASES`.
   *
   * @param {Object[]} data    - Row objects from parseCSV/parseJSON
   * @param {Object}   [mapping] - Explicit { canonical: rawName } map
   * @returns {Object[]} Rows with canonical column names
   */
  mapColumns(data, mapping) {
    if (data.length === 0) return data;

    const rawKeys   = Object.keys(data[0]);
    const resolvedMap = mapping || this._autoDetect(rawKeys);

    return data.map(row => {
      const mapped = {};
      for (const [canonical, raw] of Object.entries(resolvedMap)) {
        mapped[canonical] = row[raw] !== undefined ? row[raw] : null;
      }
      // Keep unmapped columns too
      for (const k of rawKeys) {
        if (!Object.values(resolvedMap).includes(k)) {
          mapped[k] = row[k];
        }
      }
      return mapped;
    });
  }

  /**
   * Auto-detect column names from known aliases.
   * @param {string[]} rawKeys
   * @returns {Object.<string, string>}
   * @private
   */
  _autoDetect(rawKeys) {
    const map = {};
    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
      for (const alias of aliases) {
        if (rawKeys.includes(alias)) {
          map[canonical] = alias;
          break;
        }
      }
    }
    return map;
  }

  // ── Validation ───────────────────────────────────────────────────────

  /**
   * Validate that the data has all required columns, numeric values,
   * and physically plausible ranges.
   *
   * @param {Object[]} data - Rows with canonical column names
   * @returns {Object[]} The same data array (for chaining)
   * @throws {Error} If validation fails
   */
  validateData(data) {
    this.warnings = [];

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Data is empty or not an array.');
    }

    const keys = Object.keys(data[0]);

    // Check required columns
    for (const req of REQUIRED_COLUMNS) {
      if (!keys.includes(req)) {
        throw new Error(`Missing required column: "${req}".  Found: ${keys.join(', ')}`);
      }
    }

    // Optional columns: fill defaults
    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      // Radius must be positive
      if (typeof row.R !== 'number' || row.R <= 0) {
        throw new Error(`Row ${i}: R must be a positive number, got ${row.R}`);
      }

      // Vobs must be a number
      if (typeof row.Vobs !== 'number') {
        throw new Error(`Row ${i}: Vobs must be a number, got ${row.Vobs}`);
      }

      // Default error to 10 % if missing
      if (row.Vobs_err == null || typeof row.Vobs_err !== 'number') {
        row.Vobs_err = Math.abs(row.Vobs) * 0.1;
        this.warnings.push(`Row ${i}: Vobs_err missing, defaulting to 10% of Vobs`);
      }

      // Defaults for optional component columns
      if (row.Vdisk  == null) row.Vdisk  = 0;
      if (row.Vbulge == null) row.Vbulge = 0;
      if (row.Vgas   == null) row.Vgas   = 0;
    }

    // Physical sanity: radii should be monotonically increasing
    for (let i = 1; i < data.length; i++) {
      if (data[i].R < data[i - 1].R) {
        this.warnings.push(`Row ${i}: R is not monotonically increasing (${data[i].R} < ${data[i - 1].R})`);
      }
    }

    return data;
  }

  // ── Unit Normalisation ───────────────────────────────────────────────

  /**
   * Convert radius or velocity columns between common units.
   *
   * Supported radius units: 'kpc', 'pc', 'Mpc', 'm', 'arcsec' (with distance)
   * Supported velocity units: 'km/s', 'm/s'
   *
   * @param {Object[]} data     - Validated row objects
   * @param {string}   fromUnit - Current unit of the R column
   * @param {string}   toUnit   - Target unit
   * @param {Object}   [opts]   - Additional options
   * @param {number}   [opts.distance_Mpc] - Distance for arcsec→kpc conversion
   * @returns {Object[]} Converted data (mutated in place)
   */
  normalizeUnits(data, fromUnit, toUnit, opts = {}) {
    const radiusFactors = {
      kpc:  1.0,
      pc:   1e-3,      // pc  → kpc
      Mpc:  1e3,       // Mpc → kpc
      m:    1 / 3.0857e19,
    };

    const velocityFactors = {
      'km/s': 1.0,
      'm/s':  1e-3,    // m/s → km/s
    };

    // Radius conversion
    if (fromUnit in radiusFactors && toUnit in radiusFactors) {
      const factor = radiusFactors[fromUnit] / radiusFactors[toUnit];
      for (const row of data) {
        row.R *= factor;
      }
    }
    // Arcsec → kpc (requires distance)
    else if (fromUnit === 'arcsec' && toUnit === 'kpc') {
      const d_Mpc = opts.distance_Mpc;
      if (!d_Mpc) throw new Error('distance_Mpc required for arcsec→kpc conversion');
      // 1 arcsec at d Mpc = d * tan(1") ≈ d * 4.848e-6 Mpc = d * 4.848e-3 kpc
      const factor = d_Mpc * 4.848e-3;
      for (const row of data) {
        row.R *= factor;
      }
    }
    // Velocity conversion
    else if (fromUnit in velocityFactors && toUnit in velocityFactors) {
      const factor = velocityFactors[fromUnit] / velocityFactors[toUnit];
      const velCols = ['Vobs', 'Vobs_err', 'Vdisk', 'Vbulge', 'Vgas'];
      for (const row of data) {
        for (const col of velCols) {
          if (row[col] != null) row[col] *= factor;
        }
      }
    } else {
      throw new Error(`Unsupported unit conversion: ${fromUnit} → ${toUnit}`);
    }

    return data;
  }
}
