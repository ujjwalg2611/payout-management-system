/**
 * PayoutAdjustment Entity
 *
 * Created exactly once per sale, at reconciliation time. This is the audit
 * record that explains "why did the wallet balance change by X".
 *
 *   APPROVED sale -> adjustment = earning - advancePaid   (positive, top-up)
 *   REJECTED sale -> adjustment = -advancePaid            (negative, clawback)
 */
class PayoutAdjustment {
  constructor({ adjustmentId, userId, saleId, earning, advancePaid, finalStatus, adjustment }) {
    this.adjustmentId = adjustmentId;
    this.userId = userId;
    this.saleId = saleId;
    this.earning = earning;
    this.advancePaid = advancePaid;
    this.finalStatus = finalStatus; // 'approved' | 'rejected'
    this.adjustment = adjustment; // signed rupee amount applied to wallet
    this.createdAt = new Date();
  }
}

module.exports = PayoutAdjustment;
