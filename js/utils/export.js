/**
 * @fileoverview Export and reporting utilities for Orange-DMSE.
 *
 * Provides:
 *   • SHA-256 hashing via the Web Crypto API (SubtleCrypto)
 *   • JSON export with browser download trigger
 *   • CSV export with browser download trigger
 *   • HTML report generation (print-friendly, self-contained)
 *
 * All download functions create a temporary `<a>` element and click it
 * programmatically.  They are no-ops in non-browser environments.
 *
 * @module export
 */

// ─── SHA-256 ───────────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hash of a text string using the Web Crypto API.
 *
 * Falls back to a naïve pure-JS implementation when `crypto.subtle` is
 * unavailable (e.g. Node.js without `--experimental-global-webcrypto`).
 *
 * @param {string} text - Input string
 * @returns {Promise<string>} Hex-encoded SHA-256 digest
 */
export async function sha256Hash(text) {
  // Prefer SubtleCrypto (available in all modern browsers)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data    = encoder.encode(text);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: simple SHA-256 in pure JS (K. Moriarty implementation)
  return sha256Fallback(text);
}

/**
 * Pure-JS SHA-256 fallback (for environments without SubtleCrypto).
 * @param {string} message
 * @returns {string} Hex digest
 * @private
 */
function sha256Fallback(message) {
  /* eslint-disable no-bitwise */
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
  function ch(x, y, z)  { return (x & y) ^ (~x & z); }
  function maj(x, y, z) { return (x & y) ^ (x & z) ^ (y & z); }
  function sigma0(x)    { return rotr(2, x) ^ rotr(13, x) ^ rotr(22, x); }
  function sigma1(x)    { return rotr(6, x) ^ rotr(11, x) ^ rotr(25, x); }
  function gamma0(x)    { return rotr(7, x) ^ rotr(18, x) ^ (x >>> 3); }
  function gamma1(x)    { return rotr(17, x) ^ rotr(19, x) ^ (x >>> 10); }

  // Pre-process: convert to bytes, pad, append length
  const encoder = new TextEncoder();
  const msgBytes = encoder.encode(message);
  const bitLen   = msgBytes.length * 8;

  // Padding
  const padded = new Uint8Array(
    Math.ceil((msgBytes.length + 9) / 64) * 64
  );
  padded.set(msgBytes);
  padded[msgBytes.length] = 0x80;

  // Append bit length as 64-bit big-endian
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen, false);

  // Initial hash values
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  // Process each 512-bit block
  for (let offset = 0; offset < padded.length; offset += 64) {
    const W = new Uint32Array(64);
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      W[i] = (gamma1(W[i-2]) + W[i-7] + gamma0(W[i-15]) + W[i-16]) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3;
    let e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const T1 = (h + sigma1(e) + ch(e, f, g) + K[i] + W[i]) >>> 0;
      const T2 = (sigma0(a) + maj(a, b, c)) >>> 0;
      h = g; g = f; f = e; e = (d + T1) >>> 0;
      d = c; c = b; b = a; a = (T1 + T2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(v => v.toString(16).padStart(8, '0'))
    .join('');
  /* eslint-enable no-bitwise */
}

// ─── JSON Export ───────────────────────────────────────────────────────────────

/**
 * Export a data object as a downloadable JSON file.
 *
 * @param {*}      data     - Any JSON-serialisable value
 * @param {string} filename - Suggested filename (e.g. 'results.json')
 */
export function exportJSON(data, filename) {
  const json = JSON.stringify(data, null, 2);
  _triggerDownload(json, filename, 'application/json');
}

// ─── CSV Export ────────────────────────────────────────────────────────────────

/**
 * Export an array of row objects as a downloadable CSV file.
 *
 * The first row's keys become the CSV header.
 *
 * @param {Object[]} rows     - Array of objects with uniform keys
 * @param {string}   filename - Suggested filename (e.g. 'data.csv')
 */
export function exportCSV(rows, filename) {
  if (!rows || rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const lines   = [headers.join(',')];

  for (const row of rows) {
    const vals = headers.map(h => {
      const v = row[h];
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v ?? '';
    });
    lines.push(vals.join(','));
  }

  _triggerDownload(lines.join('\n'), filename, 'text/csv');
}

// ─── HTML Report ───────────────────────────────────────────────────────────────

/**
 * Generate a self-contained, print-friendly HTML report.
 *
 * @param {Object} reportData
 * @param {string} reportData.title       - Report title
 * @param {string} [reportData.subtitle]  - Optional subtitle
 * @param {string} [reportData.timestamp] - ISO timestamp (default: now)
 * @param {Array}  reportData.sections    - Report sections, each:
 *   { heading: string, content: string, table?: { headers: string[], rows: any[][] } }
 * @returns {string} Complete HTML document string
 */
export function generateReportHTML(reportData) {
  const {
    title,
    subtitle   = '',
    timestamp  = new Date().toISOString(),
    sections   = [],
  } = reportData;

  const sectionHTML = sections.map(sec => {
    let html = `<section>
  <h2>${escapeHtml(sec.heading)}</h2>`;

    if (sec.content) {
      html += `\n  <p>${escapeHtml(sec.content)}</p>`;
    }

    if (sec.table) {
      html += `\n  <table>
    <thead><tr>${sec.table.headers.map(h => `<th>${escapeHtml(String(h))}</th>`).join('')}</tr></thead>
    <tbody>`;
      for (const row of sec.table.rows) {
        html += `\n      <tr>${row.map(c => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`;
      }
      html += `\n    </tbody>\n  </table>`;
    }

    html += '\n</section>';
    return html;
  }).join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    /* ── Print-friendly styles ── */
    @page { margin: 2cm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
      color: #1a1a1a;
      line-height: 1.6;
    }
    header {
      border-bottom: 3px solid #e67e22;
      padding-bottom: 1rem;
      margin-bottom: 2rem;
    }
    h1 { color: #d35400; margin: 0; font-size: 1.8rem; }
    .subtitle { color: #666; margin-top: 0.25rem; }
    .timestamp { color: #999; font-size: 0.85rem; }
    h2 {
      color: #2c3e50;
      border-left: 4px solid #e67e22;
      padding-left: 0.75rem;
      margin-top: 2rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.9rem;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    th { background: #f8f9fa; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
    section { page-break-inside: avoid; }
    @media print {
      body { padding: 0; }
      header { border-bottom-color: #333; }
      h1 { color: #333; }
      h2 { color: #333; border-left-color: #333; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
    <p class="timestamp">Generated: ${escapeHtml(timestamp)}</p>
  </header>

  ${sectionHTML}

  <footer style="margin-top:3rem; padding-top:1rem; border-top:1px solid #eee; color:#999; font-size:0.8rem;">
    Orange-DMSE v1.0 &mdash; Dimensional Mesh Simulation Engine
  </footer>
</body>
</html>`;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Escape HTML special characters.
 * @param {string} s
 * @returns {string}
 * @private
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Trigger a browser file download.
 * No-op if `document` is not available (e.g. Node.js).
 *
 * @param {string} content  - File content
 * @param {string} filename - Suggested file name
 * @param {string} mimeType - MIME type
 * @private
 */
function _triggerDownload(content, filename, mimeType) {
  if (typeof document === 'undefined') {
    // Non-browser: log a warning and return the content
    // (allows server-side usage without crashing)
    console.warn(`[export] Cannot trigger download in non-browser environment. File: ${filename}`);
    return content;
  }

  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
