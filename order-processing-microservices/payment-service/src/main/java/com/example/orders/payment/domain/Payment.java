package com.example.orders.payment.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * One payment attempt for one order, mapped to {@code payments} from
 * {@code V2__create_payments.sql} plus {@code V4__stripe_payments.sql}.
 *
 * <p>There is at most one row per order — {@code order_id} is {@code UNIQUE} — and that is the
 * service's contract with the saga: however often {@code ProcessPayment} is delivered, the customer
 * is charged once. The outcome of the first attempt is what every later delivery reports back.
 *
 * <p>Two providers exist. The {@code SIMULATED} provider decides instantly and its row goes
 * straight to {@code AUTHORIZED}/{@code FAILED}. The {@code STRIPE} provider needs the customer:
 * the row starts {@code AWAITING_CUSTOMER} with the hosted checkout session's id and URL, and only
 * the provider's webhook (verified, idempotent) moves it to {@code AUTHORIZED} or {@code FAILED}.
 * {@code provider} is stored per row so a payment keeps telling the truth about how it was paid
 * even after the configuration changed.
 *
 * <p>The customer id is copied from the command rather than looked up: payment-service does not read
 * order_db, and it still has to be able to tell whether the caller of
 * {@code GET /api/payments/order/{orderId}} owns the payment.
 */
@Entity
@Table(name = "payments")
public class Payment {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "order_id", nullable = false, updatable = false, unique = true)
    private UUID orderId;

    @Column(name = "customer_id", nullable = false, updatable = false)
    private UUID customerId;

    @Column(name = "amount", nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, length = 3, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private PaymentStatus status;

    /**
     * Which provider this payment belongs to: {@code SIMULATED}, {@code STRIPE}, or {@code NONE}
     * when no provider was available to even attempt the charge. Stored on the row, not read from
     * configuration, so the response is honest about how this particular payment was handled.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "provider", nullable = false, length = 20, updatable = false)
    private PaymentProvider provider = PaymentProvider.SIMULATED;

    @Column(name = "failure_reason", length = 500)
    private String failureReason;

    @Column(name = "provider_ref", length = 100)
    private String providerRef;

    /**
     * The provider's hosted checkout session, while {@link PaymentStatus#AWAITING_CUSTOMER}. The
     * session id is also how the provider's webhook deliveries find this row, and the unique index
     * keeps one session from ever completing two payments.
     */
    @Column(name = "checkout_session_id", length = 255, unique = true)
    private String checkoutSessionId;

    @Column(name = "checkout_url", length = 1000)
    private String checkoutUrl;

    /** When the session stops being payable; advisory, the saga's timeout is the authority. */
    @Column(name = "checkout_expires_at")
    private OffsetDateTime checkoutExpiresAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected Payment() {
        // for JPA
    }

    private Payment(UUID orderId, UUID customerId, BigDecimal amount, String currency,
            PaymentProvider provider, PaymentStatus status, String failureReason,
            String providerRef) {
        this.id = UUID.randomUUID();
        this.orderId = orderId;
        this.customerId = customerId;
        this.amount = amount.setScale(2, RoundingMode.HALF_UP);
        this.currency = currency;
        this.provider = provider;
        this.status = status;
        this.failureReason = trim(failureReason);
        this.providerRef = providerRef;
        this.createdAt = OffsetDateTime.now(ZoneOffset.UTC);
        this.updatedAt = this.createdAt;
    }

    /**
     * @param orderId     order that was paid for
     * @param customerId  who was charged
     * @param amount      amount charged
     * @param currency    ISO 4217 code
     * @param provider    which provider took the charge
     * @param providerRef the provider's own reference
     * @return a successful payment
     */
    public static Payment authorized(
            UUID orderId, UUID customerId, BigDecimal amount, String currency,
            PaymentProvider provider, String providerRef) {
        return new Payment(orderId, customerId, amount, currency, provider,
                PaymentStatus.AUTHORIZED, null, providerRef);
    }

    /**
     * @param orderId    order that was not paid for
     * @param customerId who would have been charged
     * @param amount     amount that was declined
     * @param currency   ISO 4217 code
     * @param provider   which provider answered (or {@code NONE} when none was configured)
     * @param reason     why the gateway declined
     * @return a failed payment; the row is kept so a redelivery reports the same outcome
     */
    public static Payment failed(
            UUID orderId, UUID customerId, BigDecimal amount, String currency,
            PaymentProvider provider, String reason) {
        return new Payment(orderId, customerId, amount, currency, provider,
                PaymentStatus.FAILED, reason, null);
    }

    /**
     * @param orderId        order waiting for its customer to pay
     * @param customerId     who is being asked to pay
     * @param paymentId      id the row will carry (generated up front so it can travel in the
     *                       checkout session's metadata)
     * @param amount         amount the customer is asked for
     * @param currency       ISO 4217 code
     * @param provider       the real provider that opened the session
     * @param sessionId      the provider's session reference
     * @param checkoutUrl    the hosted page to send the customer to
     * @param checkoutExpiry when the session stops being payable, may be {@code null}
     * @return a payment that waits for the customer
     */
    public static Payment awaitingCustomer(
            UUID orderId, UUID customerId, UUID paymentId, BigDecimal amount, String currency,
            PaymentProvider provider, String sessionId, String checkoutUrl,
            OffsetDateTime checkoutExpiry) {
        Payment payment = new Payment(orderId, customerId, amount, currency, provider,
                PaymentStatus.AWAITING_CUSTOMER, null, null);
        payment.id = paymentId;
        payment.checkoutSessionId = sessionId;
        payment.checkoutUrl = checkoutUrl;
        payment.checkoutExpiresAt = checkoutExpiry;
        return payment;
    }

    @PreUpdate
    void touch() {
        this.updatedAt = OffsetDateTime.now(ZoneOffset.UTC);
    }

    /**
     * The customer paid: a hosted checkout session completed. Guarded — only an
     * {@code AWAITING_CUSTOMER} payment can be completed, so an out-of-order webhook delivery can
     * never resurrect a failed or refunded payment.
     *
     * @param providerRef the provider's reference of the charge (e.g. the Stripe payment intent)
     * @return whether this call changed anything
     */
    public boolean markCompleted(String providerRef) {
        if (this.status != PaymentStatus.AWAITING_CUSTOMER) {
            return false;
        }
        this.status = PaymentStatus.AUTHORIZED;
        this.providerRef = providerRef;
        this.failureReason = null;
        return true;
    }

    /**
     * The payment never happened: the session expired, the provider reported a failure, or the
     * saga closed the session after cancelling the order. Guarded the same way as
     * {@link #markCompleted(String)}.
     *
     * @param reason why there is no money, shown to the customer
     * @return whether this call changed anything
     */
    public boolean markFailed(String reason) {
        if (this.status != PaymentStatus.AWAITING_CUSTOMER) {
            return false;
        }
        this.status = PaymentStatus.FAILED;
        this.failureReason = trim(reason);
        return true;
    }

    /**
     * Records a failed payment <em>attempt</em> on a checkout the customer can still pay
     * ({@code PAY-2}): a declined card does not close a Checkout Session, and the same session
     * completes when the customer retries. The status stays {@code AWAITING_CUSTOMER}; the reason
     * is bookkeeping for the last attempt (a later completion clears it, an expiry/cancel
     * overwrites it with the terminal reason).
     *
     * @param reason why the attempt did not take the money
     */
    public void recordAttemptFailure(String reason) {
        if (this.status != PaymentStatus.AWAITING_CUSTOMER) {
            // Not a state change, but also not a place for an attempt note: the row is already
            // terminal, and its reason describes how it got there.
            return;
        }
        this.failureReason = trim(reason);
    }

    /**
     * Gives an authorised charge back.
     *
     * @param reason why the money is going back
     * @return whether this call changed anything; {@code false} for an already refunded or failed
     *         payment, which is what makes a redelivered {@code RefundPayment} a no-op
     */
    public boolean refund(String reason) {
        if (this.status != PaymentStatus.AUTHORIZED) {
            return false;
        }
        this.status = PaymentStatus.REFUNDED;
        this.failureReason = trim(reason);
        return true;
    }

    /** @return whether the money is currently ours */
    public boolean isAuthorized() {
        return status == PaymentStatus.AUTHORIZED;
    }

    /** @return whether the customer still has a checkout to finish */
    public boolean isAwaitingCustomer() {
        return status == PaymentStatus.AWAITING_CUSTOMER;
    }

    private static String trim(String reason) {
        if (reason == null) {
            return null;
        }
        return reason.length() <= 500 ? reason : reason.substring(0, 500);
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCurrency() {
        return currency;
    }

    public PaymentStatus getStatus() {
        return status;
    }

    public PaymentProvider getProvider() {
        return provider;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public String getProviderRef() {
        return providerRef;
    }

    public String getCheckoutSessionId() {
        return checkoutSessionId;
    }

    public String getCheckoutUrl() {
        return checkoutUrl;
    }

    public OffsetDateTime getCheckoutExpiresAt() {
        return checkoutExpiresAt;
    }

    public long getVersion() {
        return version;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public OffsetDateTime getUpdatedAt() {
        return updatedAt;
    }
}
