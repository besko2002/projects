package com.example.orders.payment.gateway;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Stands in for a real payment provider — <strong>simulated money only</strong>.
 *
 * <p>Nothing here moves real funds, talks to a real acquirer, or is correct for real money: the
 * charge writes an {@code AUTHORIZED} row in this service's own database and the refund flips it,
 * and that ledger is the whole "bank". Documentation, configuration examples and the README label
 * every charging/refunding behaviour as simulated — the real provider is
 * {@link StripePaymentGateway}, which this class deliberately does not resemble beyond the port.
 *
 * <p>It is deliberately <strong>deterministic</strong>: the same order always gets the same answer.
 * A saga is only testable if its failure branch can be triggered on purpose, and a gateway that
 * decided randomly per call would also break idempotency — a redelivered {@code ProcessPayment}
 * could then contradict the first answer.
 *
 * <p>Two knobs:
 * <ul>
 *   <li>{@code PAYMENT_DECLINE_ABOVE} (default {@code 1000.00}) — anything above this amount is
 *       declined. This is what the end-to-end "payment declined" scenario uses: the amount alone
 *       decides, so a test only has to order enough.</li>
 *   <li>{@code PAYMENT_FAILURE_RATE} (default {@code 0}) — the share of orders that are declined
 *       regardless of amount, for demonstrating compensation under "normal" traffic. The choice is
 *       made from a hash of the order id, not from a random number, so it stays stable per order.</li>
 * </ul>
 *
 * <p>Selected only by an explicit {@code PAYMENT_PROVIDER=simulated} — the automated tests and
 * anyone who wants the deterministic demo loop. It is never a fallback for a missing Stripe key:
 * with no keys the {@link UnavailablePaymentGateway} answers, so an unconfigured deployment cannot
 * drift into faking successful payments.
 */
public class SimulatedPaymentGateway implements PaymentGateway {

    /** Reason reported when the amount is above the configured ceiling. */
    public static final String DECLINED_AMOUNT = "Payment declined: amount %s %s exceeds the limit of %s";

    /** Reason reported when the order fell into the configured failure share. */
    public static final String DECLINED_RATE = "Payment declined by the provider (simulated failure rate)";

    private static final Logger log = LoggerFactory.getLogger(SimulatedPaymentGateway.class);

    private final BigDecimal declineAbove;
    private final double failureRate;

    /**
     * @param declineAbove amounts strictly greater than this are declined
     * @param failureRate  share of orders declined regardless of amount, {@code 0}..{@code 1}
     */
    public SimulatedPaymentGateway(BigDecimal declineAbove, double failureRate) {
        this.declineAbove = declineAbove;
        this.failureRate = failureRate;
    }

    @Override
    public String provider() {
        return "SIMULATED";
    }

    /**
     * @param request the charge; the order id is the only source of randomness, so the answer is
     *                stable per order no matter how often the call is repeated
     * @return the provider's answer
     */
    @Override
    public ChargeOutcome charge(ChargeRequest request) {
        UUID orderId = request.orderId();
        BigDecimal amount = request.amount();
        String currency = request.currency();
        if (amount == null || amount.compareTo(declineAbove) > 0) {
            String reason = DECLINED_AMOUNT.formatted(amount, currency, declineAbove.toPlainString());
            log.info("Simulated gateway declined order {}: {}", orderId, reason);
            return new ChargeOutcome.Declined(reason);
        }
        if (failsByRate(orderId)) {
            log.info("Simulated gateway declined order {} by failure rate {}", orderId, failureRate);
            return new ChargeOutcome.Declined(DECLINED_RATE);
        }
        return new ChargeOutcome.Approved(providerReference(orderId));
    }

    @Override
    public SessionOutcome expireSession(String checkoutSessionId) {
        // The simulator never opens a hosted session (its charges are instant), so there is
        // nothing to close; guarded anyway so a future call path cannot NPE.
        log.info("Simulated gateway has no checkout session {} to expire", checkoutSessionId);
        return new SessionOutcome.Expired();
    }

    @Override
    public RefundOutcome refund(RefundRequest request) {
        // The refund is the row flip in this service's own database; the provider port has no
        // side to call. The caller records the flip in the saga transaction.
        return new RefundOutcome.Refunded(null);
    }

    /**
     * @param orderId order being charged
     * @return whether this order falls into the configured failure share; a stable property of the
     *         order id, so every retry of the same charge lands on the same side
     */
    private boolean failsByRate(UUID orderId) {
        if (failureRate <= 0 || orderId == null) {
            return false;
        }
        if (failureRate >= 1) {
            return true;
        }
        int bucket = Math.floorMod(orderId.hashCode(), 100);
        return bucket < Math.round(failureRate * 100);
    }

    /**
     * @param orderId order being charged
     * @return a stable, provider-looking reference. Derived from the order id rather than generated,
     *         so the same charge reported twice carries the same reference.
     */
    private static String providerReference(UUID orderId) {
        UUID derived = UUID.nameUUIDFromBytes(("payment:" + orderId).getBytes(StandardCharsets.UTF_8));
        return "SIM-" + derived.toString().substring(0, 13).replace("-", "").toUpperCase(Locale.ROOT);
    }
}
