package com.example.hr.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
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
 * Distributed sliding-window login throttle in Redis, matching the semantics of {@link LoginRateLimiter}
 * across multiple API instances. Active when {@code app.login-rate-limit.store=redis}.
 *
 * <p>Uses Redis Sorted Sets (ZSET) where each member is a unique failure attempt and the score
 * is the epoch millisecond. Pruning of expired entries older than {@code now - window} and counting
 * are executed atomically via Lua scripts.
 *
 * <p>Outages fail open gracefully with error logging.
 */
@Component
@ConditionalOnProperty(prefix = "app.login-rate-limit", name = "store", havingValue = "redis")
public class RedisLoginThrottle implements LoginThrottle {

    private static final Logger log = LoggerFactory.getLogger(RedisLoginThrottle.class);

    private static final String FAILURE_PREFIX = "hr:login-fail:";
    private static final String ACCOUNT_FAILURES_PREFIX = "hr:login-fail-account:";
    private static final String LOCK_PREFIX = "hr:login-lock:";

    /**
     * Atomic sliding window failure record:
     * 1. Remove entries older than cutoff (now - window).
     * 2. Add current failure entry.
     * 3. Set rolling PEXPIRE to window duration.
     * 4. Return total active entries in the window.
     */
    private static final RedisScript<Long> RECORD_FAILURE_SCRIPT = new DefaultRedisScript<>(
            """
            local cutoff = tonumber(ARGV[1]) - tonumber(ARGV[2])
            redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
            redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
            redis.call('PEXPIRE', KEYS[1], ARGV[2])
            return redis.call('ZCARD', KEYS[1])
            """, Long.class);

    /**
     * Atomic sliding window check:
     * 1. Remove entries older than cutoff.
     * 2. Return remaining active entries count.
     */
    private static final RedisScript<Long> CHECK_FAILURES_SCRIPT = new DefaultRedisScript<>(
            """
            local cutoff = tonumber(ARGV[1]) - tonumber(ARGV[2])
            redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
            return redis.call('ZCARD', KEYS[1])
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
            long nowMillis = clock.millis();
            long windowMillis = window.toMillis();
            Long count = redis.execute(CHECK_FAILURES_SCRIPT,
                    List.of(failureKey(email, ip)),
                    String.valueOf(nowMillis),
                    String.valueOf(windowMillis));
            return count != null && count >= maxFailures;
        } catch (Exception ex) {
            log.error("Redis outage during isBlocked check for {} (failing open)", email, ex);
            return false;
        }
    }

    @Override
    public void recordFailure(String email, String ip) {
        long nowMillis = clock.millis();
        long windowMillis = window.toMillis();
        String member = nowMillis + ":" + UUID.randomUUID();

        Long failures = recordInZSet(failureKey(email, ip), nowMillis, windowMillis, member);
        Long accountFailures = recordInZSet(ACCOUNT_FAILURES_PREFIX + email, nowMillis, windowMillis, member);

        if (accountFailures != null && accountFailures >= lockAfterFailures) {
            lock(email, clock.instant().plus(lockoutDuration));
        }
    }

    private Long recordInZSet(String key, long nowMillis, long windowMillis, String member) {
        try {
            return redis.execute(RECORD_FAILURE_SCRIPT,
                    List.of(key),
                    String.valueOf(nowMillis),
                    String.valueOf(windowMillis),
                    member);
        } catch (Exception ex) {
            log.error("Redis outage during recordFailure for key {}", key, ex);
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
            Instant until = Instant.parse(value);
            if (!until.isAfter(clock.instant())) {
                redis.delete(LOCK_PREFIX + email);
                return Optional.empty();
            }
            return Optional.of(until);
        } catch (Exception ex) {
            log.warn("Redis outage or unreadable lock for {} - ignoring it (failing open)", email, ex);
            return Optional.empty();
        }
    }

    @Override
    public void lock(String email, Instant until) {
        try {
            long remainingMillis = Math.max(1, Duration.between(clock.instant(), until).toMillis());
            redis.opsForValue().set(LOCK_PREFIX + email, until.toString(), remainingMillis, TimeUnit.MILLISECONDS);
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
