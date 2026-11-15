package com.example.moviereservation;

import org.springframework.boot.autoconfigure.jdbc.JdbcConnectionDetails;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * One throwaway database on a native PostgreSQL server, for running the integration tests without
 * Docker. Configured through environment variables:
 *
 * <ul>
 *   <li>{@code MOVIE_TEST_DB_URL} — JDBC URL of the server's maintenance database, for example
 *       {@code jdbc:postgresql://127.0.0.1:55432/postgres}</li>
 *   <li>{@code MOVIE_TEST_DB_USERNAME} / {@code MOVIE_TEST_DB_PASSWORD} — a role with
 *       {@code CREATEDB} (and nothing more); it owns and later drops the test databases</li>
 * </ul>
 *
 * <p>Only databases named {@value #PREFIX}&lt;random&gt; that this instance created are ever dropped.
 */
final class NativeTestDatabase implements JdbcConnectionDetails, AutoCloseable {

    static final String PREFIX = "movie_test_";
    private static final Pattern MAINTENANCE_DB = Pattern.compile("^(jdbc:postgresql://[^/?]+/)([^/?]+)(.*)$");

    private final String adminUrl;
    private final String username;
    private final String password;
    private final String databaseName;
    private final String jdbcUrl;

    private NativeTestDatabase(String adminUrl, String username, String password, String databaseName) {
        this.adminUrl = adminUrl;
        this.username = username;
        this.password = password;
        this.databaseName = databaseName;
        var matcher = MAINTENANCE_DB.matcher(adminUrl);
        if (!matcher.matches()) {
            throw new IllegalStateException("MOVIE_TEST_DB_URL must look like jdbc:postgresql://host:port/postgres");
        }
        this.jdbcUrl = matcher.group(1) + databaseName + matcher.group(3);
    }

    static boolean isConfigured(Map<String, String> env) {
        String url = env.get("MOVIE_TEST_DB_URL");
        return url != null && !url.isBlank();
    }

    static NativeTestDatabase create(Map<String, String> env) {
        String username = require(env, "MOVIE_TEST_DB_USERNAME");
        String password = require(env, "MOVIE_TEST_DB_PASSWORD");
        String name = PREFIX + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        NativeTestDatabase database = new NativeTestDatabase(require(env, "MOVIE_TEST_DB_URL"), username, password, name);
        // The name is generated here from [a-z0-9_] only, so quoting it is safe.
        database.execute("CREATE DATABASE \"" + name + "\"");
        return database;
    }

    @Override
    public String getJdbcUrl() {
        return jdbcUrl;
    }

    @Override
    public String getUsername() {
        return username;
    }

    @Override
    public String getPassword() {
        return password;
    }

    String getDatabaseName() {
        return databaseName;
    }

    /** Drops the database; FORCE ends connections a closing pool may still hold. */
    @Override
    public void close() {
        execute("DROP DATABASE IF EXISTS \"" + databaseName + "\" WITH (FORCE)");
    }

    private void execute(String sql) {
        try (Connection connection = DriverManager.getConnection(adminUrl, username, password);
             Statement statement = connection.createStatement()) {
            statement.execute(sql);
        } catch (SQLException ex) {
            throw new IllegalStateException("Native test database operation failed for " + databaseName, ex);
        }
    }

    private static String require(Map<String, String> env, String key) {
        String value = env.get(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(key + " must be set when MOVIE_TEST_DB_URL is set");
        }
        return value;
    }
}
