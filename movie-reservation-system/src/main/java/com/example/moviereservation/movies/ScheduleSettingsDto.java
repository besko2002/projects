package com.example.moviereservation.movies;

/**
 * Public scheduling settings the admin UI needs to enter showtimes as cinema wall-clock times.
 *
 * @param zone          IANA business time zone of the cinema ({@code app.schedule.zone}), e.g. {@code Africa/Cairo}
 * @param bufferMinutes cleaning buffer appended to every showtime's end
 */
public record ScheduleSettingsDto(String zone, int bufferMinutes) {
}
