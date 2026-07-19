/* eslint-disable no-console */
/**
 * Runnable demo / test script.
 * Run with: npm run demo   (or: node tests/scenario.test.js)
 *
 * Reproduces:
 *  1. The exact worked example from the assignment PDF (3 pending sales of
 *     ₹40 each -> ₹12 advance -> reconciled to 1 rejected + 2 approved ->
 *     final payout of ₹68) and asserts the numbers match exactly.
 *  2. The 24-hour withdrawal cooldown rule.
 *  3. Question 2: a failed withdrawal being credited back and re-withdrawn.
 */
const assert = require('assert');
const CatalogService = require('../src/services/CatalogService');
const AdvancePayoutService = require('../src/services/AdvancePayoutService');
const ReconciliationService = require('../src/services/ReconciliationService');
const WithdrawalService = require('../src/services/WithdrawalService');
const WalletService = require('../src/services/WalletService');

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  // ---------------------------------------------------------------
  // SCENARIO 1: the worked example from the PDF
  // ---------------------------------------------------------------
  section('Scenario 1: PDF worked example (expect final payout = ₹68)');

  CatalogService.createUser({ userId: 'john_doe', name: 'John Doe', email: 'john@example.com' });
  CatalogService.createBrand({ brandId: 'brand_1', name: 'Brand One' });

  const s1 = CatalogService.createSale({ userId: 'john_doe', brandId: 'brand_1', earning: 40 });
  const s2 = CatalogService.createSale({ userId: 'john_doe', brandId: 'brand_1', earning: 40 });
  const s3 = CatalogService.createSale({ userId: 'john_doe', brandId: 'brand_1', earning: 40 });

  const advanceRun = await AdvancePayoutService.runForUser('john_doe');
  console.log('Advance payout run:', advanceRun);
  assert.strictEqual(advanceRun.totalAdvance, 12, 'Total advance should be ₹12 (10% of ₹120)');
  assert.strictEqual(WalletService.getBalance('john_doe'), 12, 'Wallet should hold ₹12 after advance');

  // Re-run the job to prove idempotency: must pay nothing more.
  const advanceRerun = await AdvancePayoutService.runForUser('john_doe');
  assert.strictEqual(advanceRerun.totalAdvance, 0, 'Re-running the advance job must be a no-op');
  assert.strictEqual(WalletService.getBalance('john_doe'), 12, 'Balance must be unchanged after re-run');
  console.log('Idempotency check passed: re-running the advance job paid ₹0 extra.');

  const rec1 = await ReconciliationService.reconcile(s1.saleId, 'rejected'); // -4
  const rec2 = await ReconciliationService.reconcile(s2.saleId, 'approved'); // +36
  const rec3 = await ReconciliationService.reconcile(s3.saleId, 'approved'); // +36

  // The PDF's "Total Final Payout = ₹68" is the SUM OF THE RECONCILIATION
  // ADJUSTMENTS ONLY (the incremental amount released at reconciliation
  // time) - it deliberately excludes the ₹12 advance that was already paid
  // out earlier in a separate transfer. We reproduce that exact figure here:
  const sumOfAdjustments = rec1.adjustment.adjustment + rec2.adjustment.adjustment + rec3.adjustment.adjustment;
  console.log('Sum of reconciliation adjustments (PDF\'s "Final Payout"):', sumOfAdjustments);
  assert.strictEqual(sumOfAdjustments, 68, 'Sum of adjustments must equal ₹68 exactly as per PDF example');
  console.log('PASSED: matches the PDF example exactly (₹68).');

  // Cross-check: the TOTAL money ever credited to the wallet (advance +
  // adjustments) must equal what the user is actually entitled to:
  // ₹0 (rejected sale) + ₹40 + ₹40 (two approved sales) = ₹80.
  console.log('Total wallet balance (advance + all adjustments):', rec3.walletBalance);
  assert.strictEqual(rec3.walletBalance, 80, 'Total lifetime payout must equal ₹80 (0 + 40 + 40 in raw earnings)');
  console.log('PASSED: total wallet balance correctly reconciles to raw earnings (₹80).');

  // Reconciling the same sale twice must be rejected (idempotency guard).
  try {
    await ReconciliationService.reconcile(s1.saleId, 'approved');
    throw new Error('Expected reconciliation of an already-reconciled sale to throw');
  } catch (e) {
    assert.strictEqual(e.code, 'CONFLICT');
    console.log('PASSED: double-reconciliation of the same sale is rejected (409 CONFLICT).');
  }

  // ---------------------------------------------------------------
  // SCENARIO 2: business rule cases 1 & 2 individually (₹30/₹3/₹27 and ₹50/₹5/-₹5)
  // ---------------------------------------------------------------
  section('Scenario 2: individual approved/rejected cases from the PDF');

  CatalogService.createUser({ userId: 'case_user', name: 'Case User', email: 'case@example.com' });
  const saleApproved = CatalogService.createSale({ userId: 'case_user', brandId: 'brand_1', earning: 30 });
  const saleRejected = CatalogService.createSale({ userId: 'case_user', brandId: 'brand_1', earning: 50 });

  await AdvancePayoutService.runForUser('case_user');
  const r1 = await ReconciliationService.reconcile(saleApproved.saleId, 'approved');
  assert.strictEqual(r1.adjustment.adjustment, 27, 'Approved case must yield +₹27');
  console.log('PASSED: approved case (₹30 earning, ₹3 advance) -> +₹27 adjustment.');

  const r2 = await ReconciliationService.reconcile(saleRejected.saleId, 'rejected');
  assert.strictEqual(r2.adjustment.adjustment, -5, 'Rejected case must yield -₹5');
  console.log('PASSED: rejected case (₹50 earning, ₹5 advance) -> -₹5 adjustment.');

  // ---------------------------------------------------------------
  // SCENARIO 3: 24-hour withdrawal cooldown
  // ---------------------------------------------------------------
  section('Scenario 3: withdrawal cooldown (business rule #3)');

  const withdrawal1 = await WithdrawalService.initiateWithdrawal('john_doe', 20);
  WithdrawalService.markCompleted(withdrawal1.withdrawalId);
  console.log('First withdrawal completed:', withdrawal1.withdrawalId);

  try {
    await WithdrawalService.initiateWithdrawal('john_doe', 10);
    throw new Error('Expected a second withdrawal within 24h to be rate-limited');
  } catch (e) {
    assert.strictEqual(e.code, 'RATE_LIMITED');
    console.log('PASSED: a second withdrawal within 24 hours is correctly rejected (429 RATE_LIMITED).');
  }

  // ---------------------------------------------------------------
  // SCENARIO 4 (Question 2): failed payout recovery
  // ---------------------------------------------------------------
  section('Scenario 4: Question 2 - failed payout recovery');

  CatalogService.createUser({ userId: 'jane_doe', name: 'Jane Doe', email: 'jane@example.com' });
  const janeSale = CatalogService.createSale({ userId: 'jane_doe', brandId: 'brand_1', earning: 100 });
  await AdvancePayoutService.runForUser('jane_doe'); // wallet = 10
  await ReconciliationService.reconcile(janeSale.saleId, 'approved'); // +90 -> wallet = 100

  const balanceBeforeWithdraw = WalletService.getBalance('jane_doe');
  assert.strictEqual(balanceBeforeWithdraw, 100);

  const janeWithdrawal = await WithdrawalService.initiateWithdrawal('jane_doe', 100);
  assert.strictEqual(WalletService.getBalance('jane_doe'), 0, 'Balance is debited immediately on initiate');
  console.log('Withdrawal initiated, ₹100 debited from wallet (in flight to gateway).');

  // Gateway later reports failure via webhook:
  const recovery = await WithdrawalService.recoverFailedWithdrawal(janeWithdrawal.withdrawalId, 'failed');
  assert.strictEqual(recovery.walletBalance, 100, 'Failed withdrawal amount must be credited back in full');
  console.log('PASSED: failed withdrawal credited back - wallet restored to ₹100.');

  // User can immediately retry - no cooldown was consumed by the failed attempt.
  const retryWithdrawal = await WithdrawalService.initiateWithdrawal('jane_doe', 100);
  assert.ok(retryWithdrawal.withdrawalId);
  console.log('PASSED: user can immediately re-initiate a withdrawal after a failure (no cooldown penalty).');

  // Duplicate webhook delivery for the same (already-recovered) withdrawal must be a no-op, not double-credit.
  try {
    await WithdrawalService.recoverFailedWithdrawal(janeWithdrawal.withdrawalId, 'failed');
    throw new Error('Expected duplicate webhook delivery to be rejected');
  } catch (e) {
    assert.strictEqual(e.code, 'CONFLICT');
    console.log('PASSED: duplicate/late webhook for an already-resolved withdrawal is ignored (no double credit).');
  }

  console.log('\nAll scenarios passed. ✅');
}

main().catch((err) => {
  console.error('\n❌ DEMO FAILED:', err);
  process.exit(1);
});
