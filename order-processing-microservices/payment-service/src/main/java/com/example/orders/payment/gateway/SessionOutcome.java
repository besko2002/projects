package com.example.orders.payment.gateway;

/**
 * The provider's answer to "close a hosted checkout session the customer abandoned".
 */
public sealed interface SessionOutcome {

    /** The session is no longer payable (it was closed, or it already was). */
    record Expired() implements SessionOutcome {
    }

    /**
     * The customer paid in the same moment the close was asked for: the session completed before
     * it could be expired. The caller must treat the order as paid and let the saga's late-payment
     * machinery refund the money — never record a failure for money that was taken.
     */
    record AlreadyCompleted(String paymentIntentId) implements SessionOutcome {
    }

    /** The provider could not be asked; the caller keeps the payment as it stands and retries. */
    record Unavailable(String reason) implements SessionOutcome {
    }
}
