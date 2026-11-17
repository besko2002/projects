package com.example.orders.payment.gateway;

/**
 * The provider's answer to "give a taken charge back".
 */
public sealed interface RefundOutcome {

    /** The money went back; {@code refundId} is the provider's own reference, may be local. */
    record Refunded(String refundId) implements RefundOutcome {
    }

    /** The provider could not be asked; the caller retries the same refund later. */
    record Unavailable(String reason) implements RefundOutcome {
    }
}
