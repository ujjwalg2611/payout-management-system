const express = require('express');
const CatalogService = require('../services/CatalogService');
const WalletService = require('../services/WalletService');
const { users, ledger } = require('../repositories');
const { NotFoundError } = require('../utils/errors');

const router = express.Router();

// POST /users  { userId, name, email }
router.post('/', (req, res) => {
  const user = CatalogService.createUser(req.body);
  res.status(201).json(user);
});

// GET /users/:userId
router.get('/:userId', (req, res) => {
  const user = users.get(req.params.userId);
  if (!user) throw new NotFoundError(`User ${req.params.userId} not found`);
  res.json(user);
});

// GET /users/:userId/wallet
router.get('/:userId/wallet', (req, res) => {
  const balance = WalletService.getBalance(req.params.userId);
  res.json({ userId: req.params.userId, walletBalance: balance });
});

// GET /users/:userId/ledger  -> full audit trail
router.get('/:userId/ledger', (req, res) => {
  const entries = ledger
    .find((e) => e.userId === req.params.userId)
    .sort((a, b) => a.createdAt - b.createdAt);
  res.json(entries);
});

// GET /users/:userId/sales
router.get('/:userId/sales', (req, res) => {
  res.json(CatalogService.getUserSales(req.params.userId));
});

module.exports = router;
