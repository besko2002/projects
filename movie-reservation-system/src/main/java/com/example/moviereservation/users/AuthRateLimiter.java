package com.example.moviereservation.users;

import com.example.moviereservation.common.TooManyRequestsException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/** Per-instance abuse guard; deploy a shared gateway limiter as well when running multiple nodes. */
@Component
public class AuthRateLimiter {

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final AtomicLong requests = new AtomicLong();
    private final Clock clock;
    private final int loginFailures;
    private final int registrations;
    private final long windowMillis;

    @Autowired
    public AuthRateLimiter(@Value("${app.security.login-failures:5}") int loginFailures,
                           @Value("${app.security.registrations-per-ip:120}") int registrations,
                           @Value("${app.security.rate-window-seconds:60}") long windowSeconds) {
        this(loginFailures, registrations, Duration.ofSeconds(windowSeconds), Clock.systemUTC());
    }

    AuthRateLimiter(int loginFailures, int registrations, Duration window, Clock clock) {
        if (loginFailures < 1 || registrations < 1 || window.isNegative() || window.isZero()) {
            throw new IllegalArgumentException("Auth rate limits and window must be positive");
        }
        this.loginFailures = loginFailures;
        this.registrations = registrations;
        this.windowMillis = window.toMillis();
        this.clock = clock;
    }

    public void checkLogin(String ip, String email) {
        if (blocked("login:" + ip + ":" + normalise(email), loginFailures)
                || blocked("login-ip:" + ip, loginFailures * 6)) {
            throw new TooManyRequestsException("Too many login attempts; try again later");
        }
    }

    private boolean blocked(String key, int limit) {
        Window state = windows.get(key);
        return state != null && state.startedAt + windowMillis > clock.millis() && state.count >= limit;
    }

    public void failedLogin(String ip, String email) {
        increment("login:" + ip + ":" + normalise(email), loginFailures, false);
        increment("login-ip:" + ip, loginFailures * 6, false);
    }

    public void successfulLogin(String ip, String email) {
        windows.remove("login:" + ip + ":" + normalise(email));
    }

    public void registration(String ip) {
        increment("register:" + ip, registrations, true);
    }

    public void googleAuth(String ip) {
        increment("google:" + ip, 30, true);
    }

    public void forgotPassword(String ip, String email) {
        increment("forgot-ip:" + ip, 15, this.windowMillis, true);
        if (email != null && !email.isBlank()) {
            // Per-email limit: at most 3 requests per 15 minutes to prevent spamming victim's mailbox
            increment("forgot-email:" + normalise(email), 3, Duration.ofMinutes(15).toMillis(), true);
        }
    }

    public void resetPassword(String ip) {
        increment("reset:" + ip, 10, this.windowMillis, true);
    }

    private void increment(String key, int limit, boolean rejectBeforeIncrement) {
        increment(key, limit, this.windowMillis, rejectBeforeIncrement);
    }

    private void increment(String key, int limit, long customWindowMillis, boolean rejectBeforeIncrement) {
        long now = clock.millis();
        Window state = windows.compute(key, (unused, old) -> {
            if (old == null || old.startedAt + customWindowMillis <= now) {
                return new Window(now, 1);
            }
            return new Window(old.startedAt, Math.min(old.count + 1, limit + 1));
        });
        if (rejectBeforeIncrement && state.count > limit) {
            String message;
            if (key.startsWith("google:")) {
                message = "Too many Google sign-in attempts; try again later";
            } else if (key.startsWith("forgot-")) {
                message = "Too many password reset requests; try again later";
            } else if (key.startsWith("reset:")) {
                message = "Too many password reset attempts; try again later";
            } else {
                message = "Too many registration attempts; try again later";
            }
            throw new TooManyRequestsException(message);
        }
        // Expired keys are pruned periodically so arbitrary email probes cannot grow this map forever.
        if (requests.incrementAndGet() % 128 == 0) {
            windows.entrySet().removeIf(entry -> entry.getValue().startedAt + Math.max(windowMillis, Duration.ofMinutes(15).toMillis()) <= now);
        }
    }

    private static String normalise(String email) {
        return email == null ? "" : email.trim().toLowerCase(java.util.Locale.ROOT);
    }

    private record Window(long startedAt, int count) {
    }
}
