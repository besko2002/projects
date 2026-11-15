package com.example.moviereservation.tickets;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The Stripe idempotency key of a refund. Regression for a live Stripe test-mode failure: the key
 * used to be {@code ticket-<id>-refund}. Ticket ids restart in every database, so a second database
 * (a reset, a restore, or another environment on the same Stripe account) produced the same key for
 * a different payment and Stripe refused the refund with an IdempotencyException.
 */
class RefundKeyTest {

    @Test
    @DisplayName("two different payments never share a refund key, even for the same ticket id")
    void differentPaymentsGetDifferentKeys() {
        String first = TicketService.refundKey("pi_first", new BigDecimal("25.00"));
        String second = TicketService.refundKey("pi_second", new BigDecimal("25.00"));

        assertThat(first).isNotEqualTo(second);
    }

    @Test
    @DisplayName("a retry of the same refund reuses the same key, whatever the decimal scale")
    void sameRefundIsStableAcrossRetries() {
        assertThat(TicketService.refundKey("pi_x", new BigDecimal("30.50")))
                .isEqualTo(TicketService.refundKey("pi_x", new BigDecimal("30.5")))
                .isEqualTo("refund-pi_x-30.5");
    }

    @Test
    @DisplayName("two different amounts on one payment are distinct refund requests")
    void differentAmountsOnOnePaymentGetDifferentKeys() {
        assertThat(TicketService.refundKey("pi_x", new BigDecimal("10.00")))
                .isNotEqualTo(TicketService.refundKey("pi_x", new BigDecimal("15.00")));
    }
}
