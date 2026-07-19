-- =====================================================================
-- User Payout Management System - Relational Schema (PostgreSQL)
-- =====================================================================
-- This is the "real" schema the in-memory repositories in src/repositories
-- stand in for. All money columns use NUMERIC(12,2) — never FLOAT — to
-- avoid rounding drift on financial data.

CREATE TABLE users (
    user_id             VARCHAR(64)     PRIMARY KEY,
    name                VARCHAR(255)    NOT NULL,
    email               VARCHAR(255)    UNIQUE NOT NULL,
    wallet_balance      NUMERIC(12,2)   NOT NULL DEFAULT 0,
    last_withdrawal_at  TIMESTAMPTZ,               -- set only on a COMPLETED withdrawal
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE TABLE brands (
    brand_id    VARCHAR(64)   PRIMARY KEY,
    name        VARCHAR(255)  NOT NULL
);

CREATE TYPE sale_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE sales (
    sale_id             UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             VARCHAR(64)     NOT NULL REFERENCES users(user_id),
    brand_id            VARCHAR(64)     NOT NULL REFERENCES brands(brand_id),
    earning             NUMERIC(12,2)   NOT NULL CHECK (earning >= 0),
    status              sale_status     NOT NULL DEFAULT 'pending',
    advance_paid        NUMERIC(12,2)   NOT NULL DEFAULT 0,
    advance_payout_id   UUID            UNIQUE,   -- FK added below, after advance_payouts exists
    reconciled_at       TIMESTAMPTZ,     -- NULL until admin reconciles; set exactly once
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE TYPE advance_status AS ENUM ('transferred', 'failed');

CREATE TABLE advance_payouts (
    advance_payout_id  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             VARCHAR(64)     NOT NULL REFERENCES users(user_id),
    sale_id             UUID            NOT NULL UNIQUE REFERENCES sales(sale_id), -- UNIQUE = one advance per sale, enforced at DB level too
    amount               NUMERIC(12,2)   NOT NULL CHECK (amount >= 0),
    status               advance_status  NOT NULL DEFAULT 'transferred',
    created_at           TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Circular relationship (sale <-> its own advance payout) resolved with a
-- deferred FK, added only after both tables exist.
ALTER TABLE sales
    ADD CONSTRAINT fk_sales_advance_payout
    FOREIGN KEY (advance_payout_id) REFERENCES advance_payouts(advance_payout_id);

CREATE TABLE payout_adjustments (
    adjustment_id   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         VARCHAR(64)     NOT NULL REFERENCES users(user_id),
    sale_id         UUID            NOT NULL UNIQUE REFERENCES sales(sale_id), -- one adjustment per sale, ever
    earning         NUMERIC(12,2)   NOT NULL,
    advance_paid    NUMERIC(12,2)   NOT NULL,
    final_status    sale_status     NOT NULL CHECK (final_status IN ('approved', 'rejected')),
    adjustment      NUMERIC(12,2)   NOT NULL,   -- signed: + for approved top-up, - for rejected clawback
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE TYPE withdrawal_status AS ENUM ('initiated', 'completed', 'failed', 'rejected', 'cancelled');

CREATE TABLE withdrawals (
    withdrawal_id   UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         VARCHAR(64)         NOT NULL REFERENCES users(user_id),
    amount          NUMERIC(12,2)       NOT NULL CHECK (amount > 0),
    status          withdrawal_status   NOT NULL DEFAULT 'initiated',
    recovered_at    TIMESTAMPTZ,                 -- set when a failed/rejected/cancelled amount is credited back
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE TYPE ledger_reason AS ENUM (
    'advance_payout',
    'reconciliation_adjustment',
    'withdrawal_debit',
    'withdrawal_recovery'
);

-- Append-only audit trail. wallet_balance on `users` should always equal
-- SUM(amount) of this table for that user — used as a periodic
-- reconciliation/correctness check job.
CREATE TABLE wallet_ledger (
    entry_id        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         VARCHAR(64)     NOT NULL REFERENCES users(user_id),
    amount          NUMERIC(12,2)   NOT NULL,   -- signed
    reason          ledger_reason   NOT NULL,
    reference_id    UUID            NOT NULL,   -- sale_id / advance_payout_id / adjustment_id / withdrawal_id
    balance_after   NUMERIC(12,2)   NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
-- Advance-payout job's core query: "give me pending, un-advanced sales"
CREATE INDEX idx_sales_advance_eligible
    ON sales (user_id, status)
    WHERE status = 'pending' AND advance_payout_id IS NULL;

-- Admin reconciliation queue
CREATE INDEX idx_sales_status ON sales (status);

CREATE INDEX idx_advance_payouts_user ON advance_payouts (user_id);
CREATE INDEX idx_payout_adjustments_user ON payout_adjustments (user_id);
CREATE INDEX idx_withdrawals_user_status ON withdrawals (user_id, status);
CREATE INDEX idx_wallet_ledger_user ON wallet_ledger (user_id, created_at);

-- ---------------------------------------------------------------------
-- Concurrency note (mirrors src/utils/mutex.js in the code):
-- Every write that touches users.wallet_balance MUST be done inside a
-- transaction that starts with:
--     SELECT * FROM users WHERE user_id = $1 FOR UPDATE;
-- This serializes concurrent writers (e.g. the advance-payout cron job and
-- a user-initiated withdrawal hitting the same user_id at the same time)
-- and is the production equivalent of the in-memory KeyedMutex used in
-- src/utils/mutex.js.
-- ---------------------------------------------------------------------
