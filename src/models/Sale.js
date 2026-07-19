const SALE_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/**
 * Sale Entity
 *
 * advancePaid        -> amount already advanced against this sale (0 until paid)
 * advancePayoutId    -> FK to AdvancePayout record. This is the idempotency guard:
 *                        once set, the advance-payout job will NEVER touch this
 *                        sale again, no matter how many times the job runs.
 * reconciledAt       -> null while pending; set exactly once when admin reconciles.
 */
class Sale {
  constructor({ saleId, userId, brandId, earning, status = SALE_STATUS.PENDING }) {
    this.saleId = saleId;
    this.userId = userId;
    this.brandId = brandId;
    this.earning = earning;
    this.status = status;
    this.advancePaid = 0;
    this.advancePayoutId = null;
    this.reconciledAt = null;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }
}

module.exports = { Sale, SALE_STATUS };
