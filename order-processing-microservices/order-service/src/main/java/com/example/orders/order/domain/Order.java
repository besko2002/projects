package com.example.orders.order.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * An order and its priced lines, mapped to the {@code orders} table from
 * {@code V2__create_orders.sql} (Flyway owns the schema; {@code ddl-auto=validate} only checks
 * that this mapping still matches it).
 *
 * <p>The entity name is {@code OrderAggregate} rather than {@code Order}: {@code order} is a
 * keyword in the query language, and giving the entity a name that never has to be quoted keeps
 * every derived query unambiguous. The table is still {@code orders}.
 *
 * <p>The total is the sum of the stored line totals, computed once at creation. Nothing
 * recalculates it from the catalog later — see {@link OrderLine} for why.
 */
@Entity(name = "OrderAggregate")
@Table(name = "orders")
public class Order {

    /** Currency every order is priced in for now; the catalog has no multi-currency prices. */
    public static final String DEFAULT_CURRENCY = "EUR";

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Owner of the order: the {@code sub} claim of the token that created it. */
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private OrderStatus status;

    @Column(name = "total_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal totalAmount;

    @Column(name = "currency", nullable = false, length = 3, updatable = false)
    private String currency;

    @Column(name = "idempotency_key", length = 100, updatable = false)
    private String idempotencyKey;

    @Column(name = "failure_reason", length = 500)
    private String failureReason;

    /**
     * The reservation inventory-service took for this order, learned from {@code StockReserved}.
     * A plain column, not a foreign key: the row lives in another service's database, and this
     * service can only ask for it to be released.
     */
    @Column(name = "reservation_id")
    private UUID reservationId;

    /**
     * The payment payment-service recorded <strong>and this order has proof of</strong>: either the
     * charge completed while the order was live ({@code PaymentCompleted}), or a late completion
     * arrived for an order the saga had already given up on (tracked for its refund). It is
     * deliberately <em>not</em> written while the customer is merely holding a checkout link —
     * "a checkout was opened" and "money was taken" are different facts (see
     * {@link #checkoutPaymentId}).
     */
    @Column(name = "payment_id")
    private UUID paymentId;

    /**
     * The payment behind the hosted checkout, learned from {@code PaymentAwaitingCustomer}: its id
     * is the identity the {@code ExpirePayment} command is built from, so the checkout can be
     * closed even when {@link #paymentUrl} was never stored (a cancellation that overtook the
     * awaiting event must not drop the close). Distinct from {@link #paymentId} on purpose: an
     * awaiting checkout is not money taken.
     */
    @Column(name = "checkout_payment_id")
    private UUID checkoutPaymentId;

    /**
     * The hosted checkout page payment-service opened for this order, learned from
     * {@code PaymentAwaitingCustomer}. Non-null means a checkout was (or may still be) open for a
     * real provider: the API exposes it while the order waits for payment, and the saga uses the
     * fact as its signal to have the session closed when the order is cancelled or times out —
     * payment-service decides what the close is worth, and answers a completion it finds instead.
     * Presentation only: the checkout's identity lives in {@link #checkoutPaymentId}, so the link
     * is never re-shown after the saga gave up on the order.
     */
    @Column(name = "payment_url", length = 1000)
    private String paymentUrl;

    /**
     * When the provider itself stops accepting the checkout's payment, carried by
     * {@code PaymentAwaitingCustomer}. Advisory to the customer, but a hard fact for the saga: the
     * timeout sweeper may cancel an order past this deadline even when the configured payment
     * window would still keep it open, and must not cancel a valid checkout that is still payable.
     */
    @Column(name = "checkout_expires_at")
    private OffsetDateTime checkoutExpiresAt;

    /**
     * When the saga gave up on the checkout and queued its {@code ExpirePayment} close, stamped
     * once by {@link #markCheckoutClosed()}. The stamp is the close command's de-duplication mark —
     * a re-announced {@code PaymentAwaitingCustomer} (fresh event id, same fact) finds it and
     * queues nothing — and closing also retires the stored {@link #paymentUrl}: an order the saga
     * has cancelled must not keep handing out a link it will never honour.
     */
    @Column(name = "checkout_closed_at")
    private OffsetDateTime checkoutClosedAt;

    /**
     * The saga's own view of the refund for {@link #paymentId}. Kept separately from the status
     * because a cancelled order is final and can still owe the customer their money — see
     * {@link RefundStatus} for why.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "refund_status", nullable = false, length = 20)
    private RefundStatus refundStatus = RefundStatus.NONE;

    /**
     * When the refund of {@link #paymentId} was last commanded (the first request or a recovery
     * re-queue, whichever is more recent). The recovery sweep reads it as the base for its retry
     * interval, so a lost refund is re-commanded on a deliberate cadence instead of on every
     * scheduler tick; see {@code V6__refund_recovery.sql}.
     */
    @Column(name = "refund_retry_at")
    private OffsetDateTime refundRetryAt;

    /** Optimistic-locking guard: two saga events for one order cannot both win. */
    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    /**
     * Lines are part of the order, never addressed on their own, so they are cascaded and
     * orphan-removed: the aggregate is the only way in.
     */
    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("productName ASC")
    private List<OrderLine> items = new ArrayList<>();

    protected Order() {
        // for JPA
    }

    private Order(UUID userId, String currency, String idempotencyKey) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.status = OrderStatus.PENDING;
        this.totalAmount = BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);
        this.currency = currency;
        this.idempotencyKey = idempotencyKey;
        this.createdAt = OffsetDateTime.now(ZoneOffset.UTC);
        this.updatedAt = this.createdAt;
    }

    /**
     * @param userId         owner, taken from the token
     * @param currency       ISO 4217 code, three letters
     * @param idempotencyKey replay guard supplied by the client, may be {@code null}
     * @return an empty {@code PENDING} order; add its lines with {@link #addLine}
     */
    public static Order pending(UUID userId, String currency, String idempotencyKey) {
        return new Order(userId, currency, idempotencyKey);
    }

    @PreUpdate
    void touch() {
        this.updatedAt = OffsetDateTime.now(ZoneOffset.UTC);
    }

    /**
     * Appends a priced line and folds its total into the order total.
     *
     * @param productId   catalog id
     * @param productName name as the catalog had it when the order was placed
     * @param unitPrice   price as the catalog had it when the order was placed
     * @param quantity    units ordered, positive
     * @return the stored line
     */
    public OrderLine addLine(UUID productId, String productName, BigDecimal unitPrice, int quantity) {
        OrderLine line = new OrderLine(this, productId, productName, unitPrice, quantity);
        this.items.add(line);
        this.totalAmount = this.totalAmount.add(line.getLineTotal());
        return line;
    }

    // ------------------------------------------------------------------ saga transitions
    //
    // Plain state mutators: *whether* a transition is allowed is decided by the saga, which knows
    // the event it is reacting to and can log an unexpected one instead of applying it. Putting the
    // guard here as well would only duplicate that decision in a place with less context.

    /**
     * Stock is held and the charge has been requested.
     *
     * @param reservationId reservation inventory-service created, may be {@code null} if unknown
     */
    public void markPaymentPending(UUID reservationId) {
        this.status = OrderStatus.PAYMENT_PENDING;
        this.reservationId = reservationId;
        this.failureReason = null;
    }

    /**
     * The charge went through.
     *
     * @param paymentId payment payment-service recorded
     */
    public void markConfirmed(UUID paymentId) {
        this.status = OrderStatus.CONFIRMED;
        this.paymentId = paymentId;
        this.failureReason = null;
    }

    /**
     * Turned down before anything moved.
     *
     * @param reason why, shown to the customer
     */
    public void markRejected(String reason) {
        this.status = OrderStatus.REJECTED;
        this.failureReason = trim(reason);
    }

    /**
     * Undone after it had progressed.
     *
     * @param reason why, shown to the customer
     */
    public void markCancelled(String reason) {
        this.status = OrderStatus.CANCELLED;
        this.failureReason = trim(reason);
    }

    /**
     * Cancellation accepted, waiting for the refund to come back.
     *
     * @param reason why, shown to the customer
     */
    public void markCancellationPending(String reason) {
        this.status = OrderStatus.CANCELLATION_PENDING;
        this.failureReason = trim(reason);
    }

    /**
     * @param reservationId reservation this order holds
     */
    public void rememberReservation(UUID reservationId) {
        this.reservationId = reservationId;
    }

    /**
     * Records the id of a payment whose answer arrived, without touching the status. Used when the
     * answer is <em>late</em> (the saga already cancelled the order): the payment still happened, so
     * the refund of exactly this payment has to be trackable — but {@code markConfirmed} would be
     * wrong, as it would re-confirm a cancelled order.
     *
     * @param paymentId payment payment-service recorded
     */
    public void rememberPayment(UUID paymentId) {
        this.paymentId = paymentId;
    }

    /**
     * Records a payment that is waiting for its customer, learned from
     * {@code PaymentAwaitingCustomer}: the checkout's payment id (the identity the saga closes the
     * session with, even for a cancelled order where no URL may be kept), the hosted page, and the
     * provider's own deadline. Callers decide whether the checkout is still relevant; the order
     * only remembers what payment-service reported. Deliberately does <em>not</em> touch
     * {@code paymentId}: an awaiting checkout is not money taken.
     *
     * @param paymentId       the payment that is {@code AWAITING_CUSTOMER}
     * @param paymentUrl      the hosted checkout page, or {@code null} when the saga must not
     *                        expose one (the checkout of an already-cancelled order)
     * @param checkoutExpires when the provider stops accepting the session's payment, may be
     *                        {@code null} when unknown
     */
    public void rememberCheckout(UUID paymentId, String paymentUrl, OffsetDateTime checkoutExpires) {
        this.checkoutPaymentId = paymentId;
        this.paymentUrl = paymentUrl;
        this.checkoutExpiresAt = checkoutExpires;
    }

    /**
     * Marks the checkout closed after its {@code ExpirePayment} command has been queued: the close
     * is commanded once per checkout — later awaiting events for the same checkout are then
     * dropped instead of queueing the close again — and the stored link is retired, so a cancelled
     * order never exposes a payable page. The checkout's identity is deliberately kept: it is what
     * a re-announced awaiting event is recognised against.
     */
    public void markCheckoutClosed() {
        this.checkoutClosedAt = OffsetDateTime.now(ZoneOffset.UTC);
        this.paymentUrl = null;
        this.checkoutExpiresAt = null;
    }

    /** @return whether the saga has already queued the close of this order's checkout */
    public boolean isCheckoutClosed() {
        return this.checkoutClosedAt != null;
    }

    /**
     * Marks a {@code RefundPayment} command as queued; callers queue the command in the same
     * transaction, so the flag can never claim a refund that is not actually on its way.
     *
     * @return whether this call was the one that requested the refund ({@code false} means a
     *         refund of the tracked payment is already requested or settled, and queueing another
     *         command would duplicate the effect)
     */
    public boolean requestRefund() {
        if (this.refundStatus != RefundStatus.NONE) {
            return false;
        }
        this.refundStatus = RefundStatus.REQUESTED;
        this.refundRetryAt = OffsetDateTime.now(ZoneOffset.UTC);
        return true;
    }

    /** Applies a {@code PaymentRefunded} event: the tracked refund is finished. */
    public void markRefunded() {
        this.refundStatus = RefundStatus.REFUNDED;
    }

    /**
     * Records that the refund was (re-)commanded just now. {@code requestRefund()} stamps the
     * first attempt; every recovery re-queue calls this so the next attempt waits one retry
     * interval. The caller writes the outbox row in the same transaction, so the timestamp never
     * claims an attempt that was not queued.
     *
     * @param now the moment of this attempt
     */
    public void bookRefundRetry(OffsetDateTime now) {
        this.refundRetryAt = now;
    }

    private static String trim(String reason) {
        if (reason == null) {
            return null;
        }
        return reason.length() <= 500 ? reason : reason.substring(0, 500);
    }

    /**
     * @return a short human-facing reference derived from the id, e.g. {@code ORD-3F2A1B7C}. It is
     *         not stored: the id already is the business key, and a second unique number would be
     *         one more thing to keep consistent for no gain.
     */
    public String getOrderNumber() {
        return orderNumberOf(this.id);
    }

    /**
     * @param orderId an order id
     * @return the same reference {@link #getOrderNumber()} would produce for it
     */
    public static String orderNumberOf(UUID orderId) {
        return "ORD-" + orderId.toString().substring(0, 8).toUpperCase(Locale.ROOT);
    }

    public UUID getId() {
        return id;
    }

    public UUID getUserId() {
        return userId;
    }

    public OrderStatus getStatus() {
        return status;
    }

    public BigDecimal getTotalAmount() {
        return totalAmount;
    }

    public String getCurrency() {
        return currency;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public UUID getReservationId() {
        return reservationId;
    }

    public UUID getPaymentId() {
        return paymentId;
    }

    /** @return the payment behind the hosted checkout, while one is known, else {@code null} */
    public UUID getCheckoutPaymentId() {
        return checkoutPaymentId;
    }

    /** @return the hosted checkout page while one is known, else {@code null} */
    public String getPaymentUrl() {
        return paymentUrl;
    }

    /** @return when the provider stops accepting the checkout's payment, or {@code null} */
    public OffsetDateTime getCheckoutExpiresAt() {
        return checkoutExpiresAt;
    }

    public RefundStatus getRefundStatus() {
        return refundStatus;
    }

    public OffsetDateTime getRefundRetryAt() {
        return refundRetryAt;
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

    public List<OrderLine> getItems() {
        return List.copyOf(items);
    }
}
