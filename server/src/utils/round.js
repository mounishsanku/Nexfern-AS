/** Rounds to 2 decimal places. Use for tax and monetary values. */
function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

module.exports = { round2 };
