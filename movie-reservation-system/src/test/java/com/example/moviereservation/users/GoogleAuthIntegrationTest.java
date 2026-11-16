package com.example.moviereservation.users;

import com.example.moviereservation.TestcontainersConfiguration;
import com.example.moviereservation.users.google.GoogleAuthRequest;
import com.example.moviereservation.users.google.GoogleTokenVerifierImpl;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "app.google.client-id=test-google-client-id-12345.apps.googleusercontent.com"
})
@AutoConfigureMockMvc
@Import({TestcontainersConfiguration.class, PasswordResetIntegrationTest.TestEmailConfig.class})
class GoogleAuthIntegrationTest {

    private static final String CLIENT_ID = "test-google-client-id-12345.apps.googleusercontent.com";
    private static KeyPair testKeyPair;
    private static KeyPair forgedKeyPair;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private GoogleTokenVerifierImpl googleTokenVerifier;

    @Autowired
    private PasswordResetIntegrationTest.CapturedEmailSender capturedEmails;

    @Autowired
    private org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    @Autowired
    private com.example.moviereservation.security.JwtService jwtService;

    @BeforeAll
    static void initKeys() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        testKeyPair = kpg.generateKeyPair();
        forgedKeyPair = kpg.generateKeyPair();
    }

    @BeforeEach
    void setupVerifier() {
        com.example.moviereservation.users.google.GoogleTestHooks.setTestKeyProvider(
                googleTokenVerifier,
                kid -> "test-key-1".equals(kid) ? testKeyPair.getPublic() : null);
    }

    private String createGoogleToken(String sub, String email, String name, boolean emailVerified,
                                     String audience, String issuer, Instant expiresAt, KeyPair signerKey) {
        return Jwts.builder()
                .header().keyId("test-key-1").and()
                .issuer(issuer)
                .audience().add(audience).and()
                .subject(sub)
                .claim("email", email)
                .claim("email_verified", emailVerified)
                .claim("name", name)
                .expiration(Date.from(expiresAt))
                .signWith(signerKey.getPrivate(), Jwts.SIG.RS256)
                .compact();
    }

    private String validToken(String sub, String email, String name) {
        return createGoogleToken(sub, email, name, true, CLIENT_ID, "https://accounts.google.com",
                Instant.now().plusSeconds(3600), testKeyPair);
    }

    @Test
    void authConfigEndpointReturnsPublicGoogleClientId() throws Exception {
        mockMvc.perform(get("/api/auth/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.googleClientId").value(CLIENT_ID));
    }

    @Test
    void validGoogleTokenRegistersNewUserWithRoleUser() throws Exception {
        String sub = "google-sub-" + System.nanoTime();
        String email = "guser-" + System.nanoTime() + "@cinema.test";
        String token = validToken(sub, email, "Google Patron");

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isString())
                .andExpect(jsonPath("$.user.email").value(email))
                .andExpect(jsonPath("$.user.role").value("USER"));

        Optional<User> created = userRepository.findByGoogleSub(sub);
        assertThat(created).isPresent();
        assertThat(created.get().getEmail()).isEqualTo(email);
        assertThat(created.get().getRole()).isEqualTo(Role.USER);
        assertThat(created.get().getPasswordHash()).isNull(); // Passwordless until reset
    }

    @Test
    void signingInWithExistingGoogleSubReturnsSameAccount() throws Exception {
        String sub = "google-sub-returning-" + System.nanoTime();
        String email = "returning-" + System.nanoTime() + "@cinema.test";
        String token = validToken(sub, email, "Returning User");

        // First login registers
        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isOk());

        Long firstId = userRepository.findByGoogleSub(sub).orElseThrow().getId();

        // Second login signs in
        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.id").value(firstId));
    }

    @Test
    void verifiedGoogleEmailLinksToExistingEmailAccount() throws Exception {
        String email = "existing-patron-" + System.nanoTime() + "@cinema.test";
        // Pre-create account with email/password
        User initial = userRepository.saveAndFlush(new User("Patron Original", email, "hashed-pass", Role.USER));
        assertThat(initial.getGoogleSub()).isNull();

        String sub = "google-sub-link-" + System.nanoTime();
        String token = validToken(sub, email, "Patron Google");

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.id").value(initial.getId()))
                .andExpect(jsonPath("$.notice").value(containsString("previous password was cleared")));

        User reloaded = userRepository.findById(initial.getId()).orElseThrow();
        assertThat(reloaded.getGoogleSub()).isEqualTo(sub);
    }

    @Test
    void linkingAnAccountThatHadAPasswordEmailsTheOwnerAfterCommit() throws Exception {
        String email = "notify-link-" + System.nanoTime() + "@cinema.test";
        User initial = userRepository.saveAndFlush(new User("Notify Me", email, "hashed-pass", Role.USER));
        capturedEmails.clear();

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(
                                validToken("google-sub-notify-" + System.nanoTime(), email, "Notify Me")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notice").value(containsString("Forgot password")));

        assertThat(capturedEmails.googleReplacedNotifications).containsExactly(email);
        assertThat(userRepository.findById(initial.getId()).orElseThrow().getPasswordHash()).isNull();
        // CB-34: the notice email is handed to the task executor, never sent on the request thread
        // (a slow Resend call would otherwise hold the request and its DB connection for ~20 s).
        assertThat(capturedEmails.googleReplacedViaExecutor).containsExactly(true);
    }

    @Test
    @org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
    void googleSignUpAndLinkLogsNeverContainTheRecipientEmail(
            org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        String newEmail = "log-privacy-new-" + System.nanoTime() + "@cinema.test";
        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(
                                validToken("google-sub-log-" + System.nanoTime(), newEmail, "Log Privacy")))))
                .andExpect(status().isOk());

        String linkEmail = "log-privacy-link-" + System.nanoTime() + "@cinema.test";
        userRepository.saveAndFlush(new User("Link Privacy", linkEmail, "hashed-pass", Role.USER));
        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(
                                validToken("google-sub-log-link-" + System.nanoTime(), linkEmail, "Link Privacy")))))
                .andExpect(status().isOk());

        assertThat(output.getAll()).contains("Registered new user via Google");
        assertThat(output.getAll()).doesNotContain(newEmail).doesNotContain(linkEmail);
    }

    @Test
    @org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
    void aDuplicateEmailInsertNeverLogsOrReportsTheEmail(
            org.springframework.boot.test.system.CapturedOutput output) {
        // CB-32: the PostgreSQL detail line ("Key (email)=(...) already exists") was logged by
        // Hibernate and repeated in the exception message.
        String email = "dup-log-" + System.nanoTime() + "@cinema.test";
        userRepository.saveAndFlush(new User("First", email, "hashed", Role.USER));
        Throwable failure = org.assertj.core.api.Assertions.catchThrowable(() ->
                userRepository.saveAndFlush(new User("Second", email, "hashed", Role.USER)));
        assertThat(failure).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        for (Throwable t = failure; t != null; t = t.getCause()) {
            assertThat(String.valueOf(t.getMessage())).as("message of %s", t.getClass()).doesNotContain(email);
        }
        assertThat(output.getAll()).doesNotContain(email);
    }

    @RepeatedTest(5)
    void concurrentFirstGoogleSignUpsForOneUserAllSignInToOneAccount() throws Exception {
        String sub = "google-sub-race-" + System.nanoTime();
        String email = "race-" + System.nanoTime() + "@cinema.test";
        String body = objectMapper.writeValueAsString(new GoogleAuthRequest(validToken(sub, email, "Race Patron")));
        int threads = 8;
        java.util.concurrent.CyclicBarrier start = new java.util.concurrent.CyclicBarrier(threads);
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(threads);
        try {
            List<java.util.concurrent.Future<Integer>> results = new java.util.ArrayList<>();
            for (int i = 0; i < threads; i++) {
                // A distinct client address per request keeps the per-IP Google limit out of the way.
                String clientIp = "198.18." + (System.nanoTime() % 250) + "." + (i + 1);
                results.add(pool.submit(() -> {
                    start.await();
                    return mockMvc.perform(post("/api/auth/google")
                                    .with(request -> {
                                        request.setRemoteAddr(clientIp);
                                        return request;
                                    })
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                            .andReturn().getResponse().getStatus();
                }));
            }
            List<Integer> statuses = new java.util.ArrayList<>();
            for (java.util.concurrent.Future<Integer> result : results) {
                statuses.add(result.get(60, java.util.concurrent.TimeUnit.SECONDS));
            }
            assertThat(statuses).as("statuses %s", statuses).allMatch(code -> code == 200);
        } finally {
            pool.shutdownNow();
        }
        assertThat(userRepository.findByGoogleSub(sub)).isPresent();
        assertThat(userRepository.findByEmail(email)).isPresent();
    }

    @Test
    void cannotLinkAccountIfAlreadyLinkedToDifferentGoogleSub() throws Exception {
        String email = "collision-" + System.nanoTime() + "@cinema.test";
        userRepository.saveAndFlush(new User("Patron 1", email, "hashed", Role.USER, "initial-google-sub"));

        String competingSub = "competing-sub-" + System.nanoTime();
        String token = validToken(competingSub, email, "Competing Google");

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isConflict());
    }

    @Test
    void wrongAudienceIsRejectedWith401() throws Exception {
        String token = createGoogleToken("sub-wrong-aud", "user@test.org", "User", true,
                "wrong-client-id.apps.googleusercontent.com", "https://accounts.google.com",
                Instant.now().plusSeconds(3600), testKeyPair);

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void expiredTokenIsRejectedWith401() throws Exception {
        String token = createGoogleToken("sub-expired", "user@test.org", "User", true,
                CLIENT_ID, "https://accounts.google.com",
                Instant.now().minusSeconds(10), testKeyPair);

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void unverifiedEmailIsRejectedWith400() throws Exception {
        String token = createGoogleToken("sub-unverified", "unverified@test.org", "User", false,
                CLIENT_ID, "https://accounts.google.com",
                Instant.now().plusSeconds(3600), testKeyPair);

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void forgedSignatureIsRejectedWith401() throws Exception {
        // Signed with a different key pair that does not match test-key-1
        String token = createGoogleToken("sub-forged", "forged@test.org", "Attacker", true,
                CLIENT_ID, "https://accounts.google.com",
                Instant.now().plusSeconds(3600), forgedKeyPair);

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void preHijackDefense_whenGoogleLinksAccountWithPassword_passwordAndSessionsAreRevoked() throws Exception {
        String email = "victim-" + System.nanoTime() + "@cinema.test";
        String attackerPassword = "AttackerPassword123!";

        // Attacker pre-registers the victim's email address
        User user = userRepository.saveAndFlush(new User("Victim Name", email, passwordEncoder.encode(attackerPassword), Role.USER));
        String attackerJwt = jwtService.generateToken(user.getId(), user.getEmail(), user.getRole().name(), user.getTokenVersion());

        // Attacker JWT works currently
        mockMvc.perform(get("/api/users/me").header("Authorization", "Bearer " + attackerJwt))
                .andExpect(status().isOk());

        // Legitimate victim signs in via Google with verified email
        String victimSub = "google-sub-" + System.nanoTime();
        String googleToken = validToken(victimSub, email, "Victim Google Name");

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(googleToken))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isString());

        // 1. Password has been cleared in DB
        User updated = userRepository.findById(user.getId()).orElseThrow();
        assertThat(updated.getPasswordHash()).isNull();
        assertThat(updated.getGoogleSub()).isEqualTo(victimSub);

        // 2. Attacker's existing JWT is now rejected (revoked by tokenVersion increment)
        mockMvc.perform(get("/api/users/me").header("Authorization", "Bearer " + attackerJwt))
                .andExpect(status().isUnauthorized());

        // 3. Attacker cannot sign in using the old password anymore
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest(email, attackerPassword))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void adminAccountsCannotSignInWithGoogle() throws Exception {
        String adminEmail = "admin-" + System.nanoTime() + "@cinema.test";
        User admin = userRepository.saveAndFlush(new User("Admin User", adminEmail, passwordEncoder.encode("AdminPass123!"), Role.ADMIN));

        String sub = "google-sub-admin-" + System.nanoTime();
        String token = validToken(sub, adminEmail, "Admin Google");

        // Attempting to link or sign in an ADMIN account via Google must be rejected with 403
        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isForbidden());

        // Also test an existing user with googleSub who was later granted ADMIN
        admin.setGoogleSub("existing-admin-sub");
        userRepository.saveAndFlush(admin);

        String returningToken = validToken("existing-admin-sub", adminEmail, "Admin Google");
        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(returningToken))))
                .andExpect(status().isForbidden());
    }

    @Test
    void googleNameOver100CharsTruncatesSafelyWithoutDataIntegrityViolation() throws Exception {
        String longName = "Very Long Google Patron Name ".repeat(6); // > 150 chars
        String sub = "google-sub-longname-" + System.nanoTime();
        String email = "longname-" + System.nanoTime() + "@cinema.test";
        String token = validToken(sub, email, longName);

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isString());

        User created = userRepository.findByGoogleSub(sub).orElseThrow();
        assertThat(created.getName()).hasSizeLessThanOrEqualTo(100);
        assertThat(created.getName()).isEqualTo(longName.substring(0, 100));
    }

    @Test
    void googleNameWithEmojiDoesNotSplitSurrogatePairAtBoundary() throws Exception {
        // 99 ASCII chars followed by a 2-char surrogate pair emoji (🎬)
        String prefix = "A".repeat(99);
        String nameWithEmoji = prefix + "\uD83C\uDFAC"; // 99 ASCII + 2 surrogate chars = 101 chars, 100 codepoints
        String sub = "google-sub-emoji-" + System.nanoTime();
        String email = "emoji-" + System.nanoTime() + "@cinema.test";
        String token = validToken(sub, email, nameWithEmoji);

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token))))
                .andExpect(status().isOk());

        User created = userRepository.findByGoogleSub(sub).orElseThrow();
        assertThat(created.getName()).isEqualTo(nameWithEmoji);

        // 100 ASCII chars + emoji (101 codepoints): truncates to 100 codepoints without dangling surrogate
        String name101 = "B".repeat(100) + "\uD83C\uDFAC";
        String sub2 = "google-sub-emoji2-" + System.nanoTime();
        String email2 = "emoji2-" + System.nanoTime() + "@cinema.test";
        String token2 = validToken(sub2, email2, name101);

        mockMvc.perform(post("/api/auth/google")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new GoogleAuthRequest(token2))))
                .andExpect(status().isOk());

        User created2 = userRepository.findByGoogleSub(sub2).orElseThrow();
        assertThat(created2.getName()).isEqualTo("B".repeat(100));
    }
}
