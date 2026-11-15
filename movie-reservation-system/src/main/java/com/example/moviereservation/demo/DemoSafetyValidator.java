package com.example.moviereservation.demo;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Guards against inadvertent live Stripe key usage in demo mode.
 * When {@code app.demo.enabled=true}, any configured Stripe secret key must be a test key.
 */
@Component
public class DemoSafetyValidator {

    public DemoSafetyValidator(@Value("${app.demo.enabled:false}") boolean demoEnabled,
                               @Value("${app.stripe.secret-key:}") String stripeSecretKey) {
        if (demoEnabled && stripeSecretKey != null && !stripeSecretKey.isBlank()) {
            String trimmed = stripeSecretKey.trim();
            if (!trimmed.startsWith("sk_test_") && !trimmed.startsWith("rk_test_")) {
                throw new IllegalStateException(
                        "Live Stripe keys are strictly forbidden when demo mode is enabled (app.demo.enabled=true). "
                                + "Only Stripe test keys (starting with sk_test_ or rk_test_) are allowed.");
            }
        }
    }
}
