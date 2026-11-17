package com.example.orders.order.saga;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.orders.common.events.EventEnvelope;
import com.example.orders.common.events.EventHeaders;
import com.example.orders.common.events.PaymentAwaitingCustomer;
import com.example.orders.common.events.PaymentCompleted;
import com.example.orders.common.events.PaymentRefunded;
import com.example.orders.common.events.StockReserved;
import com.example.orders.common.events.Topics;
import com.example.orders.order.OrderIntegrationTest;
import com.example.orders.order.domain.Order;
import com.example.orders.order.domain.OrderStatus;
import com.example.orders.order.domain.RefundStatus;
import com.example.orders.support.correlation.CorrelationId;
import com.example.orders.support.idempotency.ProcessedEventRepository;
import com.example.orders.support.outbox.OutboxEvent;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.TestPropertySource;

/**
 * Regression for the hosted-checkout review (17 Nov 2026): a checkout is a <em>promise to pay</em>,
 * not a payment, and the provider runs its own clock.
 *
 * <p>What these tests pin, against real Postgres and real Kafka:
 * <ul>
 *   <li><b>PAY-1</b> — a {@code PaymentAwaitingCustomer} that arrives after the saga cancelled the
 *       order must still close the checkout: the expiry command is built from the event's payment
 *       id even when no URL was ever stored, the cancelled order never exposes a payable link, and
 *       duplicates queue no second close. Cancellation and the awaiting event may arrive in either
 *       order and converge on one closed checkout.</li>
 *   <li><b>PAY-4</b> — cancelling (or timing out) an order whose customer only ever held a checkout
 *       link must <em>not</em> claim a refund: no {@code RefundPayment}, {@code refund_status}
 *       stays {@code NONE} — before the fix the checkout's payment id was mistaken for proof of
 *       payment and the refund-recovery sweep re-commanded that phantom refund forever. A charge
 *       that completes anyway is still tracked and refunded to settlement.</li>
 *   <li><b>PAY-5</b> — the provider's own session deadline is honoured: a checkout Stripe no longer
 *       accepts is compensated promptly even when the configured payment window would keep
 *       waiting, a still-valid checkout is never cancelled early, and a stale scan result cannot
 *       cancel an order that progressed after the scan read it.</li>
 * </ul>
 *
 * <p>Deterministic by construction: the context's scheduled sweeper is switched off, the scans
 * under test run on a hand-built {@link OrderSagaTimeoutSweeper} (same wiring as the context's
 * own), and "time passing" is persisted {@code updated_at}/deadlines aged with SQL — nothing
 * sleeps. The deadline cases are driven by a checkout whose expiry is already in the past, which
 * is exactly what the production condition reads.
 */
@TestPropertySource(properties = {
        "orders.saga.timeout=PT5S",
        // Generous window: only the provider deadline may cancel a checkout in these tests.
        "orders.saga.payment-window=PT2M",
        "orders.saga.refund-retry-interval=PT20S",
        // No scheduled sweep: the test drives the scans itself.
        "orders.saga.timeout-sweeper-enabled=false"
})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OrderSagaCheckoutTest extends OrderIntegrationTest {

    private static final String EXPIRE = "ExpirePayment";
    private static final String REFUND = "RefundPayment";

    /** A hosted checkout URL as Stripe hands it out; never shown after the saga gives up. */
    private static final String CHECKOUT_URL = "https://checkout.stripe.com/c/pay/test-session";

    @Autowired
    private OrderSaga saga;

    @Autowired
    private ProcessedEventRepository processedEvents;

    @Autowired
    private JdbcTemplate jdbc;

    @Value("${orders.saga.timeout}")
    private Duration timeout;

    @Value("${orders.saga.payment-window}")
    private Duration paymentWindow;

    @Value("${orders.saga.refund-retry-interval}")
    private Duration refundRetryInterval;

    @BeforeEach
    void clearDeduplicationLog() {
        processedEvents.deleteAllInBatch();
    }

    // ------------------------------------------------------------------ PAY-1: late awaiting event

    @Test
    void aLateAwaitingEventForACancelledOrderStillClosesItsCheckout() throws Exception {
        UUID user = UUID.randomUUID();
        UUID orderId = placeOrder(user, "149.00", 1, "corr-late-awaiting");
        mvc.perform(post("/api/orders/{id}/cancel", orderId)
                        .header("Authorization", "Bearer " + token(user, "USER")))
                .andExpect(status().isOk());
        awaitStatus(orderId, OrderStatus.CANCELLED);

        // The checkout was opened (or its announcement was simply late) after the cancellation:
        // the event is the saga's first news of it, no URL was ever stored.
        UUID paymentId = UUID.randomUUID();
        publish(Topics.PAYMENT_EVENTS, orderId, awaiting(orderId, paymentId, now().plusMinutes(30)));

        awaitUntil(Duration.ofSeconds(45), () -> countOutbox(orderId, EXPIRE) == 1);
        assertThat(expirePaymentIds(orderId)).containsExactly(paymentId);
        Order order = order(orderId);
        assertThat(order.getStatus()).isEqualTo(OrderStatus.CANCELLED);
        // No payable link on a cancelled order — and no phantom refund either.
        assertThat(order.getPaymentUrl()).isNull();
        assertThat(order.getRefundStatus()).isEqualTo(RefundStatus.NONE);
        assertThat(countOutbox(orderId, REFUND)).isZero();
        assertThat(countOutbox(orderId, "OrderCancelled")).isEqualTo(1);

        // A redelivery and a re-announcement (fresh event id, same fact) close nothing twice.
        EventEnvelope<PaymentAwaitingCustomer> first = awaiting(orderId, paymentId, now().plusMinutes(30));
        publish(Topics.PAYMENT_EVENTS, orderId, first);
        publish(Topics.PAYMENT_EVENTS, orderId, awaiting(orderId, paymentId, now().plusMinutes(30)));
        awaitUntil(Duration.ofSeconds(45), () -> processedEvents.count() == 3);
        assertHoldsFor(Duration.ofSeconds(2), () -> assertThat(countOutbox(orderId, EXPIRE)).isEqualTo(1));
        assertThat(order(orderId).getRefundStatus()).isEqualTo(RefundStatus.NONE);
    }

    @Test
    void cancellationAndTheAwaitingEventConvergeOnOneClosedCheckoutWhoeverWins() throws Exception {
        UUID user = UUID.randomUUID();
        UUID orderId = reservedOrder(user, "corr-awaiting-race");
        UUID paymentId = UUID.randomUUID();
        PaymentAwaitingCustomer awaiting = new PaymentAwaitingCustomer(
                orderId, paymentId, CHECKOUT_URL, now().plusMinutes(30),
                order(orderId).getTotalAmount(), "EUR");

        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Boolean> cancel = pool.submit(() -> {
                start.await();
                mvc.perform(post("/api/orders/{id}/cancel", orderId)
                                .header("Authorization", "Bearer " + token(user, "USER")))
                        .andExpect(status().isOk());
                return true;
            });
            Future<Boolean> arrive = pool.submit(() -> {
                start.await();
                saga.paymentAwaitingCustomer(UUID.randomUUID(), awaiting);
                return true;
            });
            start.countDown();
            cancel.get(60, TimeUnit.SECONDS);
            arrive.get(60, TimeUnit.SECONDS);
        }
        finally {
            pool.shutdownNow();
        }

        // Both interleavings converge: the checkout is closed exactly once, the order is finally
        // cancelled, no refund was ever owed, and the cancellation is announced exactly once.
        awaitUntil(Duration.ofSeconds(45), () -> order(orderId).getStatus() == OrderStatus.CANCELLED);
        assertHoldsFor(Duration.ofSeconds(3), () -> {
            assertThat(countOutbox(orderId, EXPIRE)).isEqualTo(1);
            assertThat(expirePaymentIds(orderId)).containsExactly(paymentId);
            assertThat(countOutbox(orderId, REFUND)).isZero();
            assertThat(countOutbox(orderId, "OrderCancelled")).isEqualTo(1);
        });
        Order order = order(orderId);
        assertThat(order.getRefundStatus()).isEqualTo(RefundStatus.NONE);
        assertThat(order.getPaymentUrl()).isNull();
        assertThat(mvc.perform(get("/api/orders/{id}", orderId)
                        .header("Authorization", "Bearer " + token(user, "USER")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
                .doesNotContain("checkout.stripe.com");
    }

    // ------------------------------------------------------------------ PAY-4: unpaid cancellation

    @Test
    void cancellingAnOrderWithAnOpenCheckoutClosesItWithoutClaimingARefund() throws Exception {
        UUID user = UUID.randomUUID();
        UUID orderId = reservedOrder(user, "corr-unpaid-cancel");
        UUID paymentId = UUID.randomUUID();
        publish(Topics.PAYMENT_EVENTS, orderId,
                awaiting(orderId, paymentId, now().plusMinutes(30)));
        awaitUntil(Duration.ofSeconds(45), () -> CHECKOUT_URL.equals(order(orderId).getPaymentUrl()));

        mvc.perform(post("/api/orders/{id}/cancel", orderId)
                        .header("Authorization", "Bearer " + token(user, "USER")))
                .andExpect(status().isOk());
        awaitStatus(orderId, OrderStatus.CANCELLED);

        // The checkout is closed; no money was taken, so no refund may be claimed or tracked.
        assertThat(countOutbox(orderId, EXPIRE)).isEqualTo(1);
        assertThat(expirePaymentIds(orderId)).containsExactly(paymentId);
        assertThat(countOutbox(orderId, REFUND)).isZero();
        assertThat(order(orderId).getRefundStatus()).isEqualTo(RefundStatus.NONE);
        assertThat(types(orderId)).contains("ReleaseStock", "OrderCancelled");

        // The recovery sweep has nothing to recover: no refund was ever requested for this order.
        assertThat(sweeper().recoverOutstandingRefunds()).isZero();
        assertThat(countOutbox(orderId, REFUND)).isZero();
    }

    @Test
    void aTimedOutUnpaidCheckoutIsClosedNotRefunded() {
        UUID paymentId = UUID.randomUUID();
        UUID orderId = checkoutOrder(paymentId, CHECKOUT_URL, now().plusMinutes(30));

        // The sweeper's own cutoff: a fresh order is not past the payment window, so only a
        // checkout past the provider deadline may be cancelled — this one is not.
        assertThat(saga.timeOut(orderId, "Test: window elapsed",
                now().minus(paymentWindow))).isFalse();
        assertThat(order(orderId).getStatus()).isEqualTo(OrderStatus.PAYMENT_PENDING);
        assertThat(outbox.findByAggregateIdOrderByCreatedAtAsc(orderId)).isEmpty();

        // Give up on it deliberately: the close is queued, the refund is not.
        assertThat(saga.timeOut(orderId, "Test: the sweep gave up on a checkout",
                now())).isTrue();
        Order cancelled = order(orderId);
        assertThat(cancelled.getStatus()).isEqualTo(OrderStatus.CANCELLED);
        assertThat(cancelled.getRefundStatus()).isEqualTo(RefundStatus.NONE);
        assertThat(countOutbox(orderId, EXPIRE)).isEqualTo(1);
        assertThat(expirePaymentIds(orderId)).containsExactly(paymentId);
        assertThat(countOutbox(orderId, REFUND)).isZero();
        assertThat(countOutbox(orderId, "ReleaseStock")).isEqualTo(1);
    }

    @Test
    void aLateCompletionAfterAnUnpaidCancelIsTrackedAndRefundedToSettlement() throws Exception {
        UUID user = UUID.randomUUID();
        UUID orderId = reservedOrder(user, "corr-late-paid-unpaid-cancel");
        UUID paymentId = UUID.randomUUID();
        publish(Topics.PAYMENT_EVENTS, orderId,
                awaiting(orderId, paymentId, now().plusMinutes(30)));
        awaitUntil(Duration.ofSeconds(45), () -> CHECKOUT_URL.equals(order(orderId).getPaymentUrl()));
        mvc.perform(post("/api/orders/{id}/cancel", orderId)
                        .header("Authorization", "Bearer " + token(user, "USER")))
                .andExpect(status().isOk());
        awaitStatus(orderId, OrderStatus.CANCELLED);
        assertThat(order(orderId).getRefundStatus()).isEqualTo(RefundStatus.NONE);

        // The customer paid the open checkout anyway. The money is real: track it, refund it.
        publish(Topics.PAYMENT_EVENTS, orderId,
                EventEnvelope.of("corr-late-paid-unpaid-cancel-completed",
                        new PaymentCompleted(orderId, paymentId, order(orderId).getTotalAmount(), "EUR")));
        awaitUntil(Duration.ofSeconds(45), () -> order(orderId).getRefundStatus() == RefundStatus.REQUESTED);
        assertThat(order(orderId).getPaymentId()).isEqualTo(paymentId);
        assertThat(refundPaymentIds(orderId)).containsExactly(paymentId);

        // The API shows the refund progress (the field the storefront reads).
        String before = mvc.perform(get("/api/orders/{id}", orderId)
                        .header("Authorization", "Bearer " + token(user, "USER")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(parse(before).get("refundStatus").asText()).isEqualTo("REQUESTED");

        publish(Topics.PAYMENT_EVENTS, orderId, refunded(orderId, paymentId));
        awaitUntil(Duration.ofSeconds(45), () -> order(orderId).getRefundStatus() == RefundStatus.REFUNDED);
        String after = mvc.perform(get("/api/orders/{id}", orderId)
                        .header("Authorization", "Bearer " + token(user, "USER")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(parse(after).get("refundStatus").asText()).isEqualTo("REFUNDED");
        assertThat(order(orderId).getStatus()).isEqualTo(OrderStatus.CANCELLED);
        assertThat(countOutbox(orderId, "OrderCancelled")).isEqualTo(1);
    }

    // ------------------------------------------------------------------ PAY-5: provider deadline

    @Test
    void aCheckoutPastTheProviderDeadlineIsCancelledEvenWhenTheWindowWouldWait() {
        UUID dead = checkoutOrder(UUID.randomUUID(), CHECKOUT_URL, now().minusSeconds(1));
        UUID alive = checkoutOrder(UUID.randomUUID(), CHECKOUT_URL, now().plusMinutes(30));

        // Both are freshly touched, so the payment window selects neither; the provider deadline
        // selects only the expired one. The generic stuck scan skips both (they hold a checkout).
        assertThat(sweeper().cancelTimedOut()).isEqualTo(1);

        Order cancelled = order(dead);
        assertThat(cancelled.getStatus()).isEqualTo(OrderStatus.CANCELLED);
        assertThat(cancelled.getFailureReason()).contains("payment page expired");
        assertThat(countOutbox(dead, EXPIRE)).isEqualTo(1);
        assertThat(countOutbox(dead, REFUND)).isZero();
        assertThat(cancelled.getRefundStatus()).isEqualTo(RefundStatus.NONE);

        // The still-valid checkout is untouched: the customer may still be typing their card.
        assertThat(order(alive).getStatus()).isEqualTo(OrderStatus.PAYMENT_PENDING);
        assertThat(outbox.findByAggregateIdOrderByCreatedAtAsc(alive)).isEmpty();
        assertThat(sweeper().cancelTimedOut()).isZero();
        assertThat(order(alive).getStatus()).isEqualTo(OrderStatus.PAYMENT_PENDING);
    }

    @Test
    void aStaleScanDoesNotCancelAnOrderThatProgressedAfterIt() throws Exception {
        UUID progressed = placeOrder(UUID.randomUUID(), "149.00", 1, "corr-stale-progressed");
        age(Duration.ofSeconds(10), progressed);
        UUID stillStuck = placeOrder(UUID.randomUUID(), "149.00", 1, "corr-stale-stuck");
        age(Duration.ofSeconds(10), stillStuck);

        // The scan ran; then the reservation answer arrived and the order moved on.
        publish(Topics.INVENTORY_EVENTS, progressed, EventEnvelope.of("corr-stale-progressed-reserved",
                new StockReserved(progressed, UUID.randomUUID(), List.of())));
        awaitStatus(progressed, OrderStatus.PAYMENT_PENDING);

        // The stale scan result must not cancel the newly progressed order...
        assertThat(saga.timeOut(progressed, "Test: stale scan",
                now().minus(Duration.ofSeconds(10)))).isFalse();
        assertThat(order(progressed).getStatus()).isEqualTo(OrderStatus.PAYMENT_PENDING);
        // ...and its outbox gains no cancellation commands (the OrderCreated and ProcessPayment
        // rows already queued on its way here are exactly what a live order should carry).
        assertThat(countOutbox(progressed, EXPIRE)).isZero();
        assertThat(countOutbox(progressed, REFUND)).isZero();
        assertThat(countOutbox(progressed, "ReleaseStock")).isZero();
        assertThat(countOutbox(progressed, "OrderCancelled")).isZero();
        // ...while its genuinely stuck sibling is still compensated by the same cutoff.
        assertThat(saga.timeOut(stillStuck, "Test: stale scan",
                now().minus(Duration.ofSeconds(10)))).isTrue();
        assertThat(order(stillStuck).getStatus()).isEqualTo(OrderStatus.CANCELLED);
    }

    // ------------------------------------------------------------------ fixtures & helpers

    /** @return the sweeper the context would have scheduled, built with the context's own clocks */
    private OrderSagaTimeoutSweeper sweeper() {
        return new OrderSagaTimeoutSweeper(orders, saga, timeout, paymentWindow, refundRetryInterval);
    }

    private Order order(UUID orderId) {
        return orders.findById(orderId).orElseThrow();
    }

    /**
     * @param paymentId the checkout's payment id
     * @param url       the hosted page, or {@code null} when none was ever stored
     * @param expiresAt the provider's deadline
     * @return a persisted {@code PAYMENT_PENDING} order (stock held — the only state a real flow
     *         reaches a checkout from) waiting at a hosted checkout, built without the saga's
     *         round trip
     */
    private UUID checkoutOrder(UUID paymentId, String url, OffsetDateTime expiresAt) {
        Order order = Order.pending(UUID.randomUUID(), "EUR", null);
        order.addLine(UUID.randomUUID(), "Widget", new BigDecimal("12.50"), 2);
        order.markPaymentPending(UUID.randomUUID());
        order.rememberCheckout(paymentId, url, expiresAt);
        return orders.saveAndFlush(order).getId();
    }

    /**
     * @return a {@code PAYMENT_PENDING} order, reached through the real saga step, with no checkout
     */
    private UUID reservedOrder(UUID user, String correlationId) throws Exception {
        UUID orderId = placeOrder(user, "119.00", 2, correlationId);
        publish(Topics.INVENTORY_EVENTS, orderId, EventEnvelope.of(correlationId,
                new StockReserved(orderId, UUID.randomUUID(), List.of())));
        awaitStatus(orderId, OrderStatus.PAYMENT_PENDING);
        return orderId;
    }

    private UUID placeOrder(UUID user, String unitPrice, int quantity, String correlationId)
            throws Exception {
        UUID product = givenCatalogProduct("SKU-CHECKOUT-" + UUID.randomUUID().toString().substring(0, 6),
                "Checkout product", unitPrice);
        String body = mvc.perform(post("/api/orders")
                        .header("Authorization", "Bearer " + token(user, "USER"))
                        .header(CorrelationId.HEADER, correlationId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody(product, quantity)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(parse(body).get("id").asText());
    }

    private EventEnvelope<PaymentAwaitingCustomer> awaiting(UUID orderId, UUID paymentId,
            OffsetDateTime expiresAt) {
        return EventEnvelope.of("corr-awaiting-" + UUID.randomUUID(), new PaymentAwaitingCustomer(
                orderId, paymentId, CHECKOUT_URL, expiresAt, order(orderId).getTotalAmount(), "EUR"));
    }

    private EventEnvelope<PaymentRefunded> refunded(UUID orderId, UUID paymentId) {
        return EventEnvelope.of("corr-refunded-" + UUID.randomUUID(), new PaymentRefunded(
                orderId, paymentId, order(orderId).getTotalAmount(), "EUR", "Cancelled by the customer"));
    }

    private List<UUID> expirePaymentIds(UUID orderId) {
        return outbox.findByAggregateIdOrderByCreatedAtAsc(orderId).stream()
                .filter(row -> EXPIRE.equals(row.getEventType()))
                .map(this::payloadOf)
                .map(payload -> UUID.fromString(payload.get("payload").get("paymentId").asText()))
                .toList();
    }

    private List<UUID> refundPaymentIds(UUID orderId) {
        return outbox.findByAggregateIdOrderByCreatedAtAsc(orderId).stream()
                .filter(row -> REFUND.equals(row.getEventType()))
                .map(this::payloadOf)
                .map(payload -> UUID.fromString(payload.get("payload").get("paymentId").asText()))
                .toList();
    }

    private List<String> types(UUID orderId) {
        return outbox.findByAggregateIdOrderByCreatedAtAsc(orderId).stream()
                .map(OutboxEvent::getEventType)
                .toList();
    }

    private long countOutbox(UUID orderId, String eventType) {
        return outbox.findByAggregateIdOrderByCreatedAtAsc(orderId).stream()
                .filter(row -> eventType.equals(row.getEventType()))
                .count();
    }

    private JsonNode payloadOf(OutboxEvent row) {
        try {
            return parse(row.getPayload());
        }
        catch (IOException e) {
            throw new UncheckedIOException("Outbox payload is not JSON", e);
        }
    }

    private void awaitStatus(UUID orderId, OrderStatus expected) {
        awaitUntil(Duration.ofSeconds(45), () -> orders.findById(orderId)
                .map(found -> found.getStatus() == expected)
                .orElse(false));
    }

    /** Lets a row look as if its last transition were {@code age} ago — plain SQL, no version bump. */
    private void age(Duration age, UUID orderId) {
        jdbc.update("UPDATE orders SET updated_at = ? WHERE id = ?", now().minus(age), orderId);
    }

    private static OffsetDateTime now() {
        return OffsetDateTime.now(ZoneOffset.UTC);
    }

    private void publish(String topic, UUID key, EventEnvelope<?> envelope) {
        Map<String, Object> config = new HashMap<>();
        config.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        config.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG,
                org.apache.kafka.common.serialization.StringSerializer.class.getName());
        config.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG,
                org.apache.kafka.common.serialization.StringSerializer.class.getName());
        config.put(ProducerConfig.ACKS_CONFIG, "all");
        try (KafkaProducer<String, String> producer = new KafkaProducer<>(config)) {
            ProducerRecord<String, String> record = new ProducerRecord<>(
                    topic, key.toString(), json.writeValueAsString(envelope));
            record.headers().add(EventHeaders.EVENT_ID,
                    envelope.eventId().toString().getBytes(StandardCharsets.UTF_8));
            record.headers().add(EventHeaders.EVENT_TYPE,
                    envelope.eventType().getBytes(StandardCharsets.UTF_8));
            record.headers().add(EventHeaders.CORRELATION_ID,
                    envelope.correlationId().getBytes(StandardCharsets.UTF_8));
            producer.send(record).get();
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Interrupted while producing", e);
        }
        catch (Exception e) {
            throw new AssertionError("Could not produce onto " + topic, e);
        }
    }

    private static void assertHoldsFor(Duration duration, Runnable assertion) {
        long deadline = System.nanoTime() + duration.toNanos();
        do {
            assertion.run();
            try {
                Thread.sleep(100);
            }
            catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Interrupted while asserting", e);
            }
        }
        while (System.nanoTime() < deadline);
    }
}
