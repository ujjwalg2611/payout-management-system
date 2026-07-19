const express = require('express');
const CatalogService = require('../services/CatalogService');
const { sales } = require('../repositories');
const { NotFoundError } = require('../utils/errors');

const router = express.Router();

// POST /sales  { userId, brandId, earning }
router.post('/', (req, res) => {
  const sale = CatalogService.createSale(req.body);
  res.status(201).json(sale);
});

// GET /sales/:saleId
router.get('/:saleId', (req, res) => {
  const sale = sales.get(req.params.saleId);
  if (!sale) throw new NotFoundError(`Sale ${req.params.saleId} not found`);
  res.json(sale);
});

module.exports = router;
