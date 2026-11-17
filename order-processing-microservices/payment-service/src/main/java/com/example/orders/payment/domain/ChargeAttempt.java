package com.example.orders.payment.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/**
 * The one charge attempt of one order, mapped to {@code charge_attempts} from
 * {@code V5__charge_attempts.sql}.
 *
 * <p>This row is written <strong>before</strong> the provider is called, and it is what makes a
 * retried charge safe ({@code PAY-3}): every Stripe parameter that is not the command's own payload
 * — the payment id that travels in the session's metadata and the session's expiry — is decided
 * once, here, and read back on every delivery. A redelivery therefore reaches Stripe with the same
 * idempotency key <em>and</em> the same parameters, which is the contract Stripe's idempotent
 * replay relies on; a key that changes shape between calls is refused, and a different session
 * would be a second payable checkout for one order.
 *
 * <p>The row is deliberately separate from {@link Payment}: a payment is the provider's
 * <em>answer</em>, and no payment row may exist before that answer is known. The attempt is the
 * question — which exists before any answer does.
 *
 * <p>{@code attempts} counts the provider calls made for this attempt, so a provider that cannot be
 * asked at all (an outage, a misconfiguration) is retried a bounded number of times before the
 * charge is recorded as an honest failure instead of being re-asked forever.
 */
@Entity
@Table(name = "charge_attempts")
public class ChargeAttempt {

    @Id
    @Column(name = "order_id", nullable = false, updatable = false)
    private UUID orderId;

    /**
     * The command this attempt was opened by. Every later delivery of <em>any</em> command for the
     * same order reuses it: the provider's idempotency key is derived from it, so a replayed
     * request reaches the same session even when the redelivered command carries a different event
     * id.
     */
    @Column(name = "event_id", nullable = false, updatable = false)
    private UUID eventId;

    /**
     * The payment id the row will carry if the charge opens a hosted checkout — generated up front
     * so it can travel in the session's metadata, persisted here so a retry sends the same one.
     */
    @Column(name = "payment_id", nullable = false, updatable = false)
    private UUID paymentId;

    /**
     * When the requested session stops being payable: {@code now + checkout TTL} at the moment the
     * attempt was opened. Persisted because Stripe refuses an idempotent replay whose
     * {@code expires_at} moved.
     */
    @Column(name = "expires_at", nullable = false, updatable = false)
    private OffsetDateTime expiresAt;

    /** How many times the provider has been asked about this attempt, including the next call. */
    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected ChargeAttempt() {
        // for JPA
    }

    private ChargeAttempt(UUID orderId, UUID eventId, UUID paymentId, OffsetDateTime expiresAt) {
        this.orderId = orderId;
        this.eventId = eventId;
        this.paymentId = paymentId;
        this.expiresAt = expiresAt;
        this.attempts = 0;
        this.createdAt = OffsetDateTime.now(ZoneOffset.UTC);
        this.updatedAt = this.createdAt;
    }

    /**
     * @param orderId   the one order this attempt charges
     * @param eventId   the command that opened it (stable across redeliveries of that command)
     * @param paymentId the payment id the session will carry in its metadata
     * @param expiresAt the requested session expiry, decided once
     * @return an attempt that has not been asked of the provider yet
     */
    public static ChargeAttempt first(UUID orderId, UUID eventId, UUID paymentId,
            OffsetDateTime expiresAt) {
        return new ChargeAttempt(orderId, eventId, paymentId, expiresAt);
    }

    @PreUpdate
    void touch() {
        this.updatedAt = OffsetDateTime.now(ZoneOffset.UTC);
    }

    /**
     * Books one more provider call for this attempt. The caller invokes the provider right after,
     * outside any transaction; the count is what bounds the retries of an unreachable provider.
     *
     * @return the attempt number of the call being booked (1 = the first ask)
     */
    public int bookAttempt() {
        return ++this.attempts;
    }

    /** @return the command that opened this attempt — the stable part of the idempotency key */
    public UUID getEventId() {
        return eventId;
    }

    /** @return the payment id the session's metadata carries */
    public UUID getPaymentId() {
        return paymentId;
    }

    /** @return the requested session expiry, fixed when the attempt was opened */
    public OffsetDateTime getExpiresAt() {
        return expiresAt;
    }

    /** @return how many provider calls this attempt has already had */
    public int getAttempts() {
        return attempts;
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
