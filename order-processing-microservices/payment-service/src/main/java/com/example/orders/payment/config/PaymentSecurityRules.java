package com.example.orders.payment.config;

import com.example.orders.support.security.ServiceAuthorizationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;

/**
 * payment-service's own slice of the shared filter chain.
 *
 * <p>Exactly one rule to declare: the Stripe webhook is the provider's way of talking to this
 * service, it arrives without a JWT, and its authentication is the {@code Stripe-Signature}
 * header verified inside the endpoint. Everything else under {@code /api/payments} falls through
 * to the closing {@code anyRequest().authenticated()} of service-support, with the per-payment
 * ownership check in the query service.
 *
 * <p>The gateway permits the same path for the same reason — the provider is not one of this
 * system's JWT holders, and its signature is a strictly stronger proof of authenticity.
 */
@Configuration(proxyBeanMethods = false)
class PaymentSecurityRules {

    @Bean
    ServiceAuthorizationCustomizer paymentAuthorizationRules() {
        return registry -> registry
                .requestMatchers(HttpMethod.POST, "/api/payments/stripe/webhook").permitAll();
    }
}
