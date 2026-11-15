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

    private static final String UNIFORM_MESSAGE = "If an account matches that email, a password reset link has been sent.";

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

    @TestConfiguration
    static class TestEmailConfig {
        @Bean
        @Primary
        CapturedEmailSender testEmailSender() {
            return new CapturedEmailSender();
        }
    }

    static class CapturedEmailSender implements EmailSender {
        final Map<String, String> resetLinks = new ConcurrentHashMap<>();
        final List<String> notifications = new ArrayList<>();

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public void sendPasswordReset(String toEmail, String resetLink) {
            resetLinks.put(toEmail, resetLink);
        }

        @Override
        public void sendPasswordChangedNotification(String toEmail) {
            notifications.add(toEmail);
        }

        void clear() {
            resetLinks.clear();
            notifications.clear();
        }
    }

    @BeforeEach
    void clearState() {
        emailSender.clear();
    }

    private String extractTokenFromUrl(String url) {
        try {
            URI uri = URI.create(url);
            String query = uri.getQuery();
            for (String param : query.split("&")) {
                String[] pair = param.split("=");
                if ("token".equals(pair[0])) {
                    return URLDecoder.decode(pair[1], StandardCharsets.UTF_8);
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
        assertThat(resetLink).startsWith("http://127.0.0.1:5177/reset-password?token=");

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
}
