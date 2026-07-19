const { sales, payoutAdjustments } = require('../repositories');
const { SALE_STATUS } = require('../models/Sale');
const PayoutAdjustment = require('../models/PayoutAdjustment');
const WalletService = require('./WalletService');
const mutex = require('../utils/mutex');
const id = require('../utils/id');
const { round2 } = require('../utils/money');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');

const FINAL_STATUSES = new Set([SALE_STATUS.APPROVED, SALE_STATUS.REJECTED]);

/**
 * ReconciliationService
 * Applies core business rule #2: on reconciliation, adjust the wallet by
 * the difference between what's actually owed and what was already
 * advanced.
 *
 *   Approved: adjustment = earning - advancePaid   (top-up, can be 0 if never advanced)
 *   Rejected: adjustment = -advancePaid             (claw back exactly what was advanced)
 *
 * IDEMPOTENCY: a sale can only transition PENDING -> {APPROVED, REJECTED}
 * exactly once. sale.reconciledAt acts as the guard, exactly like
 * advancePayoutId does for the advance job. Re-reconciling an already
 * final sale is rejected with a 409, not silently re-applied - re-applying
 * would double count the adjustment.
 */
class ReconciliationService {
  async reconcile(saleId, newStatus) {
    if (!FINAL_STATUSES.has(newStatus)) {
      throw new ValidationError(`status must be one of: ${[...FINAL_STATUSES].join(', ')}`);
    }

    const sale = sales.get(saleId);
    if (!sale) throw new NotFoundError(`Sale ${saleId} not found`);

    return mutex.runExclusive(sale.userId, () => this._reconcileLocked(saleId, newStatus));
  }

  _reconcileLocked(saleId, newStatus) {
    const sale = sales.get(saleId); // re-read inside the lock
    if (!sale) throw new NotFoundError(`Sale ${saleId} not found`);

    if (sale.status !== SALE_STATUS.PENDING || sale.reconciledAt) {
      throw new ConflictError(
        `Sale ${saleId} has already been reconciled as '${sale.status}'. Reconciliation is a one-time, final action.`
      );
    }

    const adjustment =
      newStatus === SALE_STATUS.APPROVED
        ? round2(sale.earning - sale.advancePaid)
        : round2(-sale.advancePaid);

    const record = new PayoutAdjustment({
      adjustmentId: id.adjustmentId(),
      userId: sale.userId,
      saleId: sale.saleId,
      earning: sale.earning,
      advancePaid: sale.advancePaid,
      finalStatus: newStatus,
      adjustment,
    });
    payoutAdjustments.set(record.adjustmentId, record);

    sale.status = newStatus;
    sale.reconciledAt = new Date();
    sale.updatedAt = new Date();
    sales.set(sale.saleId, sale);

    const { user } = WalletService.applyReconciliationAdjustment(sale.userId, adjustment, record.adjustmentId);

    return { sale, adjustment: record, walletBalance: user.walletBalance };
  }
}

module.exports = new ReconciliationService();
