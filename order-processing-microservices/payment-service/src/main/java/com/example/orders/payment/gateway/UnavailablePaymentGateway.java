package com.example.orders.payment.gateway;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The payment port when no provider is configured: every ask is answered with an honest
 * {@code Unavailable} — never with a verdict about money.
 *
 * <p>Why a gateway bean instead of refusing to start: the saga's health does not depend on the
 * provider's keys, and the failure must be visible where it happens — the order ends
 * {@code CANCELLED} with the reason "Payment is unavailable …", the notification reaches the
 * customer, and the logs say exactly which variable is missing. Faking success here would be the
 * worst possible answer: stock committed, order confirmed, no money anywhere.
 */
class UnavailablePaymentGateway implements PaymentGateway {

    private static final Logger log = LoggerFactory.getLogger(UnavailablePaymentGateway.class);

    private final String reason;

    UnavailablePaymentGateway(String reason) {
        this.reason = reason;
        log.warn("Payments are unavailable: {}", reason);
    }

    @Override
    public String provider() {
        return "NONE";
    }

    @Override
    public ChargeOutcome charge(ChargeRequest request) {
        log.warn("Declining the charge of order {} because payments are unavailable", request.orderId());
        return new ChargeOutcome.Unavailable(reason);
    }

    @Override
    public SessionOutcome expireSession(String checkoutSessionId) {
        // No provider, so no session was ever opened; a close request has nothing to close.
        return new SessionOutcome.Expired();
    }

    @Override
    public RefundOutcome refund(RefundRequest request) {
        log.warn("Cannot refund {}: payments are unavailable", request.providerRef());
        return new RefundOutcome.Unavailable(reason);
    }
}
