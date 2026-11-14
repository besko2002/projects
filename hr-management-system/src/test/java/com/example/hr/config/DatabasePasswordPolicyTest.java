package com.example.hr.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The startup guard for the database password. A missing or placeholder password must stop the
 * application, because a development database that is reachable with "hr" is one published port
 * away from being reachable by anyone.
 */
class DatabasePasswordPolicyTest {

    @Test
    void aMissingPasswordStopsTheApplication() {
        assertThatThrownBy(() -> new DatabasePasswordPolicy("", "hr"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DB_PASSWORD");
        assertThatThrownBy(() -> new DatabasePasswordPolicy(null, "hr"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aTooShortPasswordStopsTheApplication() {
        assertThatThrownBy(() -> new DatabasePasswordPolicy("short1", "hr"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(String.valueOf(DatabasePasswordPolicy.MIN_LENGTH));
    }

    @Test
    void placeholderPasswordsStopTheApplication() {
        // The password that used to be the default everywhere.
        assertThatThrownBy(() -> new DatabasePasswordPolicy("hr", "hr"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new DatabasePasswordPolicy("postgres", "postgres"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new DatabasePasswordPolicy("password", "hr"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new DatabasePasswordPolicy("changeme", "hr"))
                .isInstanceOf(IllegalStateException.class);
        // The user name itself, even long enough.
        assertThatThrownBy(() -> new DatabasePasswordPolicy("a-very-long-user-name", "a-very-long-user-name"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void theErrorMessageNeverEchoesThePassword() {
        assertThatThrownBy(() -> new DatabasePasswordPolicy("postgres", "hr"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining("postgres");
    }

    @Test
    void aStrongPasswordIsAccepted() {
        assertThatCode(() -> new DatabasePasswordPolicy("8fJ2sQ-x7pL4mNc9", "hr"))
                .doesNotThrowAnyException();
    }
}
