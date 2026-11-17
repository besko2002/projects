-- A hosted checkout is now tracked by its own identity, separate from a proven payment, and the
-- provider's own deadline travels with it.
--
-- Why the split (PAY-1/PAY-4/PAY-5, 17 Nov 2026 review):
--   * `payment_id` keeps exactly one meaning: a payment this order has proof of (PaymentCompleted
--     on a live order, or the late completion of a cancelled one). Before, rememberCheckout also
--     wrote it while the customer had only been handed a link — cancelling such an order then
--     "requested a refund" of money that was never taken, and the refund-recovery sweep re-commanded
--     that phantom refund forever.
--   * `checkout_payment_id` is the AWAITING_CUSTOMER payment the saga heard about from
--     PaymentAwaitingCustomer. It is the identity the ExpirePayment command is built from, so a
--     late awaiting event for an already-cancelled order still closes its checkout even when no
--     URL was ever stored (the URL column is presentation, not identity).
--   * `checkout_expires_at` is the provider's own session deadline carried by the same event. The
--     timeout sweeper uses it (next to the configured payment window) so a valid hosted checkout is
--     never cancelled while the provider still accepts the customer's payment, and so an expired
--     one is compensated promptly even if the provider's expiry webhook is missed.
--   * `checkout_closed_at` is stamped once, when the saga queues the checkout's ExpirePayment
--     close. It de-duplicates that command (a re-announced awaiting event, fresh event id but same
--     fact, must not queue a second close) and retires `payment_url` with it: a cancelled order
--     must not keep exposing a link it will never honour.
--
-- Existing rows: both columns start NULL, which is exactly the state of orders that never reached
-- the hosted-checkout step; the backfill is unnecessary because a NULL checkout identity has always
-- meant "no checkout known".

ALTER TABLE orders
    ADD COLUMN checkout_payment_id UUID,
    ADD COLUMN checkout_expires_at TIMESTAMPTZ,
    ADD COLUMN checkout_closed_at TIMESTAMPTZ;
