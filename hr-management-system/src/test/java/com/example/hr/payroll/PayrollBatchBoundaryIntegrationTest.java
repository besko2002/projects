package com.example.hr.payroll;

import com.example.hr.employee.Role;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Exercises PayrollService across the 500-employee batch boundary.
 */
class PayrollBatchBoundaryIntegrationTest extends AbstractPayrollIntegrationTest {

    @Test
    void exercisesPayrollServiceAcross500EmployeeBatchBoundary() throws Exception {
        String admin = adminToken();
        int totalEmployees = 505;

        // Fast batch insert of 505 active employees with valid salaries
        List<Object[]> batchArgs = new ArrayList<>(totalEmployees);
        for (int i = 0; i < totalEmployees; i++) {
            UUID id = UUID.randomUUID();
            String num = "EMP-B" + String.format("%04d", i);
            batchArgs.add(new Object[]{
                    id, num, "Batch Employee " + i, "batch" + i + "@hr.local",
                    Role.EMPLOYEE.name(), "ACTIVE", "dummy-hash",
                    LocalDate.of(2024, 1, 1), new BigDecimal("5000.00")
            });
        }
        jdbc.batchUpdate("""
                insert into employees (id, employee_number, full_name, email, role, status, password_hash, hire_date, salary)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, batchArgs);

        // Run payroll for February 2025
        int year = 2025;
        int month = 2;
        JsonNode runJson = createRunOk(admin, year, month);
        UUID runId = runIdOf(runJson);

        // 1. Verify totals across the batch boundary
        assertThat(runJson.path("run").path("payslipCount").asInt()).isEqualTo(totalEmployees);
        assertThat(runJson.path("totals").path("employees").asInt()).isEqualTo(totalEmployees);
        BigDecimal expectedBase = new BigDecimal("5000.00").multiply(BigDecimal.valueOf(totalEmployees));
        assertThat(new BigDecimal(runJson.path("totals").path("baseSalary").asText()))
                .isEqualByComparingTo(expectedBase);

        // 2. Verify unique payslips
        List<UUID> payslipIds = jdbc.queryForList("select id from payslips where run_id = ?", UUID.class, runId);
        assertThat(payslipIds).hasSize(totalEmployees);
        Set<UUID> uniqueIds = new HashSet<>(payslipIds);
        assertThat(uniqueIds).hasSize(totalEmployees);

        // 3. Page ordering and caps
        // Request size 50 returns 50
        JsonNode page50 = body(getAs(admin, "/api/payroll/runs/" + runId + "/payslips?page=0&size=50")
                .andExpect(status().isOk()));
        assertThat(page50.path("content").size()).isEqualTo(50);
        assertThat(page50.path("totalElements").asInt()).isEqualTo(totalEmployees);
        assertThat(page50.path("totalPages").asInt()).isEqualTo(11);

        // Request size 500 is capped at 200
        JsonNode pageCapped = body(getAs(admin, "/api/payroll/runs/" + runId + "/payslips?page=0&size=500")
                .andExpect(status().isOk()));
        assertThat(pageCapped.path("content").size()).isEqualTo(200);
        assertThat(pageCapped.path("size").asInt()).isEqualTo(200);

        // Ordering is consistent
        String firstNum = page50.path("content").get(0).path("employeeNumber").asText();
        String secondNum = page50.path("content").get(1).path("employeeNumber").asText();
        assertThat(firstNum.compareTo(secondNum)).isLessThanOrEqualTo(0);
    }

    @Test
    void atomicRollbackOnLaterBatchFailureLeavesNoRunAndNoOrphanPayslips() throws Exception {
        String admin = adminToken();
        int totalEmployees = 505;

        List<Object[]> batchArgs = new ArrayList<>(totalEmployees);
        for (int i = 0; i < totalEmployees; i++) {
            UUID id = UUID.randomUUID();
            String num = "EMP-R" + String.format("%04d", i);
            batchArgs.add(new Object[]{
                    id, num, "Rollback Employee " + i, "rollback" + i + "@hr.local",
                    Role.EMPLOYEE.name(), "ACTIVE", "dummy-hash",
                    LocalDate.of(2024, 1, 1), new BigDecimal("4000.00")
            });
        }
        jdbc.batchUpdate("""
                insert into employees (id, employee_number, full_name, email, role, status, password_hash, hire_date, salary)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, batchArgs);

        int year = 2025;
        int month = 1;

        // Force a failure during batch 2 by adding a trigger that fails when payslips exceed 500
        jdbc.execute("""
                create or replace function fail_on_503() returns trigger as $$
                begin
                    if (select count(*) from payslips) > 502 then
                        raise exception 'Simulated batch 2 failure';
                    end if;
                    return new;
                end;
                $$ language plpgsql;
                """);
        jdbc.execute("""
                create trigger trigger_fail_on_503
                before insert on payslips
                for each row execute function fail_on_503();
                """);

        try {
            // Attempt createRun - must fail and rollback atomically
            createRun(admin, year, month).andExpect(status().is5xxServerError());

            // Confirm 0 runs and 0 payslips were left behind
            Long runCount = jdbc.queryForObject("select count(*) from payroll_runs where run_year = ? and run_month = ?",
                    Long.class, year, month);
            Long payslipCount = jdbc.queryForObject("select count(*) from payslips", Long.class);

            assertThat(runCount).isZero();
            assertThat(payslipCount).isZero();
        } finally {
            jdbc.execute("drop trigger if exists trigger_fail_on_503 on payslips");
            jdbc.execute("drop function if exists fail_on_503");
        }
    }

    @Test
    void recalculateRollbackRestoresOriginalPayslipsOnLaterBatchFailure() throws Exception {
        String admin = adminToken();
        int totalEmployees = 105;

        List<Object[]> batchArgs = new ArrayList<>(totalEmployees);
        for (int i = 0; i < totalEmployees; i++) {
            UUID id = UUID.randomUUID();
            String num = "EMP-RC" + String.format("%04d", i);
            batchArgs.add(new Object[]{
                    id, num, "Recalc Rollback " + i, "recalc" + i + "@hr.local",
                    Role.EMPLOYEE.name(), "ACTIVE", "dummy-hash",
                    LocalDate.of(2024, 1, 1), new BigDecimal("4500.00")
            });
        }
        jdbc.batchUpdate("""
                insert into employees (id, employee_number, full_name, email, role, status, password_hash, hire_date, salary)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, batchArgs);

        int year = 2025;
        int month = 3;

        JsonNode runJson = createRunOk(admin, year, month);
        UUID runId = runIdOf(runJson);
        assertThat(runJson.path("run").path("payslipCount").asInt()).isEqualTo(totalEmployees);

        List<UUID> initialPayslipIds = jdbc.queryForList("select id from payslips where run_id = ?", UUID.class, runId);
        assertThat(initialPayslipIds).hasSize(totalEmployees);

        // Force a failure during batch 2 of recalculation (batch size is 100)
        jdbc.execute("""
                create or replace function fail_on_later_batch() returns trigger as $$
                begin
                    if (select count(*) from payslips where run_id = NEW.run_id) >= 101 then
                        raise exception 'Simulated batch 2 recalculate failure';
                    end if;
                    return new;
                end;
                $$ language plpgsql;
                """);
        jdbc.execute("""
                create trigger trigger_fail_on_later_batch
                before insert on payslips
                for each row execute function fail_on_later_batch();
                """);

        try {
            recalculate(admin, runId).andExpect(status().is5xxServerError());

            // Because recalculate failed in a later batch, the transaction must roll back completely
            // Original payslips must still be intact
            List<UUID> postRollbackIds = jdbc.queryForList("select id from payslips where run_id = ?", UUID.class, runId);
            assertThat(postRollbackIds).containsExactlyInAnyOrderElementsOf(initialPayslipIds);

            String status = jdbc.queryForObject("select status from payroll_runs where id = ?", String.class, runId);
            assertThat(status).isEqualTo("DRAFT");
        } finally {
            jdbc.execute("drop trigger if exists trigger_fail_on_later_batch on payslips");
            jdbc.execute("drop function if exists fail_on_later_batch");
        }
    }
}
