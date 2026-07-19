const LEDGER_REASON = Object.freeze({
  ADVANCE_PAYOUT: 'advance_payout', // +amount
  RECONCILIATION_ADJUSTMENT: 'reconciliation_adjustment', // +/-amount
  WITHDRAWAL_DEBIT: 'withdrawal_debit', // -amount (on initiate)
  WITHDRAWAL_RECOVERY: 'withdrawal_recovery', // +amount (on fail/reject/cancel)
});

/**
 * LedgerEntry Entity
 * Every single mutation of walletBalance MUST create exactly one LedgerEntry.
 * This gives us: (a) a full audit trail, (b) the ability to recompute a
 * user's balance independently as a correctness check, (c) debuggability
 * when a user disputes their balance.
 */
class LedgerEntry {
  constructor({ entryId, userId, amount, reason, referenceId, balanceAfter }) {
    this.entryId = entryId;
    this.userId = userId;
    this.amount = amount; // signed
    this.reason = reason;
    this.referenceId = referenceId; // saleId / advancePayoutId / withdrawalId
    this.balanceAfter = balanceAfter;
    this.createdAt = new Date();
  }
}

module.exports = { LedgerEntry, LEDGER_REASON };
