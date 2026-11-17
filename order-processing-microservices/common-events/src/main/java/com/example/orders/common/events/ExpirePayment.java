package com.example.orders.common.events;

import java.util.UUID;

/**
 * Compensation command for a checkout the customer never finished: close the hosted payment
 * session so a cancelled or timed-out order cannot be paid for afterwards.
 *
 * <p>Why a separate command instead of reusing {@link RefundPayment}: refund means "money was
 * taken, give it back", and its arrival flips order-service's {@code refund_status} bookkeeping.
 * An abandoned session never took money — asking for a refund of nothing would leave that flag
 * open forever, and the refund-recovery sweep would re-command it on every tick. Expiring is the
 * honest compensation: no money moved, so the only owed thing is a closed session.
 *
 * <p>payment-service expires the session at the provider (an already-completed session is
 * answered with that fact instead, so a customer who clicked pay in the same moment still gets
 * their order saga's late-payment treatment, which refunds them). No event is announced on
 * success: the order is already cancelled when this command is queued, and a
 * {@code PaymentFailed} for a cancelled order would be dead letter noise.
 *
 * @param orderId   order whose payment session should be closed
 * @param paymentId payment that is {@code AWAITING_CUSTOMER}, as order-service learned it
 * @param reason    why the session is being closed, shown in payment-service's ledger
 */
public record ExpirePayment(
        UUID orderId,
        UUID paymentId,
        String reason) {
}
