package com.example.orders.payment.gateway;

import java.time.Duration;

/**
 * The checkout TTL every part of payment-service agrees on.
 *
 * <p>The session's expiry is a <em>request parameter</em> of the Stripe call, and Stripe refuses an
 * idempotent replay whose parameters moved ({@code PAY-3}). The value must therefore be decided
 * once and used identically by the two places that shape the request: the persisted charge attempt
 * (which stores {@code now + TTL} before the network call) and the gateway (which sends it). One
 * clamp, one constant, one function — Stripe rejects lifetimes under 30 minutes, so the configured
 * value is floored at exactly that, wherever it is used.
 */
public final class CheckoutTtl {

    /** Shortest lifetime Stripe accepts for a Checkout Session. */
    public static final Duration MIN = Duration.ofMinutes(30);

    private CheckoutTtl() {
    }

    /**
     * @param configured the operator's checkout TTL
     * @return the TTL Stripe will actually accept — never below its 30-minute minimum
     */
    public static Duration effective(Duration configured) {
        return configured == null || configured.isNegative() || configured.compareTo(MIN) < 0
                ? MIN : configured;
    }
}
