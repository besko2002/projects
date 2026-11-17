package com.example.orders.payment.domain;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Payments are addressed by the order they belong to — and, once a real provider is involved, by
 * the provider's own references, because that is what its webhook deliveries carry.
 */
public interface PaymentRepository extends JpaRepository<Payment, UUID> {

    /**
     * @param orderId order the payment belongs to
     * @return the single payment of that order, if there is one
     */
    Optional<Payment> findByOrderId(UUID orderId);

    /**
     * @param providerRef the provider's reference of the charge, e.g. a Stripe payment intent id
     * @return the payment that charge belongs to
     */
    Optional<Payment> findByProviderRef(String providerRef);

    /**
     * @param checkoutSessionId the provider's hosted checkout session id
     * @return the payment that session was opened for
     */
    Optional<Payment> findByCheckoutSessionId(String checkoutSessionId);
}
