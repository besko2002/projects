package com.example.orders.order.saga;

import com.example.orders.order.domain.Order;
import com.example.orders.order.domain.OrderRepository;
import com.example.orders.order.domain.OrderStatus;
import com.example.orders.order.domain.RefundStatus;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The saga's deadline — and the refund's retry clock.
 *
 * <p>An orchestrated saga has one failure mode no amount of retrying fixes: a step that never
 * answers. inventory-service may be down while the order is {@code PENDING}, a
 * {@code ProcessPayment} may have been dead-lettered, a service may have been redeployed mid-flow.
 * Without a deadline the order would sit in a non-final state forever — and worse, keep its stock
 * reserved — so after {@code ORDER_SAGA_TIMEOUT} the sweeper cancels it <em>with</em> compensation.
 *
 * <p>The timeout is measured from the last transition, not from creation: an order that is making
 * progress is not stuck. It is generous compared to the saga's normal latency (which is
 * milliseconds), because cancelling an order that was merely slow is itself a failure.
 *
 * <p>One kind of "stuck" is not fixable by cancelling: a tracked refund whose
 * {@code RefundPayment} command was lost. Money has been (or is being) taken, the order may already
 * be final, and the only cure is to ask for the refund again. A second scan re-commands refunds
 * that are unanswered after {@code orders.saga.refund-retry-interval}, oldest attempt first. Both
 * scans share the sweep tick; the per-order work stays in per-order transactions, so neither scan
 * holds locks across orders and a failure on one order does not roll back the others. Delivery of
 * the re-queued command remains Kafka's at-least-once — the exactly-once effects at the edges are
 * the consumers' flags (payment-service refunds exactly once per order), not the sweep's claim.
 *
 * <p><b>The refund scan is the only driver of refund retries.</b> The two clocks are independent
 * ({@code orders.saga.timeout} against {@code orders.saga.refund-retry-interval}, in either order),
 * so the timeout scan leaves every order with an outstanding refund alone — in its query, not in
 * its loop, so such orders cannot fill the capped batch either — and a refund is re-commanded only
 * once {@code refund_retry_at} is a full retry interval old.
 */
@Component
@ConditionalOnProperty(name = "orders.saga.timeout-sweeper-enabled", havingValue = "true", matchIfMissing = true)
class OrderSagaTimeoutSweeper {

    private static final Logger log = LoggerFactory.getLogger(OrderSagaTimeoutSweeper.class);

    private final OrderRepository orders;
    private final OrderSaga saga;
    private static final PageRequest BATCH = PageRequest.of(0, 50);

    private final Duration timeout;
    private final Duration paymentWindow;
    private final Duration refundRetryInterval;

    OrderSagaTimeoutSweeper(
            OrderRepository orders,
            OrderSaga saga,
            @Value("${orders.saga.timeout:PT2M}") Duration timeout,
            @Value("${orders.saga.payment-window:PT35M}") Duration paymentWindow,
            @Value("${orders.saga.refund-retry-interval:PT30S}") Duration refundRetryInterval) {
        this.orders = orders;
        this.saga = saga;
        this.timeout = timeout;
        // A customer at a hosted checkout is never given less time than any other step.
        this.paymentWindow = paymentWindow.compareTo(timeout) < 0 ? timeout : paymentWindow;
        this.refundRetryInterval = refundRetryInterval;
    }

    @Scheduled(
            fixedDelayString = "${orders.saga.sweep-interval-ms:15000}",
            initialDelayString = "${orders.saga.sweep-interval-ms:15000}")
    void sweep() {
        int cancelled = cancelTimedOut();
        int recovered = recoverOutstandingRefunds();
        if (cancelled + recovered > 0) {
            log.info("Sweep finished: {} order(s) cancelled, {} refund(s) re-queued",
                    cancelled, recovered);
        }
    }

    /**
     * Cancels every order that has been stuck for longer than the timeout, and every order whose
     * hosted checkout is past the provider's own deadline.
     *
     * <p>Orders that are only waiting for an outstanding refund ({@code REQUESTED}) are not stuck
     * and are not candidates: re-commanding their refund is {@link #recoverOutstandingRefunds()}'s
     * job, paced by the retry interval, never by this timeout.
     *
     * <p>Two clocks cancel an order waiting at a hosted checkout. The configured payment window is
     * the generous one; the provider's own session deadline ({@code checkout_expires_at}, carried
     * by {@code PaymentAwaitingCustomer}) is the honest one — once Stripe itself refuses the
     * payment, waiting longer only delays the customer's answer, and if the provider's expiry
     * webhook was missed the deadline is what still gets the stock released. The re-check inside
     * {@code timeOut} keeps a stale scan result from cancelling an order that progressed after the
     * scan read it.
     *
     * <p>The scan is read-only and each cancellation is its own transaction, so a sweep never holds
     * locks across orders and a failure on one order does not roll back the others.
     *
     * @return how many orders this run cancelled
     */
    @Transactional(readOnly = true)
    public int cancelTimedOut() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        OffsetDateTime cutoff = now.minus(timeout);
        int cancelled = 0;
        List<Order> stuck = orders.findStuckExcludingAwaitingCustomer(
                OrderStatus.UNFINISHED, RefundStatus.REQUESTED, OrderStatus.STOCK_HELD, cutoff, BATCH);
        if (!stuck.isEmpty()) {
            log.warn("Saga timeout sweep found {} order(s) with no progress since {}", stuck.size(), cutoff);
            for (Order order : stuck) {
                String reason = "The order was cancelled because step '%s' did not complete within %s"
                        .formatted(order.getStatus(), timeout);
                if (saga.timeOut(order.getId(), reason, cutoff)) {
                    cancelled++;
                }
            }
        }
        // A customer holding a payment link gets the payment window, not the step timeout: the
        // hosted checkout stays payable for at least 30 minutes, and cancelling while the customer
        // is still typing their card would refund a payment they were entitled to make. The same
        // scan also catches checkouts the provider itself has already closed (their deadline is
        // older than any window would be), so a missed expiry webhook still gets compensated.
        OffsetDateTime paymentCutoff = now.minus(paymentWindow);
        List<Order> unpaid = orders.findAwaitingCustomerPastWindow(
                OrderStatus.STOCK_HELD, RefundStatus.REQUESTED, paymentCutoff, now, BATCH);
        if (!unpaid.isEmpty()) {
            log.warn("Saga timeout sweep found {} unpaid checkout(s) past their window ({}) or the "
                    + "provider's deadline", unpaid.size(), paymentWindow);
            for (Order order : unpaid) {
                String reason = order.getCheckoutExpiresAt() != null
                        && order.getCheckoutExpiresAt().isBefore(now)
                        ? "The order was cancelled because its payment page expired before payment "
                                + "was completed"
                        : "The order was cancelled because payment was not completed within %s"
                                .formatted(paymentWindow);
                if (saga.timeOut(order.getId(), reason, paymentCutoff)) {
                    cancelled++;
                }
            }
        }
        return cancelled;
    }

    /**
     * Re-commands every outstanding refund that has now been unanswered for a full retry interval,
     * whatever happened to its order — a cancellation that is still waiting, or a cancellation that
     * already went final {@code CANCELLED} with a late payment changing its mind. Only the refund
     * is retried; neither the state nor its announcement is touched by this scan.
     *
     * <p>The scan is read-only and each recovery is its own transaction; booking the attempt and
     * queuing the command commit together inside it, so no attempt goes unbooked.
     *
     * @return how many refunds this run re-queued
     */
    @Transactional(readOnly = true)
    public int recoverOutstandingRefunds() {
        OffsetDateTime dueBefore = OffsetDateTime.now(ZoneOffset.UTC).minus(refundRetryInterval);
        List<Order> owed = orders.findTop50ByRefundStatusAndStatusInAndRefundRetryAtBeforeOrderByRefundRetryAtAsc(
                RefundStatus.REQUESTED,
                Set.of(OrderStatus.CANCELLED, OrderStatus.CANCELLATION_PENDING),
                dueBefore);
        if (owed.isEmpty()) {
            return 0;
        }
        log.warn("Refund recovery sweep found {} refund(s) unanswered since before {}",
                owed.size(), dueBefore);
        int recovered = 0;
        for (Order order : owed) {
            String reason = ("The refund was commanded again because the payment-service did not"
                    + " confirm the first command within %s").formatted(refundRetryInterval);
            if (saga.recoverOutstandingRefund(order.getId(), reason, dueBefore)) {
                recovered++;
            }
        }
        return recovered;
    }
}
