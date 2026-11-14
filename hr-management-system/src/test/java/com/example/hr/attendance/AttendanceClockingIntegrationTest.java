package com.example.hr.attendance;

import com.example.hr.employee.Role;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Check-in / check-out state rules against the real database. */
class AttendanceClockingIntegrationTest extends AbstractAttendanceIntegrationTest {

    private String adminToken;
    private NewEmployee staff;
    private String staffToken;

    @BeforeEach
    void setUp() throws Exception {
        adminToken = adminToken();
        staff = createEmployee(adminToken, "Sara Staff", Role.EMPLOYEE, null);
        staffToken = login(staff.email(), staff.password());
    }

    @Test
    void checkInOpensASessionForTheCallerAndCheckOutClosesIt() throws Exception {
        JsonNode opened = body(checkIn(staffToken).andExpect(status().isCreated()));
        assertThat(opened.path("employeeId").asText()).isEqualTo(staff.id().toString());
        assertThat(opened.path("checkOut").isNull()).isTrue();
        assertThat(opened.path("source").asText()).isEqualTo("SELF");
        assertThat(opened.path("correctedById").isNull()).isTrue();

        JsonNode closed = body(checkOut(staffToken).andExpect(status().isOk()));
        assertThat(closed.path("id").asText()).isEqualTo(opened.path("id").asText());
        assertThat(closed.path("checkOut").isNull()).isFalse();
        assertThat(closed.path("minutes").asInt()).isGreaterThanOrEqualTo(0);
    }

    @Test
    void aSecondCheckInWhileOneIsOpenIsRefusedWithConflict() throws Exception {
        checkIn(staffToken).andExpect(status().isCreated());
        checkIn(staffToken).andExpect(status().isConflict());

        Long rows = jdbc.queryForObject("select count(*) from attendance_sessions where employee_id = ?",
                Long.class, staff.id());
        assertThat(rows).isEqualTo(1L);
    }

    @Test
    void twoConcurrentCheckInsLeaveExactlyOneOpenSession() throws Exception {
        // The race the service check alone cannot win: both requests read "no open session",
        // both insert. The database guard (one open session per employee and work day) has to
        // arbitrate, and the loser must get a clear 409.
        int threads = 2;
        CyclicBarrier gate = new CyclicBarrier(threads);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        List<Future<Integer>> results = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                results.add(pool.submit(() -> {
                    gate.await(10, TimeUnit.SECONDS);
                    try {
                        return checkIn(staffToken).andReturn().getResponse().getStatus();
                    } catch (Exception ex) {
                        throw new IllegalStateException(ex);
                    }
                }));
            }
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> result : results) {
                statuses.add(result.get(30, TimeUnit.SECONDS));
            }

            assertThat(statuses).containsExactlyInAnyOrder(201, 409);
            Long open = jdbc.queryForObject(
                    "select count(*) from attendance_sessions where employee_id = ? and check_out is null",
                    Long.class, staff.id());
            assertThat(open).isEqualTo(1L);
            Long all = jdbc.queryForObject("select count(*) from attendance_sessions where employee_id = ?",
                    Long.class, staff.id());
            assertThat(all).isEqualTo(1L);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void theDatabaseRefusesTwoOpenSessionsForTheSameEmployeeAndDay() throws Exception {
        // The guard itself, without the service: the partial unique index rejects a second
        // open session for the same employee and work day.
        LocalDate today = LocalDate.now(ZONE);
        insertOpenSession(staff.id(), today, at(today, "08:00"));

        assertThatThrownBy(() -> insertOpenSession(staff.id(), today, at(today, "08:05")))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("attendance_sessions_one_open_per_day_idx");

        // An open session from an EARLIER day does not collide: different work day.
        insertOpenSession(staff.id(), today.minusDays(1), at(today.minusDays(1), "08:00"));
    }

    /** Writes an open session straight into the database, the way the race used to. */
    private void insertOpenSession(UUID employeeId, LocalDate workDate, Instant checkIn) {
        jdbc.update("""
                insert into attendance_sessions (id, employee_id, check_in, check_out, work_date,
                                                source, corrected_by, correction_reason, created_at,
                                                updated_at, version)
                values (?, ?, ?::timestamptz, null, ?, 'SELF', null, null, now(), now(), 0)
                """, UUID.randomUUID(), employeeId, checkIn.atOffset(java.time.ZoneOffset.UTC), workDate);
    }

    @Test
    void checkingOutWithoutAnOpenSessionIsRefusedWithConflict() throws Exception {
        checkOut(staffToken).andExpect(status().isConflict());
    }

    @Test
    void checkingOutTwiceIsRefusedTheSecondTime() throws Exception {
        checkIn(staffToken).andExpect(status().isCreated());
        checkOut(staffToken).andExpect(status().isOk());
        checkOut(staffToken).andExpect(status().isConflict());
    }

    @Test
    void severalClosedSessionsOnTheSameDayAreAllowed() throws Exception {
        checkIn(staffToken).andExpect(status().isCreated());
        checkOut(staffToken).andExpect(status().isOk());
        checkIn(staffToken).andExpect(status().isCreated());
        checkOut(staffToken).andExpect(status().isOk());

        Long rows = jdbc.queryForObject("select count(*) from attendance_sessions where employee_id = ?",
                Long.class, staff.id());
        assertThat(rows).isEqualTo(2L);
    }

    @Test
    void aSessionLeftOpenOnAnEarlierDayDoesNotBlockTodaysCheckIn() throws Exception {
        // An abandoned session from two days ago, written the only way the past can be
        // written: an HR correction with no check-out.
        LocalDate twoDaysAgo = LocalDate.now(ZONE).minusDays(2);
        addSession(adminToken, staff.id(), at(twoDaysAgo, "09:00"), null, "turnstile failure")
                .andExpect(status().isCreated());

        checkIn(staffToken).andExpect(status().isCreated());

        JsonNode range = body(myAttendance(staffToken, twoDaysAgo, LocalDate.now(ZONE))
                .andExpect(status().isOk()));
        assertThat(day(range, twoDaysAgo).path("status").asText()).isEqualTo("MISSING_CHECKOUT");
        assertThat(range.path("missingCheckoutDays").asInt()).isEqualTo(1);
    }

    @Test
    void anAbandonedSessionFromAnEarlierDayCannotBeClosedByTodaysCheckOut() throws Exception {
        LocalDate yesterday = LocalDate.now(ZONE).minusDays(1);
        addSession(adminToken, staff.id(), at(yesterday, "09:00"), null, "turnstile failure")
                .andExpect(status().isCreated());

        checkOut(staffToken).andExpect(status().isConflict());
        Long open = jdbc.queryForObject(
                "select count(*) from attendance_sessions where employee_id = ? and check_out is null",
                Long.class, staff.id());
        assertThat(open).isEqualTo(1L);
    }

    @Test
    void aTerminatedEmployeeCannotRecordAttendance() throws Exception {
        NewEmployee leaver = createEmployee(adminToken, "Leo Leaver", Role.EMPLOYEE, null);
        String leaverToken = login(leaver.email(), leaver.password());
        mvc.perform(post("/api/employees/" + leaver.id() + "/terminate")
                .header("Authorization", bearer(adminToken))).andExpect(status().isOk());

        // The security filter rejects a terminated account's token outright.
        checkIn(leaverToken).andExpect(status().isUnauthorized());
    }

    @Test
    void anonymousClockingIsRejected() throws Exception {
        mvc.perform(post("/api/attendance/check-in")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/attendance/check-out")).andExpect(status().isUnauthorized());
    }

    @Test
    void anEmployeeOnlyEverClocksForThemself() throws Exception {
        NewEmployee other = createEmployee(adminToken, "Omar Other", Role.EMPLOYEE, null);
        String otherToken = login(other.email(), other.password());

        checkIn(staffToken).andExpect(status().isCreated());
        // The other employee's own check-in is unaffected: sessions are strictly per caller.
        checkIn(otherToken).andExpect(status().isCreated());

        UUID staffId = staff.id();
        Long mine = jdbc.queryForObject("select count(*) from attendance_sessions where employee_id = ?",
                Long.class, staffId);
        assertThat(mine).isEqualTo(1L);
    }

    @Test
    void todaysOpenSessionReadsAsPresentNotAsAMissingCheckout() throws Exception {
        checkIn(staffToken).andExpect(status().isCreated());

        LocalDate today = LocalDate.now(ZONE);
        JsonNode range = body(myAttendance(staffToken, today, today).andExpect(status().isOk()));
        JsonNode today0 = day(range, today);
        assertThat(today0.path("openSession").asBoolean()).isTrue();
        assertThat(today0.path("status").asText()).isIn("PRESENT", "LATE", "WEEKEND", "HOLIDAY");
        assertThat(today0.path("workedMinutes").asInt()).isZero();
    }
}
