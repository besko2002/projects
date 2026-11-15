package com.example.moviereservation.demo;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DemoSafetyValidatorTest {

    @Test
    void rejectsLiveStripeSecretKeyWhenDemoEnabled() {
        assertThatThrownBy(() -> new DemoSafetyValidator(true, "sk_" + "live_51Abc123FakeProductionKey"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Live Stripe keys are strictly forbidden when demo mode is enabled");

        assertThatThrownBy(() -> new DemoSafetyValidator(true, "rk_" + "live_51Abc123FakeRestrictedLiveKey"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Live Stripe keys are strictly forbidden when demo mode is enabled");

        assertThatThrownBy(() -> new DemoSafetyValidator(true, "invalid_prefix_key"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Live Stripe keys are strictly forbidden when demo mode is enabled");
    }

    @Test
    void acceptsTestStripeSecretKeyWhenDemoEnabled() {
        assertThatCode(() -> new DemoSafetyValidator(true, "sk_" + "test_51Abc123FakeTestKey"))
                .doesNotThrowAnyException();

        assertThatCode(() -> new DemoSafetyValidator(true, "rk_" + "test_51Abc123FakeRestrictedKey"))
                .doesNotThrowAnyException();

        assertThatCode(() -> new DemoSafetyValidator(true, ""))
                .doesNotThrowAnyException();

        assertThatCode(() -> new DemoSafetyValidator(true, null))
                .doesNotThrowAnyException();
    }

    @Test
    void ignoresLiveKeysWhenDemoDisabled() {
        // When demo is disabled, live keys are allowed (production mode)
        assertThatCode(() -> new DemoSafetyValidator(false, "sk_" + "live_51Abc123FakeProductionKey"))
                .doesNotThrowAnyException();
    }
}
