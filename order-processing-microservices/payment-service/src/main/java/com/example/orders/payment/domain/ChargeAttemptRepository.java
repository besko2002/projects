package com.example.orders.payment.domain;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The one charge attempt of an order, keyed by the order id itself: the table is the attempt's
 * durable memory, read back by every delivery of every command for that order.
 */
public interface ChargeAttemptRepository extends JpaRepository<ChargeAttempt, UUID> {
}
