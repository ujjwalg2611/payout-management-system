/**
 * User Entity
 *
 * walletBalance      -> money the user is currently entitled to withdraw
 *                        (can go negative - see README "Negative Wallet Balance")
 * lastWithdrawalAt   -> timestamp of the last SUCCESSFUL withdrawal.
 *                        Deliberately NOT updated on failed/rejected/cancelled
 *                        withdrawals, so a failed attempt never burns the
 *                        user's 24 hour window (this is what makes Question 2
 *                        work correctly together with the withdrawal-limit rule).
 */
class User {
  constructor({ userId, name, email }) {
    this.userId = userId;
    this.name = name;
    this.email = email;
    this.walletBalance = 0; // in rupees (paise-safe integer math used in services)
    this.lastWithdrawalAt = null;
    this.createdAt = new Date();
  }
}

module.exports = User;
