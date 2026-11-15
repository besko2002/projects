package com.example.hr;

import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;

/** PostgreSQL test fixture: Docker by default, or a newly created native database when explicitly configured. */
public final class PostgresTestDatabase {
    private final PostgreSQLContainer<?> container;
    private final String adminUrl;
    private final String username;
    private final String password;
    private String databaseName;
    private String jdbcUrl;

    public PostgresTestDatabase() {
        adminUrl = System.getenv("HR_TEST_DB_URL");
        if (adminUrl == null || adminUrl.isBlank()) {
            container = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("hr").withUsername("hr")
                    .withPassword("test-only-hr-db-password");
            username = null;
            password = null;
        } else {
            container = null;
            username = required("HR_TEST_DB_USERNAME");
            password = required("HR_TEST_DB_PASSWORD");
        }
    }

    public synchronized void start() {
        if (container != null) {
            container.start();
            return;
        }
        if (databaseName != null) return;
        int query = adminUrl.indexOf('?');
        String base = query < 0 ? adminUrl : adminUrl.substring(0, query);
        String options = query < 0 ? "" : adminUrl.substring(query);
        if (!base.startsWith("jdbc:postgresql://") || !base.endsWith("/postgres")) {
            throw new IllegalArgumentException("HR_TEST_DB_URL must address the postgres maintenance database; tests always create their own database");
        }
        String name = "hr_test_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = DriverManager.getConnection(adminUrl, username, password);
             var statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE \"" + name + "\"");
        } catch (SQLException ex) {
            throw new IllegalStateException("Cannot create isolated HR test database; the test role needs CREATEDB", ex);
        }
        databaseName = name;
        jdbcUrl = base.substring(0, base.length() - "postgres".length()) + name + options;
        Runtime.getRuntime().addShutdownHook(new Thread(this::close, "drop-" + name));
    }

    public String getJdbcUrl() {
        return container == null ? jdbcUrl : container.getJdbcUrl();
    }

    public String getUsername() {
        return container == null ? username : container.getUsername();
    }

    public String getPassword() {
        return container == null ? password : container.getPassword();
    }

    public synchronized void stop() {
        if (container != null) {
            container.stop();
            return;
        }
        close();
    }

    private synchronized void close() {
        if (databaseName == null || !databaseName.matches("hr_test_[0-9a-f]{32}")) return;
        try (var connection = DriverManager.getConnection(adminUrl, username, password);
             var statement = connection.createStatement()) {
            statement.execute("DROP DATABASE IF EXISTS \"" + databaseName + "\" WITH (FORCE)");
            databaseName = null;
        } catch (SQLException ex) {
            System.err.println("Could not remove generated HR test database " + databaseName);
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " is required for native HR tests");
        return value;
    }
}
