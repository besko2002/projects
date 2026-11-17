package com.example.orders.payment.gateway;

import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Refund;
import com.stripe.model.checkout.Session;
import com.stripe.net.RequestOptions;
import com.stripe.param.RefundCreateParams;
import com.stripe.param.checkout.SessionCreateParams;
import com.stripe.param.checkout.SessionExpireParams;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Currency;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The real provider: <strong>Stripe Checkout in test mode</strong> through the {@code stripe-java}
 * SDK.
 *
 * <p>The customer pays on Stripe's hosted page, so a "charge" here opens a Checkout Session and
 * the verdict arrives later through the webhook endpoint — this class only ever creates sessions
 * and refunds, it never decides that money was taken. Every method is a network call and is meant
 * to be invoked <em>outside</em> a database transaction; the callers pass idempotency keys so a
 * repeated call (Kafka redelivery, optimistic-retry, crash between call and commit) returns the
 * provider's first answer instead of charging or refunding twice:
 *
 * <ul>
 *   <li>a checkout session's key is derived from the charge attempt's opening command's event id,
 *       and the request itself (payment id in the metadata, session expiry) is persisted with the
 *       attempt before the call, so a replay sends byte-identical parameters — Stripe refuses a
 *       reused key with changed parameters, and refusing would orphan an accepted session;</li>
 *   <li>a refund's key is derived from the <strong>Stripe payment intent id and the amount</strong>
 *       — never from a local id, which restarts per database and would collide with another
 *       environment's refund on the same Stripe account.</li>
 * </ul>
 *
 * <p>Failures of the SDK are translated, never leaked: a failed call becomes an
 * {@code Unavailable} outcome, which the saga treats as "the provider could not be asked" — a
 * bounded retry under the attempt's own idempotency key first, an honest recorded failure after
 * that — never as a fake success.
 */
class StripePaymentGateway implements PaymentGateway {

    private static final Logger log = LoggerFactory.getLogger(StripePaymentGateway.class);

    /** Currencies Stripe expects without a minor unit (amounts are whole numbers). */
    private static final int DEFAULT_FRACTION_DIGITS = 2;

    static final String META_ORDER_ID = "orderId";
    static final String META_PAYMENT_ID = "paymentId";

    private final StripeClient client;
    private final String currency;
    private final String storefrontBaseUrl;

    StripePaymentGateway(StripeClient client, String currency, String storefrontBaseUrl) {
        this.client = client;
        this.currency = currency.toLowerCase();
        this.storefrontBaseUrl = storefrontBaseUrl.endsWith("/")
                ? storefrontBaseUrl.substring(0, storefrontBaseUrl.length() - 1) : storefrontBaseUrl;
    }

    @Override
    public String provider() {
        return "STRIPE";
    }

    @Override
    public ChargeOutcome charge(ChargeRequest request) {
        SessionCreateParams.Builder params = SessionCreateParams.builder()
                .setMode(SessionCreateParams.Mode.PAYMENT)
                .setSuccessUrl(storefrontBaseUrl + "/payment/success")
                .setCancelUrl(storefrontBaseUrl + "/payment/cancel")
                // Cards only, on purpose: a card checkout is fully synchronous — completed means
                // paid, declines arrive as payment_intent.payment_failed — so every method this
                // session offers is one this service actually implements. An asynchronous method
                // (bank transfer, SEPA debit) completes "unpaid" first and would need its own
                // success/failure handling before it may be offered here.
                .addPaymentMethodType(SessionCreateParams.PaymentMethodType.CARD)
                // The session's expiry was decided when the charge attempt was opened and persisted
                // with it: a retried charge must send the same value or Stripe refuses the replay
                // of its idempotency key. The provider-side belt over abandoned checkouts — the
                // saga's timeout remains the authority.
                .setExpiresAt(request.expiresAt().toInstant().getEpochSecond())
                .setClientReferenceId(request.orderId().toString())
                .putMetadata(META_ORDER_ID, request.orderId().toString())
                .putMetadata(META_PAYMENT_ID, request.paymentId().toString())
                // The charge.refunded event carries the payment intent, not the session — the
                // intent needs its own pointer back to this order.
                .setPaymentIntentData(SessionCreateParams.PaymentIntentData.builder()
                        .putMetadata(META_ORDER_ID, request.orderId().toString())
                        .build())
                .addLineItem(SessionCreateParams.LineItem.builder()
                        .setQuantity(1L)
                        .setPriceData(SessionCreateParams.LineItem.PriceData.builder()
                                .setCurrency(currency)
                                .setUnitAmount(toMinorUnits(request.amount()))
                                .setProductData(SessionCreateParams.LineItem.PriceData.ProductData
                                        .builder()
                                        .setName("Order " + orderNumber(request.orderId()))
                                        .setDescription("Order Processing demo store")
                                        .build())
                                .build())
                        .build());
        try {
            Session session = client.checkout().sessions().create(params.build(),
                    RequestOptions.builder().setIdempotencyKey(request.idempotencyKey()).build());
            log.info("Opened Stripe Checkout Session {} for order {} (payment {})",
                    session.getId(), request.orderId(), request.paymentId());
            return new ChargeOutcome.AwaitingCustomer(session.getId(), session.getUrl(),
                    toOffsetDateTime(session.getExpiresAt()));
        }
        catch (StripeException ex) {
            log.error("Stripe refused to open a Checkout Session for order {}: {}",
                    request.orderId(), ex.getMessage(), ex);
            return new ChargeOutcome.Unavailable(
                    "The payment provider could not open a checkout session right now");
        }
    }

    @Override
    public SessionOutcome expireSession(String checkoutSessionId) {
        // Read first: an already-completed session (the customer clicked pay while the saga gave
        // up) must surface as a completion, never as a failure — Stripe refuses to expire those,
        // and treating that refusal as "closed" would strand real money behind a FAILED row.
        Session session = retrieveSession(checkoutSessionId);
        if (session == null) {
            return new SessionOutcome.Unavailable(
                    "The payment provider could not be reached to close the checkout session");
        }
        switch (nullSafe(session.getStatus())) {
            case "complete" -> {
                log.info("Checkout Session {} was already completed before it could be expired",
                        checkoutSessionId);
                return new SessionOutcome.AlreadyCompleted(session.getPaymentIntent());
            }
            case "expired" -> {
                return new SessionOutcome.Expired();
            }
            default -> {
                // "open" (and anything unexpected that still looks open): close it, and re-read
                // if the close races a customer who paid at the same moment.
                try {
                    client.checkout().sessions().expire(session.getId(), SessionExpireParams.builder().build());
                    log.info("Expired Stripe Checkout Session {}", checkoutSessionId);
                    return new SessionOutcome.Expired();
                }
                catch (StripeException ex) {
                    Session reread = retrieveSession(checkoutSessionId);
                    if (reread != null && "complete".equals(nullSafe(reread.getStatus()))) {
                        log.info("Checkout Session {} completed while it was being expired",
                                checkoutSessionId);
                        return new SessionOutcome.AlreadyCompleted(reread.getPaymentIntent());
                    }
                    log.error("Stripe refused to expire Checkout Session {} and it is not complete: {}",
                            checkoutSessionId, ex.getMessage(), ex);
                    return new SessionOutcome.Unavailable(
                            "The payment provider could not close the checkout session right now");
                }
            }
        }
    }

    @Override
    public RefundOutcome refund(RefundRequest request) {
        try {
            RefundCreateParams params = RefundCreateParams.builder()
                    .setPaymentIntent(request.providerRef())
                    .setAmount(toMinorUnits(request.amount()))
                    .build();
            Refund refund = client.refunds().create(params, RequestOptions.builder()
                    .setIdempotencyKey(request.idempotencyKey())
                    .build());
            log.info("Stripe refunded {} {} of payment intent {} (refund {}, idempotencyKey={})",
                    request.amount(), request.currency(), request.providerRef(), refund.getId(),
                    request.idempotencyKey());
            return new RefundOutcome.Refunded(refund.getId());
        }
        catch (StripeException ex) {
            log.error("Stripe refused to refund payment intent {}: {}",
                    request.providerRef(), ex.getMessage(), ex);
            return new RefundOutcome.Unavailable(
                    "The payment provider could not process the refund right now");
        }
    }

    /**
     * @param sessionId session to read back
     * @return the session, or {@code null} when Stripe could not be reached — the caller decides
     *         what an unreadable session means for the order
     */
    private Session retrieveSession(String sessionId) {
        try {
            return client.checkout().sessions().retrieve(sessionId);
        }
        catch (StripeException ex) {
            log.error("Stripe refused to read back Checkout Session {}: {}",
                    sessionId, ex.getMessage(), ex);
            return null;
        }
    }

    private static String nullSafe(String value) {
        return value == null ? "" : value;
    }

    /**
     * Stripe charges in the currency's smallest unit (cents for EUR, whole units for JPY), so the
     * number of fraction digits comes from the currency itself instead of a hard-coded 100.
     */
    private long toMinorUnits(BigDecimal amount) {
        int fractionDigits;
        try {
            fractionDigits = Currency.getInstance(currency.toUpperCase()).getDefaultFractionDigits();
        }
        catch (IllegalArgumentException ex) {
            fractionDigits = DEFAULT_FRACTION_DIGITS;
        }
        if (fractionDigits < 0) {
            fractionDigits = DEFAULT_FRACTION_DIGITS;
        }
        return amount.setScale(fractionDigits, RoundingMode.HALF_UP)
                .movePointRight(fractionDigits).longValueExact();
    }

    /** Same short reference order-service shows, recomputed for presentation only. */
    private static String orderNumber(java.util.UUID orderId) {
        return "ORD-" + orderId.toString().substring(0, 8).toUpperCase(Locale.ROOT);
    }

    private static OffsetDateTime toOffsetDateTime(Long epochSeconds) {
        return epochSeconds == null
                ? null : Instant.ofEpochSecond(epochSeconds).atOffset(ZoneOffset.UTC);
    }
}
