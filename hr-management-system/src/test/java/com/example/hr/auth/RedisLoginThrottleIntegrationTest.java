package com.example.hr.auth;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class RedisLoginThrottleIntegrationTest {

    @SuppressWarnings("resource")
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7-alpine")
            .withExposedPorts(6379);

    private static StringRedisTemplate redis;
    private static LettuceConnectionFactory connectionFactory;

    @BeforeAll
    static void startRedis() {
        REDIS.start();
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
        redis = new StringRedisTemplate(connectionFactory);
    }

    @AfterEach
    void cleanKeys() {
        Set<String> keys = redis.keys("hr:login*");
        if (keys != null && !keys.isEmpty()) {
            redis.delete(keys);
        }
    }

    @Test
    void sharedCountersAcrossInstances() {
        RedisLoginThrottle instance1 = new RedisLoginThrottle(redis, 5, Duration.ofMinutes(15), 10,
                Duration.ofMinutes(15), Clock.systemUTC());
        RedisLoginThrottle instance2 = new RedisLoginThrottle(redis, 5, Duration.ofMinutes(15), 10,
                Duration.ofMinutes(15), Clock.systemUTC());

        String email = "shared@hr.local";
        String ip = "10.0.0.1";

        for (int i = 0; i < 4; i++) {
            instance1.recordFailure(email, ip);
            assertThat(instance2.isBlocked(email, ip)).isFalse();
        }

        instance1.recordFailure(email, ip);
        assertThat(instance2.isBlocked(email, ip)).isTrue();

        instance2.reset(email, ip);
        assertThat(instance1.isBlocked(email, ip)).isFalse();
    }

    @Test
    void atomicIncrementAndTtlExpiry() {
        RedisLoginThrottle throttle = new RedisLoginThrottle(redis, 5, Duration.ofSeconds(10), 10,
                Duration.ofSeconds(10), Clock.systemUTC());

        String email = "expiry@hr.local";
        String ip = "10.0.0.2";

        throttle.recordFailure(email, ip);

        Long ttl = redis.getExpire("hr:login-fail:" + email + "|" + ip, TimeUnit.SECONDS);
        assertThat(ttl).isNotNull();
        assertThat(ttl).isGreaterThan(0).isLessThanOrEqualTo(10);
    }

    @Test
    void lockoutAcrossMultipleIps() {
        RedisLoginThrottle instance1 = new RedisLoginThrottle(redis, 5, Duration.ofMinutes(15), 10,
                Duration.ofMinutes(15), Clock.systemUTC());
        RedisLoginThrottle instance2 = new RedisLoginThrottle(redis, 5, Duration.ofMinutes(15), 10,
                Duration.ofMinutes(15), Clock.systemUTC());

        String email = "lockout@hr.local";

        // 10 distinct IPs with 1 failure each: no individual IP is blocked, but account gets locked
        for (int i = 1; i <= 10; i++) {
            instance1.recordFailure(email, "192.168.1." + i);
        }

        Optional<Instant> locked1 = instance1.lockedUntil(email);
        Optional<Instant> locked2 = instance2.lockedUntil(email);

        assertThat(locked1).isPresent();
        assertThat(locked2).isPresent();
        assertThat(locked1.get()).isEqualTo(locked2.get());
    }

    @Test
    void concurrentFailuresRecordAccuratelyWithoutLostUpdates() throws Exception {
        RedisLoginThrottle throttle = new RedisLoginThrottle(redis, 50, Duration.ofMinutes(15), 100,
                Duration.ofMinutes(15), Clock.systemUTC());

        String email = "concurrent@hr.local";
        String ip = "10.0.0.99";
        int threads = 20;

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Void>> futures = new ArrayList<>();

        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                start.await();
                throttle.recordFailure(email, ip);
                return null;
            }));
        }

        start.countDown();
        for (Future<Void> future : futures) {
            future.get(10, TimeUnit.SECONDS);
        }
        pool.shutdown();

        String countStr = redis.opsForValue().get("hr:login-fail:" + email + "|" + ip);
        assertThat(countStr).isEqualTo("20");
    }

    @Test
    void outageBehaviorFailsOpenGracefully() {
        // Pointing to a dead port
        LettuceClientConfiguration clientConfig = LettuceClientConfiguration.builder()
                .commandTimeout(Duration.ofMillis(200))
                .build();
        RedisStandaloneConfiguration serverConfig = new RedisStandaloneConfiguration("127.0.0.1", 59999);
        LettuceConnectionFactory deadFactory = new LettuceConnectionFactory(serverConfig, clientConfig);
        deadFactory.afterPropertiesSet();

        StringRedisTemplate deadRedis = new StringRedisTemplate(deadFactory);

        RedisLoginThrottle outageThrottle = new RedisLoginThrottle(deadRedis, 5, Duration.ofMinutes(15), 10,
                Duration.ofMinutes(15), Clock.systemUTC());

        String email = "down@hr.local";
        String ip = "10.0.0.5";

        // Failing open: isBlocked is false, lockedUntil is empty, methods do not crash
        assertThatCode(() -> {
            boolean blocked = outageThrottle.isBlocked(email, ip);
            assertThat(blocked).isFalse();

            Optional<Instant> lock = outageThrottle.lockedUntil(email);
            assertThat(lock).isEmpty();

            outageThrottle.recordFailure(email, ip);
            outageThrottle.reset(email, ip);
            outageThrottle.lock(email, Instant.now().plusSeconds(60));
        }).doesNotThrowAnyException();

        deadFactory.destroy();
    }
}
