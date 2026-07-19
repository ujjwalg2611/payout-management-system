const { users, brands, sales } = require('../repositories');
const User = require('../models/User');
const { Sale } = require('../models/Sale');
const id = require('../utils/id');
const { NotFoundError, ValidationError } = require('../utils/errors');

/**
 * CatalogService groups the "boring" CRUD needed to set up demo/test data:
 * creating users, brands, and sales. Kept separate from the business-rule
 * services (Advance/Reconciliation/Withdrawal) on purpose, per single-
 * responsibility: this service does NOT know about payouts at all.
 */
class CatalogService {
  createUser({ userId, name, email }) {
    if (!userId) throw new ValidationError('userId is required');
    if (users.get(userId)) throw new ValidationError(`User ${userId} already exists`);
    const user = new User({ userId, name, email });
    users.set(userId, user);
    return user;
  }

  createBrand({ brandId, name }) {
    if (brands.get(brandId)) return brands.get(brandId);
    const brand = { brandId, name: name || brandId };
    brands.set(brandId, brand);
    return brand;
  }

  createSale({ userId, brandId, earning }) {
    if (!users.get(userId)) throw new NotFoundError(`User ${userId} not found`);
    if (!(earning >= 0)) throw new ValidationError('earning must be a non-negative number');
    if (!brands.get(brandId)) this.createBrand({ brandId });

    const sale = new Sale({ saleId: id.saleId(), userId, brandId, earning });
    sales.set(sale.saleId, sale);
    return sale;
  }

  getUserSales(userId) {
    return sales.find((s) => s.userId === userId);
  }
}

module.exports = new CatalogService();
