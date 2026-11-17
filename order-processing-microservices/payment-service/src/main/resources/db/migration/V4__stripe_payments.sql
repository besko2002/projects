-- Real Stripe payments (test mode): a charge may now need the customer to pay on Stripe's hosted
-- page, so a payment row can be AWAITING_CUSTOMER with a checkout session attached, and every row
-- records which provider handled it.
--
-- Existing rows keep working unchanged: they were all created by the simulated provider, which is
-- what the new provider column defaults to.

-- Which provider this payment belongs to: SIMULATED (the local deterministic provider), STRIPE
-- (real test-mode charges), or NONE (no provider was available to attempt the charge at all).
ALTER TABLE payments
    ADD COLUMN provider VARCHAR(20) NOT NULL DEFAULT 'SIMULATED'
    CHECK (provider IN ('SIMULATED', 'STRIPE', 'NONE'));

-- The hosted checkout of an AWAITING_CUSTOMER payment. The session id is UNIQUE: one session can
-- never complete two payments, and it is the key the provider's webhook deliveries are matched
-- against. The URL is what order-service exposes to the customer; the expiry is advisory.
ALTER TABLE payments
    ADD COLUMN checkout_session_id VARCHAR(255),
    ADD COLUMN checkout_url        VARCHAR(1000),
    ADD COLUMN checkout_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX idx_payments_checkout_session ON payments (checkout_session_id)
    WHERE checkout_session_id IS NOT NULL;

-- Lookups by the provider's own references: checkout.session.* deliveries arrive with the session
-- id, charge.refunded arrives with the payment intent (stored as provider_ref on completion).
CREATE INDEX idx_payments_provider_ref ON payments (provider_ref) WHERE provider_ref IS NOT NULL;

-- AWAITING_CUSTOMER joins the legal states; the old constraint is replaced (not extended) so an
-- unknown value can still never reach the table through raw SQL.
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments
    ADD CONSTRAINT payments_status_check
    CHECK (status IN ('AWAITING_CUSTOMER', 'AUTHORIZED', 'FAILED', 'REFUNDED'));

-- Idempotency log of the webhook endpoint, keyed by the provider's own event id (evt_...): a
-- redelivery is answered with what happened the first time and changes nothing. Unlike
-- processed_events, these ids are provider-generated strings, not the UUIDs of this system's
-- Kafka messages, so they get their own table (and stay inspectable in their original form).
CREATE TABLE stripe_webhook_events
(
    event_id    VARCHAR(255) PRIMARY KEY,
    event_type  VARCHAR(100) NOT NULL,
    received_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
