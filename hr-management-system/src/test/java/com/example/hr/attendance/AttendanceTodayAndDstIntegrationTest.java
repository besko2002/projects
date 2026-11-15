package com.example.hr.attendance;

import com.example.hr.employee.Role;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AttendanceTodayAndDstIntegrationTest extends AbstractAttendanceIntegrationTest {
    @Autowired
    private AttendanceDeriver deriver;

    @Test
    void todayRequiresAuthentication() throws Exception {
        mvc.perform(get("/api/attendance/today")).andExpect(status().isUnauthorized());
    }

    @Test
    void todayReturnsTheCallersRangeUsingTheServerClockAndZone() throws Exception {
        String admin = adminToken();
        NewEmployee staff = createEmployee(admin, "Sara Staff", Role.EMPLOYEE, null);
        String token = login(staff.email(), staff.password());
        LocalDate before = deriver.today();
        var response = body(mvc.perform(get("/api/attendance/today").header("Authorization", bearer(token)))
                .andExpect(status().isOk()));
        assertThat(response.path("employeeId").asText()).isEqualTo(staff.id().toString());
        assertThat(LocalDate.parse(response.path("from").asText())).isIn(before, deriver.today());
        assertThat(response.path("to").asText()).isEqualTo(response.path("from").asText());
        assertThat(response.path("days")).hasSize(1);
        assertThat(response.path("days").get(0).path("day").asText()).isEqualTo(response.path("from").asText());
    }

    @Test
    void persistedSpringAndFallSessionsKeepElapsedMinutesInBothApiAndDerivation() throws Exception {
        String admin = adminToken();
        NewEmployee staff = createEmployee(admin, "Sara Staff", Role.EMPLOYEE, null);
        assertPersisted(admin, staff.id(), "2025-04-24T23:30+02:00[Africa/Cairo]",
                "2025-04-25T01:30+03:00[Africa/Cairo]", 60);
        assertPersisted(admin, staff.id(), "2025-10-30T22:30+03:00[Africa/Cairo]",
                "2025-10-31T00:30+02:00[Africa/Cairo]", 180);
    }

    @Test
    void fallbackSessionWithReversedLocalTimesIsAcceptedAndCanBeCorrected() throws Exception {
        String admin = adminToken();
        NewEmployee staff = createEmployee(admin, "Sara Staff", Role.EMPLOYEE, null);
        var start = ZonedDateTime.parse("2025-10-30T23:45+03:00[Africa/Cairo]").toInstant();
        var end = ZonedDateTime.parse("2025-10-30T23:15+02:00[Africa/Cairo]").toInstant();
        var created = body(addSession(admin, staff.id(), start, end, "repeated hour").andExpect(status().isCreated()));
        assertThat(created.path("minutes").asInt()).isEqualTo(30);
        var corrected = body(correctSession(admin, UUID.fromString(created.path("id").asText()),
                start.minusSeconds(300), end, "door log").andExpect(status().isOk()));
        assertThat(corrected.path("minutes").asInt()).isEqualTo(35);
        var range = body(attendanceOf(admin, staff.id(), LocalDate.of(2025, 10, 30), LocalDate.of(2025, 10, 30))
                .andExpect(status().isOk()));
        assertThat(range.path("workedMinutes").asInt()).isEqualTo(35);
    }

    private void assertPersisted(String token, UUID employee, String from, String to, int minutes) throws Exception {
        var start = ZonedDateTime.parse(from);
        var end = ZonedDateTime.parse(to);
        var created = body(addSession(token, employee, start.toInstant(), end.toInstant(), "DST door log")
                .andExpect(status().isCreated()));
        assertThat(created.path("minutes").asInt()).isEqualTo(minutes);
        var range = body(attendanceOf(token, employee, start.toLocalDate(), start.toLocalDate())
                .andExpect(status().isOk()));
        assertThat(range.path("workedMinutes").asInt()).isEqualTo(minutes);
    }
}
