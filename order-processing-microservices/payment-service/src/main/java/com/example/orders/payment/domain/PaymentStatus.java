package com.example.orders.payment.domain;

/** Lifecycle of one payment; mirrored by the {@code CHECK} constraint on {@code payments.status}. */
public enum PaymentStatus {

    /**
     * A real provider opened a hosted checkout and the customer has not paid yet. The verdict
     * comes from the provider's webhook, not from this service: the row keeps the checkout URL and
     * session id, and it can still end {@link #AUTHORIZED} or {@link #FAILED}. The saga's timeout
     * compensates abandoned checkouts by having the session expired.
     */
    AWAITING_CUSTOMER,

    /**
     * The charge went through. Called authorised rather than captured because a real integration
     * would separate the two, and the saga only ever needs "the money is committed to us".
     */
    AUTHORIZED,

    /** The gateway declined. Terminal: a new attempt would be a new payment for a new order. */
    FAILED,

    /** An authorised charge that was given back after the order was cancelled. */
    REFUNDED
}
