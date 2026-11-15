package com.example.hr.attendance;

import com.example.hr.employee.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
    void concurrentMutualCorrectionBetweenHrEmployeesCannotDeadlockWithHttp500() throws Exception {
        String admin = adminToken();
        NewEmployee hrA = createEmployee(admin, "Alice HR", Role.HR, null);
        NewEmployee hrB = createEmployee(admin, "Bob HR", Role.HR, null);
        String tokenA = login(hrA.email(), hrA.password());
        String tokenB = login(hrB.email(), hrB.password());

        List<Integer> statuses = race(
                () -> code(addSession(tokenA, hrB.id(), at(march(4), "09:00"), at(march(4), "12:00"), "A corrects B")),
                () -> code(addSession(tokenB, hrA.id(), at(march(4), "09:00"), at(march(4), "12:00"), "B corrects A")));

        assertThat(statuses).allSatisfy(status -> assertThat(status).isIn(201, 409));
        assertThat(statuses).doesNotContain(500);
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
