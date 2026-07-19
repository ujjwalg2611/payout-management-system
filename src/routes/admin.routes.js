const express = require('express');
const AdvancePayoutService = require('../services/AdvancePayoutService');
const ReconciliationService = require('../services/ReconciliationService');

const router = express.Router();

// POST /admin/sales/:saleId/reconcile   { status: 'approved' | 'rejected' }
router.post('/sales/:saleId/reconcile', async (req, res) => {
  const result = await ReconciliationService.reconcile(req.params.saleId, req.body.status);
  res.json(result);
});

// POST /admin/jobs/advance-payout/run    { userId?: string }
// Without a body, runs for every user with eligible pending sales
// (this is what a cron scheduler would call, e.g. every hour).
router.post('/jobs/advance-payout/run', async (req, res) => {
  if (req.body && req.body.userId) {
    const result = await AdvancePayoutService.runForUser(req.body.userId);
    return res.json(result);
  }
  const results = await AdvancePayoutService.runForAllUsers();
  res.json(results);
});

module.exports = router;
