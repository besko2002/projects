package com.example.hr;

import com.example.hr.employee.Role;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class EmployeePasswordResetIntegrationTest extends AbstractIntegrationTest {
    @ParameterizedTest
    @EnumSource(value = Role.class, names = {"EMPLOYEE", "HR"})
    void roleChangesRevokeOldTokensAndFreshLoginUsesNewPermissions(Role initial) throws Exception {
        String admin = adminToken();
        NewEmployee actor = createEmployee(admin, "Role Changed Actor", initial, null);
        NewEmployee target = createEmployee(admin, "Role Changed Target", Role.EMPLOYEE, null);
        String old = login(actor.email(), actor.password());
        int before = jdbc.queryForObject("select token_version from employees where id = ?", Integer.class, actor.id());
        // A no-op role edit must not log the user out.
        mvc.perform(patch("/api/employees/" + actor.id()).header("Authorization", bearer(admin))
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("role", initial.name()))))
                .andExpect(status().isOk());
        getAs(old, "/api/employees/me").andExpect(status().isOk());
        Role changed = initial == Role.EMPLOYEE ? Role.HR : Role.EMPLOYEE;
        mvc.perform(patch("/api/employees/" + actor.id()).header("Authorization", bearer(admin))
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("role", changed.name()))))
                .andExpect(status().isOk());
        reset(old, target.id(), "Verified identity").andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value("Your account credentials or permissions changed; please sign in again"));
        assertThat(jdbc.queryForObject("select token_version from employees where id = ?", Integer.class, actor.id()))
                .isEqualTo(before + 1);
        reset(login(actor.email(), actor.password()), target.id(), "Verified identity")
                .andExpect(initial == Role.EMPLOYEE ? status().isOk() : status().isForbidden());
    }

    private ResultActions reset(String token, UUID id, String reason) throws Exception {
        return mvc.perform(post("/api/employees/" + id + "/reset-password")
                .header("Authorization", bearer(token)).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("reason", reason))));
    }

    @Test
    void hrResetRevokesAllTokensRequiresChangeAndAuditsWithoutSecrets() throws Exception {
        String admin = adminToken();
        NewEmployee hr = createEmployee(admin, "Reset HR", Role.HR, null);
        NewEmployee staff = createEmployee(admin, "Reset Target", Role.EMPLOYEE, null);
        String old = login(staff.email(), staff.password());
        String other = login(staff.email(), staff.password());
        int before = jdbc.queryForObject("select token_version from employees where id = ?", Integer.class, staff.id());
        String response = reset(login(hr.email(), hr.password()), staff.id(), "  Identity verified in person  ")
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.employeeId").value(staff.id().toString()))
                .andReturn().getResponse().getContentAsString();
        String temporary = json.readTree(response).path("temporaryPassword").asText();
        assertThat(temporary).hasSize(14).isNotEqualTo(staff.password());
        assertThat(jdbc.queryForObject("select token_version from employees where id = ?", Integer.class, staff.id()))
                .isEqualTo(before + 1);
        getAs(old, "/api/employees/me").andExpect(status().isUnauthorized());
        getAs(other, "/api/employees/me").andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", staff.email(), "password", staff.password()))))
                .andExpect(status().isUnauthorized());
        String fresh = login(staff.email(), temporary);
        getAs(fresh, "/api/employees/me").andExpect(jsonPath("$.mustChangePassword").value(true));
        getAs(fresh, "/api/leave/balances/me").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.mustChangePassword").value(true));
        String hash = jdbc.queryForObject("select password_hash from employees where id = ?", String.class, staff.id());
        assertThat(hash).isNotEqualTo(temporary).startsWith("$2");
        String detail = jdbc.queryForObject("select detail from security_events where employee_id = ? and detail like 'Password reset%'", String.class, staff.id());
        assertThat(detail).contains(hr.id().toString(), "Identity verified in person").doesNotContain(temporary, hash);
        String eventEmail = jdbc.queryForObject("select email from security_events where employee_id = ? and detail like 'Password reset%'", String.class, staff.id());
        assertThat(eventEmail).isEqualTo(staff.email());
        mvc.perform(post("/api/auth/change-password").header("Authorization", bearer(fresh))
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(
                        Map.of("currentPassword", temporary, "newPassword", "Recovered@2026"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.mustChangePassword").value(false));
        getAs(fresh, "/api/employees/me").andExpect(status().isUnauthorized());
        getAs(login(staff.email(), "Recovered@2026"), "/api/leave/balances/me").andExpect(status().isOk());
    }

    @Test
    void aTokenIssuedInTheResetSecondIsAlsoRevoked() throws Exception {
        String admin = adminToken();
        NewEmployee staff = createEmployee(admin, "Same Second Reset", Role.EMPLOYEE, null);
        String password = staff.password();
        for (int attempt = 0; attempt < 10; attempt++) {
            String old = login(staff.email(), password);
            password = body(reset(admin, staff.id(), "Verified identity").andExpect(status().isOk()))
                    .path("temporaryPassword").asText();
            long issued = json.readTree(new String(java.util.Base64.getUrlDecoder().decode(old.split("\\.")[1]),
                    java.nio.charset.StandardCharsets.UTF_8)).path("iat").asLong();
            java.time.Instant changed = jdbc.queryForObject(
                    "select password_changed_at from employees where id = ?", java.time.Instant.class, staff.id());
            getAs(old, "/api/employees/me").andExpect(status().isUnauthorized());
            if (changed.getEpochSecond() == issued) return;
        }
        throw new AssertionError("Could not exercise reset and token issuance in the same second");
    }

    @Test
    void permissionsSelfResetAndTerminatedTargetsAreRejected() throws Exception {
        String admin = adminToken();
        NewEmployee hr = createEmployee(admin, "Policy HR", Role.HR, null);
        NewEmployee staff = createEmployee(admin, "Policy Staff", Role.EMPLOYEE, null);
        NewEmployee anotherAdmin = createEmployee(admin, "Policy Admin", Role.ADMIN, null);
        String hrToken = login(hr.email(), hr.password());
        reset(login(staff.email(), staff.password()), hr.id(), "Verified").andExpect(status().isForbidden());
        reset(hrToken, anotherAdmin.id(), "Verified").andExpect(status().isForbidden());
        reset(hrToken, hr.id(), "Verified").andExpect(status().isForbidden());
        reset(admin, anotherAdmin.id(), "Verified").andExpect(status().isOk());
        mvc.perform(post("/api/employees/" + staff.id() + "/terminate").header("Authorization", bearer(admin)))
                .andExpect(status().isOk());
        reset(admin, staff.id(), "Verified").andExpect(status().isBadRequest());
    }

    @Test
    void reasonIsRequiredAndBoundedAndMissingAuthenticationIsRejected() throws Exception {
        String admin = adminToken();
        NewEmployee staff = createEmployee(admin, "Reason Staff", Role.EMPLOYEE, null);
        reset(admin, staff.id(), "   ").andExpect(status().isBadRequest());
        reset(admin, staff.id(), "x".repeat(401)).andExpect(status().isBadRequest());
        mvc.perform(post("/api/employees/" + staff.id() + "/reset-password")
                .header("Authorization", bearer(admin)).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/employees/" + staff.id() + "/reset-password")
                .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Verified\"}"))
                .andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("select token_version from employees where id = ?", Integer.class, staff.id())).isZero();
    }

    @Test
    void nonHrCallerWithBlankReasonGets403Not400() throws Exception {
        String admin = adminToken();
        NewEmployee staff = createEmployee(admin, "Regular Staff", Role.EMPLOYEE, null);
        String staffToken = login(staff.email(), staff.password());
        reset(staffToken, staff.id(), "   ").andExpect(status().isForbidden());
    }
}
