package com.example.hr.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import java.util.Locale;
import java.util.Set;

/**
 * Refuses to start the application with a missing or trivial database password.
 *
 * <p>The password has no default anywhere: {@code .env.example} asks for one, Compose refuses
 * to start without it and this guard refuses to boot with a placeholder such as {@code hr}.
 * A development database that is reachable with a one-word password is a real risk the moment
 * the port is not bound to loopback any more, so the check is enforced in code rather than only
 * documented.
 *
 * <p>The password itself is never echoed in the error message - only the rule that was broken.
 */
@Configuration
public class DatabasePasswordPolicy {

    /** Placeholders that must never be used as a password, whatever the environment. */
    private static final Set<String> PLACEHOLDERS = Set.of(
            "hr", "postgres", "password", "passwort", "secret", "changeme", "change-me",
            "admin", "administrator", "root", "letmein", "welcome", "qwerty", "123456",
            "123456789", "dbpassword", "db_password", "localdev", "local-dev");

    /** Minimum length. Long beats clever: the rule only has to reject the obvious mistakes. */
    static final int MIN_LENGTH = 12;

    /**
     * @param password the configured datasource password ({@code DB_PASSWORD})
     * @param username the configured datasource user ({@code DB_USERNAME})
     * @throws IllegalStateException when the password is missing, too short or a placeholder
     */
    public DatabasePasswordPolicy(@Value("${spring.datasource.password:}") String password,
                                  @Value("${spring.datasource.username:}") String username) {
        if (password == null || password.isBlank()) {
            throw new IllegalStateException(
                    "spring.datasource.password (DB_PASSWORD) must be set - it has no default; see .env.example");
        }
        if (password.length() < MIN_LENGTH) {
            throw new IllegalStateException(
                    "DB_PASSWORD must be at least " + MIN_LENGTH + " characters long");
        }
        String normalised = password.toLowerCase(Locale.ROOT);
        if (PLACEHOLDERS.contains(normalised)) {
            throw new IllegalStateException(
                    "DB_PASSWORD must not be a placeholder password; generate one with 'openssl rand -base64 24'");
        }
        if (username != null && !username.isBlank() && normalised.equals(username.toLowerCase(Locale.ROOT))) {
            throw new IllegalStateException("DB_PASSWORD must not be the same as the database user name");
        }
    }
}
