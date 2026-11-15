package com.example.moviereservation;

import org.springframework.boot.autoconfigure.jdbc.JdbcConnectionDetails;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * The PostgreSQL database every integration test context runs against.
 *
 * <p>By default (CI) each context gets a throwaway PostgreSQL 16 container through
 * {@link ServiceConnection}, which needs Docker. When {@code MOVIE_TEST_DB_URL} is set, the
 * tests run without Docker instead: each context gets its own uniquely named, empty database on
 * that native PostgreSQL server, dropped again when the context closes. Either way every context
 * starts from an empty, freshly migrated database, so the tests behave identically.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

    // Not a leak: Spring owns the container bean and stops it when the test context closes.
    @Bean
    @ServiceConnection
    @Conditional(DockerDatabase.class)
    @SuppressWarnings("resource")
    PostgreSQLContainer<?> postgresContainer() {
        return new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                .withDatabaseName("movie_reservation")
                .withUsername("movie")
                .withPassword("movie");
    }

    // Spring calls close() when the test context closes, which drops the database.
    @Bean(destroyMethod = "close")
    @Conditional(NativeDatabase.class)
    JdbcConnectionDetails nativeTestDatabase() {
        return NativeTestDatabase.create(System.getenv());
    }

    static final class NativeDatabase implements Condition {
        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            return NativeTestDatabase.isConfigured(System.getenv());
        }
    }

    static final class DockerDatabase implements Condition {
        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            return !NativeTestDatabase.isConfigured(System.getenv());
        }
    }
}
