package com.example.orders.payment.webhook;

import com.example.orders.common.events.PaymentCompleted;
import com.example.orders.common.events.PaymentFailed;
import com.example.orders.common.events.PaymentRefunded;
import com.example.orders.common.events.Topics;
import com.example.orders.payment.domain.Payment;
import com.example.orders.payment.domain.PaymentProvider;
import com.example.orders.payment.domain.PaymentRepository;
import com.example.orders.payment.domain.PaymentStatus;
import com.example.orders.payment.domain.StripeWebhookEventRepository;
import com.example.orders.support.outbox.OutboxWriter;
import java.math.RoundingMode;
import java.util.Currency;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Applies a verified Stripe delivery to this service's ledger, and announces what changed to the
 * saga through the outbox — exactly like a command would, because from order-service's point of
 * view the webhook <em>is</em> the provider's answer.
 *
 * <p>Idempotent twice over, because Stripe redelivers and because deliveries can arrive out of
 * order:
 * <ol>
 *   <li>the {@code stripe_webhook_events} note claims the event id in the same transaction as the
 *       work, so a redelivery is recognised before anything is touched;</li>
 *   <li>every state transition is guarded by the payment's current status, so a late or repeated
 *       delivery can never move a payment backwards (a completed payment is never re-opened, a
 *       refunded one never refunded again).</li>
 * </ol>
 *
 * <p>The verdicts are the same shape the saga knows:
 * {@code checkout.session.completed} → {@code PaymentCompleted} (only when the session was
 * <em>paid</em>, and only for the amount and currency this service asked for),
 * {@code checkout.session.expired} → {@code PaymentFailed}, and {@code charge.refunded} confirms a
 * refund (usually one this service already recorded synchronously — the delivery then changes
 * nothing, which is the point). {@code payment_intent.payment_failed} is deliberately
 * <em>not</em> a verdict for a card checkout ({@code PAY-2}): a declined attempt leaves the session
 * open and the customer may retry their card, so the row stays awaiting and only the attempt's
 * reason is recorded — the session's completion, expiry or the saga's timeout remain in charge of
 * the verdict.
 */
@Service
public class StripeWebhookService {

    private static final Logger log = LoggerFactory.getLogger(StripeWebhookService.class);

    private final PaymentRepository payments;
    private final StripeWebhookEventRepository webhookEvents;
    private final OutboxWriter outbox;

    StripeWebhookService(
            PaymentRepository payments,
            StripeWebhookEventRepository webhookEvents,
            OutboxWriter outbox) {
        this.payments = payments;
        this.webhookEvents = webhookEvents;
        this.outbox = outbox;
    }

    /**
     * Applies one verified delivery.
     *
     * @param event the verified event
     * @return what happened, for the response body: {@code APPLIED}, {@code DUPLICATE},
     *         {@code IGNORED}, {@code UNKNOWN_PAYMENT}, {@code ALREADY_*} for idempotent replays,
     *         or {@code NOT_PAID} for a completion of a session the customer did not finish paying
     */
    @Transactional
    public String apply(StripeEvent event) {
        if (!webhookEvents.claim(event.eventId(), event.type())) {
            log.info("Stripe event {} was already applied, ignoring the redelivery", event.eventId());
            return "DUPLICATE";
        }
        if (!event.supported()) {
            log.debug("Stripe event {} of type {} is not one this service acts on",
                    event.eventId(), event.type());
            return "IGNORED";
        }
        return switch (event.type()) {
            case "checkout.session.completed" -> applySessionCompleted(event);
            case "checkout.session.expired" -> applySessionExpired(event);
            case "payment_intent.payment_failed" -> applyIntentFailed(event);
            case "charge.refunded" -> applyChargeRefunded(event);
            default -> "IGNORED"; // covered by supported(), kept exhaustive for the switch
        };
    }

    /**
     * The customer paid: complete the payment and announce it. Requires the session the event
     * names to be the one the payment row stores — a session this service never opened (or lost)
     * must not complete a payment that is not its — and requires the paid amount and currency to
     * be the ones this service asked for: a session paying a different total (a tampered or
     * foreign session under the same account) must never credit this ledger.
     */
    private String applySessionCompleted(StripeEvent event) {
        Optional<Payment> found = findBySession(event);
        if (found.isEmpty()) {
            log.warn("Stripe event {} completes checkout session {} but no payment of this service "
                    + "was opened for it", event.eventId(), event.sessionId());
            return "UNKNOWN_PAYMENT";
        }
        Payment payment = found.get();
        if (!"paid".equals(event.paymentStatus())) {
            // checkout.session.completed also fires with payment_status "unpaid" for asynchronous
            // methods; the money is not here yet, so the answer must stay open.
            log.info("Stripe event {} reports session {} as {} ({}) — payment stays awaiting",
                    event.eventId(), event.sessionId(), event.paymentStatus(), payment.getStatus());
            return "NOT_PAID";
        }
        if (!amountAgrees(event, payment)) {
            return "AMOUNT_MISMATCH";
        }
        if (payment.markCompleted(event.paymentIntentId())) {
            payments.saveAndFlush(payment);
            announceCompleted(payment);
            log.info("Stripe event {} completed payment {} of order {} (intent {})",
                    event.eventId(), payment.getId(), payment.getOrderId(), event.paymentIntentId());
            return "APPLIED";
        }
        return replayVerdict(event, payment, "completed");
    }

    /**
     * @param event   a completed-session delivery
     * @param payment the row the session belongs to
     * @return whether the delivery's amount and currency are the ones this service asked for.
     *         Absent fields are not a mismatch (the payload shape is Stripe's to evolve), but a
     *         present field must agree with the row.
     */
    private boolean amountAgrees(StripeEvent event, Payment payment) {
        if (event.currency() != null
                && !event.currency().equalsIgnoreCase(payment.getCurrency())) {
            log.warn("Stripe event {} paid session {} in {} but payment {} of order {} is a {} "
                    + "charge: refusing to complete it",
                    event.eventId(), event.sessionId(), event.currency(), payment.getId(),
                    payment.getOrderId(), payment.getCurrency());
            return false;
        }
        if (event.amount() != null && !amountMatchesMinorUnits(event.amount(), payment)) {
            log.warn("Stripe event {} reports session {} paid {} minor units but payment {} of "
                    + "order {} is {}: refusing to complete it",
                    event.eventId(), event.sessionId(), event.amount(), payment.getId(),
                    payment.getOrderId(), payment.getAmount());
            return false;
        }
        return true;
    }

    /**
     * @param minorUnits an amount in the currency's smallest unit
     * @param payment    the row whose amount is being compared
     * @return whether the minor units equal the row's amount — using the currency's own fraction
     *         digits (zero for e.g. JPY), the same conversion the gateway charges with
     */
    private static boolean amountMatchesMinorUnits(long minorUnits, Payment payment) {
        int fractionDigits;
        try {
            fractionDigits = Currency.getInstance(payment.getCurrency().toUpperCase(Locale.ROOT))
                    .getDefaultFractionDigits();
        }
        catch (IllegalArgumentException ex) {
            fractionDigits = 2;
        }
        if (fractionDigits < 0) {
            fractionDigits = 2;
        }
        long expected = payment.getAmount().setScale(fractionDigits, RoundingMode.HALF_UP)
                .movePointRight(fractionDigits).longValueExact();
        return minorUnits == expected;
    }

    /** The customer never finished: the session died of old age at the provider. */
    private String applySessionExpired(StripeEvent event) {
        Optional<Payment> found = findBySession(event);
        if (found.isEmpty()) {
            return "UNKNOWN_PAYMENT";
        }
        Payment payment = found.get();
        if (payment.markFailed("The checkout session expired without a payment")) {
            payments.saveAndFlush(payment);
            announceFailed(payment, payment.getFailureReason());
            log.info("Stripe event {} expired payment {} of order {}",
                    event.eventId(), payment.getId(), payment.getOrderId());
            return "APPLIED";
        }
        return replayVerdict(event, payment, "expired");
    }

    /**
     * The provider reports a payment intent failure. For a card checkout this is a <em>retriable
     * attempt failure</em>, not a verdict ({@code PAY-2}): a Checkout Session stays open after a
     * declined card, and the very same session completes when the customer retries with a working
     * card. Making the ledger terminal here would strand that later completion — a successful
     * payment after a failed attempt must still confirm the order (or refund a cancelled one).
     *
     * <p>So an {@code AWAITING_CUSTOMER} payment only records the attempt's reason (cleared again
     * by a later completion) and stays open; nothing is announced, because the order's saga must
     * keep waiting for the customer it still has. The payment stays reconcilable: the session's
     * own completion, the session's expiry or this saga's timeout all still apply. A delivery
     * naming a payment that is no longer open (already completed, refunded, or failed for good)
     * changes nothing.
     *
     * <p>The intent is not on the row yet (an {@code AWAITING_CUSTOMER} payment has no provider
     * reference), so the delivery is matched through the {@code orderId} this service wrote into
     * the intent's metadata — and only this service's Stripe rows may be touched by it.
     */
    private String applyIntentFailed(StripeEvent event) {
        UUID orderId = parseOrderId(event.orderId());
        if (orderId == null) {
            return "UNKNOWN_PAYMENT";
        }
        Optional<Payment> found = payments.findByOrderId(orderId)
                .filter(payment -> payment.getProvider() == PaymentProvider.STRIPE);
        if (found.isEmpty()) {
            return "UNKNOWN_PAYMENT";
        }
        Payment payment = found.get();
        if (!payment.isAwaitingCustomer()) {
            // Out-of-order delivery (a late attempt failure after the session completed, or one
            // for a payment this saga already closed): the stored state speaks for itself.
            return replayVerdict(event, payment, "failed");
        }
        String reason = "The payment was not completed: %s".formatted(
                event.failureMessage() == null ? "the provider reported a failed attempt"
                        : event.failureMessage());
        // Retriable: the session is still open, the customer may pay it. The row stays open with
        // the attempt's reason (a later completion clears it); nothing is announced — the saga
        // must not cancel an order whose checkout still stands.
        payment.recordAttemptFailure(reason);
        payments.saveAndFlush(payment);
        log.info("Stripe event {} reports a failed attempt on the still-open checkout of payment {} "
                + "of order {}: it stays awaiting", event.eventId(), payment.getId(),
                payment.getOrderId());
        return "ATTEMPT_FAILED";
    }

    /**
     * Confirms a refund at the provider. Most deliveries confirm a refund this service recorded
     * itself (the synchronous Stripe call), which then changes nothing — exactly what "confirm"
     * means here. A refund nobody asked this service for (e.g. from the Stripe dashboard) closes
     * the ledger row too, so the money and the ledger agree either way.
     */
    private String applyChargeRefunded(StripeEvent event) {
        if (event.paymentIntentId() == null) {
            return "UNKNOWN_PAYMENT";
        }
        Optional<Payment> found = payments.findByProviderRef(event.paymentIntentId());
        if (found.isEmpty()) {
            return "UNKNOWN_PAYMENT";
        }
        Payment payment = found.get();
        if (event.amount() != null && event.amountRefunded() != null
                && event.amount() > 0 && !event.amount().equals(event.amountRefunded())) {
            log.warn("Stripe event {} reports a PARTIAL refund ({}/{} minor units) of payment {} of "
                    + "order {}; this service only issues full refunds, the row stays {}",
                    event.eventId(), event.amountRefunded(), event.amount(), payment.getId(),
                    payment.getOrderId(), payment.getStatus());
            return "PARTIAL_REFUND_IGNORED";
        }
        if (payment.refund("Refunded by the payment provider")) {
            payments.saveAndFlush(payment);
            outbox.record(payment.getOrderId(), PaymentRefunded.class.getSimpleName(),
                    Topics.PAYMENT_EVENTS,
                    new PaymentRefunded(payment.getOrderId(), payment.getId(), payment.getAmount(),
                            payment.getCurrency(), "Refunded by the payment provider"));
            log.info("Stripe event {} confirmed the refund of payment {} of order {}",
                    event.eventId(), payment.getId(), payment.getOrderId());
            return "APPLIED";
        }
        return replayVerdict(event, payment, "refunded");
    }

    /**
     * A redelivery (or an out-of-order delivery) for a payment whose state already moved: report
     * what the stored state means instead of changing it. Never moves a payment backwards —
     * especially never re-opens a FAILED or REFUNDED payment because a late completion claims
     * money arrived.
     */
    private String replayVerdict(StripeEvent event, Payment payment, String happened) {
        PaymentStatus status = payment.getStatus();
        log.info("Stripe event {} says payment {} of order {} was {} but the row is already {}: "
                + "state unchanged", event.eventId(), payment.getId(), payment.getOrderId(),
                happened, status);
        return switch (status) {
            case AUTHORIZED -> "ALREADY_COMPLETED";
            case FAILED -> "ALREADY_FAILED";
            case REFUNDED -> "ALREADY_REFUNDED";
            case AWAITING_CUSTOMER -> "STILL_AWAITING";
        };
    }

    private Optional<Payment> findBySession(StripeEvent event) {
        if (event.sessionId() == null) {
            return Optional.empty();
        }
        return payments.findByCheckoutSessionId(event.sessionId())
                // A row from the simulated provider never had a session; this filter is for the
                // reader, not a real branch.
                .filter(payment -> payment.getProvider() == PaymentProvider.STRIPE);
    }

    /**
     * @param value an id this system wrote into provider metadata; may belong to another
     *              integration sharing the account, so it is parsed defensively
     * @return the order id, or {@code null} when it is not one of ours
     */
    private static UUID parseOrderId(String value) {
        if (value == null) {
            return null;
        }
        try {
            return UUID.fromString(value.trim());
        }
        catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private void announceCompleted(Payment payment) {
        outbox.record(payment.getOrderId(), PaymentCompleted.class.getSimpleName(),
                Topics.PAYMENT_EVENTS,
                new PaymentCompleted(payment.getOrderId(), payment.getId(), payment.getAmount(),
                        payment.getCurrency()));
    }

    private void announceFailed(Payment payment, String reason) {
        outbox.record(payment.getOrderId(), PaymentFailed.class.getSimpleName(),
                Topics.PAYMENT_EVENTS,
                new PaymentFailed(payment.getOrderId(), payment.getId(), payment.getAmount(),
                        payment.getCurrency(), reason));
    }
}
