package com.example.hr.attendance;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.UUID;

/** One presence interval, retaining instants so repeated wall-clock hours remain unambiguous. */
public record SessionWindow(
        UUID id,
        LocalDateTime checkIn,
        LocalDateTime checkOut,
        AttendanceSource source,
        Instant checkInInstant,
        Instant checkOutInstant) {

    public SessionWindow {
        if (checkIn == null) {
            throw new IllegalArgumentException("checkIn is required");
        }
        if (checkOut != null && (checkInInstant != null && checkOutInstant != null
                ? !checkOutInstant.isAfter(checkInInstant) : !checkOut.isAfter(checkIn))) {
            throw new IllegalArgumentException("checkOut must be after checkIn");
        }
    }

    /** Compatibility constructor for wall-clock-only pure inputs. */
    public SessionWindow(UUID id, LocalDateTime checkIn, LocalDateTime checkOut, AttendanceSource source) {
        this(id, checkIn, checkOut, source, null, null);
    }

    public Instant start(ZoneId zone) {
        return checkInInstant != null ? checkInInstant : checkIn.atZone(zone).toInstant();
    }

    public Instant end(ZoneId zone) {
        return checkOutInstant != null ? checkOutInstant
                : checkOut == null ? null : checkOut.atZone(zone).toInstant();
    }

    /** Convenience for tests: a closed session on {@code day} between two wall-clock times. */
    public static SessionWindow of(java.time.LocalDate day, String from, String to) {
        return new SessionWindow(null, day.atTime(java.time.LocalTime.parse(from)),
                to == null ? null : day.atTime(java.time.LocalTime.parse(to)), AttendanceSource.SELF);
    }

    public boolean isOpen() {
        return checkOut == null;
    }
}
