package com.example.orders.payment.gateway;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * What payment-service needs to ask a provider for the money of one order.
 *
 * <p>Every field except the command's own payload is decided <em>once</em> per order, persisted in
 * {@code charge_attempts} before the network call, and reused on every retry ({@code PAY-3}): a
 * redelivery must reach the provider with the same idempotency key <em>and</em> the same request,
 * or Stripe refuses the replay and an accepted-but-unanswered charge can never be recovered.
 *
 * @param orderId        order being paid for
 * @param paymentId      id the payment row will carry — decided up front, persisted, so it travels
 *                       as the provider session's metadata and every later webhook can find the row
 * @param customerId     who is charged (visibility endpoint)
 * @param amount         amount to charge
 * @param currency       ISO 4217 code
 * @param idempotencyKey provider-side replay guard of this attempt; derived from the charge
 *                       attempt's opening command's event id, so a redelivered or retried charge
 *                       reaches the same session
 * @param expiresAt      when the requested session stops being payable, decided once when the
 *                       attempt was opened — never recomputed per call
 */
public record ChargeRequest(
        UUID orderId,
        UUID paymentId,
        UUID customerId,
        BigDecimal amount,
        String currency,
        String idempotencyKey,
        OffsetDateTime expiresAt) {
}
