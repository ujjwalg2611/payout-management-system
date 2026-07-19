const { users, ledger } = require('../repositories');
const { LedgerEntry, LEDGER_REASON } = require('../models/LedgerEntry');
const { NotFoundError } = require('../utils/errors');
const { round2 } = require('../utils/money');
const id = require('../utils/id');

/**
 * WalletService is the ONLY place in the codebase allowed to mutate
 * user.walletBalance. Every other service must go through here. This keeps
 * the "balance changed -> ledger entry written" invariant impossible to
 * accidentally break as the codebase grows.
 *
 * NOTE: callers are responsible for wrapping calls in mutex.runExclusive(userId, ...)
 * when the operation must be atomic with respect to reads of the balance
 * (see WithdrawalService for the canonical example).
 */
class WalletService {
  applyDelta(userId, amount, reason, referenceId) {
    const user = users.get(userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    user.walletBalance = round2(user.walletBalance + amount);
    users.set(userId, user);

    const entry = new LedgerEntry({
      entryId: id.entryId(),
      userId,
      amount: round2(amount),
      reason,
      referenceId,
      balanceAfter: user.walletBalance,
    });
    ledger.set(entry.entryId, entry);

    return { user, entry };
  }

  creditAdvancePayout(userId, amount, advancePayoutId) {
    return this.applyDelta(userId, amount, LEDGER_REASON.ADVANCE_PAYOUT, advancePayoutId);
  }

  applyReconciliationAdjustment(userId, amount, adjustmentId) {
    return this.applyDelta(userId, amount, LEDGER_REASON.RECONCILIATION_ADJUSTMENT, adjustmentId);
  }

  debitForWithdrawal(userId, amount, withdrawalId) {
    return this.applyDelta(userId, -amount, LEDGER_REASON.WITHDRAWAL_DEBIT, withdrawalId);
  }

  recoverFailedWithdrawal(userId, amount, withdrawalId) {
    return this.applyDelta(userId, amount, LEDGER_REASON.WITHDRAWAL_RECOVERY, withdrawalId);
  }

  getBalance(userId) {
    const user = users.get(userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);
    return user.walletBalance;
  }
}

module.exports = new WalletService();
