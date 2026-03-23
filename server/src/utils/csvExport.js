/**
 * RFC-style CSV helpers for Excel-friendly UTF-8 exports.
 */

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cells) {
  return cells.map(csvEscape).join(",");
}

/**
 * @param {import("express").Response} res
 * @param {string} filename
 * @param {string[][]} rows
 */
function sendCsv(res, filename, rows) {
  const safeName = filename.replace(/[^\w.\-]+/g, "_");
  const body = "\uFEFF" + rows.map(csvLine).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.send(body);
}

module.exports = { csvEscape, csvLine, sendCsv };
