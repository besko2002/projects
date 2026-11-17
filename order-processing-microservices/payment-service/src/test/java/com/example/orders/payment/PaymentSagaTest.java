package com.example.orders.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.orders.common.events.EventEnvelope;
import com.example.orders.common.events.ExpirePayment;
import com.example.orders.common.events.ProcessPayment;
import com.example.orders.common.events.RefundPayment;
import com.example.orders.payment.domain.ChargeAttempt;
import com.example.orders.payment.domain.ChargeAttemptRepository;
import com.example.orders.payment.domain.Payment;
import com.example.orders.payment.domain.PaymentProvider;
import com.example.orders.payment.domain.PaymentStatus;
import com.example.orders.payment.gateway.ChargeOutcome;
import com.example.orders.payment.gateway.ChargeRequest;
import com.example.orders.payment.gateway.PaymentGateway;
import com.example.orders.payment.gateway.RefundOutcome;
import com.example.orders.payment.gateway.RefundRequest;
import com.example.orders.payment.gateway.SessionOutcome;
import com.example.orders.payment.saga.PaymentSagaTransactions;
import com.example.orders.support.idempotency.ProcessedEvents;
import com.example.orders.support.outbox.OutboxWriter;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * payment-service inside the saga: commands in on Kafka, events out on Kafka, and the
 * {@code payments} row as the evidence that the money moved exactly once.
 */
class PaymentSagaTest extends PaymentIntegrationTest {

    @Autowired
    private ChargeAttemptRepository chargeAttempts;

    @Autowired
    private TransactionTemplate transactionTemplate;

    @Autowired
    private OutboxWriter outboxWriter;

    @Autowired
    private ProcessedEvents processedEventsService;

    @Test
    void anAmountUnderTheLimitIsAuthorizedAndAnnouncedAsPaymentCompleted() {
        UUID orderId = UUID.randomUUID();
        UUID customerId = UUID.randomUUID();

        publishCommand(orderId, EventEnvelope.of("corr-pay-ok",
                new ProcessPayment(orderId, customerId, new BigDecimal("249.99"), "EUR")));

        JsonNode event = awaitPaymentEvent(orderId, "PaymentCompleted");
        Payment payment = payments.findByOrderId(orderId).orElseThrow();
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.AUTHORIZED);
        assertThat(payment.getCustomerId()).isEqualTo(customerId);
        assertThat(payment.getAmount()).isEqualByComparingTo("249.99");
        assertThat(payment.getProviderRef()).startsWith("SIM-");
        assertThat(payment.getFailureReason()).isNull();

        assertThat(event.get("payload").get("paymentId").asText()).isEqualTo(payment.getId().toString());
        assertThat(event.get("payload").get("amount").asDouble()).isEqualTo(249.99);
        assertThat(event.get("payload").get("currency").asText()).isEqualTo("EUR");
        // The correlation id of the command travels into the event it produced.
        assertThat(event.get("correlationId").asText()).isEqualTo("corr-pay-ok");
    }

    @Test
    void anAmountAboveTheLimitIsDeclinedAndAnnouncedAsPaymentFailed() {
        UUID orderId = UUID.randomUUID();

        publishCommand(orderId, EventEnvelope.of("corr-pay-declined",
                new ProcessPayment(orderId, UUID.randomUUID(), new BigDecimal("1500.00"), "EUR")));

        JsonNode event = awaitPaymentEvent(orderId, "PaymentFailed");
        Payment payment = payments.findByOrderId(orderId).orElseThrow();
        // The failed attempt is stored, not forgotten: a redelivery has to report the same outcome.
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.FAILED);
        assertThat(payment.getProviderRef()).isNull();
        assertThat(payment.getFailureReason())
                .contains("exceeds the limit of " + DECLINE_ABOVE);
        assertThat(event.get("payload").get("reason").asText()).contains("exceeds the limit");
    }

    @Test
    void aRedeliveredProcessPaymentChargesOnlyOnce() {
        UUID orderId = UUID.randomUUID();
        // The same event id twice: what the outbox relay produces when a broker acknowledgement is
        // lost after the record was already on the topic.
        EventEnvelope<ProcessPayment> command = EventEnvelope.of("corr-pay-dup",
                new ProcessPayment(orderId, UUID.randomUUID(), new BigDecimal("50.00"), "EUR"));

        publishCommand(orderId, command);
        awaitUntil(Duration.ofSeconds(45), () -> payments.findByOrderId(orderId).isPresent());
        UUID paymentId = payments.findByOrderId(orderId).orElseThrow().getId();
        publishCommand(orderId, command);

        assertHoldsFor(Duration.ofSeconds(3), () -> {
            assertThat(payments.count()).isEqualTo(1);
            assertThat(payments.findByOrderId(orderId).orElseThrow().getId()).isEqualTo(paymentId);
        });
        // One note per (event, consumer): the second delivery found it and did nothing at all.
        assertThat(processedEvents.count()).isEqualTo(1);
    }

    @Test
    void aSecondChargeCommandForTheSameOrderReportsTheStoredOutcomeInsteadOfCharging() {
        UUID orderId = UUID.randomUUID();
        UUID customerId = UUID.randomUUID();
        publishCommand(orderId, EventEnvelope.of("corr-pay-first",
                new ProcessPayment(orderId, customerId, new BigDecimal("75.00"), "EUR")));
        awaitUntil(Duration.ofSeconds(45), () -> payments.findByOrderId(orderId).isPresent());
        UUID paymentId = payments.findByOrderId(orderId).orElseThrow().getId();
        outbox.deleteAllInBatch();

        // A *different* command for the same order: a new event id, so the de-duplication log does
        // not stop it. The unique payment per order does.
        publishCommand(orderId, EventEnvelope.of("corr-pay-second",
                new ProcessPayment(orderId, customerId, new BigDecimal("75.00"), "EUR")));

        awaitUntil(Duration.ofSeconds(45), () -> !outbox.findAll().isEmpty());
        assertHoldsFor(Duration.ofSeconds(2), () -> {
            assertThat(payments.count()).isEqualTo(1);
            assertThat(payments.findByOrderId(orderId).orElseThrow().getId()).isEqualTo(paymentId);
        });
        assertThat(outbox.findAll()).allSatisfy(row ->
                assertThat(row.getEventType()).isEqualTo("PaymentCompleted"));
    }

    @Test
    void refundingAnAuthorizedPaymentAnnouncesPaymentRefunded() {
        UUID orderId = UUID.randomUUID();
        publishCommand(orderId, EventEnvelope.of("corr-refund-flow",
                new ProcessPayment(orderId, UUID.randomUUID(), new BigDecimal("120.00"), "EUR")));
        awaitUntil(Duration.ofSeconds(45), () -> payments.findByOrderId(orderId)
                .filter(Payment::isAuthorized).isPresent());
        UUID paymentId = payments.findByOrderId(orderId).orElseThrow().getId();

        publishCommand(orderId, EventEnvelope.of("corr-refund-flow", new RefundPayment(
                orderId, paymentId, new BigDecimal("120.00"), "EUR", "Cancelled by the customer")));

        JsonNode event = awaitPaymentEvent(orderId, "PaymentRefunded");
        assertThat(event.get("payload").get("paymentId").asText()).isEqualTo(paymentId.toString());
        assertThat(event.get("payload").get("reason").asText()).isEqualTo("Cancelled by the customer");
        Payment refunded = payments.findByOrderId(orderId).orElseThrow();
        assertThat(refunded.getStatus()).isEqualTo(PaymentStatus.REFUNDED);
        assertThat(refunded.getFailureReason()).isEqualTo("Cancelled by the customer");
    }

    @Test
    void refundingAFailedPaymentChangesNothingAndAnnouncesNothing() {
        UUID orderId = UUID.randomUUID();
        publishCommand(orderId, EventEnvelope.of("corr-refund-failed",
                new ProcessPayment(orderId, UUID.randomUUID(), new BigDecimal("2000.00"), "EUR")));
        awaitUntil(Duration.ofSeconds(45), () -> payments.findByOrderId(orderId).isPresent());
        UUID paymentId = payments.findByOrderId(orderId).orElseThrow().getId();

        publishCommand(orderId, EventEnvelope.of("corr-refund-failed", new RefundPayment(
                orderId, paymentId, new BigDecimal("2000.00"), "EUR", "Cancelled by the customer")));

        // There is no money to give back, and announcing a refund would tell the orchestrator that
        // something happened when nothing did.
        assertThat(findPaymentEvent(orderId, "PaymentRefunded", Duration.ofSeconds(5))).isNull();
        assertThat(payments.findByOrderId(orderId).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.FAILED);
    }

    @Test
    void refundingAnOrderThatWasNeverChargedIsASilentNoOp() {
        UUID orderId = UUID.randomUUID();

        publishCommand(orderId, EventEnvelope.of("corr-refund-unknown", new RefundPayment(
                orderId, UUID.randomUUID(), new BigDecimal("10.00"), "EUR", "timeout compensation")));

        // The orchestrator compensates without knowing how far the saga got, so this is normal.
        assertThat(findPaymentEvent(orderId, "PaymentRefunded", Duration.ofSeconds(5))).isNull();
        assertHoldsFor(Duration.ofSeconds(1), () -> assertThat(payments.count()).isZero());
    }

    @Test
    void aRedeliveredRefundDoesNotRefundTwiceButKeepsTheOrchestratorInformed() {
        UUID orderId = UUID.randomUUID();
        publishCommand(orderId, EventEnvelope.of("corr-refund-dup",
                new ProcessPayment(orderId, UUID.randomUUID(), new BigDecimal("30.00"), "EUR")));
        awaitUntil(Duration.ofSeconds(45), () -> payments.findByOrderId(orderId)
                .filter(Payment::isAuthorized).isPresent());
        UUID paymentId = payments.findByOrderId(orderId).orElseThrow().getId();

        publishCommand(orderId, EventEnvelope.of("corr-refund-dup", new RefundPayment(
                orderId, paymentId, new BigDecimal("30.00"), "EUR", "first refund")));
        awaitPaymentEvent(orderId, "PaymentRefunded");
        // A second refund command with a fresh event id: the payment is already refunded, so the
        // state must not change, while the confirmation is repeated for an orchestrator that may
        // still be waiting for it.
        publishCommand(orderId, EventEnvelope.of("corr-refund-dup-2", new RefundPayment(
                orderId, paymentId, new BigDecimal("30.00"), "EUR", "second refund")));

        awaitUntil(Duration.ofSeconds(45), () -> outbox.findAll().stream()
                .filter(row -> "PaymentRefunded".equals(row.getEventType()))
                .count() == 2);
        Payment payment = payments.findByOrderId(orderId).orElseThrow();
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.REFUNDED);
        assertThat(payment.getFailureReason()).isEqualTo("first refund");
    }

    @Test
    void anEventTypeThatIsNotAPaymentCommandIsIgnored() {
        UUID orderId = UUID.randomUUID();

        publishCommand(orderId, EventEnvelope.of("corr-ignored",
                new com.example.orders.common.events.CommitStock(orderId)));

        assertHoldsFor(Duration.ofSeconds(2), () -> assertThat(payments.count()).isZero());
    }

    // ------------------------------------------------------------------ abandoned checkouts

    /**
     * The saga gave up on a checkout the customer never finished: the session is closed at the
     * provider and nothing is announced — the order is already cancelled when the expiry command
     * is queued, and a failure event for a cancelled order would be dead letter noise.
     */
    @Test
    void anAbandonedCheckoutIsClosedSilentlyByTheExpiryCommand() {
        Payment payment = givenAwaitingStripePayment("cs_abandoned");
        UUID orderId = payment.getOrderId();

        publishCommand(orderId, EventEnvelope.of("corr-expire-abandoned",
                new ExpirePayment(orderId, payment.getId(), "Checkout abandoned after the timeout")));

        awaitUntil(Duration.ofSeconds(45), () -> payments.findByOrderId(orderId)
                .map(Payment::getStatus).filter(PaymentStatus.FAILED::equals).isPresent());
        Payment failed = payments.findByOrderId(orderId).orElseThrow();
        assertThat(failed.getFailureReason()).contains("Checkout abandoned");
        // No announcement of any kind: no money moved, and the order no longer listens.
        assertThat(findPaymentEvent(orderId, "PaymentFailed", Duration.ofSeconds(3))).isNull();
        assertThat(findPaymentEvent(orderId, "PaymentRefunded", Duration.ofSeconds(1))).isNull();
        assertThat(outbox.findAll()).isEmpty();
    }

    /**
     * The customer paid at the very moment the saga gave up: the close of the session reports the
     * payment as already completed, so the row is completed — never failed for money that was
     * taken — and the completion is announced so the orchestrator's compensation refunds the
     * customer. The refund is then announced exactly once, and a provider-side confirmation of
     * that same refund (the {@code charge.refunded} webhook, covered in
     * {@link PaymentWebhookTest}) must never announce it twice.
     */
    @Test
    void aCustomerWhoPaysAsTheSessionIsClosedIsCompletedAndRefundedExactlyOnce() {
        Payment payment = givenAwaitingStripePayment("cs_just-paid");
        UUID orderId = payment.getOrderId();

        // A gateway that answers like Stripe does when the completion races the close.
        PaymentGateway justPaid = new PaymentGateway() {
            @Override
            public String provider() {
                return "STRIPE";
            }

            @Override
            public ChargeOutcome charge(ChargeRequest request) {
                throw new AssertionError("not used in this test");
            }

            @Override
            public SessionOutcome expireSession(String sessionId) {
                return new SessionOutcome.AlreadyCompleted("pi_just-paid");
            }

            @Override
            public RefundOutcome refund(RefundRequest request) {
                return new RefundOutcome.Refunded("re_just-paid");
            }
        };
        new PaymentSagaTransactions(payments, chargeAttempts, justPaid, outboxWriter,
                processedEventsService, transactionTemplate, java.time.Duration.ofMinutes(30))
                .onExpirePayment(UUID.randomUUID(),
                        new ExpirePayment(orderId, payment.getId(), "Checkout abandoned"));

        // The money was taken, so the row is completed — and the completion is announced.
        Payment completed = payments.findByOrderId(orderId).orElseThrow();
        assertThat(completed.getStatus()).isEqualTo(PaymentStatus.AUTHORIZED);
        assertThat(completed.getProviderRef()).isEqualTo("pi_just-paid");
        assertThat(outbox.findAll()).anySatisfy(row -> {
            assertThat(row.getEventType()).isEqualTo("PaymentCompleted");
            assertThat(row.getAggregateId()).isEqualTo(orderId);
        });

        // The orchestrator's answer to a completion for a cancelled order: refund.
        publishCommand(orderId, EventEnvelope.of("corr-late-refund", new RefundPayment(
                orderId, payment.getId(), payment.getAmount(), "EUR", "Late payment refunded")));
        awaitPaymentEvent(orderId, "PaymentRefunded");

        assertThat(payments.findByOrderId(orderId).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.REFUNDED);
        assertThat(outbox.findAll().stream()
                .filter(row -> "PaymentRefunded".equals(row.getEventType()))
                .filter(row -> row.getAggregateId().equals(orderId))
                .count()).isEqualTo(1);
    }

    // ------------------------------------------------------------------ charge attempts (PAY-3)

    /**
     * The charge of a Stripe checkout whose provider call is lost must be recoverable, and the
     * recovery must be safe: the attempt's identity and request parameters are persisted
     * <em>before</em> the first ask, so the retry reaches the <em>same</em> session with the
     * <em>same</em> idempotency key and expiry — the key derived from the command that opened the
     * attempt, not from whichever redelivery happens to be asking. Stripe then replays its first
     * answer instead of refusing the changed request or minting a second payable checkout.
     */
    @Test
    void aLostChargeResponseIsRetriedWithTheSameIdentityAndParameters() {
        UUID orderId = UUID.randomUUID();
        UUID customerId = UUID.randomUUID();
        List<ChargeRequest> asks = new ArrayList<>();
        AtomicInteger call = new AtomicInteger();
        PaymentGateway lostOnce = new PaymentGateway() {
            @Override
            public String provider() {
                return "STRIPE";
            }

            @Override
            public ChargeOutcome charge(ChargeRequest request) {
                asks.add(request);
                if (call.incrementAndGet() == 1) {
                    return new ChargeOutcome.Unavailable("connection reset before the answer");
                }
                return new ChargeOutcome.AwaitingCustomer("cs_recovered",
                        "https://checkout.stripe.com/pay/cs_recovered", request.expiresAt());
            }

            @Override
            public SessionOutcome expireSession(String sessionId) {
                throw new AssertionError("not used in this test");
            }

            @Override
            public RefundOutcome refund(RefundRequest request) {
                throw new AssertionError("not used in this test");
            }
        };
        PaymentSagaTransactions saga = new PaymentSagaTransactions(payments, chargeAttempts,
                lostOnce, outboxWriter, processedEventsService, transactionTemplate,
                Duration.ofMinutes(30));

        UUID openingCommandId = UUID.randomUUID();
        // First ask: the provider could not be asked, so nothing may be decided and the command
        // must stay un-marked, ready for its redelivery.
        assertThatThrownBy(() -> saga.onProcessPayment(openingCommandId,
                new ProcessPayment(orderId, customerId, new BigDecimal("59.00"), "EUR")))
                .isInstanceOf(IllegalStateException.class);
        assertThat(payments.count()).isZero();
        assertThat(processedEvents.count()).isZero();
        assertThat(chargeAttempts.findById(orderId).orElseThrow().getAttempts()).isEqualTo(1);

        // The retry: a redelivery of the command — here even modelled as a *different* command
        // with a fresh event id, the harshest version. It must reach the same session.
        UUID redeliveredCommandId = UUID.randomUUID();
        saga.onProcessPayment(redeliveredCommandId,
                new ProcessPayment(orderId, customerId, new BigDecimal("59.00"), "EUR"));

        assertThat(asks).hasSize(2);
        ChargeAttempt attempt = chargeAttempts.findById(orderId).orElseThrow();
        String openingKey = "charge:" + openingCommandId;
        assertThat(asks.get(0).idempotencyKey()).isEqualTo(openingKey);
        // Not the redelivery's own event id: the key belongs to the attempt.
        assertThat(asks.get(1).idempotencyKey()).isEqualTo(openingKey);
        assertThat(asks.get(1).paymentId()).isEqualTo(asks.get(0).paymentId());
        assertThat(asks.get(1).expiresAt()).isEqualTo(asks.get(0).expiresAt());
        assertThat(attempt.getAttempts()).isEqualTo(2);

        // The recovered answer is recorded under the attempt's identity and announced.
        Payment payment = payments.findByOrderId(orderId).orElseThrow();
        assertThat(payment.getId()).isEqualTo(attempt.getPaymentId());
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.AWAITING_CUSTOMER);
        assertThat(payment.getCheckoutSessionId()).isEqualTo("cs_recovered");
        assertThat(payment.getCheckoutExpiresAt()).isEqualTo(attempt.getExpiresAt());
        assertThat(outbox.findAll()).anySatisfy(row -> {
            assertThat(row.getEventType()).isEqualTo("PaymentAwaitingCustomer");
            assertThat(row.getAggregateId()).isEqualTo(orderId);
        });
    }

    /**
     * Two commands raced for one order and the loser's insert lost the primary-key race: the
     * loser adopts the winner's attempt — its identity, its idempotency key, its expiry — so two
     * commands can never mint two sessions for one order.
     */
    @Test
    void aLaterCommandAdoptsTheAttemptAnEarlierDeliveryOpened() {
        UUID orderId = UUID.randomUUID();
        UUID winnerEventId = UUID.randomUUID();
        UUID winnerPaymentId = UUID.randomUUID();
        OffsetDateTime winnerExpiry = OffsetDateTime.now(ZoneOffset.UTC).plus(Duration.ofMinutes(30));
        chargeAttempts.saveAndFlush(
                ChargeAttempt.first(orderId, winnerEventId, winnerPaymentId, winnerExpiry));

        List<ChargeRequest> asks = new ArrayList<>();
        PaymentGateway recorder = new PaymentGateway() {
            @Override
            public String provider() {
                return "STRIPE";
            }

            @Override
            public ChargeOutcome charge(ChargeRequest request) {
                asks.add(request);
                return new ChargeOutcome.AwaitingCustomer("cs_adopted",
                        "https://checkout.stripe.com/pay/cs_adopted", request.expiresAt());
            }

            @Override
            public SessionOutcome expireSession(String sessionId) {
                throw new AssertionError("not used in this test");
            }

            @Override
            public RefundOutcome refund(RefundRequest request) {
                throw new AssertionError("not used in this test");
            }
        };
        PaymentSagaTransactions saga = new PaymentSagaTransactions(payments, chargeAttempts,
                recorder, outboxWriter, processedEventsService, transactionTemplate,
                Duration.ofMinutes(30));

        // A command with its own, different event id must not open a second attempt.
        saga.onProcessPayment(UUID.randomUUID(),
                new ProcessPayment(orderId, UUID.randomUUID(), new BigDecimal("10.00"), "EUR"));

        assertThat(asks).hasSize(1);
        assertThat(asks.get(0).idempotencyKey()).isEqualTo("charge:" + winnerEventId);
        assertThat(asks.get(0).paymentId()).isEqualTo(winnerPaymentId);
        assertThat(asks.get(0).expiresAt()).isEqualTo(winnerExpiry);
        assertThat(chargeAttempts.count()).isEqualTo(1);
        assertThat(chargeAttempts.findById(orderId).orElseThrow().getAttempts()).isEqualTo(1);
        Payment payment = payments.findByOrderId(orderId).orElseThrow();
        assertThat(payment.getId()).isEqualTo(winnerPaymentId);
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.AWAITING_CUSTOMER);
    }

    /**
     * A provider that cannot be asked at all (an outage, missing keys) is retried a bounded
     * number of times — each retry re-using the persisted attempt, so an ask that Stripe actually
     * accepted is never thrown away — and then recorded as an <em>honest</em> failure: the money
     * verdict is an answer (or the absence of one, stated as such), never a silent success.
     */
    @Test
    void aProviderThatCannotBeAskedIsRetriedBoundedAndThenRecordedAsAnHonestFailure() {
        UUID orderId = UUID.randomUUID();
        List<ChargeRequest> asks = new ArrayList<>();
        PaymentGateway down = new PaymentGateway() {
            @Override
            public String provider() {
                return "STRIPE";
            }

            @Override
            public ChargeOutcome charge(ChargeRequest request) {
                asks.add(request);
                return new ChargeOutcome.Unavailable("the provider is unreachable");
            }

            @Override
            public SessionOutcome expireSession(String sessionId) {
                throw new AssertionError("not used in this test");
            }

            @Override
            public RefundOutcome refund(RefundRequest request) {
                throw new AssertionError("not used in this test");
            }
        };
        PaymentSagaTransactions saga = new PaymentSagaTransactions(payments, chargeAttempts,
                down, outboxWriter, processedEventsService, transactionTemplate,
                Duration.ofMinutes(30));
        UUID eventId = UUID.randomUUID();
        ProcessPayment command = new ProcessPayment(orderId, UUID.randomUUID(),
                new BigDecimal("11.00"), "EUR");

        // Ask 1 and 2: the command is thrown back to Kafka, nothing recorded, nothing marked.
        assertThatThrownBy(() -> saga.onProcessPayment(eventId, command))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> saga.onProcessPayment(eventId, command))
                .isInstanceOf(IllegalStateException.class);
        assertThat(payments.count()).isZero();
        assertThat(processedEvents.count()).isZero();
        assertThat(asks).hasSize(2);

        // Ask 3: the bound (MAX_UNAVAILABLE_ASKS = 3) is reached, so the attempt is recorded as
        // the honest failure it is, the verdict is announced and the command is marked processed.
        saga.onProcessPayment(eventId, command);

        assertThat(asks).hasSize(3);
        assertThat(chargeAttempts.findById(orderId).orElseThrow().getAttempts()).isEqualTo(3);
        Payment failed = payments.findByOrderId(orderId).orElseThrow();
        assertThat(failed.getStatus()).isEqualTo(PaymentStatus.FAILED);
        assertThat(failed.getFailureReason()).contains("the provider is unreachable");
        assertThat(outbox.findAll()).anySatisfy(row -> {
            assertThat(row.getEventType()).isEqualTo("PaymentFailed");
            assertThat(row.getAggregateId()).isEqualTo(orderId);
        });
        assertThat(processedEvents.count()).isEqualTo(1);
        // And a further redelivery of the same command finds the stored answer instead of
        // asking the (still down) provider again.
        saga.onProcessPayment(eventId, command);
        assertThat(asks).hasSize(3);
    }

    // ------------------------------------------------------------------ helpers

    /**
     * @param sessionId the hosted checkout session id
     * @return a stored {@code AWAITING_CUSTOMER} payment of the Stripe provider, as the real
     *         gateway would have left it
     */
    private Payment givenAwaitingStripePayment(String sessionId) {
        return payments.saveAndFlush(Payment.awaitingCustomer(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), new BigDecimal("49.90"),
                "EUR", PaymentProvider.STRIPE, sessionId,
                "https://checkout.stripe.com/pay/" + sessionId,
                OffsetDateTime.now().plusMinutes(30)));
    }
}
