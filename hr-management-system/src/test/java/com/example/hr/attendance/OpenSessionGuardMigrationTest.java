package com.example.hr.attendance;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The V8 migration on a database that already holds duplicate open sessions.
 *
 * <p>It must refuse to run and say what has to be reconciled by hand. What it must <b>not</b> do
 * is invent a check-out time for the extra sessions: attendance records are not the migration's
 * to rewrite. The migration runs in a transaction, so the failed attempt leaves neither the
 * index nor a Flyway history entry behind - after the operator reconciles, the re-run succeeds.
 *
 * <p>The schema is built with Flyway directly (target V7) instead of through Spring, because the
 * point of the test is what happens when the migration meets existing duplicates.
 */
@Testcontainers
class OpenSessionGuardMigrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("hr").withUsername("hr")
            .withPassword("test-only-hr-db-password");

    private JdbcTemplate jdbc;

    @BeforeEach
    void prepare() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        // A clean database for every test: drop the schema history and the schema itself.
        jdbc.execute("drop schema if exists public cascade");
        jdbc.execute("create schema public");
        migrateTo("7");
    }

    @AfterEach
    void cleanUp() {
        jdbc.execute("drop schema if exists public cascade");
        jdbc.execute("create schema public");
    }

    @Test
    void theMigrationRefusesToRunWhenDuplicatesExistAndSucceedsAfterReconciliation() {
        UUID employee = insertEmployee("Rae Duplicate");
        LocalDate workDate = LocalDate.of(2025, 3, 10);
        insertOpenSession(employee, workDate, Instant.parse("2025-03-10T08:00:00Z"));
        insertOpenSession(employee, workDate, Instant.parse("2025-03-10T08:05:00Z"));

        // 1. The migration refuses, and says what to do.
        assertThatThrownBy(() -> migrate())
                .isInstanceOf(FlywayException.class)
                .hasMessageContaining("V8 refused to run")
                .hasMessageContaining("does not invent check-out times")
                .hasMessageContaining(employee.toString())
                .hasMessageContaining(workDate.toString());

        // 2. Nothing was left behind: no index and no failed history entry.
        assertThat(indexExists("attendance_sessions_one_open_per_day_idx")).isFalse();
        assertThat(failedMigrationCount()).isZero();

        // 3. The operator reconciles by hand - here: closing the second session with the check-out
        //    time it actually had.
        jdbc.update("update attendance_sessions set check_out = ? where employee_id = ? "
                + "and work_date = ? and check_in = ?",
                Timestamp.from(Instant.parse("2025-03-10T09:00:00Z")), employee, workDate,
                Timestamp.from(Instant.parse("2025-03-10T08:05:00Z")));

        // 4. The migration now applies, and the guard is in place.
        migrate();
        assertThat(indexExists("attendance_sessions_one_open_per_day_idx")).isTrue();
        assertThat(failedMigrationCount()).isZero();
    }

    @Test
    void theMigrationAppliesWhenThereIsOnlyOneOpenSessionPerEmployeeAndDay() {
        UUID employee = insertEmployee("Sol Single");
        LocalDate workDate = LocalDate.of(2025, 3, 10);
        insertOpenSession(employee, workDate, Instant.parse("2025-03-10T08:00:00Z"));
        // An open session from an earlier day is fine - it belongs to another work day.
        insertOpenSession(employee, workDate.minusDays(1), Instant.parse("2025-03-09T08:00:00Z"));

        migrate();

        assertThat(indexExists("attendance_sessions_one_open_per_day_idx")).isTrue();
    }

    // ------------------------------------------------------------------ helpers

    private void migrate() {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    private void migrateTo(String target) {
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private UUID insertEmployee(String fullName) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into employees (id, full_name, email, password_hash, role, hire_date, status,
                                      must_change_password, created_at, updated_at, version)
                values (?, ?, ?, 'hash', 'EMPLOYEE', date '2024-01-15', 'ACTIVE', false, now(), now(), 0)
                """, id, fullName, fullName.toLowerCase().replace(' ', '.') + "@hr.local");
        return id;
    }

    private void insertOpenSession(UUID employeeId, LocalDate workDate, Instant checkIn) {
        jdbc.update("""
                insert into attendance_sessions (id, employee_id, check_in, check_out, work_date,
                                                source, corrected_by, correction_reason, created_at,
                                                updated_at, version)
                values (?, ?, ?, null, ?, 'SELF', null, null, now(), now(), 0)
                """, UUID.randomUUID(), employeeId, Timestamp.from(checkIn), workDate);
    }

    private boolean indexExists(String name) {
        Integer count = jdbc.queryForObject(
                "select count(*) from pg_indexes where indexname = ?", Integer.class, name);
        return count != null && count > 0;
    }

    private int failedMigrationCount() {
        Integer count = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where success = false", Integer.class);
        return count == null ? 0 : count;
    }
}
