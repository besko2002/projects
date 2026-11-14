package com.example.hr.payroll;

import com.example.hr.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Isolated full-stack scale benchmark measuring a 5,000 employee roster against
 * PostgreSQL, repository batch queries, Spring services, org-chart pagination,
 * manager search, payroll generation, and streaming Excel export.
 *
 * <p>Note: 20,000 employee full-stack capacity is explicitly left unverified
 * on local runner environments due to container heap and resource constraints.
 */
class PayrollFullStackScaleTest extends AbstractIntegrationTest {

    private static final int ROSTER_SIZE = 5_000;

    @Test
    @DisplayName("5,000 employee roster isolated full-stack scale benchmark")
    void benchmark5000EmployeeFullStackWorkload() throws Exception {
        String adminToken = adminToken();

        // 1. Batch seed 5,000 active employees directly via JDBC in batches of 500
        long seedStart = System.currentTimeMillis();
        UUID rootManagerId = UUID.randomUUID();
        insertEmployee(rootManagerId, "EMP-10000", "Root Manager", "root.manager@hr.local", null);

        List<UUID> childIds = new ArrayList<>(ROSTER_SIZE - 1);
        String insertSql = """
                insert into employees (id, employee_number, full_name, email, password_hash, role,
                                       job_title, manager_id, hire_date, salary, status,
                                       must_change_password, created_at, updated_at, version, token_version)
                values (?, ?, ?, ?, '$2a$10$dummyHashForScaleBenchmarkingPurposesOnly', 'EMPLOYEE',
                        'Scale Worker', ?, ?, 5000.00, 'ACTIVE', false, now(), now(), 0, 0)
                """;

        jdbc.execute((java.sql.Connection conn) -> {
            try (PreparedStatement ps = conn.prepareStatement(insertSql)) {
                for (int i = 1; i < ROSTER_SIZE; i++) {
                    UUID id = UUID.randomUUID();
                    childIds.add(id);
                    ps.setObject(1, id);
                    ps.setString(2, "EMP-" + (10000 + i));
                    ps.setString(3, "Worker " + i);
                    ps.setString(4, "worker." + i + "@hr.local");
                    ps.setObject(5, rootManagerId);
                    ps.setDate(6, Date.valueOf(LocalDate.of(2024, 1, 1)));
                    ps.addBatch();

                    if (i % 500 == 0 || i == ROSTER_SIZE - 1) {
                        ps.executeBatch();
                    }
                }
            }
            return null;
        });

        long seedDuration = System.currentTimeMillis() - seedStart;
        long totalEmployees = jdbc.queryForObject("select count(*) from employees", Long.class);
        // Includes the bootstrap admin plus the 5,000 scale workers
        assertThat(totalEmployees).isGreaterThanOrEqualTo(ROSTER_SIZE);

        System.gc();
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        long initialHeapSnapshotBytes = memoryBean.getHeapMemoryUsage().getUsed();

        // 2. Measure Paged Org-Chart Root Query
        long orgRootsStart = System.currentTimeMillis();
        JsonNode rootsPage = body(mvc.perform(get("/api/org-chart?page=0&size=50")
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk()));
        long orgRootsDuration = System.currentTimeMillis() - orgRootsStart;
        assertThat(rootsPage.path("content").size()).isGreaterThanOrEqualTo(1);

        // 3. Measure Paged Org-Chart Children Query (Root Manager has 4,999 direct reports)
        long orgChildrenStart = System.currentTimeMillis();
        JsonNode childrenPage = body(mvc.perform(get("/api/org-chart/" + rootManagerId + "/children?page=0&size=50")
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk()));
        long orgChildrenDuration = System.currentTimeMillis() - orgChildrenStart;
        assertThat(childrenPage.path("content").size()).isEqualTo(50);
        assertThat(childrenPage.path("totalElements").asInt()).isEqualTo(ROSTER_SIZE - 1);

        // 4. Measure Paged Manager/Employee Search
        long searchStart = System.currentTimeMillis();
        JsonNode searchPage = body(mvc.perform(get("/api/employees?q=Worker&page=0&size=20")
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk()));
        long searchDuration = System.currentTimeMillis() - searchStart;
        assertThat(searchPage.path("content").size()).isEqualTo(20);
        assertThat(searchPage.path("totalElements").asInt()).isEqualTo(ROSTER_SIZE - 1);

        // 5. Measure Full Payroll Run Creation for 5,000 Employees
        long payrollStart = System.currentTimeMillis();
        String createRunJson = json.writeValueAsString(Map.of("year", 2024, "month", 6));
        JsonNode payrollResponse = body(mvc.perform(post("/api/payroll/runs")
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createRunJson))
                .andExpect(status().isCreated()));
        long payrollDuration = System.currentTimeMillis() - payrollStart;

        UUID runId = UUID.fromString(payrollResponse.path("run").path("id").asText());
        int createdPayslips = payrollResponse.path("run").path("payslipCount").asInt();
        int totalsEmployees = payrollResponse.path("totals").path("employees").asInt();
        assertThat(createdPayslips).isGreaterThanOrEqualTo(ROSTER_SIZE);
        assertThat(totalsEmployees).isEqualTo(createdPayslips);

        // 6. Measure Streaming Excel Export for 5,000 Payslips
        long exportStart = System.currentTimeMillis();
        byte[] excelBytes = mvc.perform(get("/api/payroll/runs/" + runId + "/export.xlsx")
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        long exportDuration = System.currentTimeMillis() - exportStart;
        assertThat(excelBytes.length).isGreaterThan(1000);

        long finalHeapSnapshotBytes = memoryBean.getHeapMemoryUsage().getUsed();
        long heapSnapshotMb = Math.max(initialHeapSnapshotBytes, finalHeapSnapshotBytes) / (1024 * 1024);

        System.out.println("================================================================================");
        System.out.println("                FULL-STACK SCALE BENCHMARK RESULTS (5,000 ROSTER)               ");
        System.out.println("================================================================================");
        System.out.printf("Roster Size:                    %d employees%n", ROSTER_SIZE);
        System.out.printf("Database Batch Seed Duration:   %d ms (%.2f s)%n", seedDuration, seedDuration / 1000.0);
        System.out.printf("Org-Chart Roots Duration:       %d ms%n", orgRootsDuration);
        System.out.printf("Org-Chart Children (paged):     %d ms (total reports: %d)%n", orgChildrenDuration, ROSTER_SIZE - 1);
        System.out.printf("Employee Search (paged):        %d ms%n", searchDuration);
        System.out.printf("Payroll Run Creation (5,000):   %d ms (%.2f s)%n", payrollDuration, payrollDuration / 1000.0);
        System.out.printf("Streaming Excel Export (5,000): %d ms (%.2f s, %d bytes)%n", exportDuration, exportDuration / 1000.0, excelBytes.length);
        System.out.printf("Heap Reading Snapshot:          %d MB (point-in-time snapshot, not guaranteed peak)%n", heapSnapshotMb);
        System.out.println("Unverified Scope:               20,000 employee full-stack capacity explicitly left");
        System.out.println("                                unverified due to runner container limits.");
        System.out.println("================================================================================");

        assertThat(payrollDuration).isLessThan(60_000); // Must complete within 60s
        assertThat(exportDuration).isLessThan(30_000);  // Must export within 30s
    }

    private void insertEmployee(UUID id, String empNo, String fullName, String email, UUID managerId) {
        jdbc.update("""
                insert into employees (id, employee_number, full_name, email, password_hash, role,
                                       job_title, manager_id, hire_date, salary, status,
                                       must_change_password, created_at, updated_at, version, token_version)
                values (?, ?, ?, ?, '$2a$10$dummyHashForScaleBenchmarkingPurposesOnly', 'EMPLOYEE',
                        'Manager', ?, '2023-01-01', 12000.00, 'ACTIVE', false, now(), now(), 0, 0)
                """, id, empNo, fullName, email, managerId);
    }
}
