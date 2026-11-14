package com.example.hr.auth;

import com.example.hr.AbstractIntegrationTest;
import com.example.hr.employee.Role;
import com.example.hr.security.SecurityEvent;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The sign-in hardening: the account lockout after repeated failures, and the security events
 * that record what happened around a sign-in.
 */
class SecurityEventIntegrationTest extends AbstractIntegrationTest {

    @BeforeEach
    void cleanEvents() {
        jdbc.execute("delete from security_events");
    }

    @Test
    void theAccountIsLockedAfterRepeatedFailuresFromManyAddresses() throws Exception {
        String admin = adminToken();
        NewEmployee staff = createEmployee(admin, "Lock Me", Role.EMPLOYEE, null);

        // The per-address throttle blocks after five failures; the ACCOUNT lock needs ten, so
        // the attempts come from different addresses - the lock is what has to survive that.
        for (int attempt = 1; attempt <= 10; attempt += 1) {
            loginFrom("10.0.0." + attempt, staff.email(), "wrong-" + attempt);
        }

        // The right password does not help while the account is locked.
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(
                                java.util.Map.of("email", staff.email(), "password", staff.password()))))
                .andExpect(status().isTooManyRequests());

        List<SecurityEvent.Type> types = jdbc.queryForList(
                "select type from security_events where email = ? order by occurred_at",
                SecurityEvent.Type.class, staff.email());
        assertThat(types).contains(SecurityEvent.Type.LOGIN_FAILED, SecurityEvent.Type.ACCOUNT_LOCKED);
    }

    @Test
    void theSecurityEventsRecordTheSignInsAndThePasswordChanges() throws Exception {
        String admin = adminToken();
        NewEmployee staff = createEmployee(admin, "Event Me", Role.EMPLOYEE, null);

        // A failed sign-in, then a successful one.
        loginFrom("10.1.0.1", staff.email(), "wrong");
        String token = login(staff.email(), staff.password());
        assertThat(token).isNotBlank();

        // And a password change.
        mvc.perform(post("/api/auth/change-password").header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(java.util.Map.of(
                                "currentPassword", staff.password(), "newPassword", "Rotated@2026"))))
                .andExpect(status().isOk());

        List<SecurityEvent.Type> types = jdbc.queryForList(
                "select type from security_events where email = ? order by occurred_at",
                SecurityEvent.Type.class, staff.email());
        assertThat(types).containsExactly(SecurityEvent.Type.LOGIN_FAILED,
                SecurityEvent.Type.LOGIN_SUCCEEDED, SecurityEvent.Type.PASSWORD_CHANGED);

        // No password and no token ever ends up in the trail.
        Integer secrets = jdbc.queryForObject(
                "select count(*) from security_events where detail like '%Password123%' "
                        + "or detail like '%Rotated@%'", Integer.class);
        assertThat(secrets).isZero();
    }

    /** A sign-in from a given client address. */
    private org.springframework.test.web.servlet.ResultActions loginFrom(String ip, String email,
                                                                         String password)
            throws Exception {
        return mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .with(request -> {
                    request.setRemoteAddr(ip);
                    return request;
                })
                .content(json.writeValueAsString(java.util.Map.of("email", email, "password", password))));
    }

    @Test
    void theHealthEndpointStaysUpWithoutRedis() throws Exception {
        // The Redis health indicator is off unless Redis is actually used, so a stack without
        // Redis does not look unhealthy.
        mvc.perform(get("/actuator/health")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }
}
