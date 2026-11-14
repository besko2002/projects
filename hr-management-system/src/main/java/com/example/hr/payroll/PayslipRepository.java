package com.example.hr.payroll;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface PayslipRepository extends JpaRepository<Payslip, UUID> {

    @Query("""
            select p from Payslip p
              join fetch p.employee e
              join fetch p.run r
             where r.id = :runId
             order by p.employeeNumber
            """)
    List<Payslip> findByRun(@Param("runId") UUID runId);

    /** The employee's own payslips, FINALIZED runs only — a draft must never leak. */
    @Query("""
            select p from Payslip p
              join fetch p.run r
             where p.employee.id = :employeeId
               and r.status = com.example.hr.payroll.PayrollRunStatus.FINALIZED
             order by r.year desc, r.month desc
            """)
    List<Payslip> findFinalizedOf(@Param("employeeId") UUID employeeId);

    @Modifying
    @Query("delete from Payslip p where p.run.id = :runId")
    int deleteByRunId(@Param("runId") UUID runId);

    long countByRunId(UUID runId);

    /**
     * One page of the payslips of a run. The run can hold tens of thousands of them, so they
     * are never loaded as one list.
     */
    @Query("""
            select p from Payslip p
             where p.run.id = :runId
             order by p.employeeNumber, p.id
            """)
    Page<Payslip> findByRunPaged(@Param("runId") UUID runId, Pageable pageable);

    /**
     * The company-level sums of one run, computed in the database. Reading them from the
     * database keeps a 20,000-payslip run out of the heap.
     */
    @Query(value = """
            select count(*) as payslipCount,
                   coalesce(sum(base_salary), 0) as baseSalary,
                   coalesce(sum(prorated_base), 0) as proratedBase,
                   coalesce(sum(overtime_pay), 0) as overtimePay,
                   coalesce(sum(holiday_pay), 0) as holidayPay,
                   coalesce(sum(unpaid_leave_deduction), 0) as unpaidLeaveDeduction,
                   coalesce(sum(absence_deduction), 0) as absenceDeduction,
                   coalesce(sum(gross_earnings), 0) as grossEarnings,
                   coalesce(sum(insurance), 0) as insurance,
                   coalesce(sum(tax), 0) as tax,
                   coalesce(sum(net_pay), 0) as netPay
              from payslips
             where run_id = :runId
            """, nativeQuery = true)
    RunTotals sumOfRun(@Param("runId") UUID runId);

    /** The sums of one run, straight from the database. */
    interface RunTotals {
        long getPayslipCount();

        java.math.BigDecimal getBaseSalary();

        java.math.BigDecimal getProratedBase();

        java.math.BigDecimal getOvertimePay();

        java.math.BigDecimal getHolidayPay();

        java.math.BigDecimal getUnpaidLeaveDeduction();

        java.math.BigDecimal getAbsenceDeduction();

        java.math.BigDecimal getGrossEarnings();

        java.math.BigDecimal getInsurance();

        java.math.BigDecimal getTax();

        java.math.BigDecimal getNetPay();
    }
}
