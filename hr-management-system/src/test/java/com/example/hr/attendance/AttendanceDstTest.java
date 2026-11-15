package com.example.hr.attendance;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AttendanceDstTest {
    private static final ZoneId ZONE = ZoneId.of("Africa/Cairo");
    private static final AttendanceRules RULES = new AttendanceRules(
            ZONE, LocalTime.of(9, 0), LocalTime.of(17, 0), 15, 240, 16);

    @Test
    void springGapCountsElapsedMinutesNotWallClockMinutes() {
        assertElapsed("2025-04-24T23:30+02:00[Africa/Cairo]",
                "2025-04-25T01:30+03:00[Africa/Cairo]", 60);
    }

    @Test
    void fallRepeatedHourCountsBothOccurrences() {
        assertElapsed("2025-10-30T22:30+03:00[Africa/Cairo]",
                "2025-10-31T00:30+02:00[Africa/Cairo]", 180);
    }

    @Test
    void validFallbackSessionMayEndAtAnEarlierWallClockTime() {
        DailyAttendance result = assertElapsed("2025-10-30T23:45+03:00[Africa/Cairo]",
                "2025-10-30T23:15+02:00[Africa/Cairo]", 30);
        assertThat(result.lastOut()).isBefore(result.firstIn());
    }

    @Test
    void repeatedHourSessionsAreOrderedByInstantNotLocalTime() {
        SessionWindow first = window("2025-10-30T23:40+03:00[Africa/Cairo]",
                "2025-10-30T23:50+03:00[Africa/Cairo]");
        SessionWindow second = window("2025-10-30T23:10+02:00[Africa/Cairo]",
                "2025-10-30T23:20+02:00[Africa/Cairo]");
        DailyAttendance result = calculate(RULES, List.of(second, first), first.start(ZONE).plusSeconds(7200));
        assertThat(result.firstIn()).isEqualTo(first.checkIn());
        assertThat(result.lastOut()).isEqualTo(second.checkOut());
        assertThat(result.workedMinutes()).isEqualTo(20);
    }

    @Test
    void abandonmentUsesElapsedHoursAcrossSpringAndFall() {
        for (String start : List.of("2025-04-24T23:30+02:00[Africa/Cairo]",
                "2025-10-30T23:30+03:00[Africa/Cairo]")) {
            SessionWindow open = window(start, null);
            assertThat(calculate(RULES, List.of(open), open.start(ZONE).plus(Duration.ofHours(16)).minusSeconds(1))
                    .status()).isNotEqualTo(AttendanceStatus.MISSING_CHECKOUT);
            assertThat(calculate(RULES, List.of(open), open.start(ZONE).plus(Duration.ofHours(16)))
                    .status()).isEqualTo(AttendanceStatus.MISSING_CHECKOUT);
        }
    }

    @Test
    void overtimeBoundaryIsZonedDuringTheRepeatedHour() {
        AttendanceRules rules = new AttendanceRules(ZONE, LocalTime.of(9, 0), LocalTime.of(23, 30), 0, 240, 16);
        SessionWindow session = window("2025-10-30T23:15+03:00[Africa/Cairo]",
                "2025-10-30T23:45+02:00[Africa/Cairo]");
        assertThat(calculate(rules, List.of(session), session.end(ZONE)).overtimeMinutes()).isEqualTo(75);
    }

    @Test
    void graceIsElapsedFromZonedShiftStartAcrossTheGap() {
        AttendanceRules rules = new AttendanceRules(ZONE, LocalTime.MIDNIGHT, LocalTime.of(17, 0), 15, 240, 16);
        SessionWindow session = window("2025-04-25T01:16+03:00[Africa/Cairo]",
                "2025-04-25T02:00+03:00[Africa/Cairo]");
        assertThat(calculate(rules, List.of(session), session.end(ZONE)).lateMinutes()).isEqualTo(1);
    }

    private DailyAttendance assertElapsed(String from, String to, int expected) {
        SessionWindow session = window(from, to);
        DailyAttendance result = calculate(RULES, List.of(session), session.end(ZONE));
        assertThat(result.workedMinutes()).isEqualTo(expected);
        assertThat(result.overtimeMinutes()).isEqualTo(Math.min(expected, 240));
        return result;
    }

    private static SessionWindow window(String from, String to) {
        ZonedDateTime start = ZonedDateTime.parse(from);
        ZonedDateTime end = to == null ? null : ZonedDateTime.parse(to);
        return new SessionWindow(null, start.toLocalDateTime(), end == null ? null : end.toLocalDateTime(),
                AttendanceSource.SELF, start.toInstant(), end == null ? null : end.toInstant());
    }

    private static DailyAttendance calculate(AttendanceRules rules, List<SessionWindow> sessions, Instant now) {
        LocalDate day = sessions.get(0).checkIn().toLocalDate();
        return new DailyAttendanceCalculator(rules).calculate(new DailyAttendanceInput(day, DayKind.WORKING,
                LeaveCoverage.NONE, sessions, now.atZone(ZONE).toLocalDateTime(), now));
    }
}
