const express = require('express');
const WithdrawalService = require('../services/WithdrawalService');
const { withdrawals } = require('../repositories');
const { NotFoundError } = require('../utils/errors');

const router = express.Router();

// POST /users/:userId/withdrawals   { amount }
router.post('/users/:userId/withdrawals', async (req, res) => {
  const withdrawal = await WithdrawalService.initiateWithdrawal(req.params.userId, req.body.amount);
  res.status(201).json(withdrawal);
});

// GET /withdrawals/:withdrawalId
router.get('/withdrawals/:withdrawalId', (req, res) => {
  const w = withdrawals.get(req.params.withdrawalId);
  if (!w) throw new NotFoundError(`Withdrawal ${req.params.withdrawalId} not found`);
  res.json(w);
});

module.exports = router;
