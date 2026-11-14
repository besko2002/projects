package com.example.hr.payroll;

import com.example.hr.AbstractIntegrationTest;
import com.example.hr.employee.Employee;
import com.example.hr.employee.EmployeeRepository;
import com.example.hr.employee.Role;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The payroll roster is walked in batches, so the batch query has to be BOUNDED.
 *
 * <p>It was not, for a while: the limit was passed as an ordinary query parameter, so every
 * batch returned the whole company. A payroll run over 20,000 employees then loaded all of them
 * (and all their attendance) into the heap and died with an OutOfMemoryError. This test is here
 * to make sure the limit is applied again.
 */
class PayrollBatchQueryTest extends AbstractIntegrationTest {

    @Autowired
    EmployeeRepository employees;

    @Test
    void theBatchQueryReturnsOnePageAndThePagesCoverTheWholeRosterWithoutOverlap() throws Exception {
        String admin = adminToken();
        for (int index = 0; index < 12; index += 1) {
            createEmployee(admin, "Batch " + index, Role.EMPLOYEE, null);
        }

        List<UUID> seen = new ArrayList<>();
        UUID after = new UUID(0L, 0L);
        int pages = 0;
        while (true) {
            List<Employee> batch = employees.findPayrollEligibleBatch(LocalDate.of(2024, 1, 1),
                    LocalDate.of(2030, 1, 1), after, PageRequest.of(0, 5));

            // The point of the test: one batch is one page, never the whole company.
            assertThat(batch).hasSizeLessThanOrEqualTo(5);
            if (batch.isEmpty()) {
                break;
            }
            pages += 1;
            after = batch.get(batch.size() - 1).getId();
            for (Employee employee : batch) {
                assertThat(seen).doesNotContain(employee.getId());
                seen.add(employee.getId());
            }
        }

        // The 12 new eligible employees (the seeded admin has null salary and is excluded), in several pages, without a repeat.
        assertThat(seen).hasSize(12);
        assertThat(pages).isGreaterThanOrEqualTo(3);
    }
}
