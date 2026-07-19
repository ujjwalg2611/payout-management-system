const { users, withdrawals } = require('../repositories');
const { Withdrawal, WITHDRAWAL_STATUS, RECOVERABLE_STATUSES } = require('../models/Withdrawal');
const WalletService = require('./WalletService');
const mutex = require('../utils/mutex');
const id = require('../utils/id');
const { NotFoundError, ConflictError, ValidationError, RateLimitError } = require('../utils/errors');

const WITHDRAWAL_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * WithdrawalService
 *
 * Business rule #3 (24h limit): enforced against `user.lastWithdrawalAt`,
 * which is ONLY updated on a *successful* (completed) withdrawal - see
 * markCompleted(). This is a deliberate design decision: it makes Question
 * 2 (failed payout recovery) compose correctly with Question 1's cooldown
 * rule without any special-casing. A user whose withdrawal failed has not
 * "used up" their daily window.
 *
 * Question 2 (failed payout recovery): initiateWithdrawal() debits the
 * wallet immediately (money is "in flight" to the gateway, so it must not
 * be spendable twice). If the gateway later reports FAILED / REJECTED /
 * CANCELLED, recoverFailedWithdrawal() credits the exact amount back and
 * the withdrawal record moves to a terminal recovered state, after which
 * the user is free to call initiateWithdrawal() again immediately (no
 * cooldown, since lastWithdrawalAt was never touched for a failed attempt).
 */
class WithdrawalService {
  async initiateWithdrawal(userId, amount) {
    if (!(amount > 0)) throw new ValidationError('Withdrawal amount must be greater than 0');

    return mutex.runExclusive(userId, () => this._initiateLocked(userId, amount));
  }

  _initiateLocked(userId, amount) {
    const user = users.get(userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    if (user.lastWithdrawalAt) {
      const elapsed = Date.now() - new Date(user.lastWithdrawalAt).getTime();
      if (elapsed < WITHDRAWAL_COOLDOWN_MS) {
        const retryAfterMs = WITHDRAWAL_COOLDOWN_MS - elapsed;
        throw new RateLimitError(
          `Only one withdrawal is allowed every 24 hours. Try again in ${Math.ceil(retryAfterMs / (60 * 1000))} minute(s).`
        );
      }
    }

    if (amount > user.walletBalance) {
      throw new ValidationError(
        `Requested amount (${amount}) exceeds withdrawable balance (${user.walletBalance})`
      );
    }

    const withdrawal = new Withdrawal({ withdrawalId: id.withdrawalId(), userId, amount });
    withdrawals.set(withdrawal.withdrawalId, withdrawal);

    // Debit immediately - the money is committed to this withdrawal attempt
    // and must not be withdrawable again until/unless it is recovered.
    WalletService.debitForWithdrawal(userId, amount, withdrawal.withdrawalId);

    // NOTE: lastWithdrawalAt is intentionally NOT set yet - only on success.
    return withdrawal;
  }

  /**
   * Called by the payment-gateway webhook (or admin action) once the
   * transfer is confirmed successful.
   */
  markCompleted(withdrawalId) {
    const withdrawal = withdrawals.get(withdrawalId);
    if (!withdrawal) throw new NotFoundError(`Withdrawal ${withdrawalId} not found`);
    if (withdrawal.status !== WITHDRAWAL_STATUS.INITIATED) {
      throw new ConflictError(`Withdrawal ${withdrawalId} is already '${withdrawal.status}'`);
    }

    return mutex.runExclusive(withdrawal.userId, () => {
      withdrawal.status = WITHDRAWAL_STATUS.COMPLETED;
      withdrawal.updatedAt = new Date();
      withdrawals.set(withdrawalId, withdrawal);

      const user = users.get(withdrawal.userId);
      user.lastWithdrawalAt = new Date(); // cooldown starts NOW, only on success
      users.set(user.userId, user);

      return withdrawal;
    });
  }

  /**
   * Question 2: Failed Payout Recovery.
   * newStatus must be one of FAILED / REJECTED / CANCELLED.
   */
  recoverFailedWithdrawal(withdrawalId, newStatus) {
    if (!RECOVERABLE_STATUSES.has(newStatus)) {
      throw new ValidationError(`newStatus must be one of: ${[...RECOVERABLE_STATUSES].join(', ')}`);
    }

    const withdrawal = withdrawals.get(withdrawalId);
    if (!withdrawal) throw new NotFoundError(`Withdrawal ${withdrawalId} not found`);

    return mutex.runExclusive(withdrawal.userId, () => this._recoverLocked(withdrawal, newStatus));
  }

  _recoverLocked(withdrawal, newStatus) {
    const fresh = withdrawals.get(withdrawal.withdrawalId); // re-read inside lock

    // Idempotency: a webhook can be delivered more than once. Only the
    // FIRST terminal notification actually credits money back.
    if (fresh.status !== WITHDRAWAL_STATUS.INITIATED) {
      throw new ConflictError(
        `Withdrawal ${fresh.withdrawalId} is already '${fresh.status}' - ignoring duplicate/late notification.`
      );
    }

    fresh.status = newStatus;
    fresh.updatedAt = new Date();
    fresh.recoveredAt = new Date();
    withdrawals.set(fresh.withdrawalId, fresh);

    const { user } = WalletService.recoverFailedWithdrawal(fresh.userId, fresh.amount, fresh.withdrawalId);

    // lastWithdrawalAt was never set for this attempt, so the user can
    // call initiateWithdrawal() again right away - no cooldown penalty
    // for a failure that wasn't their fault.

    return { withdrawal: fresh, walletBalance: user.walletBalance };
  }
}

module.exports = new WithdrawalService();
