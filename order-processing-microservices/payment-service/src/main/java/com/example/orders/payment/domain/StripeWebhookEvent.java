package com.example.orders.payment.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

/**
 * One verified Stripe webhook delivery, keyed by the provider's own event id — the webhook's
 * de-duplication note, in the same spirit as {@code processed_events} but for provider-generated
 * string ids instead of this system's UUIDs. A redelivered {@code evt_...} finds its row and
 * changes nothing the second time; the payment's own state guards stay behind it as the second
 * line of defense.
 */
@Entity
@Table(name = "stripe_webhook_events")
public class StripeWebhookEvent {

    @Id
    @Column(name = "event_id", nullable = false, updatable = false, length = 255)
    private String eventId;

    @Column(name = "event_type", nullable = false, length = 100)
    private String eventType;

    @Column(name = "received_at", nullable = false, updatable = false)
    private OffsetDateTime receivedAt;

    protected StripeWebhookEvent() {
        // for JPA
    }

    private StripeWebhookEvent(String eventId, String eventType) {
        this.eventId = eventId;
        this.eventType = eventType;
        this.receivedAt = OffsetDateTime.now(ZoneOffset.UTC);
    }

    /**
     * @param eventId   Stripe's event id, {@code evt_...}
     * @param eventType Stripe's event type, e.g. {@code checkout.session.completed}
     * @return a note that this delivery was accepted
     */
    public static StripeWebhookEvent of(String eventId, String eventType) {
        return new StripeWebhookEvent(eventId, eventType);
    }

    public String getEventId() {
        return eventId;
    }

    public String getEventType() {
        return eventType;
    }

    public OffsetDateTime getReceivedAt() {
        return receivedAt;
    }
}
