package com.example.hr.payroll;

import com.example.hr.access.EmployeeAccessPolicy;
import com.example.hr.attendance.AttendanceDeriver;
import com.example.hr.attendance.DailyAttendance;
import com.example.hr.attendance.WorkCalendar;
import com.example.hr.common.BadRequestException;
import com.example.hr.common.ConflictException;
import com.example.hr.common.ResourceNotFoundException;
import com.example.hr.employee.Employee;
import com.example.hr.employee.EmployeeRepository;
import com.example.hr.employee.dto.PageResponse;
import com.example.hr.payroll.PayrollDtos.CreateRunBody;
import com.example.hr.payroll.PayrollDtos.PayrollRunDetailResponse;
import com.example.hr.payroll.PayrollDtos.PayrollRunResponse;
import com.example.hr.payroll.PayrollDtos.PayrollTotals;
import com.example.hr.payroll.PayrollDtos.PayslipResponse;
import com.example.hr.security.CurrentEmployee;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The payroll run lifecycle and the payslip access rules.
 *
 * <h2>Run model</h2>
 * {@code POST /api/payroll/runs} creates a DRAFT run plus one immutable payslip per
 * eligible employee in a <b>single transaction</b>. Idempotency is enforced by the
 * {@code (run_year, run_month)} unique constraint, not by a pre-check: the run row is
 * inserted and flushed first, so two concurrent calls serialise on it and the loser's
 * whole transaction — run and payslips — is rolled back with a 409. Months in the future
 * are refused; the current month is allowed (and then only the attendance recorded so far
 * counts).
 *
 * <p>DRAFT runs can be recalculated (payslips are replaced) or deleted. FINALIZED runs are
 * frozen: recalculate and delete answer 409, and because every figure is stored, later
 * attendance corrections or salary changes cannot move a single number.
 *
 * <h2>Who sees a payslip</h2>
 * <ul>
 *   <li>HR and ADMIN: always, DRAFT included.</li>
 *   <li>The employee themself: only once the run is FINALIZED. A DRAFT payslip answers
 *       404 to them.</li>
 *   <li>A manager: <b>never</b> — not even for a direct report. 404, the same answer an
 *       unrelated employee gets, so payslip ids cannot be probed.</li>
 * </ul>
 */
@Service
public class PayrollService {

    /** How many employees are written per batch. Small enough to stay cheap, big enough to fly. */
    private static final int PAYSLIP_BATCH_SIZE = 500;

    /** Keyset pagination starts after this id - it is smaller than any generated UUID. */
    private static final UUID FIRST_BATCH = new UUID(0L, 0L);

    private final PayrollRunRepository runs;
    private final PayslipRepository payslips;
    private final EmployeeRepository employees;
    private final AttendanceDeriver attendance;
    private final WorkCalendar calendar;
    private final PayrollCalculator calculator;
    private final PayrollRates rates;
    private final EmployeeAccessPolicy policy;
    private final CurrentEmployee currentEmployee;
    private final ObjectMapper json;
    private final Clock clock;
    private final EntityManager entityManager;

    PayrollService(PayrollRunRepository runs, PayslipRepository payslips, EmployeeRepository employees,
                   AttendanceDeriver attendance, WorkCalendar calendar, PayrollCalculator calculator,
                   PayrollRates rates, EmployeeAccessPolicy policy, CurrentEmployee currentEmployee,
                   ObjectMapper json, Clock clock, EntityManager entityManager) {
        this.runs = runs;
        this.payslips = payslips;
        this.employees = employees;
        this.attendance = attendance;
        this.calendar = calendar;
        this.calculator = calculator;
        this.rates = rates;
        this.policy = policy;
        this.currentEmployee = currentEmployee;
        this.json = json;
        this.clock = clock;
        this.entityManager = entityManager;
    }

    // ------------------------------------------------------------------ run lifecycle

    @Transactional
    public PayrollRunDetailResponse createRun(CreateRunBody body) {
        Employee actor = currentEmployee.require();
        policy.requireHrOrAdmin(actor, "run payroll");

        YearMonth period = YearMonth.of(body.year(), body.month());
        if (period.isAfter(YearMonth.from(attendance.today()))) {
            throw new BadRequestException("Payroll cannot be run for a future month (" + period + ")");
        }
        if (runs.existsByYearAndMonth(period.getYear(), period.getMonthValue())) {
            throw new ConflictException("A payroll run for " + period + " already exists");
        }

        PayrollRun run = new PayrollRun(period, actor, now());
        try {
            // The real guard: the unique (year, month) index. A concurrent caller blocks
            // here and then fails, rolling back its run *and* its payslips.
            runs.saveAndFlush(run);
        } catch (DataIntegrityViolationException ex) {
            throw new ConflictException("A payroll run for " + period + " already exists");
        }

        PayrollTotals totals = buildPayslips(run);
        return new PayrollRunDetailResponse(toRun(run), totals);
    }

    @Transactional
    public PayrollRunDetailResponse recalculate(UUID runId) {
        policy.requireHrOrAdmin(currentEmployee.require(), "recalculate a payroll run");
        PayrollRun run = requireRunForUpdate(runId);
        run.requireDraft("recalculated");

        payslips.deleteByRunId(run.getId());
        payslips.flush();

        PayrollTotals totals = buildPayslips(run);
        return new PayrollRunDetailResponse(toRun(run), totals);
    }

    @Transactional
    public PayrollRunResponse finalizeRun(UUID runId) {
        Employee actor = currentEmployee.require();
        policy.requireHrOrAdmin(actor, "finalize a payroll run");
        PayrollRun run = requireRunForUpdate(runId);
        run.finalizeRun(actor, now());
        runs.save(run);
        return toRun(run);
    }

    @Transactional
    public void deleteRun(UUID runId) {
        policy.requireHrOrAdmin(currentEmployee.require(), "delete a payroll run");
        PayrollRun run = requireRunForUpdate(runId);
        run.requireDraft("deleted");
        payslips.deleteByRunId(run.getId());
        payslips.flush();
        runs.delete(run);
    }

    // ------------------------------------------------------------------ reading

    @Transactional(readOnly = true)
    public PageResponse<PayrollRunResponse> listRuns(int page, int size) {
        policy.requireHrOrAdmin(currentEmployee.require(), "list payroll runs");
        int resolved = size < 1 ? 20 : Math.min(size, 100);
        return PageResponse.of(
                runs.findAllByOrderByYearDescMonthDesc(PageRequest.of(Math.max(page, 0), resolved)),
                this::toRun);
    }

    @Transactional(readOnly = true)
    public PayrollRunDetailResponse getRun(UUID runId) {
        policy.requireHrOrAdmin(currentEmployee.require(), "view a payroll run");
        PayrollRun run = requireRun(runId);
        return new PayrollRunDetailResponse(toRun(run), totalsOf(run.getId()));
    }

    /**
     * One page of the payslips of a run. A run over 20,000 employees has as many payslips, so
     * they are served page by page instead of in one response.
     *
     * @param runId the run whose payslips are asked for
     * @param page  the zero-based page
     * @param size  the page size (capped)
     * @return the page of payslips
     */
    @Transactional(readOnly = true)
    public PageResponse<PayslipResponse> payslipsPage(UUID runId, int page, int size) {
        policy.requireHrOrAdmin(currentEmployee.require(), "view a payroll run");
        PayrollRun run = requireRun(runId);
        int resolved = size < 1 ? 50 : Math.min(size, 200);
        return PageResponse.of(
                payslips.findByRunPaged(run.getId(), PageRequest.of(Math.max(page, 0), resolved)),
                this::toPayslip);
    }

    /** The company-level sums of a run, read from the database. */
    @Transactional(readOnly = true)
    public PayrollTotals totalsOf(UUID runId) {
        PayslipRepository.RunTotals sums = payslips.sumOfRun(runId);
        return new PayrollTotals((int) sums.getPayslipCount(), Money.scaled(sums.getBaseSalary()),
                Money.scaled(sums.getProratedBase()), Money.scaled(sums.getOvertimePay()),
                Money.scaled(sums.getHolidayPay()), Money.scaled(sums.getUnpaidLeaveDeduction()),
                Money.scaled(sums.getAbsenceDeduction()), Money.scaled(sums.getGrossEarnings()),
                Money.scaled(sums.getInsurance()), Money.scaled(sums.getTax()),
                Money.scaled(sums.getNetPay()));
    }

    @Transactional(readOnly = true)
    public List<PayslipResponse> myPayslips() {
        Employee me = currentEmployee.require();
        return payslips.findFinalizedOf(me.getId()).stream().map(this::toPayslip).toList();
    }

    @Transactional(readOnly = true)
    public PayslipResponse getPayslip(UUID payslipId) {
        return toPayslip(requireVisiblePayslip(payslipId));
    }

    /**
     * Resolves a payslip and applies the privacy matrix. Everything that is not allowed is
     * a 404 — never a 403 — so the existence of a payslip is never confirmed to somebody
     * who may not read it.
     */
    @Transactional(readOnly = true)
    public Payslip requireVisiblePayslip(UUID payslipId) {
        Employee actor = currentEmployee.require();
        Payslip payslip = payslips.findById(payslipId)
                .orElseThrow(() -> notFound(payslipId));
        if (policy.isHrOrAdmin(actor)) {
            return payslip;
        }
        boolean own = payslip.employeeId().equals(actor.getId());
        if (own && payslip.getRun().getStatus().isFinalized()) {
            return payslip;
        }
        throw notFound(payslipId);
    }

    @Transactional(readOnly = true)
    public PayrollRun requireRunForExport(UUID runId) {
        policy.requireHrOrAdmin(currentEmployee.require(), "export a payroll run");
        return requireRun(runId);
    }

    @Transactional(readOnly = true)
    public List<Payslip> payslipsOf(UUID runId) {
        return payslips.findByRun(runId);
    }

    @Transactional(readOnly = true)
    public Page<Payslip> payslipsBatch(UUID runId, int page, int size) {
        policy.requireHrOrAdmin(currentEmployee.require(), "export a payroll run");
        return payslips.findByRunPaged(runId, PageRequest.of(Math.max(0, page), Math.max(1, size)));
    }

    // ------------------------------------------------------------------ the run itself

    /**
     * Writes the payslips of a run, in batches.
     *
     * <p>The employees are walked with keyset pagination, the attendance of a batch is derived
     * and the batch is written and flushed before the next one is read. Nothing but the current
     * batch is ever in memory, which is what makes a 20,000-employee run possible: the old
     * version held every employee, every derived day and every payslip at once, and the API ran
     * out of memory. The run stays atomic - the whole thing is one transaction, so a failure
     * anywhere leaves no run and no payslips behind.
     *
     * @param run the run the payslips belong to
     * @return the totals of the run, accumulated while writing
     */
    private PayrollTotals buildPayslips(PayrollRun run) {
        YearMonth period = run.period();
        LocalDate monthStart = period.atDay(1);
        LocalDate monthEnd = period.atEndOfMonth();

        Set<LocalDate> holidays = calendar.holidaysBetween(monthStart, monthEnd);
        int workingDaysInMonth = calendar.workingDaysBetween(monthStart, monthEnd, holidays);
        Instant now = now();
        Totals totals = new Totals();

        UUID after = FIRST_BATCH;
        while (true) {
            List<Employee> batch = employees.findPayrollEligibleBatch(monthStart, monthEnd, after,
                    PageRequest.of(0, PAYSLIP_BATCH_SIZE));
            if (batch.isEmpty()) {
                break;
            }
            after = batch.get(batch.size() - 1).getId();
            Map<UUID, List<DailyAttendance>> derived = attendance.deriveAll(batch, monthStart, monthEnd);

            for (Employee employee : batch) {
                LocalDate windowStart = max(monthStart, employee.getHireDate());
                LocalDate windowEnd = employee.getTerminatedAt() == null
                        ? monthEnd : min(monthEnd, employee.getTerminatedAt());
                int payableDays = windowEnd.isBefore(windowStart)
                        ? 0 : calendar.workingDaysBetween(windowStart, windowEnd, holidays);

                int unpaidLeaveDays = 0;
                int absentDays = 0;
                int lateMinutes = 0;
                int overtimeMinutes = 0;
                int holidayMinutes = 0;
                for (DailyAttendance day : derived.getOrDefault(employee.getId(), List.of())) {
                    if (day.isUnpaidLeaveDay()) {
                        unpaidLeaveDays++;
                    }
                    if (day.isAbsentDay()) {
                        absentDays++;
                    }
                    lateMinutes += day.lateMinutes();
                    overtimeMinutes += day.weekdayOvertimeMinutes();
                    holidayMinutes += day.restDayMinutes();
                }

                PayrollInput input = new PayrollInput(employee.getSalary(), workingDaysInMonth,
                        Math.min(payableDays, workingDaysInMonth), unpaidLeaveDays, absentDays,
                        lateMinutes, overtimeMinutes, holidayMinutes, rates);
                PayrollResult result = calculator.calculate(input);
                totals.add(payslips.save(new Payslip(run, employee, result,
                        writeSnapshot(period, monthStart, monthEnd, result), now)));
            }
            // Write the batch and let go of it: the persistence context stays small however many
            // employees the company has.
            payslips.flush();
            // Let go of the batch: the persistence context stays small however many employees
            // the company has. The run itself was already written and is not touched again.
            entityManager.clear();
        }
        return totals.toTotals();
    }

    private String writeSnapshot(YearMonth period, LocalDate start, LocalDate end, PayrollResult result) {
        PayslipSnapshot snapshot = new PayslipSnapshot(period.getYear(), period.getMonthValue(), start, end,
                result.rates(), result.taxBreakdown(), PayslipSnapshot.NOTES);
        try {
            return json.writeValueAsString(snapshot);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Could not serialise the payslip snapshot", ex);
        }
    }

    private PayslipSnapshot readSnapshot(Payslip payslip) {
        try {
            return json.readValue(payslip.getSnapshot(), PayslipSnapshot.class);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Could not read the payslip snapshot of " + payslip.getId(), ex);
        }
    }

    // ------------------------------------------------------------------ mapping

    PayrollRunResponse toRun(PayrollRun run) {
        return new PayrollRunResponse(run.getId(), run.getYear(), run.getMonth(), run.getStatus(),
                (int) payslips.countByRunId(run.getId()),
                run.getCreatedBy() == null ? null : run.getCreatedBy().getId(), run.getCreatedAt(),
                run.getFinalizedBy() == null ? null : run.getFinalizedBy().getId(), run.getFinalizedAt());
    }


    /**
     * The company-level sums of a run, accumulated while the payslips are written - so the
     * totals are known without holding every payslip in memory.
     */
    private static final class Totals {
        private int employees;
        private BigDecimal base = Money.ZERO;
        private BigDecimal prorated = Money.ZERO;
        private BigDecimal overtime = Money.ZERO;
        private BigDecimal holiday = Money.ZERO;
        private BigDecimal unpaid = Money.ZERO;
        private BigDecimal absence = Money.ZERO;
        private BigDecimal gross = Money.ZERO;
        private BigDecimal insurance = Money.ZERO;
        private BigDecimal tax = Money.ZERO;
        private BigDecimal net = Money.ZERO;

        void add(Payslip slip) {
            employees++;
            base = base.add(slip.getBaseSalary());
            prorated = prorated.add(slip.getProratedBase());
            overtime = overtime.add(slip.getOvertimePay());
            holiday = holiday.add(slip.getHolidayPay());
            unpaid = unpaid.add(slip.getUnpaidLeaveDeduction());
            absence = absence.add(slip.getAbsenceDeduction());
            gross = gross.add(slip.getGrossEarnings());
            insurance = insurance.add(slip.getInsurance());
            tax = tax.add(slip.getTax());
            net = net.add(slip.getNetPay());
        }

        PayrollTotals toTotals() {
            return new PayrollTotals(employees, Money.scaled(base), Money.scaled(prorated),
                    Money.scaled(overtime), Money.scaled(holiday), Money.scaled(unpaid),
                    Money.scaled(absence), Money.scaled(gross), Money.scaled(insurance),
                    Money.scaled(tax), Money.scaled(net));
        }
    }

    PayslipResponse toPayslip(Payslip p) {
        PayslipSnapshot snapshot = readSnapshot(p);
        return new PayslipResponse(p.getId(), p.getRun().getId(), p.getRun().getYear(),
                p.getRun().getMonth(), p.getRun().getStatus(), p.employeeId(), p.getEmployeeNumber(),
                p.getEmployeeName(), p.getJobTitle(), p.getDepartmentName(), p.getHireDate(),
                p.getTerminatedAt(), p.getBaseSalary(), p.getWorkingDaysInMonth(),
                p.getPayableWorkingDays(), p.getUnpaidLeaveDays(), p.getAbsentDays(), p.getLateMinutes(),
                p.getOvertimeMinutes(), p.getHolidayMinutes(), p.getDailyRate(), p.getHourlyRate(),
                p.getOvertimeHours(), p.getHolidayHours(), p.getProratedBase(), p.getOvertimePay(),
                p.getHolidayPay(), p.getUnpaidLeaveDeduction(), p.getAbsenceDeduction(),
                p.getGrossEarnings(), p.getInsurableWage(), p.getInsurance(), p.getPersonalExemption(),
                p.getTaxableIncome(), p.getTax(), p.getNetPay(), p.isNetFloored(),
                p.isNetFloored()
                        ? "Deductions exceeded earnings; the net pay was floored to 0.00"
                        : null,
                snapshot.taxBreakdown(), snapshot.rates(), p.getCreatedAt());
    }

    // ------------------------------------------------------------------ helpers

    private Instant now() {
        return clock.instant();
    }

    private PayrollRun requireRun(UUID runId) {
        return runs.findById(runId)
                .orElseThrow(() -> new ResourceNotFoundException("No payroll run with id " + runId));
    }

    private PayrollRun requireRunForUpdate(UUID runId) {
        return runs.findByIdForUpdate(runId)
                .orElseThrow(() -> new ResourceNotFoundException("No payroll run with id " + runId));
    }

    private static ResourceNotFoundException notFound(UUID payslipId) {
        return new ResourceNotFoundException("No payslip with id " + payslipId);
    }

    private static LocalDate min(LocalDate a, LocalDate b) {
        return a.isBefore(b) ? a : b;
    }

    private static LocalDate max(LocalDate a, LocalDate b) {
        return a.isAfter(b) ? a : b;
    }
}
