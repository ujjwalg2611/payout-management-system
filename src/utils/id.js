const { randomUUID } = require('crypto');

const prefix = (p) => `${p}_${randomUUID()}`;

module.exports = {
  saleId: () => prefix('sale'),
  advancePayoutId: () => prefix('adv'),
  adjustmentId: () => prefix('adj'),
  withdrawalId: () => prefix('wd'),
  entryId: () => prefix('ledger'),
};
