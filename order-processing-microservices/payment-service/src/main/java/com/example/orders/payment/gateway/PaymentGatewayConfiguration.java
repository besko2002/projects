package com.example.orders.payment.gateway;

import com.stripe.StripeClient;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Chooses the {@link PaymentGateway} implementation once, at startup.
 *
 * <p>One explicit branch instead of conditional beans: exactly one {@code PaymentGateway} bean
 * always exists, so no code path is ever without a provider port.
 *
 * <ul>
 *   <li>{@code PAYMENT_PROVIDER=simulated} (explicit) → {@link SimulatedPaymentGateway}, the
 *       deterministic local provider the automated tests and the offline demo loop use.</li>
 *   <li>{@code PAYMENT_PROVIDER=stripe} or unset with {@code STRIPE_SECRET_KEY} configured →
 *       {@link StripePaymentGateway}, real Stripe (test mode only).</li>
 *   <li>anything else → {@link UnavailablePaymentGateway}: payment-service starts, but charging
 *       fails with a clear reason. The simulated provider is deliberately <em>not</em> the
 *       fallback — a deployment that meant to use Stripe must never drift into fake successes.</li>
 * </ul>
 *
 * <p>Safety around keys: a secret key that does not start with {@code sk_test_} is refused,
 * always. This project is a test-mode-only portfolio application — there is no override flag. A
 * live key is treated as a misconfiguration the same way a missing one is: it is never sent
 * anywhere, and charging fails with a clear, logged reason until a test key is configured.
 */
@Configuration
class PaymentGatewayConfiguration {

    private static final Logger log = LoggerFactory.getLogger(PaymentGatewayConfiguration.class);

    private static final String TEST_KEY_PREFIX = "sk_test_";

    @Bean
    PaymentGateway paymentGateway(
            @Value("${payments.provider:}") String provider,
            @Value("${payments.secret-key:}") String stripeSecretKey,
            @Value("${payments.currency:EUR}") String stripeCurrency,
            @Value("${payments.storefront-base-url:http://localhost:5179}") String storefrontBaseUrl,
            @Value("${payments.decline-above:1000.00}") String declineAbove,
            @Value("${payments.failure-rate:0}") double failureRate) {
        String requested = provider == null ? "" : provider.trim().toLowerCase();
        String key = stripeSecretKey == null ? "" : stripeSecretKey.trim();
        boolean keyIsUsableTestKey = key.startsWith(TEST_KEY_PREFIX);

        switch (requested) {
            case "simulated" -> {
                log.info("Payment provider: SIMULATED (no real money moves; every payment response "
                        + "carries simulated: true)");
                return new SimulatedPaymentGateway(
                        new java.math.BigDecimal(declineAbove), failureRate);
            }
            case "stripe" -> {
                if (key.isEmpty()) {
                    log.error("PAYMENT_PROVIDER=stripe but STRIPE_SECRET_KEY is not configured: "
                            + "charges will fail with a clear reason until the key is set");
                    return new UnavailablePaymentGateway(
                            "Payment is unavailable: the payment provider is set to Stripe but "
                                    + "STRIPE_SECRET_KEY is not configured");
                }
                if (!keyIsUsableTestKey) {
                    log.error("Refusing a Stripe key that is not a test key: this application is "
                            + "test-mode only, the key is not used anywhere");
                    return new UnavailablePaymentGateway(
                            "Payment is unavailable: the configured Stripe key is not a test key "
                                    + "(it must start with sk_test_)");
                }
                log.info("Payment provider: STRIPE (test mode), storefront {}", storefrontBaseUrl);
                return new StripePaymentGateway(new StripeClient(key), stripeCurrency,
                        storefrontBaseUrl);
            }
            default -> {
                if (key.isEmpty()) {
                    return new UnavailablePaymentGateway(
                            "Payment is unavailable: no payment provider is configured "
                                    + "(set STRIPE_SECRET_KEY, or PAYMENT_PROVIDER=simulated for the "
                                    + "deterministic demo provider)");
                }
                if (!keyIsUsableTestKey) {
                    log.error("STRIPE_SECRET_KEY is configured but is not a test key; treating "
                            + "payments as unavailable: this application is test-mode only, the "
                            + "key is not used anywhere");
                    return new UnavailablePaymentGateway(
                            "Payment is unavailable: the configured Stripe key is not a test key "
                                    + "(it must start with sk_test_)");
                }
                log.info("Payment provider: STRIPE (chosen because STRIPE_SECRET_KEY is set), "
                        + "storefront {}", storefrontBaseUrl);
                return new StripePaymentGateway(new StripeClient(key), stripeCurrency,
                        storefrontBaseUrl);
            }
        }
    }
}
