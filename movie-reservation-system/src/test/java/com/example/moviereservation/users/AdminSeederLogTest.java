package com.example.moviereservation.users;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** CB-30: startup logs must not print the administrator's email address. */
@ExtendWith(OutputCaptureExtension.class)
class AdminSeederLogTest {

    @Test
    void seedingTheAdminLogsOnlyAMaskedEmail(CapturedOutput output) {
        UserService users = mock(UserService.class);
        when(users.createAdminIfAbsent("Owner", "owner.private@example.com", "Secret-Pass-1")).thenReturn(true);

        new AdminSeeder(users, "owner.private@example.com", "Secret-Pass-1", "Owner").seed();

        assertThat(output.getAll()).contains("Seeded ADMIN account for o***@example.com");
        assertThat(output.getAll()).doesNotContain("owner.private@example.com").doesNotContain("Secret-Pass-1");
    }
}
