const InMemoryStore = require('./InMemoryStore');

// One "table" per entity. Exported as singletons so every service shares
// the same underlying data (mirrors a real shared database connection pool).
module.exports = {
  users: new InMemoryStore(),
  brands: new InMemoryStore(),
  sales: new InMemoryStore(),
  advancePayouts: new InMemoryStore(),
  payoutAdjustments: new InMemoryStore(),
  withdrawals: new InMemoryStore(),
  ledger: new InMemoryStore(),
};
