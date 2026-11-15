package com.example.moviereservation.users;

import com.example.moviereservation.TestcontainersConfiguration;
import com.example.moviereservation.security.JwtService;
import com.example.moviereservation.users.email.EmailSender;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "app.email.resend-api-key=test-resend-key",
        "app.email.frontend-base-url=http://127.0.0.1:5177"
})
@AutoConfigureMockMvc
@Import({TestcontainersConfiguration.class, PasswordResetIntegrationTest.TestEmailConfig.class})
class PasswordResetIntegrationTest {

    private static final String UNIFORM_MESSAGE = "If an account matches that email, we will email a password reset link. It can take a few minutes; if nothing arrives, check your spam folder or request a new link.";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordResetTokenRepository tokenRepository;

    @Autowired
    private CapturedEmailSender emailSender;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private org.springframework.transaction.support.TransactionTemplate transactionTemplate;

    @TestConfiguration
    static class TestEmailConfig {
        @Bean
        @Primary
        CapturedEmailSender testEmailSender() {
            return new CapturedEmailSender();
        }

        @Bean(name = {"applicationTaskExecutor", "testEmailExecutor"})
        @Primary
        java.util.concurrent.Executor testEmailExecutor() {
            return Runnable::run;
        }
    }

    static class CapturedEmailSender implements EmailSender {
        final Map<String, String> resetLinks = new ConcurrentHashMap<>();
        final List<String> notifications = new ArrayList<>();
        final List<String> googleReplacedNotifications = new ArrayList<>();
        volatile boolean failOnSend = false;

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public void sendPasswordReset(String toEmail, String resetLink) {
            if (failOnSend) {
                throw new RuntimeException("Simulated email delivery failure");
            }
            resetLinks.put(toEmail, resetLink);
        }

        @Override
        public void sendPasswordChangedNotification(String toEmail) {
            notifications.add(toEmail);
        }

        @Override
        public void sendPasswordReplacedByGoogleNotification(String toEmail) {
            googleReplacedNotifications.add(toEmail);
        }

        void clear() {
            resetLinks.clear();
            notifications.clear();
        }
    }

    @BeforeEach
    void clearState() {
        emailSender.clear();
        emailSender.failOnSend = false;
    }

    private String extractTokenFromUrl(String url) {
        try {
            URI uri = URI.create(url);
            String fragment = uri.getFragment();
            if (fragment != null && !fragment.isBlank()) {
                for (String param : fragment.split("&")) {
                    String[] pair = param.split("=");
                    if ("token".equals(pair[0])) {
                        return URLDecoder.decode(pair[1], StandardCharsets.UTF_8);
                    }
                }
            }
            String query = uri.getQuery();
            if (query != null && !query.isBlank()) {
                for (String param : query.split("&")) {
                    String[] pair = param.split("=");
                    if ("token".equals(pair[0])) {
                        return URLDecoder.decode(pair[1], StandardCharsets.UTF_8);
                    }
                }
            }
        } catch (Exception ex) {
            throw new IllegalArgumentException("Cannot extract token from " + url, ex);
        }
        throw new IllegalArgumentException("No token param in " + url);
    }

    @Test
    void forgotPasswordReturnsUniformMessageAndDispatchesEmailWhenUserExists() throws Exception {
        String email = "reset-target-" + System.nanoTime() + "@cinema.test";
        User user = userRepository.saveAndFlush(new User("Reset Target", email, passwordEncoder.encode("InitialP@ss1"), Role.USER));

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value(UNIFORM_MESSAGE));

        assertThat(emailSender.resetLinks).containsKey(email);
        String resetLink = emailSender.resetLinks.get(email);
        assertThat(resetLink).startsWith("http://127.0.0.1:5177/reset-password#token=");

        String rawToken = extractTokenFromUrl(resetLink);
        String expectedHash = PasswordResetService.sha256(rawToken);

        Optional<PasswordResetToken> stored = tokenRepository.findByTokenHash(expectedHash);
        assertThat(stored).isPresent();
        assertThat(stored.get().getUser().getId()).isEqualTo(user.getId());
        assertThat(stored.get().isUsed()).isFalse();
        assertThat(stored.get().getExpiresAt()).isAfter(OffsetDateTime.now());
    }

    @Test
    void forgotPasswordReturnsIdenticalUniformMessageWhenUserDoesNotExist() throws Exception {
        String nonExistentEmail = "ghost-" + System.nanoTime() + "@cinema.test";

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(nonExistentEmail))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value(UNIFORM_MESSAGE));

        assertThat(emailSender.resetLinks).doesNotContainKey(nonExistentEmail);
    }

    @Test
    void newForgotPasswordRequestInvalidatesOlderTokensForSameUser() throws Exception {
        String email = "multi-reset-" + System.nanoTime() + "@cinema.test";
        User user = userRepository.saveAndFlush(new User("Multi Target", email, passwordEncoder.encode("InitialP@ss1"), Role.USER));

        // First request
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk());

        String firstToken = extractTokenFromUrl(emailSender.resetLinks.get(email));
        String firstHash = PasswordResetService.sha256(firstToken);

        // Second request
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk());

        String secondToken = extractTokenFromUrl(emailSender.resetLinks.get(email));
        String secondHash = PasswordResetService.sha256(secondToken);

        assertThat(firstHash).isNotEqualTo(secondHash);

        // First token is now invalidated (used = true)
        assertThat(tokenRepository.findByTokenHash(firstHash).orElseThrow().isUsed()).isTrue();
        // Second token is fresh and unused
        assertThat(tokenRepository.findByTokenHash(secondHash).orElseThrow().isUsed()).isFalse();
    }

    @Test
    void successfulPasswordResetRevokesPriorTokensAndAllowsSignInWithNewPassword() throws Exception {
        String email = "flow-user-" + System.nanoTime() + "@cinema.test";
        String oldPassword = "OldPassword@123";
        String newPassword = "NewSecretPassword@456";

        User user = userRepository.saveAndFlush(new User("Flow User", email, passwordEncoder.encode(oldPassword), Role.USER));
        String oldJwt = jwtService.generateToken(user.getId(), user.getEmail(), user.getRole().name(), user.getTokenVersion());

        // Verify old JWT works on protected route
        mockMvc.perform(get("/api/users/me").header("Authorization", "Bearer " + oldJwt))
                .andExpect(status().isOk());

        // Request reset
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk());

        String rawToken = extractTokenFromUrl(emailSender.resetLinks.get(email));

        // Perform reset
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ResetPasswordRequest(rawToken, newPassword))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Password has been successfully reset. You may now sign in with your new password."));

        // Notification email sent
        assertThat(emailSender.notifications).contains(email);

        // Prior token is marked used
        String tokenHash = PasswordResetService.sha256(rawToken);
        assertThat(tokenRepository.findByTokenHash(tokenHash).orElseThrow().isUsed()).isTrue();

        // Old JWT is revoked (token_version incremented)
        mockMvc.perform(get("/api/users/me").header("Authorization", "Bearer " + oldJwt))
                .andExpect(status().isUnauthorized());

        // Old password no longer works
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest(email, oldPassword))))
                .andExpect(status().isUnauthorized());

        // New password signs in successfully
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest(email, newPassword))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isString());
    }

    @Test
    void cannotReuseSameResetTokenTwice() throws Exception {
        String email = "single-use-" + System.nanoTime() + "@cinema.test";
        User user = userRepository.saveAndFlush(new User("Single Use", email, passwordEncoder.encode("Pass@1234"), Role.USER));

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk());

        String rawToken = extractTokenFromUrl(emailSender.resetLinks.get(email));

        // First reset succeeds
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ResetPasswordRequest(rawToken, "BrandNew@123"))))
                .andExpect(status().isOk());

        // Second reset fails with 400 Bad Request
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ResetPasswordRequest(rawToken, "AnotherNew@123"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void resetWithInvalidOrNonexistentTokenReturns400() throws Exception {
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ResetPasswordRequest("nonexistent-token-hex", "ValidNewPass@123"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void resetWithPasswordViolatingLengthPolicyReturns400() throws Exception {
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ResetPasswordRequest("some-token", "short"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void concurrentResetsWithSameTokenSerializeAndOnlyOneSucceeds() throws Exception {
        String email = "concurrent-reset-" + System.nanoTime() + "@cinema.test";
        userRepository.saveAndFlush(new User("Concurrent User", email, passwordEncoder.encode("Pass@1234"), Role.USER));

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk());

        String rawToken = extractTokenFromUrl(emailSender.resetLinks.get(email));

        int threads = 2;
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        CountDownLatch readyLatch = new CountDownLatch(threads);
        CountDownLatch startLatch = new CountDownLatch(1);
        AtomicInteger successCount = new AtomicInteger();
        AtomicInteger conflictOrBadRequestCount = new AtomicInteger();

        List<Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            final int index = i;
            futures.add(executor.submit(() -> {
                readyLatch.countDown();
                try {
                    startLatch.await();
                    var result = mockMvc.perform(post("/api/auth/reset-password")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(objectMapper.writeValueAsString(new ResetPasswordRequest(rawToken, "NewPass@" + index + "123"))))
                            .andReturn();

                    int statusCode = result.getResponse().getStatus();
                    if (statusCode == 200) {
                        successCount.incrementAndGet();
                    } else if (statusCode == 400) {
                        conflictOrBadRequestCount.incrementAndGet();
                    }
                } catch (Exception ex) {
                    throw new RuntimeException(ex);
                }
            }));
        }

        assertThat(readyLatch.await(5, TimeUnit.SECONDS)).isTrue();
        startLatch.countDown();

        for (Future<?> f : futures) {
            f.get(10, TimeUnit.SECONDS);
        }
        executor.shutdown();

        // Exactly one should succeed with 200, the other must fail with 400
        assertThat(successCount.get()).isEqualTo(1);
        assertThat(conflictOrBadRequestCount.get()).isEqualTo(1);
    }

    @Test
    void emailDeliveryFailureDoesNotInvalidatePriorValidTokens() throws Exception {
        String email = "delivery-fail-" + System.nanoTime() + "@cinema.test";
        userRepository.saveAndFlush(new User("Delivery Target", email, passwordEncoder.encode("InitialP@ss1"), Role.USER));

        // First reset request succeeds and dispatches email
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk());

        String firstToken = extractTokenFromUrl(emailSender.resetLinks.get(email));
        String firstHash = PasswordResetService.sha256(firstToken);
        assertThat(tokenRepository.findByTokenHash(firstHash).orElseThrow().isUsed()).isFalse();

        // Simulate provider failure on second request
        emailSender.failOnSend = true;

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk());

        // Because second email dispatch failed, first valid token must STILL remain usable (used = false)
        assertThat(tokenRepository.findByTokenHash(firstHash).orElseThrow().isUsed()).isFalse();

        // The user can still successfully reset password with the first token
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ResetPasswordRequest(firstToken, "NewWorkingPass@123"))))
                .andExpect(status().isOk());
    }

    @Test
    void rateLimiterBlocksExcessivePasswordResetRequestsPerEmail() throws Exception {
        String email = "victim-flood-" + System.nanoTime() + "@cinema.test";
        userRepository.saveAndFlush(new User("Flood Victim", email, passwordEncoder.encode("Pass@1234"), Role.USER));

        // 3 requests within 15 minutes are permitted
        for (int i = 0; i < 3; i++) {
            mockMvc.perform(post("/api/auth/forgot-password")
                            .header("X-Forwarded-For", "198.51.100." + (i + 1))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                    .andExpect(status().isOk());
        }

        // 4th request for the same email is blocked with 429 Too Many Requests
        mockMvc.perform(post("/api/auth/forgot-password")
                        .header("X-Forwarded-For", "198.51.100.99")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void delayedOlderResetLinkInvalidationDoesNotInvalidateNewerToken() throws Exception {
        String email = "race-test-" + System.nanoTime() + "@cinema.test";
        User user = userRepository.saveAndFlush(new User("Race Tester", email, passwordEncoder.encode("Pass@1234"), Role.USER));

        // Generate first reset link
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk());
        String link1 = emailSender.resetLinks.get(email);
        assertThat(link1).isNotNull();
        String token1 = link1.substring(link1.indexOf("#token=") + 7);

        // Generate second reset link
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ForgotPasswordRequest(email))))
                .andExpect(status().isOk());
        String link2 = emailSender.resetLinks.get(email);
        assertThat(link2).isNotNull().isNotEqualTo(link1);
        String token2 = link2.substring(link2.indexOf("#token=") + 7);

        PasswordResetToken tokenObj1 = tokenRepository.findByTokenHash(PasswordResetService.sha256(token1)).orElseThrow();
        PasswordResetToken tokenObj2 = tokenRepository.findByTokenHash(PasswordResetService.sha256(token2)).orElseThrow();

        // Simulate request 1's delayed invalidation callback executing AFTER request 2 created token 2
        transactionTemplate.executeWithoutResult(status ->
                tokenRepository.invalidatePriorTokensForUser(user.getId(), tokenObj1.getId()));

        // Token 2 must remain valid (not marked used) because tokenObj1.id < tokenObj2.id
        PasswordResetToken tokenObj2Reloaded = tokenRepository.findById(tokenObj2.getId()).orElseThrow();
        assertThat(tokenObj2Reloaded.isUsed()).isFalse();

        // New password can be set with token 2
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ResetPasswordRequest(token2, "NewBrandNewPass@1234"))))
                .andExpect(status().isOk());
    }

    @Test
    void successfulPasswordResetInvalidatesAllOtherTokensForUser() throws Exception {
        String email = "invalidate-all-" + System.nanoTime() + "@cinema.test";
        User user = userRepository.saveAndFlush(new User("Invalidate Tester", email, passwordEncoder.encode("Pass@1234"), Role.USER));

        // Create two reset tokens directly
        OffsetDateTime expiresAt = OffsetDateTime.now().plusMinutes(30);
        PasswordResetToken t1 = tokenRepository.saveAndFlush(new PasswordResetToken(user, PasswordResetService.sha256("rawToken1111"), expiresAt));
        PasswordResetToken t2 = tokenRepository.saveAndFlush(new PasswordResetToken(user, PasswordResetService.sha256("rawToken2222"), expiresAt));

        // Reset using token 2
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ResetPasswordRequest("rawToken2222", "NewBrandNewPass@1234"))))
                .andExpect(status().isOk());

        // Token 1 must now be marked used
        PasswordResetToken t1Reloaded = tokenRepository.findById(t1.getId()).orElseThrow();
        assertThat(t1Reloaded.isUsed()).isTrue();

        // Attempting to reset using token 1 is rejected
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new ResetPasswordRequest("rawToken1111", "AnotherPass@9999"))))
                .andExpect(status().isBadRequest());
    }
}
