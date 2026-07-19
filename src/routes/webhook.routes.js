const express = require('express');
const WithdrawalService = require('../services/WithdrawalService');

const router = express.Router();

/**
 * Simulated payment-gateway webhook.
 * In production this endpoint would verify a signature header before
 * trusting the payload. Real gateways (Razorpay/Stripe/etc.) retry webhook
 * delivery, so this handler MUST be idempotent - it is, via the
 * withdrawal.status guard inside WithdrawalService.recoverFailedWithdrawal.
 *
 * POST /webhooks/payout-status
 * body: { withdrawalId, status: 'completed' | 'failed' | 'rejected' | 'cancelled' }
 */
router.post('/payout-status', async (req, res) => {
  const { withdrawalId, status } = req.body;

  if (status === 'completed') {
    const withdrawal = WithdrawalService.markCompleted(withdrawalId);
    return res.json(withdrawal);
  }

  const result = await Promise.resolve(WithdrawalService.recoverFailedWithdrawal(withdrawalId, status));
  res.json(result);
});

module.exports = router;
