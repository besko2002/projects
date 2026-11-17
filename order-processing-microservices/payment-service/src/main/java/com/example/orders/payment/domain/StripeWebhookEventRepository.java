package com.example.orders.payment.domain;

import java.time.OffsetDateTime;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** De-duplication notes of the Stripe webhook endpoint, keyed by the provider's event id. */
public interface StripeWebhookEventRepository extends JpaRepository<StripeWebhookEvent, String> {

    /**
     * Claims a delivery inside the caller's transaction: the insert decides who wins when two
     * copies of the same event arrive together (the loser's flush fails, like the saga's notes).
     *
     * @param eventId   Stripe's event id
     * @param eventType Stripe's event type
     * @return {@code true} when this caller may apply the event
     */
    default boolean claim(String eventId, String eventType) {
        if (existsById(eventId)) {
            return false;
        }
        saveAndFlush(StripeWebhookEvent.of(eventId, eventType));
        return true;
    }

    /**
     * Drops notes older than any plausible redelivery, on the same schedule as the other
     * housekeeping sweeps.
     *
     * @param cutoff deliveries received before this instant are forgotten
     * @return how many notes were removed
     */
    @Modifying
    @Query("delete from StripeWebhookEvent e where e.receivedAt < :cutoff")
    int deleteReceivedBefore(@Param("cutoff") OffsetDateTime cutoff);
}
