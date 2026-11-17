package com.example.orders.payment.gateway;

import java.math.BigDecimal;

/**
 * What payment-service asks a provider to give back after a cancellation.
 *
 * @param providerRef    the provider's own reference of the charge, e.g. a Stripe payment intent
 *                       id; {@code null} only when the provider is the local simulator
 * @param amount         amount to refund
 * @param currency       ISO 4217 code
 * @param idempotencyKey provider-side replay guard. For Stripe this MUST be derived from the
 *                       provider reference and the amount — never from a local id, which restarts
 *                       per database and would collide with another environment's refund
 */
public record RefundRequest(
        String providerRef,
        BigDecimal amount,
        String currency,
        String idempotencyKey) {
}
