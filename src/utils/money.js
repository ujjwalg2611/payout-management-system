/**
 * All amounts in this demo are plain rupees rounded to 2 decimals to keep
 * the example output readable. In production, store money as integer paise
 * (amount * 100) end-to-end and only format to rupees at the presentation
 * layer - this avoids IEEE-754 floating point drift entirely.
 */
function round2(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

module.exports = { round2 };
