package com.example.hr.attendance;

import com.example.hr.employee.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Independent request transactions must serialize on the employee even when no session exists yet. */
class AttendanceWriteConcurrencyIntegrationTest extends AbstractAttendanceIntegrationTest {
    @Autowired AttendanceSessionRepository sessions;
    @Autowired PlatformTransactionManager transactionManager;
    private String hrToken;
    private String staffToken;
    private NewEmployee staff;

    @BeforeEach
    void fixtures() throws Exception {
        String admin = adminToken();
        NewEmployee hr = createEmployee(admin, "Hana HR", Role.HR, null);
        staff = createEmployee(admin, "Sara Staff", Role.EMPLOYEE, null);
        hrToken = login(hr.email(), hr.password());
        staffToken = login(staff.email(), staff.password());
    }

    @Test
    void concurrentOverlappingInsertsCannotBothCommit() throws Exception {
        List<Integer> statuses = race(
                () -> code(addSession(hrToken, staff.id(), at(march(4), "09:00"), at(march(4), "13:00"), "first")),
                () -> code(addSession(hrToken, staff.id(), at(march(4), "12:00"), at(march(4), "17:00"), "second")));
        assertThat(statuses).containsExactlyInAnyOrder(201, 409);
        assertThat(countSessions()).isEqualTo(1);
    }

    @Test
    void concurrentMutualCorrectionCommitsBothRowsAfterBothEmployeeLocksAreHeld() throws Exception {
        String admin = adminToken();
        NewEmployee hrA = createEmployee(admin, "Alice HR", Role.HR, null);
        NewEmployee hrB = createEmployee(admin, "Bob HR", Role.HR, null);
        String tokenA = login(hrA.email(), hrA.password());
        String tokenB = login(hrB.email(), hrB.password());

        CountDownLatch locked = new CountDownLatch(2);
        var backends = java.util.concurrent.ConcurrentHashMap.<Integer>newKeySet();
        List<Integer> statuses = race(
                () -> lockedCorrection(tokenA, hrB.id(), locked, backends),
                () -> lockedCorrection(tokenB, hrA.id(), locked, backends));

        assertThat(backends).hasSize(2); // two independent JDBC connections/transactions
        assertThat(statuses).containsExactly(201, 201);
        assertThat(jdbc.queryForObject("select count(*) from attendance_sessions where employee_id = ? and corrected_by = ?",
                Long.class, hrB.id(), hrA.id())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from attendance_sessions where employee_id = ? and corrected_by = ?",
                Long.class, hrA.id(), hrB.id())).isEqualTo(1);
    }

    private int lockedCorrection(String token, UUID target, CountDownLatch locked, java.util.Set<Integer> backends) {
        return new TransactionTemplate(transactionManager).execute(transaction -> {
            jdbc.execute("set local lock_timeout = '5s'");
            backends.add(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
            assertThat(sessions.lockEmployee(target)).isPresent();
            locked.countDown();
            try {
                // Neither request can insert its cross-employee FK until BOTH target locks exist.
                assertThat(locked.await(10, TimeUnit.SECONDS)).isTrue();
                return code(addSession(token, target, at(march(4), "09:00"), at(march(4), "12:00"), "mutual correction"));
            } catch (Exception ex) {
                throw new IllegalStateException("Concurrent correction failed", ex);
            }
        });
    }

    @Test
    void concurrentInsertAndCorrectionCannotCreateOverlap() throws Exception {
        UUID id = addSessionOk(hrToken, staff.id(), march(4), "09:00", "10:00");
        List<Integer> statuses = race(
                () -> code(correctSession(hrToken, id, at(march(4), "09:00"), at(march(4), "14:00"), "extend")),
                () -> code(addSession(hrToken, staff.id(), at(march(4), "12:00"), at(march(4), "17:00"), "insert")));
        assertThat(statuses).isIn(List.of(200, 409), List.of(409, 201));
        assertNoClosedOverlap();
    }

    @Test
    void concurrentCorrectionsOnDifferentRowsCannotCreateOverlap() throws Exception {
        UUID first = addSessionOk(hrToken, staff.id(), march(4), "09:00", "10:00");
        UUID second = addSessionOk(hrToken, staff.id(), march(4), "15:00", "17:00");
        List<Integer> statuses = race(
                () -> code(correctSession(hrToken, first, at(march(4), "09:00"), at(march(4), "13:00"), "extend")),
                () -> code(correctSession(hrToken, second, at(march(4), "12:00"), at(march(4), "17:00"), "extend")));
        assertThat(statuses).containsExactlyInAnyOrder(200, 409);
        assertNoClosedOverlap();
    }

    @Test
    void concurrentInsertionInsideOpenSessionAndCheckoutCannotDoubleCount() throws Exception {
        Instant start = todayStart();
        addSession(hrToken, staff.id(), start, null, "forgot check in").andExpect(status().isCreated());
        List<Integer> statuses = race(
                () -> code(addSession(hrToken, staff.id(), start.plusSeconds(30), start.plusSeconds(60), "duplicate")),
                () -> code(checkOut(staffToken)));
        assertThat(statuses).containsExactly(409, 200);
        assertThat(countSessions()).isEqualTo(1);
        assertNoClosedOverlap();
    }

    @Test
    void concurrentCorrectionInsideOpenSessionAndCheckoutCannotDoubleCount() throws Exception {
        UUID historic = addSessionOk(hrToken, staff.id(), march(4), "09:00", "10:00");
        Instant start = todayStart();
        addSession(hrToken, staff.id(), start, null, "forgot check in").andExpect(status().isCreated());
        List<Integer> statuses = race(
                () -> code(correctSession(hrToken, historic, start.plusSeconds(30), start.plusSeconds(60), "duplicate")),
                () -> code(checkOut(staffToken)));
        assertThat(statuses).containsExactly(409, 200);
        assertNoClosedOverlap();
    }

    @Test
    void openingAnIntervalBeforeAnExistingClosedIntervalIsRejected() throws Exception {
        addSessionOk(hrToken, staff.id(), march(4), "12:00", "17:00");
        addSession(hrToken, staff.id(), at(march(4), "09:00"), null, "open before closed")
                .andExpect(status().isConflict());
    }

    private Instant todayStart() {
        // At least two minutes of today's history, independent of the test machine's zone.
        Instant now = Instant.now();
        Instant midnight = LocalDate.now(ZONE).atStartOfDay(ZONE).toInstant();
        org.junit.jupiter.api.Assumptions.assumeTrue(now.minusSeconds(180).isAfter(midnight));
        return now.minusSeconds(180);
    }

    private long countSessions() {
        return jdbc.queryForObject("select count(*) from attendance_sessions where employee_id = ?", Long.class, staff.id());
    }

    private void assertNoClosedOverlap() {
        assertThat(jdbc.queryForObject("""
                select count(*) from attendance_sessions a join attendance_sessions b
                  on a.employee_id = b.employee_id and a.id <> b.id
                 and a.check_in < b.check_out and b.check_in < a.check_out
                where a.employee_id = ?
                """, Long.class, staff.id())).isZero();
    }

    private static int code(ResultActions result) {
        return result.andReturn().getResponse().getStatus();
    }

    private static List<Integer> race(Callable<Integer> first, Callable<Integer> second) throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var left = executor.submit(() -> { ready.countDown(); start.await(); return first.call(); });
            var right = executor.submit(() -> { ready.countDown(); start.await(); return second.call(); });
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            return List.of(left.get(30, TimeUnit.SECONDS), right.get(30, TimeUnit.SECONDS));
        }
    }
}
