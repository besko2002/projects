package com.example.hr.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/**
 * The same throttle as {@link LoginRateLimiter}, but in Redis, so several instances of the API
 * share one set of counters. Active when {@code app.login-rate-limit.store=redis}.
 *
 * <p>Two keys per (e-mail, IP): a counter that runs out with the window, and the lock of the
 * account itself, which carries its own expiry. The lock unlocks itself: it is simply gone when
 * the TTL is over.
 *
 * <p>Counter increments and TTL expiry are atomic via a Redis Lua script to avoid persistent
 * keys on crash. Outages fail open gracefully with error logging.
 */
@Component
@ConditionalOnProperty(prefix = "app.login-rate-limit", name = "store", havingValue = "redis")
public class RedisLoginThrottle implements LoginThrottle {

    private static final Logger log = LoggerFactory.getLogger(RedisLoginThrottle.class);

    private static final String FAILURE_PREFIX = "hr:login-fail:";
    private static final String ACCOUNT_FAILURES_PREFIX = "hr:login-fail-account:";
    private static final String LOCK_PREFIX = "hr:login-lock:";

    private static final RedisScript<Long> INCR_EXPIRE_SCRIPT = new DefaultRedisScript<>(
            """
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
                redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            return current
            """, Long.class);

    private final StringRedisTemplate redis;
    private final int maxFailures;
    private final Duration window;
    private final int lockAfterFailures;
    private final Duration lockoutDuration;
    private final Clock clock;

    @Autowired
    RedisLoginThrottle(StringRedisTemplate redis,
                       @Value("${app.login-rate-limit.max-failures:5}") int maxFailures,
                       @Value("${app.login-rate-limit.window:PT15M}") Duration window,
                       @Value("${app.login-rate-limit.lockout-after-failures:10}") int lockAfterFailures,
                       @Value("${app.login-rate-limit.lockout-duration:PT15M}") Duration lockoutDuration) {
        this(redis, maxFailures, window, lockAfterFailures, lockoutDuration, Clock.systemUTC());
    }

    RedisLoginThrottle(StringRedisTemplate redis, int maxFailures, Duration window, int lockAfterFailures,
                       Duration lockoutDuration, Clock clock) {
        this.redis = redis;
        this.maxFailures = maxFailures;
        this.window = window;
        this.lockAfterFailures = lockAfterFailures;
        this.lockoutDuration = lockoutDuration;
        this.clock = clock;
    }

    @Override
    public boolean isBlocked(String email, String ip) {
        try {
            String value = redis.opsForValue().get(failureKey(email, ip));
            if (value == null) {
                return false;
            }
            return Long.parseLong(value) >= maxFailures;
        } catch (NumberFormatException ex) {
            return false;
        } catch (Exception ex) {
            log.error("Redis outage during isBlocked check for {} (failing open)", email, ex);
            return false;
        }
    }

    @Override
    public void recordFailure(String email, String ip) {
        String key = failureKey(email, ip);
        Long failures = atomicIncrement(key, window);

        // The lock counts the failures of the ACCOUNT, over all addresses: guessing from many
        // addresses must not buy more attempts.
        String accountKey = ACCOUNT_FAILURES_PREFIX + email;
        Long accountFailures = atomicIncrement(accountKey, window);

        if (accountFailures != null && accountFailures >= lockAfterFailures) {
            lock(email, clock.instant().plus(lockoutDuration));
        }
    }

    private Long atomicIncrement(String key, Duration ttl) {
        try {
            return redis.execute(INCR_EXPIRE_SCRIPT, List.of(key), String.valueOf(ttl.toSeconds()));
        } catch (Exception ex) {
            log.error("Redis outage during atomicIncrement for key {}", key, ex);
            return null;
        }
    }

    @Override
    public void reset(String email, String ip) {
        try {
            redis.delete(List.of(failureKey(email, ip), ACCOUNT_FAILURES_PREFIX + email));
        } catch (Exception ex) {
            log.error("Redis outage during reset for {}", email, ex);
        }
    }

    @Override
    public Optional<Instant> lockedUntil(String email) {
        try {
            String value = redis.opsForValue().get(LOCK_PREFIX + email);
            if (value == null) {
                return Optional.empty();
            }
            return Optional.of(Instant.parse(value));
        } catch (Exception ex) {
            log.warn("Redis outage or unreadable lock for {} - ignoring it (failing open)", email, ex);
            return Optional.empty();
        }
    }

    @Override
    public void lock(String email, Instant until) {
        try {
            redis.opsForValue().set(LOCK_PREFIX + email, until.toString(), lockoutDuration.toSeconds(),
                    TimeUnit.SECONDS);
        } catch (Exception ex) {
            log.error("Redis outage during lock for {}", email, ex);
        }
    }

    @Override
    public void clear() {
        try {
            Set<String> keys = redis.keys("hr:login*");
            if (keys != null && !keys.isEmpty()) {
                redis.delete(keys);
            }
        } catch (Exception ex) {
            log.error("Redis outage during clear", ex);
        }
    }

    private static String failureKey(String email, String ip) {
        return FAILURE_PREFIX + email + "|" + ip;
    }
}
