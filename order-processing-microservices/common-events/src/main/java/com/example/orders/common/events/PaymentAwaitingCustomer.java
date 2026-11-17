package com.example.orders.common.events;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Saga step 3, Stripe branch: the charge cannot be taken automatically, so the customer has to pay
 * and payment-service is waiting for them.
 *
 * <p>The Checkout Session's URL travels to order-service, which stores it on the order and exposes
 * it through {@code GET /api/orders/{id}} as {@code paymentUrl} while the order waits for payment.
 * No {@code PaymentCompleted}/{@code PaymentFailed} is implied by this event: the answer still
 * comes from the provider's webhook. The expiry is advisory (Stripe enforces it server-side); the
 * saga's own timeout remains the authority over abandoned checkouts.
 *
 * @param orderId     order that is waiting for its customer to pay
 * @param paymentId   payment row that is {@code AWAITING_CUSTOMER}
 * @param checkoutUrl hosted Stripe Checkout page to send the customer to
 * @param expiresAt   when the session stops being payable, or {@code null} when unknown
 * @param amount      amount the customer is asked for
 * @param currency    ISO 4217 code
 */
public record PaymentAwaitingCustomer(
        UUID orderId,
        UUID paymentId,
        String checkoutUrl,
        OffsetDateTime expiresAt,
        BigDecimal amount,
        String currency) {
}
