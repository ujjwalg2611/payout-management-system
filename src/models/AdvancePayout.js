const ADVANCE_STATUS = Object.freeze({
  TRANSFERRED: 'transferred',
  FAILED: 'failed',
});

/**
 * AdvancePayout Entity
 * One row per (sale) advance transfer. Kept separate from Sale so we retain
 * a full, append-only audit trail of every advance ever paid.
 */
class AdvancePayout {
  constructor({ advancePayoutId, userId, saleId, amount, status = ADVANCE_STATUS.TRANSFERRED }) {
    this.advancePayoutId = advancePayoutId;
    this.userId = userId;
    this.saleId = saleId;
    this.amount = amount;
    this.status = status;
    this.createdAt = new Date();
  }
}

module.exports = { AdvancePayout, ADVANCE_STATUS };
