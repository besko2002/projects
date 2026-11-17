package com.example.orders.payment.gateway;

import java.math.BigDecimal;

/**
 * The port payment-service talks to in order to move money.
 *
 * <p>Two implementations exist, chosen once at startup by {@link PaymentGatewayConfiguration}:
 * the local {@link SimulatedPaymentGateway} (an explicit {@code PAYMENT_PROVIDER=simulated}, what
 * the automated tests use — instant verdicts, no money) and {@link StripePaymentGateway} (real
 * Stripe test mode — hosted checkout, webhook answers, real refunds). When no provider is
 * configured the port is {@link UnavailablePaymentGateway}: it answers {@code Unavailable}, so an
 * order fails with a clear reason instead of a fake success.
 *
 * <p>The implementations make no promise about being cheap: the Stripe methods are network calls
 * and are deliberately invoked <em>outside</em> database transactions, so a slow provider never
 * holds row locks. Callers therefore pass replay guards ({@link ChargeRequest#idempotencyKey()},
 * {@link RefundRequest#idempotencyKey()}) that make a repeated call return the provider's first
 * answer instead of doing the work twice.
 */
public interface PaymentGateway {

    /**
     * @return which provider this is — {@code SIMULATED}, {@code STRIPE} or {@code NONE}; stored
     *         on every payment row, and the API reports {@code simulated: (provider == SIMULATED)}
     */
    String provider();

    /**
     * Asks the provider to take the money for one order.
     *
     * @param request amount, currency, ids and the replay guard
     * @return verdict, or the checkout the customer has to finish first, or the reason the
     *         provider could not be asked
     */
    ChargeOutcome charge(ChargeRequest request);

    /**
     * Closes a hosted checkout session the customer abandoned. Only meaningful for providers that
     * open sessions; the simulator has none and answers {@link SessionOutcome.Expired}.
     *
     * @param checkoutSessionId the provider's session reference stored on the payment
     * @return what actually happened — including the possibility that the customer paid just in
     *         time, which callers must handle as a completion, never as a failure
     */
    SessionOutcome expireSession(String checkoutSessionId);

    /**
     * Asks the provider to give a taken charge back.
     *
     * @param request provider reference, amount and the replay guard
     * @return whether the money went back, or the reason the provider could not be asked
     */
    RefundOutcome refund(RefundRequest request);
}
