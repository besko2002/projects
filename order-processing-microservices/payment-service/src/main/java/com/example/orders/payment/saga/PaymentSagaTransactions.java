package com.example.orders.payment.saga;

import com.example.orders.common.events.ExpirePayment;
import com.example.orders.common.events.PaymentAwaitingCustomer;
import com.example.orders.common.events.PaymentCompleted;
import com.example.orders.common.events.PaymentFailed;
import com.example.orders.common.events.PaymentRefunded;
import com.example.orders.common.events.ProcessPayment;
import com.example.orders.common.events.RefundPayment;
import com.example.orders.common.events.Topics;
import com.example.orders.payment.domain.ChargeAttempt;
import com.example.orders.payment.domain.ChargeAttemptRepository;
import com.example.orders.payment.domain.Payment;
import com.example.orders.payment.domain.PaymentProvider;
import com.example.orders.payment.domain.PaymentRepository;
import com.example.orders.payment.gateway.ChargeOutcome;
import com.example.orders.payment.gateway.ChargeRequest;
import com.example.orders.payment.gateway.CheckoutTtl;
import com.example.orders.payment.gateway.PaymentGateway;
import com.example.orders.payment.gateway.RefundOutcome;
import com.example.orders.payment.gateway.RefundRequest;
import com.example.orders.payment.gateway.SessionOutcome;
import com.example.orders.support.idempotency.ProcessedEvents;
import com.example.orders.support.outbox.OutboxWriter;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * payment-service's side of the saga: charging and refunding, one command at a time.
 *
 * <p>Every command is a deliberate three-act structure, because a real provider is a network call
 * and the database must never wait for one:
 * <ol>
 *   <li>a short transaction that decides whether the command has any work left at all (replay
 *       guard, existing payment row) and either reports the stored answer or asks for the
 *       provider;</li>
 *   <li>the provider call itself — <strong>no transaction, no row locks held</strong>, so a slow
 *       or down Stripe can never hold this service's database hostage;</li>
 *   <li>a short transaction that records the provider's answer, announces it through the outbox
 *       and marks the command processed — all one commit.</li>
 * </ol>
 *
 * <p>Charging exactly once is guarded twice over, because this is the one step where a duplicate
 * costs real money:
 * <ol>
 *   <li>the lookup by order id stops a redelivery for an order that already has a payment — it
 *       re-announces the stored outcome instead of charging again;</li>
 *   <li>the charge attempt's identity and parameters are persisted <em>before</em> the provider is
 *       asked ({@link #planCharge}), so the provider call always carries the same idempotency key
 *       (derived from the attempt's opening command) and the same request shape — a delivery that
 *       repeats the provider call reaches the <em>same</em> session, not a second one, even after
 *       a response was lost;</li>
 *   <li>and {@code UNIQUE(order_id)} in the database is there for the case where two deliveries
 *       somehow raced past both — the loser's insert is refused, its transaction rolls back and
 *       the redelivery lands on the fast path.</li>
 * </ol>
 *
 * <p>Refunds and session expiries are replay-guarded the same way: the provider call carries an
 * idempotency key ({@link #refundIdempotencyKey}), and the row flip plus the announcement are one
 * commit. A provider that could not be asked is thrown, un-marked, so the delivery is retried
 * until it lands or dead-letters — never swallowed.
 */
@Component
public class PaymentSagaTransactions {

    private static final Logger log = LoggerFactory.getLogger(PaymentSagaTransactions.class);

    /** Consumer name recorded in {@code processed_events} for the command topic. */
    public static final String COMMAND_CONSUMER = "payment.commands";

    private final PaymentRepository payments;
    private final ChargeAttemptRepository chargeAttempts;
    private final PaymentGateway gateway;
    private final OutboxWriter outbox;
    private final ProcessedEvents processedEvents;
    private final TransactionTemplate transactions;

    /**
     * The session TTL the charge attempt requests: clamped once (Stripe's 30-minute minimum), so
     * the persisted attempt's expiry and the gateway's request always agree.
     */
    private final Duration checkoutTtl;

    /**
     * How often a charge may be asked of a provider that answers {@code Unavailable} before the
     * attempt is recorded as an honest failure. Bounded on purpose: the retry loop keeps an
     * accepted-but-unanswered charge recoverable (the next ask replays the same idempotency key
     * and parameters), but it must not spin forever.
     */
    static final int MAX_UNAVAILABLE_ASKS = 3;

    /**
     * @param payments         the {@code payments} table
     * @param chargeAttempts   the {@code charge_attempts} table — the durable memory of the one
     *                         charge attempt per order
     * @param gateway          the provider port; the one slow call of each command happens here
     * @param outbox           where every announcement leaves
     * @param processedEvents  the command replay guard
     * @param transactions     boundary for the short transactions of acts one and three
     * @param checkoutTtl      configured session lifetime, clamped to Stripe's minimum here
     */
    public PaymentSagaTransactions(
            PaymentRepository payments,
            ChargeAttemptRepository chargeAttempts,
            PaymentGateway gateway,
            OutboxWriter outbox,
            ProcessedEvents processedEvents,
            TransactionTemplate transactions,
            @Value("${payments.checkout-ttl:PT30M}") Duration checkoutTtl) {
        this.payments = payments;
        this.chargeAttempts = chargeAttempts;
        this.gateway = gateway;
        this.outbox = outbox;
        this.processedEvents = processedEvents;
        this.transactions = transactions;
        this.checkoutTtl = CheckoutTtl.effective(checkoutTtl);
    }

    /**
     * Saga step 3: charge the customer.
     *
     * <p>The charge's identity and request parameters are decided <em>before</em> the provider is
     * asked ({@code PAY-3}): {@link #planCharge} persists them — or reads back the attempt an
     * earlier delivery opened — so the idempotency key, the payment id in the session's metadata
     * and the session's expiry are the same on every ask. A response that was accepted but lost is
     * therefore recoverable by the retry: Stripe replays its first answer for an identical request
     * instead of refusing the changed one or minting a second session.
     *
     * @param eventId id of the {@code ProcessPayment} command
     * @param command its payload
     */
    public void onProcessPayment(UUID eventId, ProcessPayment command) {
        if (command.orderId() == null) {
            log.warn("Ignoring ProcessPayment without an order id");
            return;
        }
        // Fast path: an earlier delivery (or a racing one) already recorded this order's payment.
        // Never call the provider again for it — report the stored answer instead.
        Optional<Payment> existing = payments.findByOrderId(command.orderId());
        if (existing.isPresent()) {
            Payment payment = existing.get();
            log.info("Order {} already has payment {} in state {}, re-announcing that outcome",
                    command.orderId(), payment.getId(), payment.getStatus());
            announceStored(eventId, payment);
            return;
        }

        ChargeAttempt attempt = planCharge(eventId, command);
        ChargeRequest request = new ChargeRequest(command.orderId(), attempt.getPaymentId(),
                command.customerId(), command.amount(), command.currency(),
                "charge:" + attempt.getEventId(), attempt.getExpiresAt());
        ChargeOutcome outcome = gateway.charge(request);

        if (outcome instanceof ChargeOutcome.Unavailable unavailable
                && attempt.getAttempts() < MAX_UNAVAILABLE_ASKS) {
            // The provider could not be asked. NOT recorded, NOT marked processed: the redelivery
            // re-uses the same attempt row, so the next ask carries the same idempotency key and
            // parameters — if Stripe actually accepted the first one, it replays that answer here,
            // and nothing is thrown away. A bounded number of asks keeps an outage from spinning.
            throw new IllegalStateException(
                    "Charge of order %s could not be asked from the provider (ask %d/%d): %s"
                            .formatted(command.orderId(), attempt.getAttempts(),
                                    MAX_UNAVAILABLE_ASKS, unavailable.reason()));
        }
        transactions.executeWithoutResult(status ->
                recordChargeOutcome(eventId, command, request, outcome));
    }

    /**
     * Loads — or opens — the one charge attempt of this order, and books one more provider ask
     * against it. Deliberately a short transaction with no provider call inside: the attempt is
     * durable before the network, which is the whole point.
     *
     * <p>A second, concurrent command for the same order loses the primary-key race and continues
     * with the winner's attempt: two commands must never mint two sessions for one order, so the
     * loser adopts the winner's identity and idempotency key.
     */
    private ChargeAttempt planCharge(UUID eventId, ProcessPayment command) {
        return transactions.execute(status -> {
            ChargeAttempt attempt = chargeAttempts.findById(command.orderId()).orElse(null);
            if (attempt == null) {
                attempt = ChargeAttempt.first(command.orderId(), eventId, UUID.randomUUID(),
                        OffsetDateTime.now(ZoneOffset.UTC).plus(checkoutTtl));
                try {
                    chargeAttempts.saveAndFlush(attempt);
                }
                catch (DataIntegrityViolationException raced) {
                    // Another delivery opened the attempt for this order while this one was
                    // deciding to: adopt it, never replace it.
                    attempt = chargeAttempts.findById(command.orderId()).orElseThrow();
                    log.info("Charge attempt of order {} was opened by command {}; adopting it",
                            command.orderId(), attempt.getEventId());
                }
            }
            attempt.bookAttempt();
            chargeAttempts.saveAndFlush(attempt);
            return attempt;
        });
    }

    /**
     * Compensation: give an authorised charge back.
     *
     * @param eventId id of the {@code RefundPayment} command
     * @param command its payload
     */
    public void onRefundPayment(UUID eventId, RefundPayment command) {
        if (command.orderId() == null) {
            log.warn("Ignoring RefundPayment without an order id");
            return;
        }
        Optional<Payment> refundable = planRefund(eventId, command.orderId());
        if (refundable.isEmpty()) {
            return;
        }
        Payment payment = refundable.get();
        String reason = reason(command.reason());
        RefundOutcome outcome = gateway.refund(new RefundRequest(payment.getProviderRef(),
                payment.getAmount(), payment.getCurrency(), refundIdempotencyKey(payment)));
        if (outcome instanceof RefundOutcome.Unavailable unavailable) {
            // Not marked processed: the next delivery retries the same refund until it lands,
            // because a swallowed refund leaves the customer's money with us forever.
            throw new IllegalStateException("Refund of order %s could not be asked from the provider: %s"
                    .formatted(command.orderId(), unavailable.reason()));
        }
        transactions.executeWithoutResult(status -> recordRefund(eventId, command.orderId(), reason));
    }

    /**
     * Compensation for a checkout the customer never finished: close the hosted session so a
     * cancelled order cannot be paid for afterwards.
     *
     * @param eventId id of the {@code ExpirePayment} command
     * @param command its payload
     */
    public void onExpirePayment(UUID eventId, ExpirePayment command) {
        if (command.orderId() == null) {
            log.warn("Ignoring ExpirePayment without an order id");
            return;
        }
        Optional<Payment> expirable = planExpiry(eventId, command.orderId());
        if (expirable.isEmpty()) {
            return;
        }
        String reason = reason(command.reason());
        SessionOutcome outcome = gateway.expireSession(expirable.get().getCheckoutSessionId());
        transactions.executeWithoutResult(status -> recordExpiry(eventId, command.orderId(), reason,
                outcome));
    }

    /**
     * Reports a stored payment for the command that just arrived — a redelivery of a charge that
     * was already answered. The mark and the announcement are one commit, so a processed command
     * is never announced twice and an announced one is never lost.
     */
    private void announceStored(UUID eventId, Payment payment) {
        transactions.executeWithoutResult(status -> {
            if (!processedEvents.markProcessed(eventId, COMMAND_CONSUMER)) {
                return;
            }
            announce(payment);
        });
    }

    /** Records the provider's charge answer: the row, the announcement and the mark, one commit. */
    private void recordChargeOutcome(UUID eventId, ProcessPayment command, ChargeRequest request,
            ChargeOutcome outcome) {
        if (!processedEvents.markProcessed(eventId, COMMAND_CONSUMER)) {
            return;
        }
        Optional<Payment> existing = payments.findByOrderId(command.orderId());
        if (existing.isPresent()) {
            // A concurrent delivery recorded a payment for this order while the provider was being
            // asked; report the winner's outcome instead of racing a second row into UNIQUE(order_id).
            announce(existing.get());
            return;
        }
        Payment payment = toPayment(command, request, outcome);
        payments.saveAndFlush(payment);
        announce(payment);
        log.info("Payment {} for order {} is {} ({} {})", payment.getId(), payment.getOrderId(),
                payment.getStatus(), payment.getAmount(), payment.getCurrency());
    }

    /**
     * Decides, in one short transaction, whether a refund command has work left — and for the
     * "money is with us" answer, returns the payment so the provider can be asked <em>outside</em>
     * this transaction. The command is marked processed only where this method itself answers it;
     * the ask-the-provider path is marked by {@link #recordRefund}, in the same commit as the row
     * flip and the announcement, so a crash before that commit replays the whole command.
     */
    private Optional<Payment> planRefund(UUID eventId, UUID orderId) {
        return transactions.execute(status -> {
            if (processedEvents.isProcessed(eventId, COMMAND_CONSUMER)) {
                return Optional.<Payment>empty();
            }
            Optional<Payment> found = payments.findByOrderId(orderId);
            if (found.isEmpty()) {
                // Nothing was ever charged for this order — the orchestrator compensates without
                // knowing how far the saga got, so this is a normal outcome, not an error.
                processedEvents.markProcessed(eventId, COMMAND_CONSUMER);
                log.info("RefundPayment for order {} has nothing to refund", orderId);
                return Optional.<Payment>empty();
            }
            Payment payment = found.get();
            switch (payment.getStatus()) {
                case AUTHORIZED -> {
                    return Optional.of(payment);
                }
                case REFUNDED -> {
                    // Already refunded. Announce it again rather than staying silent: the
                    // orchestrator may still be waiting for the confirmation, and it ignores a repeat.
                    processedEvents.markProcessed(eventId, COMMAND_CONSUMER);
                    log.info("Payment {} of order {} was already refunded, re-announcing it",
                            payment.getId(), orderId);
                    outbox.record(orderId, PaymentRefunded.class.getSimpleName(),
                            Topics.PAYMENT_EVENTS,
                            new PaymentRefunded(orderId, payment.getId(), payment.getAmount(),
                                    payment.getCurrency(), payment.getFailureReason()));
                    return Optional.<Payment>empty();
                }
                // A failed charge has no money to give back, and an awaiting one has none either —
                // its session is closed by an ExpirePayment command, not by a refund. Announcing a
                // refund here would tell the orchestrator something happened when nothing did.
                default -> {
                    processedEvents.markProcessed(eventId, COMMAND_CONSUMER);
                    log.info("Payment {} of order {} is {}, nothing to refund",
                            payment.getId(), orderId, payment.getStatus());
                }
            }
            return Optional.<Payment>empty();
        });
    }

    /** Records the provider's refund answer: the flip, the announcement and the mark, one commit. */
    private void recordRefund(UUID eventId, UUID orderId, String reason) {
        if (!processedEvents.markProcessed(eventId, COMMAND_CONSUMER)) {
            return;
        }
        Optional<Payment> found = payments.findByOrderId(orderId);
        if (found.isEmpty()) {
            log.warn("Refund of order {} succeeded but its payment row is gone", orderId);
            return;
        }
        Payment payment = found.get();
        if (payment.refund(reason)) {
            payments.saveAndFlush(payment);
            log.info("Refunded payment {} of order {}: {}", payment.getId(), orderId, reason);
            outbox.record(orderId, PaymentRefunded.class.getSimpleName(), Topics.PAYMENT_EVENTS,
                    new PaymentRefunded(orderId, payment.getId(), payment.getAmount(),
                            payment.getCurrency(), reason));
            return;
        }
        switch (payment.getStatus()) {
            case REFUNDED -> {
                // The webhook or a concurrent delivery refunded first; confirm rather than stall.
                log.info("Payment {} of order {} was already refunded, re-announcing it",
                        payment.getId(), orderId);
                outbox.record(orderId, PaymentRefunded.class.getSimpleName(), Topics.PAYMENT_EVENTS,
                        new PaymentRefunded(orderId, payment.getId(), payment.getAmount(),
                                payment.getCurrency(), payment.getFailureReason()));
            }
            // The row changed between the plan and the record (a webhook moved it). Nothing was
            // flipped here, so nothing is announced: the row's own state speaks for itself.
            default -> log.info("Payment {} of order {} is {}, nothing to refund",
                    payment.getId(), orderId, payment.getStatus());
        }
    }

    /**
     * Decides, in one short transaction, whether an expiry command has work left — and for the
     * "customer still has an open session" answer, returns the payment so the provider's close can
     * be asked <em>outside</em> this transaction. The command is marked processed only where this
     * method itself answers it; the ask-the-provider path is marked by {@link #recordExpiry}, in
     * the same commit as the row change, so a crash before that commit replays the whole command.
     */
    private Optional<Payment> planExpiry(UUID eventId, UUID orderId) {
        return transactions.execute(status -> {
            if (processedEvents.isProcessed(eventId, COMMAND_CONSUMER)) {
                return Optional.<Payment>empty();
            }
            Optional<Payment> found = payments.findByOrderId(orderId);
            if (found.isEmpty()) {
                processedEvents.markProcessed(eventId, COMMAND_CONSUMER);
                log.info("ExpirePayment for order {} has no payment to expire", orderId);
                return Optional.<Payment>empty();
            }
            Payment payment = found.get();
            if (payment.isAuthorized()) {
                // The webhook completed the payment while this command was in flight: money was
                // taken, so the customer keeps their (late) payment and the orchestrator's
                // compensation refunds it — announce the completion, never expire a paid charge.
                processedEvents.markProcessed(eventId, COMMAND_CONSUMER);
                log.info("Payment {} of order {} was completed while the expiry was in flight, "
                        + "announcing it", payment.getId(), orderId);
                outbox.record(orderId, PaymentCompleted.class.getSimpleName(), Topics.PAYMENT_EVENTS,
                        new PaymentCompleted(orderId, payment.getId(), payment.getAmount(),
                                payment.getCurrency()));
                return Optional.<Payment>empty();
            }
            if (!payment.isAwaitingCustomer()) {
                // FAILED or REFUNDED: no open session, nothing to close.
                processedEvents.markProcessed(eventId, COMMAND_CONSUMER);
                log.info("Payment {} of order {} is {}, no session to expire", payment.getId(),
                        orderId, payment.getStatus());
                return Optional.<Payment>empty();
            }
            if (payment.getCheckoutSessionId() == null) {
                processedEvents.markProcessed(eventId, COMMAND_CONSUMER);
                log.warn("Payment {} of order {} is awaiting a customer but has no session id; "
                        + "it cannot be expired", payment.getId(), orderId);
                return Optional.<Payment>empty();
            }
            return Optional.of(payment);
        });
    }

    /** Records the provider's session-close answer: the row change and the mark, one commit. */
    private void recordExpiry(UUID eventId, UUID orderId, String reason, SessionOutcome outcome) {
        if (outcome instanceof SessionOutcome.Unavailable unavailable) {
            // Not marked processed: the next delivery retries the close until it lands, because an
            // expired-in-name-only session can still be paid for a cancelled order.
            throw new IllegalStateException(
                    "Checkout session of order %s could not be expired: %s".formatted(orderId,
                            unavailable.reason()));
        }
        if (!processedEvents.markProcessed(eventId, COMMAND_CONSUMER)) {
            return;
        }
        Optional<Payment> found = payments.findByOrderId(orderId);
        if (found.isEmpty()) {
            log.warn("Checkout session of order {} was expired but its payment row is gone", orderId);
            return;
        }
        Payment payment = found.get();
        if (outcome instanceof SessionOutcome.AlreadyCompleted completed) {
            // The customer paid in the same moment the close was asked for. The money cannot buy a
            // cancelled order: complete the payment so the orchestrator's compensation refunds it.
            if (payment.markCompleted(completed.paymentIntentId())) {
                payments.saveAndFlush(payment);
            } else {
                log.info("Payment {} of order {} already left the awaiting state ({}), not "
                        + "completing it again", payment.getId(), orderId, payment.getStatus());
            }
            outbox.record(orderId, PaymentCompleted.class.getSimpleName(), Topics.PAYMENT_EVENTS,
                    new PaymentCompleted(orderId, payment.getId(), payment.getAmount(),
                            payment.getCurrency()));
            log.info("Checkout session of order {} had just been paid; payment {} completed so the "
                    + "refund follows", orderId, payment.getId());
            return;
        }
        // SessionOutcome.Expired: the session is closed and no money moved. No event is announced —
        // the order is already cancelled when this command is queued, and a PaymentFailed for a
        // cancelled order would be dead letter noise.
        if (payment.markFailed("Checkout session closed: " + reason)) {
            payments.saveAndFlush(payment);
            log.info("Expired the checkout session of order {}: payment {} is now {}", orderId,
                    payment.getId(), payment.getStatus());
        } else {
            log.info("Payment {} of order {} is {}, session expiry needs no change", payment.getId(),
                    orderId, payment.getStatus());
        }
    }

    /** Maps the provider's answer onto a new payment row (the provider is whoever just answered). */
    private Payment toPayment(ProcessPayment command, ChargeRequest request, ChargeOutcome outcome) {
        PaymentProvider provider = PaymentProvider.valueOf(gateway.provider());
        return switch (outcome) {
            case ChargeOutcome.Approved approved -> Payment.authorized(command.orderId(),
                    command.customerId(), command.amount(), command.currency(), provider,
                    approved.providerRef());
            case ChargeOutcome.AwaitingCustomer awaiting -> Payment.awaitingCustomer(
                    command.orderId(), command.customerId(), request.paymentId(), command.amount(),
                    command.currency(), provider, awaiting.sessionId(), awaiting.url(),
                    awaiting.expiresAt());
            case ChargeOutcome.Declined declined -> Payment.failed(command.orderId(),
                    command.customerId(), command.amount(), command.currency(), provider,
                    declined.reason());
            case ChargeOutcome.Unavailable unavailable -> Payment.failed(command.orderId(),
                    command.customerId(), command.amount(), command.currency(), provider,
                    unavailable.reason());
        };
    }

    /** Announces a payment's current state on the payment events topic. */
    private void announce(Payment payment) {
        switch (payment.getStatus()) {
            case AUTHORIZED -> outbox.record(payment.getOrderId(),
                    PaymentCompleted.class.getSimpleName(), Topics.PAYMENT_EVENTS,
                    new PaymentCompleted(payment.getOrderId(), payment.getId(), payment.getAmount(),
                            payment.getCurrency()));
            case AWAITING_CUSTOMER -> outbox.record(payment.getOrderId(),
                    PaymentAwaitingCustomer.class.getSimpleName(), Topics.PAYMENT_EVENTS,
                    new PaymentAwaitingCustomer(payment.getOrderId(), payment.getId(),
                            payment.getCheckoutUrl(), payment.getCheckoutExpiresAt(),
                            payment.getAmount(), payment.getCurrency()));
            case FAILED -> outbox.record(payment.getOrderId(), PaymentFailed.class.getSimpleName(),
                    Topics.PAYMENT_EVENTS,
                    new PaymentFailed(payment.getOrderId(), payment.getId(), payment.getAmount(),
                            payment.getCurrency(), payment.getFailureReason()));
            // A refunded payment is not an answer to "please charge": the order that asked has long
            // been cancelled, and PaymentRefunded was published when the refund happened.
            case REFUNDED -> log.info("Payment {} of order {} is already refunded, not re-announcing"
                    + " a charge", payment.getId(), payment.getOrderId());
        }
    }

    /**
     * @param reason the command's reason, or the neutral default when it carries none
     */
    private static String reason(String reason) {
        return reason == null ? "Refunded after cancellation" : reason;
    }

    /**
     * The provider's replay guard for one refund, derived from the provider's own charge reference
     * and the amount — never from a local id. Local ids restart per database, so two environments
     * would derive the same key for different refunds, or different keys for the same refund, and
     * the provider would either block a real refund or pay out twice.
     *
     * @param payment the payment being refunded
     * @return the idempotency key for the refund call
     */
    static String refundIdempotencyKey(Payment payment) {
        String chargeRef = payment.getProviderRef() != null
                ? payment.getProviderRef()
                : payment.getOrderId().toString();
        return "refund:" + chargeRef + ":" + payment.getAmount().toPlainString();
    }
}
