const WITHDRAWAL_STATUS = Object.freeze({
  INITIATED: 'initiated', // money debited from wallet, sent to payment gateway
  COMPLETED: 'completed', // gateway confirmed success
  FAILED: 'failed', // gateway reported failure     -> Question 2
  REJECTED: 'rejected', // gateway/bank rejected it     -> Question 2
  CANCELLED: 'cancelled', // user or admin cancelled it  -> Question 2
});

// Terminal states that trigger "credit back to wallet" (Question 2)
const RECOVERABLE_STATUSES = new Set([
  WITHDRAWAL_STATUS.FAILED,
  WITHDRAWAL_STATUS.REJECTED,
  WITHDRAWAL_STATUS.CANCELLED,
]);

class Withdrawal {
  constructor({ withdrawalId, userId, amount }) {
    this.withdrawalId = withdrawalId;
    this.userId = userId;
    this.amount = amount;
    this.status = WITHDRAWAL_STATUS.INITIATED;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.recoveredAt = null; // set when the failed amount is credited back
  }
}

module.exports = { Withdrawal, WITHDRAWAL_STATUS, RECOVERABLE_STATUSES };
