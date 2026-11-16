package com.example.moviereservation.users.google;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.BadCredentialsException;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import java.io.IOException;
import java.net.Authenticator;
import java.net.CookieHandler;
import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * CB-35 (test double: an HttpClient that is unreachable). While Google's key endpoint is down and
 * the key cache is empty, sign-ins must not each start another blocking certificate fetch.
 */
class GoogleKeyRefreshThrottleTest {

    @Test
    void anUnreachableKeyEndpointIsNotFetchedAgainOnEverySignIn() {
        MutableClock clock = new MutableClock();
        UnreachableHttpClient http = new UnreachableHttpClient();
        GoogleTokenVerifierImpl verifier = new GoogleTokenVerifierImpl(
                "client-id.apps.googleusercontent.com", new ObjectMapper(), clock, null, http);

        for (int signIn = 0; signIn < 5; signIn++) {
            assertThatThrownBy(() -> verifier.verify(token())).isInstanceOf(BadCredentialsException.class);
            clock.advance(Duration.ofSeconds(1));
        }
        assertThat(http.fetches.get()).as("fetches while the endpoint is down").isEqualTo(1);

        clock.advance(Duration.ofMinutes(1));
        assertThatThrownBy(() -> verifier.verify(token())).isInstanceOf(BadCredentialsException.class);
        assertThat(http.fetches.get()).as("retried once the back-off has passed").isEqualTo(2);
    }

    private static String token() {
        Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
        return b64.encodeToString("{\"alg\":\"RS256\",\"kid\":\"k1\"}".getBytes(StandardCharsets.UTF_8)) + "."
                + b64.encodeToString("{}".getBytes(StandardCharsets.UTF_8)) + "."
                + b64.encodeToString(new byte[]{1, 2, 3});
    }

    static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-11-16T10:00:00Z");

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    static final class UnreachableHttpClient extends HttpClient {
        final AtomicInteger fetches = new AtomicInteger();

        @Override
        public <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler) throws IOException {
            fetches.incrementAndGet();
            throw new java.net.ConnectException("Google is unreachable (test)");
        }

        @Override
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest request, HttpResponse.BodyHandler<T> handler) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest request, HttpResponse.BodyHandler<T> handler,
                                                                HttpResponse.PushPromiseHandler<T> push) {
            throw new UnsupportedOperationException();
        }

        @Override public Optional<CookieHandler> cookieHandler() { return Optional.empty(); }
        @Override public Optional<Duration> connectTimeout() { return Optional.empty(); }
        @Override public Redirect followRedirects() { return Redirect.NEVER; }
        @Override public Optional<ProxySelector> proxy() { return Optional.empty(); }
        @Override public SSLContext sslContext() { return null; }
        @Override public SSLParameters sslParameters() { return null; }
        @Override public Optional<Authenticator> authenticator() { return Optional.empty(); }
        @Override public Version version() { return Version.HTTP_1_1; }
        @Override public Optional<Executor> executor() { return Optional.empty(); }
    }
}
