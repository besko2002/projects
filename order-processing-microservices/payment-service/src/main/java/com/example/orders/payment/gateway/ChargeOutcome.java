package com.example.orders.payment.gateway;

import java.time.OffsetDateTime;

/**
 * A provider's answer to "charge this order".
 *
 * <p>The local simulator answers instantly with a verdict. A real hosted-checkout provider
 * ({@link StripePaymentGateway}) cannot: the customer has to pay on the provider's own page, so
 * the answer is <em>awaiting the customer</em> plus a checkout URL, and the verdict arrives later
 * through the provider's webhook. Either way the saga's transaction only ever persists what the
 * provider already decided — no charging decision is made inside a database transaction.
 */
public sealed interface ChargeOutcome {

    /** @return whether the money is definitely with us (the customer already paid) */
    boolean approved();

    /** The charge went through; {@code providerRef} is the provider's own reference. */
    record Approved(String providerRef) implements ChargeOutcome {
        @Override
        public boolean approved() {
            return true;
        }
    }

    /** The provider refused the charge; {@code reason} is shown to the customer. */
    record Declined(String reason) implements ChargeOutcome {
        @Override
        public boolean approved() {
            return false;
        }
    }

    /**
     * The charge needs the customer: a hosted checkout session was opened and its URL has to
     * reach them. {@code sessionId} is the provider's session reference; {@code expiresAt} when
     * the session stops being payable (advisory — the provider enforces it).
     */
    record AwaitingCustomer(String sessionId, String url, OffsetDateTime expiresAt)
            implements ChargeOutcome {
        @Override
        public boolean approved() {
            return false;
        }
    }

    /**
     * The provider could not be asked at all: no keys, an unreachable API, a refusal. The saga
     * records a failed payment with this reason and compensates — it must never stand in for a
     * verdict about the money.
     */
    record Unavailable(String reason) implements ChargeOutcome {
        @Override
        public boolean approved() {
            return false;
        }
    }
}
