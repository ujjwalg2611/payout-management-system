# User Payout Management System — Low-Level Design

A complete LLD + working implementation for the SDE Intern assignment, covering:

- **Question 1** — User Payout Management System (advance payouts, reconciliation, final payout, withdrawal cooldown)
- **Question 2** — Failed Payout Recovery

Implemented in **Node.js / JavaScript** (Express). Runnable end-to-end with zero external database — an in-memory repository layer stands in for a real one, with the actual Postgres schema provided separately so the design maps 1:1 onto a production system.

---

## 1. How to run

```bash
npm install
npm start          # starts the HTTP API on http://localhost:3000
npm run demo        # runs tests/scenario.test.js — reproduces the PDF's
                     # worked example end-to-end and asserts every number
```

`npm run demo` needs **no server and no dependencies at all** (it talks to the service layer directly), so it's the fastest way to see the whole system work. Sample output:

```
=== Scenario 1: PDF worked example (expect final payout = ₹68) ===
Sum of reconciliation adjustments (PDF's "Final Payout"): 68
PASSED: matches the PDF example exactly (₹68).
Total wallet balance (advance + all adjustments): 80
PASSED: total wallet balance correctly reconciles to raw earnings (₹80).
PASSED: double-reconciliation of the same sale is rejected (409 CONFLICT).
...
PASSED: failed withdrawal credited back - wallet restored to ₹100.
PASSED: user can immediately re-initiate a withdrawal after a failure (no cooldown penalty).
All scenarios passed. ✅
```

---

## 2. Understanding the two "₹68 vs ₹80" numbers (important)

The PDF's worked example says **"Total Final Payout = ₹68"**. Working through it carefully:

- 3 pending sales of ₹40 each → advance = 10% × ₹120 = **₹12** (paid immediately, before reconciliation)
- Reconciliation: 1 rejected (₹40, ₹4 advance) → adjustment **−₹4**; 2 approved (₹40, ₹4 advance each) → adjustment **+₹36** each
- Sum of the three **adjustments** = −4 + 36 + 36 = **₹68** ← this is what the PDF calls "Final Payout"

That ₹68 is the *incremental amount released at reconciliation time*, on top of the ₹12 already transferred earlier as an advance. The user's **total lifetime earning** from these three sales is actually ₹0 (rejected) + ₹40 + ₹40 = **₹80**, which is exactly `₹12 advance + ₹68 reconciliation adjustments = ₹80`. Both numbers are correct — they're just answering different questions ("what does reconciliation release right now" vs "what does the user get in total"). The system tracks both explicitly:

- `PayoutAdjustment.adjustment` → the ₹68-style number, one row per sale
- `User.walletBalance` → the running ₹80-style total, updated by every advance and every adjustment

This distinction is documented in code (`ReconciliationService.js`) and directly verified by `tests/scenario.test.js`.

---

## 3. Domain model / Entity relationships

```
User (1) ───< Sale (many)
User (1) ───< AdvancePayout (many)
User (1) ───< PayoutAdjustment (many)
User (1) ───< Withdrawal (many)
User (1) ───< WalletLedgerEntry (many)     [append-only audit trail]

Brand (1) ───< Sale (many)

Sale  (1) ───(0..1) AdvancePayout    [a sale gets AT MOST one advance, ever]
Sale  (1) ───(0..1) PayoutAdjustment [a sale gets AT MOST one reconciliation, ever]
```

**Why `Sale ↔ AdvancePayout` and `Sale ↔ PayoutAdjustment` are both capped at exactly one:** these 1-to-(0..1) relationships, enforced with a `UNIQUE` constraint on `sale_id` in both child tables (see `db/schema.sql`), are what make the whole system idempotent. "Never advance the same sale twice" and "never reconcile the same sale twice" fall directly out of the schema — they don't rely on application code remembering to check.

### Class diagram (application layer)

```
CatalogService              AdvancePayoutService         ReconciliationService
-----------------            -----------------------      -----------------------
createUser()                 runForUser(userId)            reconcile(saleId, status)
createBrand()                 runForAllUsers()
createSale()
getUserSales()

        \                            |                              /
         \                           |                             /
          v                          v                            v
                    WalletService  (the ONLY class allowed to
                     mutate user.walletBalance; always also
                     writes a LedgerEntry)
          - creditAdvancePayout()
          - applyReconciliationAdjustment()
          - debitForWithdrawal()
          - recoverFailedWithdrawal()
          - getBalance()
                          |
                          v
                  WithdrawalService
          - initiateWithdrawal()
          - markCompleted()
          - recoverFailedWithdrawal()   <- Question 2
```

All wallet-affecting services (`AdvancePayoutService`, `ReconciliationService`, `WithdrawalService`) run their critical sections through a per-user `KeyedMutex` (`src/utils/mutex.js`) and go through `WalletService` for every balance change — this is the single choke point that guarantees "balance changed ⇒ ledger entry exists" can never be violated as the codebase grows.

---

## 4. Database schema

Full schema with types, constraints and indexes: [`db/schema.sql`](./db/schema.sql). Summary:

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | balance + cooldown timestamp | — |
| `brands` | reference data | — |
| `sales` | one row per affiliate sale | `advance_payout_id UNIQUE`, FK to `advance_payouts` |
| `advance_payouts` | audit trail of every advance transfer | `sale_id UNIQUE` — one advance per sale, enforced by the DB |
| `payout_adjustments` | audit trail of every reconciliation outcome | `sale_id UNIQUE` — one reconciliation per sale, enforced by the DB |
| `withdrawals` | user withdrawal attempts, incl. failed ones | status enum incl. `failed/rejected/cancelled` |
| `wallet_ledger` | append-only log of every balance mutation | `SUM(amount) per user` should always equal `users.wallet_balance` — usable as an automated reconciliation check |

Money is stored as `NUMERIC(12,2)`, never floating point.

---

## 5. API design

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/users` | Create a user |
| `GET` | `/users/:userId` | Fetch user |
| `GET` | `/users/:userId/wallet` | Current withdrawable balance |
| `GET` | `/users/:userId/ledger` | Full audit trail of balance changes |
| `GET` | `/users/:userId/sales` | All sales for a user |
| `POST` | `/sales` | Create a sale `{ userId, brandId, earning }` |
| `GET` | `/sales/:saleId` | Fetch a sale |
| `POST` | `/admin/jobs/advance-payout/run` | Trigger the advance-payout job (cron target; optionally scoped to one `userId`) |
| `POST` | `/admin/sales/:saleId/reconcile` | Admin reconciles a sale: `{ status: "approved" | "rejected" }` |
| `POST` | `/users/:userId/withdrawals` | User requests a withdrawal `{ amount }` — enforces the 24h cooldown |
| `GET` | `/withdrawals/:withdrawalId` | Fetch withdrawal status |
| `POST` | `/webhooks/payout-status` | **Question 2** — payment gateway notifies outcome: `{ withdrawalId, status: "completed"|"failed"|"rejected"|"cancelled" }` |

All errors return a consistent shape: `{ "error": "CODE", "message": "..." }` with the right HTTP status (400/404/409/422/429), via a single centralized error middleware (`src/app.js`) — no route handler ever writes its own `res.status(...)` for an error case.

---

## 6. Question 1 — walkthrough of the business rules

### 6.1 Advance payout (10%, exactly once per sale)
`AdvancePayoutService.runForUser()` queries sales that are `status = pending AND advancePayoutId IS NULL`. For each, it creates an `AdvancePayout` record, **stamps `sale.advancePayoutId` before doing anything else**, and only then credits the wallet. Because the query filters on `advancePayoutId IS NULL`, a sale that has already been advanced becomes structurally invisible to future job runs — running the job 100 times pays exactly once. This is verified by the demo script by literally calling the job twice in a row and asserting the second run pays ₹0.

### 6.2 Final payout on reconciliation
- **Approved**: `adjustment = earning − advancePaid` (release the remainder)
- **Rejected**: `adjustment = −advancePaid` (claw back the advance)

A sale can only move `pending → {approved, rejected}` once (`sale.reconciledAt` guards this); attempting to reconcile an already-final sale returns `409 CONFLICT` rather than silently re-applying the adjustment (which would double-count money).

### 6.3 Withdrawal restriction — one withdrawal per 24 hours
Enforced against `user.lastWithdrawalAt`. The key design decision: **this timestamp is only updated on a successful (`completed`) withdrawal**, never on a failed one. This is what lets Question 1's cooldown and Question 2's recovery flow compose correctly without special-casing — see §7.

---

## 7. Question 2 — Failed Payout Recovery, in detail

Flow:
1. `WithdrawalService.initiateWithdrawal(userId, amount)` — checks the 24h cooldown and balance, then **immediately debits the wallet** and creates a `Withdrawal` row in `initiated` status. The money is "in flight" to the payment gateway and must not be spendable a second time while that's pending.
2. The payment gateway eventually calls back (`POST /webhooks/payout-status`) with one of:
   - `completed` → `WithdrawalService.markCompleted()` — sets `lastWithdrawalAt = now()`, starting the 24h cooldown.
   - `failed` / `rejected` / `cancelled` → `WithdrawalService.recoverFailedWithdrawal()` — credits the exact amount back to the wallet and marks the withdrawal terminal.
3. Because `lastWithdrawalAt` was **never touched** for a failed attempt, the user can call `initiateWithdrawal()` again immediately — no cooldown penalty for a failure that wasn't their fault. This directly satisfies "allow the user to initiate another withdrawal for that amount."
4. **Idempotency**: gateways commonly retry webhook delivery. `recoverFailedWithdrawal` re-reads the withdrawal inside the per-user lock and only acts if it's still `initiated`; a duplicate/late webhook for an already-resolved withdrawal is rejected with `409 CONFLICT` instead of crediting the wallet twice. Verified in the demo script.

---

## 8. Edge cases & failure scenarios handled

| Scenario | Handling |
|---|---|
| Advance-payout job runs twice (cron overlap / manual re-trigger / retry) | No-op the second time — guarded by `sale.advancePayoutId`. |
| Sale reconciled twice (double-click, retried request) | Second attempt rejected with `409 CONFLICT` — guarded by `sale.reconciledAt`. |
| Two operations race on the same user's wallet (e.g. advance job + withdrawal at the same instant) | Serialized via a per-user mutex (`src/utils/mutex.js`); production equivalent is `SELECT ... FOR UPDATE` inside a transaction (documented in `db/schema.sql`). |
| Withdrawal requested more than once within 24h | Rejected with `429 RATE_LIMITED`, includes retry-after in the message. |
| Withdrawal fails/rejected/cancelled | Amount credited back to wallet (`recoverFailedWithdrawal`); doesn't consume the 24h window. |
| Duplicate/late webhook for a withdrawal already resolved | Ignored (`409 CONFLICT`), prevents double-crediting. |
| Withdrawal amount exceeds current wallet balance | Rejected with `422 VALIDATION_ERROR` before any debit happens. |
| Rejected sale's advance exceeds what's currently in the wallet (user already withdrew everything) | Wallet balance is allowed to go **negative** (a "debt"), automatically offset by the user's next payout. More correct than silently capping at zero, which would let the platform quietly lose money. Documented as a trade-off below. |
| Sale with `earning = 0` | Advance = ₹0; still marked as advanced (idempotency stamp still applies) so it's not re-processed forever. |
| Reconciling a sale that was never advanced (e.g. created and reconciled before the advance job ran) | Works correctly — `advancePaid` defaults to `0`, so approved → `+earning`, rejected → `0` (nothing to claw back). |
| Unknown user / sale / withdrawal ID referenced | `404 NOT_FOUND` from the relevant repository lookup. |
| Invalid reconciliation status (anything other than approved/rejected) | `422 VALIDATION_ERROR`. |

---

## 9. Key design decisions & trade-offs

- **Ledger-first accounting.** Every balance mutation goes through `WalletService` and always writes an immutable `LedgerEntry`. Slightly more write overhead per operation, but makes the system auditable and lets a balance be independently recomputed/verified — essential for anything touching real money.
- **Wallet balance can go negative.** Alternative: clamp at zero and "forgive" the platform's loss when a rejection's clawback exceeds the current balance. Rejected because it lets users profit from bad-faith or high-volume rejected sales. A negative balance that offsets against future payouts is the financially correct behavior; a real system would also flag persistently negative balances for manual review/collection.
- **`lastWithdrawalAt` updates only on success.** Alternative: start the 24h cooldown the moment a withdrawal is *initiated*. Rejected because it would mean a payment-gateway failure (entirely outside the user's control) locks them out of withdrawing for a full day — directly conflicting with Question 2's requirement to let them retry.
- **In-memory store behind a repository interface, with a full SQL schema alongside it.** Chosen so the assignment is runnable with zero infrastructure (`npm start`, no DB to provision) while still demonstrating the real relational design that would back it in production. Swapping `src/repositories/InMemoryStore.js` for a Postgres-backed implementation with the same method signatures is the only change needed elsewhere.
- **Per-user mutex instead of optimistic locking.** Given payouts are inherently sequential per-user (job → reconcile → withdraw), a simple exclusive lock per `userId` is easier to reason about than optimistic concurrency + retry loops, at the cost of serializing (rare) concurrent operations for the *same* user — an acceptable trade since different users never contend with each other.
- **Advance payout is a scheduled job, not synchronous with sale creation.** Matches the problem statement ("the system should provide... advance payout") as a batch process (e.g. hourly cron) rather than paying out the instant a sale is created, which better mirrors real affiliate-payout systems and lets the platform batch/verify transfers.

---

## 10. Project structure

```
payout-system/
├── db/
│   └── schema.sql              # Postgres schema, relationships, indexes
├── src/
│   ├── models/                 # Entity classes (User, Sale, AdvancePayout, ...)
│   ├── repositories/           # In-memory "tables" (swap for real DB here)
│   ├── services/                # All business logic
│   │   ├── CatalogService.js
│   │   ├── WalletService.js
│   │   ├── AdvancePayoutService.js
│   │   ├── ReconciliationService.js
│   │   └── WithdrawalService.js
│   ├── routes/                  # Express route handlers (thin - call services)
│   ├── utils/                    # mutex, id generator, money rounding, errors
│   ├── app.js
│   └── server.js
├── tests/
│   └── scenario.test.js        # End-to-end demo reproducing the PDF example
├── package.json
└── README.md
```

---

## 11. A note on the submission format

The assignment asks for a public GitHub repo link. This solution was built in a sandboxed environment without outbound network/GitHub access, so the code is delivered as a ready-to-push local repository instead. To publish it:

```bash
cd payout-system
git init
git add .
git commit -m "User Payout Management System - LLD assignment"
git branch -M main
git remote add origin <your-empty-github-repo-url>
git push -u origin main
```
