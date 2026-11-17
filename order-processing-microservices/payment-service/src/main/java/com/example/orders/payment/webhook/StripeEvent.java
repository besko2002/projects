package com.example.orders.payment.webhook;

/**
 * The handful of fields this service acts on, read out of a <em>verified</em> Stripe delivery.
 *
 * <p>Deliberately parsed with Jackson rather than the SDK's event models: the payload was already
 * authenticated, only a few fields matter, and staying independent of the SDK's model classes
 * keeps the tests able to post a hand-written (but correctly signed) event with no network.
 *
 * @param eventId          Stripe's event id, {@code evt_...}; the de-duplication key
 * @param type             Stripe's event type, e.g. {@code checkout.session.completed}
 * @param sessionId        the checkout session's id, when the event is about one
 * @param paymentIntentId  the payment intent's id, when the event carries one
 * @param orderId          the order this system wrote into the session/intent metadata
 * @param paymentStatus    the checkout session's {@code payment_status} (e.g. {@code paid})
 * @param sessionStatus    the checkout session's {@code status} (e.g. {@code complete})
 * @param failureMessage   the intent's {@code last_payment_error.message}, when it failed
 * @param amount           the charge's total, in minor units (charge.refunded)
 * @param amountRefunded   how much of the charge has been refunded, in minor units
 * @param currency         the three-letter ISO code the session/charge was created in
 *                         (lower-case in Stripe's payloads)
 */
public record StripeEvent(
        String eventId,
        String type,
        String sessionId,
        String paymentIntentId,
        String orderId,
        String paymentStatus,
        String sessionStatus,
        String failureMessage,
        Long amount,
        Long amountRefunded,
        String currency) {

    /** @return whether the event is one this service knows how to act on */
    public boolean supported() {
        return switch (type) {
            case "checkout.session.completed",
                 "checkout.session.expired",
                 "payment_intent.payment_failed",
                 "charge.refunded" -> true;
            default -> false;
        };
    }
}
