package com.example.hr.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * In-memory sliding-window throttle on failed logins, keyed by (normalized e-mail, client IP),
 * plus the account lockout.
 *
 * <p>Per instance and lost on restart - enough to stop online password guessing on one node.
 * A stack with more than one instance sets {@code app.login-rate-limit.store=redis} and gets
 * {@link RedisLoginThrottle} instead, so the counters are shared.
 */
@Component
@ConditionalOnProperty(prefix = "app.login-rate-limit", name = "store", havingValue = "memory",
        matchIfMissing = true)
public class LoginRateLimiter implements LoginThrottle {

    private final int maxFailures;
    private final Duration window;
    private final int lockAfterFailures;
    private final Duration lockoutDuration;
    private final Clock clock;
    private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();
    /** The failures of an ACCOUNT, over all addresses - this is what the lockout counts. */
    private final Map<String, Deque<Instant>> accountFailures = new ConcurrentHashMap<>();
    private final Map<String, Instant> locked = new ConcurrentHashMap<>();

    @Autowired
    LoginRateLimiter(@Value("${app.login-rate-limit.max-failures:5}") int maxFailures,
                     @Value("${app.login-rate-limit.window:PT15M}") Duration window,
                     @Value("${app.login-rate-limit.lockout-after-failures:10}") int lockAfterFailures,
                     @Value("${app.login-rate-limit.lockout-duration:PT15M}") Duration lockoutDuration) {
        this(maxFailures, window, lockAfterFailures, lockoutDuration, Clock.systemUTC());
    }

    /** The throttle without a lockout (tests that only care about the window). */
    LoginRateLimiter(int maxFailures, Duration window, Clock clock) {
        this(maxFailures, window, Integer.MAX_VALUE, Duration.ofMinutes(15), clock);
    }

    LoginRateLimiter(int maxFailures, Duration window, int lockAfterFailures, Duration lockoutDuration,
                      Clock clock) {
        this.maxFailures = maxFailures;
        this.window = window;
        this.lockAfterFailures = lockAfterFailures;
        this.lockoutDuration = lockoutDuration;
        this.clock = clock;
    }

    @Override
    public boolean isBlocked(String email, String ip) {
        Deque<Instant> recent = failures.get(key(email, ip));
        if (recent == null) {
            return false;
        }
        synchronized (recent) {
            prune(recent);
            return recent.size() >= maxFailures;
        }
    }

    @Override
    public void recordFailure(String email, String ip) {
        Deque<Instant> recent = failures.computeIfAbsent(key(email, ip), k -> new ArrayDeque<>());
        synchronized (recent) {
            prune(recent);
            recent.addLast(clock.instant());
        }
        // The lock counts the failures of the ACCOUNT, over all addresses: guessing from many
        // addresses must not buy more attempts.
        Deque<Instant> account = accountFailures.computeIfAbsent(email, k -> new ArrayDeque<>());
        int total;
        synchronized (account) {
            prune(account);
            account.addLast(clock.instant());
            total = account.size();
        }
        if (total >= lockAfterFailures) {
            lock(email, clock.instant().plus(lockoutDuration));
        }
        if (failures.size() > 10_000) {
            evictExpired();
        }
    }

    @Override
    public void reset(String email, String ip) {
        failures.remove(key(email, ip));
        accountFailures.remove(email);
    }

    @Override
    public Optional<Instant> lockedUntil(String email) {
        Instant until = locked.get(email);
        if (until == null) {
            return Optional.empty();
        }
        if (!until.isAfter(clock.instant())) {
            // The lock runs out by itself: no job has to unlock it.
            locked.remove(email);
            return Optional.empty();
        }
        return Optional.of(until);
    }

    @Override
    public void lock(String email, Instant until) {
        locked.put(email, until);
    }

    @Override
    public void clear() {
        failures.clear();
        accountFailures.clear();
        locked.clear();
    }

    private void evictExpired() {
        failures.entrySet().removeIf(e -> {
            synchronized (e.getValue()) {
                prune(e.getValue());
                return e.getValue().isEmpty();
            }
        });
        accountFailures.entrySet().removeIf(e -> {
            synchronized (e.getValue()) {
                prune(e.getValue());
                return e.getValue().isEmpty();
            }
        });
    }

    private void prune(Deque<Instant> recent) {
        Instant cutoff = clock.instant().minus(window);
        while (!recent.isEmpty() && !recent.peekFirst().isAfter(cutoff)) {
            recent.pollFirst();
        }
    }

    private static String key(String email, String ip) {
        return email + "|" + ip;
    }
}
