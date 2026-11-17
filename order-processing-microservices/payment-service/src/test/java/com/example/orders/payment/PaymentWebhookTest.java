package com.example.orders.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.orders.common.events.Topics;
import com.example.orders.payment.domain.Payment;
import com.example.orders.payment.domain.PaymentProvider;
import com.example.orders.payment.domain.PaymentStatus;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/**
 * The Stripe webhook endpoint: the provider's verdicts arrive here, verified by signature instead
 * of a JWT. Every delivery is authenticated against {@link PaymentIntegrationTest#WEBHOOK_SECRET}
 * before it may touch a row — and the cases below cover the ways a hostile or merely late
 * delivery must not be able to move a payment backwards, or make the saga announce the same
 * verdict twice.
 *
 * <p>They also pin the hosted-checkout semantics the 17 Nov 2026 review demanded
 * ({@code PAY-2}): a declined attempt is <em>retriable</em> bookkeeping on a still-open checkout —
 * the row stays awaiting, nothing is announced, and the very same session completes when the
 * customer retries — and a completion is only credited when the session's amount and currency are
 * the ones this service asked for.
 */
class PaymentWebhookTest extends PaymentIntegrationTest {

    private static final String WEBHOOK_PATH = "/api/payments/stripe/webhook";

    /** Distinct Stripe event ids across the whole class, in a readable {@code evt_test_N} shape. */
    private static final AtomicLong EVENT_COUNTER = new AtomicLong();

    // ------------------------------------------------------------------ authentication

    @Test
    void aDeliveryWithoutASignatureIsRejected() throws Exception {
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .content(sessionCompletedPayload("evt_no-sig", "cs_no-sig", "pi_no-sig", "paid")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void aDeliverySignedWithADifferentSecretIsRejected() throws Exception {
        String payload = sessionCompletedPayload("evt_wrong-secret", "cs_wrong-secret",
                "pi_wrong-secret", "paid");
        // Signed by "somebody else": same scheme, wrong key. Nothing may change.
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, "whsec_not_our_secret"))
                        .content(payload))
                .andExpect(status().isBadRequest());
        assertThat(payments.count()).isZero();
    }

    @Test
    void aDeliverySignedLongAgoIsRejected() throws Exception {
        String payload = sessionCompletedPayload("evt_stale", "cs_stale", "pi_stale", "paid");
        long tenMinutesAgo = Instant.now().getEpochSecond() - 600;
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET, tenMinutesAgo))
                        .content(payload))
                .andExpect(status().isBadRequest());
        assertThat(payments.count()).isZero();
    }

    @Test
    void anUnreadableBodyIsRejectedEvenWithAValidSignature() throws Exception {
        // The signature is over "not json" itself, so authentication passes — the body is still
        // refused, because a payload this server cannot read must not change any state.
        String payload = "not json";
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isBadRequest());
        assertThat(payments.count()).isZero();
    }

    // ------------------------------------------------------------------ completion

    @Test
    void aPaidCheckoutSessionCompletesThePaymentAndAnnouncesIt() throws Exception {
        Payment payment = givenAwaitingStripePayment("cs_paid");
        String payload = sessionCompletedPayload(nextEventId(), "cs_paid", "pi_paid", "paid");

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"));

        Payment completed = payments.findByOrderId(payment.getOrderId()).orElseThrow();
        assertThat(completed.getStatus()).isEqualTo(PaymentStatus.AUTHORIZED);
        assertThat(completed.getProviderRef()).isEqualTo("pi_paid");
        assertThat(outbox.findAll()).anySatisfy(row -> {
            assertThat(row.getEventType()).isEqualTo("PaymentCompleted");
            assertThat(row.getAggregateId()).isEqualTo(payment.getOrderId());
        });
    }

    @Test
    void aRedeliveredCompletionChangesNothingAndAnnouncesNothingTwice() throws Exception {
        Payment payment = givenAwaitingStripePayment("cs_redelivery");
        String payload = sessionCompletedPayload(nextEventId(), "cs_redelivery", "pi_redelivery", "paid");

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"));
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("DUPLICATE"));

        assertThat(outbox.findAll().stream()
                .filter(row -> "PaymentCompleted".equals(row.getEventType()))
                .filter(row -> row.getAggregateId().equals(payment.getOrderId()))
                .count()).isEqualTo(1);
    }

    @Test
    void aCompletionForASessionThisServiceNeverOpenedIsIgnored() throws Exception {
        String payload = sessionCompletedPayload(nextEventId(), "cs_unknown-session",
                "pi_unknown-session", "paid");

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("UNKNOWN_PAYMENT"));

        assertThat(payments.count()).isZero();
        assertThat(outbox.findAll()).isEmpty();
    }

    @Test
    void aCompletedSessionWithoutAPaidPaymentStatusKeepsThePaymentWaiting() throws Exception {
        // checkout.session.completed also fires for asynchronous methods with payment_status
        // "unpaid"; the money is not here yet, so the row must stay open.
        Payment payment = givenAwaitingStripePayment("cs_unpaid");
        String payload = sessionCompletedPayload(nextEventId(), "cs_unpaid", "pi_unpaid", "unpaid");

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("NOT_PAID"));

        assertThat(payments.findByOrderId(payment.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.AWAITING_CUSTOMER);
        assertThat(outbox.findAll()).isEmpty();
    }

    // ------------------------------------------------------------------ out-of-order deliveries

    @Test
    void anExpiryArrivingAfterThePaymentWasCompletedMovesNothingBackwards() throws Exception {
        Payment payment = givenAwaitingStripePayment("cs_late-expiry");
        complete("cs_late-expiry", "pi_late-expiry");
        outbox.deleteAllInBatch();

        String payload = sessionExpiredPayload(nextEventId(), "cs_late-expiry");
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("ALREADY_COMPLETED"));

        assertThat(payments.findByOrderId(payment.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.AUTHORIZED);
        assertThat(outbox.findAll()).isEmpty();
    }

    @Test
    void aCompletionArrivingAfterTheRefundMovesNothingBackwards() throws Exception {
        Payment payment = givenAwaitingStripePayment("cs_late-completion");
        complete("cs_late-completion", "pi_late-completion");
        refundByProviderEvent("pi_late-completion");
        outbox.deleteAllInBatch();

        String payload = sessionCompletedPayload(nextEventId(), "cs_late-completion",
                "pi_late-completion", "paid");
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("ALREADY_REFUNDED"));

        assertThat(payments.findByOrderId(payment.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.REFUNDED);
        assertThat(outbox.findAll()).isEmpty();
    }

    // ------------------------------------------------------------------ failures

    @Test
    void aFailedAttemptOnAnOpenCheckoutIsRecordedButKeepsThePaymentWaiting() throws Exception {
        // PAY-2: a declined card does not close a Checkout Session — the same session completes
        // when the customer retries. The row stays awaiting, only the attempt's reason is kept,
        // and nothing is announced: the saga must keep waiting for the customer it still has.
        Payment payment = givenAwaitingStripePayment("cs_attempt-failed");
        String payload = intentFailedPayload(nextEventId(), "pi_attempt-failed",
                payment.getOrderId(), "Your card was declined.");

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("ATTEMPT_FAILED"));

        Payment stillOpen = payments.findByOrderId(payment.getOrderId()).orElseThrow();
        assertThat(stillOpen.getStatus()).isEqualTo(PaymentStatus.AWAITING_CUSTOMER);
        assertThat(stillOpen.getFailureReason()).contains("declined");
        assertThat(outbox.findAll()).isEmpty();
    }

    @Test
    void aCompletionAfterAFailedAttemptStillCompletesAndClearsTheAttempt() throws Exception {
        Payment payment = givenAwaitingStripePayment("cs_retry-then-paid");
        String attempt = intentFailedPayload(nextEventId(), "pi_retry-then-paid",
                payment.getOrderId(), "Your card was declined.");
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(attempt, WEBHOOK_SECRET))
                        .content(attempt))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("ATTEMPT_FAILED"));

        // The customer retries with a working card: the very same session completes.
        String payload = sessionCompletedPayload(nextEventId(), "cs_retry-then-paid",
                "pi_retry-then-paid", "paid");
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"));

        Payment completed = payments.findByOrderId(payment.getOrderId()).orElseThrow();
        assertThat(completed.getStatus()).isEqualTo(PaymentStatus.AUTHORIZED);
        assertThat(completed.getProviderRef()).isEqualTo("pi_retry-then-paid");
        // The attempt's reason described a card that is no longer the answer.
        assertThat(completed.getFailureReason()).isNull();
        assertThat(outbox.findAll().stream()
                .filter(row -> row.getAggregateId().equals(payment.getOrderId()))
                .map(row -> row.getEventType())
                .toList()).containsExactly("PaymentCompleted");
    }

    @Test
    void aFailedAttemptForAnAlreadyCompletedPaymentMovesNothing() throws Exception {
        // Out-of-order delivery: the attempt failure says "declined" of a payment that has since
        // been completed. The stored state speaks for itself; the row must not reopen.
        Payment payment = givenAwaitingStripePayment("cs_late-attempt");
        complete("cs_late-attempt", "pi_late-attempt");
        outbox.deleteAllInBatch();

        String payload = intentFailedPayload(nextEventId(), "pi_late-attempt",
                payment.getOrderId(), "Your card was declined.");
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("ALREADY_COMPLETED"));

        assertThat(payments.findByOrderId(payment.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.AUTHORIZED);
        assertThat(outbox.findAll()).isEmpty();
    }

    @Test
    void aFailedPaymentIntentForASimulatedPaymentIsIgnored() throws Exception {
        // payment_intent.payment_failed is matched through the orderId metadata and only ever
        // touches rows of the Stripe provider: a real provider's delivery must not fail a payment
        // the simulated one authorised.
        Payment simulated = payments.saveAndFlush(Payment.authorized(
                UUID.randomUUID(), UUID.randomUUID(), new BigDecimal("9.99"), "EUR",
                PaymentProvider.SIMULATED, "SIM-TESTREF"));

        String payload = intentFailedPayload(nextEventId(), "pi_simulated",
                simulated.getOrderId(), "Your card was declined.");
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("UNKNOWN_PAYMENT"));

        assertThat(payments.findByOrderId(simulated.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.AUTHORIZED);
    }

    @Test
    void anExpiredSessionFailsThePayment() throws Exception {
        Payment payment = givenAwaitingStripePayment("cs_expired");

        String payload = sessionExpiredPayload(nextEventId(), "cs_expired");
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"));

        Payment failed = payments.findByOrderId(payment.getOrderId()).orElseThrow();
        assertThat(failed.getStatus()).isEqualTo(PaymentStatus.FAILED);
        assertThat(outbox.findAll()).anySatisfy(row ->
                assertThat(row.getEventType()).isEqualTo("PaymentFailed"));
    }

    // ------------------------------------------------------------------ amount and currency

    @Test
    void aCompletionInADifferentCurrencyIsRefused() throws Exception {
        // A session paying in another currency (a tampered or foreign session under the same
        // account) must never credit this ledger.
        Payment payment = givenAwaitingStripePayment("cs_wrong-currency");
        String payload = sessionCompletedPayload(nextEventId(), "cs_wrong-currency",
                "pi_wrong-currency", "paid", "usd", 9900L);

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("AMOUNT_MISMATCH"));

        Payment untouched = payments.findByOrderId(payment.getOrderId()).orElseThrow();
        assertThat(untouched.getStatus()).isEqualTo(PaymentStatus.AWAITING_CUSTOMER);
        assertThat(untouched.getProviderRef()).isNull();
        assertThat(outbox.findAll()).isEmpty();
    }

    @Test
    void aCompletionPayingADifferentAmountIsRefused() throws Exception {
        Payment payment = givenAwaitingStripePayment("cs_wrong-amount");
        // The row asks for EUR 99.00 = 9900 minor units; the session reports 100.00.
        String payload = sessionCompletedPayload(nextEventId(), "cs_wrong-amount",
                "pi_wrong-amount", "paid", "eur", 10000L);

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("AMOUNT_MISMATCH"));

        assertThat(payments.findByOrderId(payment.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.AWAITING_CUSTOMER);
        assertThat(outbox.findAll()).isEmpty();
    }

    @Test
    void aCompletionPayingExactlyTheAskedAmountCompletes() throws Exception {
        // The agreeing case of the same check, in the currency's own minor units.
        Payment payment = givenAwaitingStripePayment("cs_right-amount");
        String payload = sessionCompletedPayload(nextEventId(), "cs_right-amount",
                "pi_right-amount", "paid", "eur", 9900L);

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"));

        assertThat(payments.findByOrderId(payment.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.AUTHORIZED);
    }

    @Test
    void aCompletionOfAZeroFractionCurrencyComparesInItsOwnMinorUnits() throws Exception {
        // JPY has no fraction digits: 1000 JPY is 1000 minor units, not 100000. The comparison
        // must use the currency's own scale, the same conversion the gateway charges with.
        Payment payment = payments.saveAndFlush(Payment.awaitingCustomer(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), new BigDecimal("1000"),
                "JPY", PaymentProvider.STRIPE, "cs_yen", "https://checkout.stripe.com/test",
                OffsetDateTime.now().plusMinutes(30)));
        String payload = sessionCompletedPayload(nextEventId(), "cs_yen", "pi_yen", "paid",
                "jpy", 1000L);

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"));

        assertThat(payments.findByOrderId(payment.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.AUTHORIZED);
    }

    // ------------------------------------------------------------------ refunds

    @Test
    void aFullRefundConfirmationClosesTheLedgerRowExactlyOnce() throws Exception {
        Payment payment = givenAuthorizedStripePayment("pi_refunded-once", "99.00");

        String payload = chargeRefundedPayload(nextEventId(), "pi_refunded-once", 9900L, 9900L);
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("APPLIED"));
        // Stripe redelivers; the ledger must not move again.
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("DUPLICATE"));

        assertThat(payments.findByOrderId(payment.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.REFUNDED);
        assertThat(outbox.findAll().stream()
                .filter(row -> "PaymentRefunded".equals(row.getEventType()))
                .filter(row -> row.getAggregateId().equals(payment.getOrderId()))
                .count()).isEqualTo(1);
    }

    @Test
    void aPartialRefundConfirmationChangesNothing() throws Exception {
        // This service only issues full refunds; a partial one (someone clicked in the dashboard)
        // is reported and ignored, because flipping the row to REFUNDED would be a lie.
        Payment payment = givenAuthorizedStripePayment("pi_partial", "50.00");

        String payload = chargeRefundedPayload(nextEventId(), "pi_partial", 5000L, 2000L);
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("PARTIAL_REFUND_IGNORED"));

        assertThat(payments.findByOrderId(payment.getOrderId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.AUTHORIZED);
        assertThat(outbox.findAll()).isEmpty();
    }

    @Test
    void aRefundForAnUnknownChargeIsIgnored() throws Exception {
        String payload = chargeRefundedPayload(nextEventId(), "pi_no-such-charge", 1000L, 1000L);
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("UNKNOWN_PAYMENT"));
        assertThat(payments.count()).isZero();
    }

    // ------------------------------------------------------------------ catch-all

    @Test
    void anEventTypeThisServiceDoesNotActOnIsAcceptedAndIgnored() throws Exception {
        Map<String, Object> object = Map.of("object", "balance");
        Map<String, Object> data = Map.of("object", object);
        Map<String, Object> envelope = Map.of(
                "id", nextEventId(),
                "type", "balance.available",
                "data", data);
        String payload = json(envelope);

        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("IGNORED"));
        assertThat(payments.count()).isZero();
    }

    // ------------------------------------------------------------------ helpers

    private void complete(String sessionId, String paymentIntentId) throws Exception {
        String payload = sessionCompletedPayload(nextEventId(), sessionId, paymentIntentId, "paid");
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());
    }

    private void refundByProviderEvent(String paymentIntentId) throws Exception {
        String payload = chargeRefundedPayload(nextEventId(), paymentIntentId, 9900L, 9900L);
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());
    }

    private Payment givenAwaitingStripePayment(String sessionId) {
        return payments.saveAndFlush(Payment.awaitingCustomer(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), new BigDecimal("99.00"),
                "EUR", PaymentProvider.STRIPE, sessionId, "https://checkout.stripe.com/test",
                OffsetDateTime.now().plusMinutes(30)));
    }

    private Payment givenAuthorizedStripePayment(String paymentIntentId, String amount) {
        return payments.saveAndFlush(Payment.authorized(
                UUID.randomUUID(), UUID.randomUUID(), new BigDecimal(amount), "EUR",
                PaymentProvider.STRIPE, paymentIntentId));
    }

    private String sessionCompletedPayload(String eventId, String sessionId, String paymentIntentId,
            String paymentStatus) {
        return json(Map.of(
                "id", eventId,
                "type", "checkout.session.completed",
                "data", Map.of("object", sessionObject(sessionId, paymentIntentId, paymentStatus))));
    }

    /**
     * Same payload with the session's currency (lower-case, as Stripe sends it) and total in minor
     * units present — the fields the service validates the completion against.
     */
    private String sessionCompletedPayload(String eventId, String sessionId, String paymentIntentId,
            String paymentStatus, String currency, Long amountMinorUnits) {
        return json(Map.of(
                "id", eventId,
                "type", "checkout.session.completed",
                "data", Map.of("object", sessionObject(sessionId, paymentIntentId, paymentStatus,
                        currency, amountMinorUnits))));
    }

    private Map<String, Object> sessionObject(String sessionId, String paymentIntentId,
            String paymentStatus) {
        return sessionObject(sessionId, paymentIntentId, paymentStatus, null, null);
    }

    private Map<String, Object> sessionObject(String sessionId, String paymentIntentId,
            String paymentStatus, String currency, Long amountMinorUnits) {
        Map<String, Object> object = new LinkedHashMap<>();
        object.put("object", "checkout.session");
        object.put("id", sessionId);
        object.put("payment_status", paymentStatus);
        if (currency != null) {
            object.put("currency", currency);
        }
        if (amountMinorUnits != null) {
            object.put("amount_total", amountMinorUnits);
        }
        if (paymentIntentId != null) {
            object.put("payment_intent", paymentIntentId);
        }
        return object;
    }

    private String sessionExpiredPayload(String eventId, String sessionId) {
        return json(Map.of(
                "id", eventId,
                "type", "checkout.session.expired",
                "data", Map.of("object", Map.of(
                        "object", "checkout.session",
                        "id", sessionId))));
    }

    private String intentFailedPayload(String eventId, String paymentIntentId, UUID orderId,
            String message) {
        return json(Map.of(
                "id", eventId,
                "type", "payment_intent.payment_failed",
                "data", Map.of("object", Map.of(
                        "object", "payment_intent",
                        "id", paymentIntentId,
                        "metadata", Map.of("orderId", orderId.toString()),
                        "last_payment_error", Map.of("message", message)))));
    }

    private String chargeRefundedPayload(String eventId, String paymentIntentId, Long amount,
            Long amountRefunded) {
        return json(Map.of(
                "id", eventId,
                "type", "charge.refunded",
                "data", Map.of("object", Map.of(
                        "object", "charge",
                        "payment_intent", paymentIntentId,
                        "amount", amount,
                        "amount_refunded", amountRefunded))));
    }

    private String json(Object body) {
        try {
            return json.writeValueAsString(body);
        }
        catch (Exception e) {
            throw new IllegalStateException("Could not build a webhook payload", e);
        }
    }

    private String nextEventId() {
        return "evt_test_" + EVENT_COUNTER.incrementAndGet();
    }

    /**
     * Signs like Stripe does: an HMAC-SHA256 over {@code "<timestamp>.<body>"}, in the
     * {@code t=...,v1=...} header scheme. {@link PaymentIntegrationTest#WEBHOOK_SECRET} is the
     * secret the endpoint is configured with in these tests.
     */
    private static String signature(String payload, String secret) {
        return signature(payload, secret, Instant.now().getEpochSecond());
    }

    private static String signature(String payload, String secret, long timestampSeconds) {
        String signed = timestampSeconds + "." + payload;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String v1 = HexFormat.of().formatHex(mac.doFinal(signed.getBytes(StandardCharsets.UTF_8)));
            return "t=" + timestampSeconds + ",v1=" + v1;
        }
        catch (Exception e) {
            throw new IllegalStateException("Could not sign a webhook delivery", e);
        }
    }
}
