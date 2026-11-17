-- The hosted checkout page payment-service opened for an order, learned from
-- PaymentAwaitingCustomer. While the order waits for payment the API exposes it as `paymentUrl`
-- (the customer finishes paying on the provider's page), and the saga uses the column's presence
-- as its signal to have the session closed when the order is cancelled or times out — the close
-- itself is an ExpirePayment command, which payment-service answers with a completion instead
-- when the customer paid in the same moment.
ALTER TABLE orders
    ADD COLUMN payment_url VARCHAR(1000);
