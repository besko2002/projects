package com.example.orders.payment.api;

import com.example.orders.payment.domain.Payment;
import com.example.orders.payment.domain.PaymentProvider;
import com.example.orders.payment.domain.PaymentStatus;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A payment as the API shows it. {@code version} stays inside — it is a persistence detail.
 *
 * <p>{@code simulated} is read from the payment row's own {@code provider}, not from the current
 * configuration: a payment keeps telling the truth about how it was paid even after the
 * configuration changed. Rows from {@link com.example.orders.payment.domain.PaymentProvider#SIMULATED}
 * are {@code simulated: true} — charging and refunding only flipped rows in this service's own
 * table. Rows from {@link com.example.orders.payment.domain.PaymentProvider#STRIPE} are
 * {@code simulated: false} and their {@code providerRef} is a real Stripe id. The field exists so a
 * caller (or a reviewer reading a captured response) can never mistake one of these rows for a real
 * charge, or a real one for a simulated one.
 *
 * @param id            payment id, the value carried in {@code PaymentCompleted}
 * @param orderId       order that was paid for
 * @param customerId    who was charged
 * @param amount        amount
 * @param currency      ISO 4217 code
 * @param status        where the payment stands
 * @param failureReason why it was declined, or why it was refunded; absent otherwise
 * @param providerRef   the provider's own reference (a Stripe payment intent for real charges)
 * @param simulated     whether the money is simulated ({@code false} only for Stripe rows)
 * @param createdAt     when the charge was attempted
 * @param updatedAt     when it last changed
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PaymentResponse(
        UUID id,
        UUID orderId,
        UUID customerId,
        BigDecimal amount,
        String currency,
        PaymentStatus status,
        String failureReason,
        String providerRef,
        boolean simulated,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt) {

    /**
     * @param payment stored payment
     * @return its public representation
     */
    public static PaymentResponse of(Payment payment) {
        return new PaymentResponse(
                payment.getId(),
                payment.getOrderId(),
                payment.getCustomerId(),
                payment.getAmount(),
                payment.getCurrency(),
                payment.getStatus(),
                payment.getFailureReason(),
                payment.getProviderRef(),
                payment.getProvider() == PaymentProvider.SIMULATED,
                payment.getCreatedAt(),
                payment.getUpdatedAt());
    }
}
