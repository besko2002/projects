package com.example.orders.payment.domain;

/**
 * Which provider handled a payment — stored on the row, not read from the current configuration.
 *
 * <p>{@code NONE} exists because an unconfigured deployment must still be honest about what it
 * did: a payment row created by the {@code UnavailablePaymentGateway} was neither simulated nor
 * charged by Stripe, and reporting {@code simulated: true} for it would be the exact lie the
 * "never a fake success" rule forbids.
 */
public enum PaymentProvider {
    /** The deterministic local simulator; the response says {@code simulated: true}. */
    SIMULATED,

    /** Real Stripe (test mode); provider references are Stripe ids, {@code simulated: false}. */
    STRIPE,

    /** No provider was configured or reachable; the charge failed for that reason alone. */
    NONE
}
