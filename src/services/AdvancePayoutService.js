const { sales, advancePayouts, users } = require('../repositories');
const { SALE_STATUS } = require('../models/Sale');
const { AdvancePayout, ADVANCE_STATUS } = require('../models/AdvancePayout');
const WalletService = require('./WalletService');
const mutex = require('../utils/mutex');
const id = require('../utils/id');
const { round2 } = require('../utils/money');

const ADVANCE_RATE = 0.10;

/**
 * AdvancePayoutService
 * Meant to be triggered by a cron job (e.g. every hour), but is exposed here
 * as a callable "runForUser" / "runForAllUsers" so it can also be invoked
 * on-demand via an admin API for testing/ops purposes.
 *
 * IDEMPOTENCY (core business rule #1):
 *   A sale is only eligible if sale.status === PENDING AND
 *   sale.advancePayoutId === null. The very first thing we do inside the
 *   locked section is re-check this condition, then IMMEDIATELY stamp
 *   sale.advancePayoutId before doing anything else. That stamp is what
 *   makes re-running the job any number of times safe - a sale that has
 *   already been advanced is structurally invisible to the query that finds
 *   "eligible" sales next time.
 */
class AdvancePayoutService {
  async runForUser(userId) {
    return mutex.runExclusive(userId, () => this._runForUserLocked(userId));
  }

  async runForAllUsers() {
    const userIds = [...new Set(sales.find((s) => s.status === SALE_STATUS.PENDING && !s.advancePayoutId).map((s) => s.userId))];
    const results = [];
    for (const userId of userIds) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.runForUser(userId));
    }
    return results;
  }

  _runForUserLocked(userId) {
    const user = users.get(userId);
    if (!user) return { userId, paidSales: [], totalAdvance: 0 };

    const eligibleSales = sales.find(
      (s) => s.userId === userId && s.status === SALE_STATUS.PENDING && !s.advancePayoutId
    );

    const paidSales = [];
    let totalAdvance = 0;

    for (const sale of eligibleSales) {
      const advanceAmount = round2(sale.earning * ADVANCE_RATE);

      const record = new AdvancePayout({
        advancePayoutId: id.advancePayoutId(),
        userId,
        saleId: sale.saleId,
        amount: advanceAmount,
        status: ADVANCE_STATUS.TRANSFERRED,
      });
      advancePayouts.set(record.advancePayoutId, record);

      // Stamp the sale FIRST (within this same synchronous tick, protected by
      // the mutex) so a concurrent/duplicate job run can never double-pay it.
      sale.advancePaid = advanceAmount;
      sale.advancePayoutId = record.advancePayoutId;
      sale.updatedAt = new Date();
      sales.set(sale.saleId, sale);

      WalletService.creditAdvancePayout(userId, advanceAmount, record.advancePayoutId);

      paidSales.push({ saleId: sale.saleId, earning: sale.earning, advanceAmount });
      totalAdvance = round2(totalAdvance + advanceAmount);
    }

    return { userId, paidSales, totalAdvance };
  }
}

module.exports = new AdvancePayoutService();
