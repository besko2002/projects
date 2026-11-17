-- One persisted charge attempt per order (PAY-3, 17 Nov 2026 review): the identity and request
-- parameters of the Stripe Checkout Session are written down BEFORE the network call, so a retry
-- after a lost response sends byte-identical parameters under the same idempotency key and Stripe
-- replays its first answer instead of refusing the request ("same key, different parameters") or
-- creating a second payable session.
--
-- Why a separate table instead of columns on `payments`: the payment row must not exist before the
-- provider answered — an AWAITING_CUSTOMER row with no session id would be a lie about the money —
-- while the attempt is exactly the fact that exists before the answer does.
--
-- `order_id` is the primary key: there is exactly one charge attempt per order (a second command
-- for the same order must reuse the first one's parameters, not mint a second session). Like the
-- other cross-service references, there is no foreign key: the orders table lives in another
-- service's database.
--
-- `attempts` counts the provider calls made for this attempt (including the one about to happen).
-- A provider that repeatedly could not be asked is given a bounded number of tries before the
-- charge is recorded as honestly FAILED — the money verdict stays an answer from the provider,
-- never a timeout's guess, but the command also must not retry forever.
--
-- `version` is the optimistic-locking guard: two racing commands for one order cannot both open
-- (or re-ask) the attempt. `created_at`/`updated_at` stamp the attempt's life, like every other
-- row in this schema.

CREATE TABLE charge_attempts
(
    order_id   UUID PRIMARY KEY,
    event_id   UUID        NOT NULL,
    payment_id UUID        NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts   INT         NOT NULL DEFAULT 0,
    version    BIGINT      NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
