package com.example.orders.payment.saga;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.orders.payment.domain.Payment;
import com.example.orders.payment.domain.PaymentProvider;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The provider's replay guard for a refund. The rule is deliberate and money-critical: the key is
 * derived from the provider's own charge reference and the amount, never from a local id — local
 * ids restart per database, so an environment rebuilt against the same Stripe account would
 * otherwise either block a real refund (same key, different refund) or pay out twice (different
 * key, same refund).
 */
class RefundIdempotencyKeyTest {

    @Test
    void theKeyIsDerivedFromTheProviderReferenceAndTheAmount() {
        Payment payment = Payment.authorized(UUID.randomUUID(), UUID.randomUUID(),
                new BigDecimal("49.90"), "EUR", PaymentProvider.STRIPE, "pi_3Fa4x1LmNoPqRsTu");

        assertThat(PaymentSagaTransactions.refundIdempotencyKey(payment))
                .isEqualTo("refund:pi_3Fa4x1LmNoPqRsTu:49.90");
    }

    @Test
    void aDifferentAmountDerivesADifferentKey() {
        Payment tenEuros = Payment.authorized(UUID.randomUUID(), UUID.randomUUID(),
                new BigDecimal("10.00"), "EUR", PaymentProvider.STRIPE, "pi_same");
        Payment ninetyEuros = Payment.authorized(UUID.randomUUID(), UUID.randomUUID(),
                new BigDecimal("90.00"), "EUR", PaymentProvider.STRIPE, "pi_same");

        assertThat(PaymentSagaTransactions.refundIdempotencyKey(tenEuros))
                .isNotEqualTo(PaymentSagaTransactions.refundIdempotencyKey(ninetyEuros));
    }

    @Test
    void theSimulatorWithoutAProviderReferenceFallsBackToTheOrder() {
        // Simulated rows carry a SIM- reference, but a missing one must not crash: the order id is
        // the last resort, and the simulator ignores the key either way.
        Payment payment = Payment.authorized(UUID.randomUUID(), UUID.randomUUID(),
                new BigDecimal("10.00"), "EUR", PaymentProvider.SIMULATED, null);

        assertThat(PaymentSagaTransactions.refundIdempotencyKey(payment))
                .isEqualTo("refund:" + payment.getOrderId() + ":10.00");
    }
}
