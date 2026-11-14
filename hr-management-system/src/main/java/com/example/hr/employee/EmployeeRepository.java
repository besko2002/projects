package com.example.hr.employee;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Employee persistence. Everything hierarchy-related is a PostgreSQL recursive CTE
 * executed as one native query — never Java-side recursion, never N+1.
 */
public interface EmployeeRepository extends JpaRepository<Employee, UUID>, JpaSpecificationExecutor<Employee> {

    Optional<Employee> findByEmail(String email);

    boolean existsByEmail(String email);

    boolean existsByRole(Role role);

    long countByDepartmentId(UUID departmentId);

    List<Employee> findByManagerIdOrderByFullNameAsc(UUID managerId);

    /** Everybody still employed on a given date; used by the monthly leave accrual. */
    List<Employee> findByStatusAndHireDateLessThanEqual(EmployeeStatus status, java.time.LocalDate hiredOnOrBefore);

    /**
     * Everybody a monthly payroll run must produce a payslip for: hired on or before the
     * end of the month, with a base salary, and either still ACTIVE or terminated
     * <em>inside</em> that month (so a final, pro-rated month is still paid). An employee
     * with no {@code salary} is not payable and is deliberately left out.
     */
    @Query("""
            select e from Employee e
             where e.hireDate <= :monthEnd
               and e.salary is not null
               and (e.status = com.example.hr.employee.EmployeeStatus.ACTIVE
                    or (e.status = com.example.hr.employee.EmployeeStatus.TERMINATED
                        and e.terminatedAt is not null
                        and e.terminatedAt >= :monthStart
                        and e.terminatedAt <= :monthEnd))
             order by e.employeeNumber
            """)
    List<Employee> findPayrollEligible(@Param("monthStart") java.time.LocalDate monthStart,
                                       @Param("monthEnd") java.time.LocalDate monthEnd);

    /**
     * One batch of the payroll-eligible employees, ordered by id so the caller can walk the
     * whole set with keyset pagination ({@code afterId}). A payroll run over 20,000 employees
     * must never hold them all in memory at once.
     *
     * @param monthStart first day of the period
     * @param monthEnd   last day of the period
     * @param afterId    the id to continue after (the all-zero id for the first batch)
     * @param limit      the maximum number of employees in the batch
     */
    @Query("""
            select e from Employee e
             where e.hireDate <= :monthEnd
               and e.salary is not null
               and (e.status = com.example.hr.employee.EmployeeStatus.ACTIVE
                    or (e.status = com.example.hr.employee.EmployeeStatus.TERMINATED
                        and e.terminatedAt is not null
                        and e.terminatedAt >= :monthStart
                        and e.terminatedAt <= :monthEnd))
               and e.id > :afterId
             order by e.id
            """)
    List<Employee> findPayrollEligibleBatch(@Param("monthStart") java.time.LocalDate monthStart,
                                            @Param("monthEnd") java.time.LocalDate monthEnd,
                                            @Param("afterId") UUID afterId,
                                            Pageable pageable);

    /**
     * Next human-readable employee number (EMP-0001, ...) straight from the database sequence.
     *
     * <p>The formatting lives in the {@code employee_number_for} function (migration V9) so the
     * column default and this query cannot drift apart. It keeps at least four digits and never
     * truncates: the old {@code lpad(..., 4, '0')} turned the 10,000th employee into 'EMP-1000',
     * a duplicate of the 1,000th one.
     */
    @Query(value = "select employee_number_for(nextval('employee_number_seq'))", nativeQuery = true)
    String nextEmployeeNumber();

    /** What every authenticated request needs to know about its caller, in one primary-key lookup. */
    interface AuthState {
        String getStatus();

        boolean isMustChangePassword();

        java.time.Instant getPasswordChangedAt();

        /** The employee's current token version; a token carrying a different one is stale. */
        int getTokenVersion();
    }

    @Query(value = """
            select e.status as status, e.must_change_password as mustChangePassword,
                   e.password_changed_at as passwordChangedAt,
                   e.token_version as tokenVersion
            from employees e where e.id = :id""", nativeQuery = true)
    Optional<AuthState> findAuthStateById(@Param("id") UUID id);

    /**
     * True when {@code candidateId} is {@code rootId} itself or sits anywhere below it in
     * the tree. Used inside the manager-assignment transaction to refuse cycles.
     */
    @Query(value = """
            with recursive subtree as (
                select e.id
                  from employees e
                 where e.id = :rootId
                union all
                select child.id
                  from employees child
                  join subtree s on child.manager_id = s.id
            )
            select exists (select 1 from subtree where id = :candidateId)
            """, nativeQuery = true)
    boolean isSelfOrDescendant(@Param("rootId") UUID rootId, @Param("candidateId") UUID candidateId);

    /** True when {@code ancestorId} appears anywhere above {@code employeeId} in the tree. */
    @Query(value = """
            with recursive chain as (
                select e.manager_id as id
                  from employees e
                 where e.id = :employeeId
                union all
                select parent.manager_id
                  from employees parent
                  join chain c on parent.id = c.id
            )
            select exists (select 1 from chain where id = :ancestorId)
            """, nativeQuery = true)
    boolean isAncestorOf(@Param("ancestorId") UUID ancestorId, @Param("employeeId") UUID employeeId);

    /**
     * All descendants (direct and indirect) of {@code rootId} with their depth
     * (1 = direct report). Columns: id, employee_number, full_name, email, job_title,
     * department name, status, depth, manager_id.
     */
    @Query(value = """
            with recursive subtree as (
                select e.id, e.manager_id, 1 as depth
                  from employees e
                 where e.manager_id = :rootId
                   and e.status = 'ACTIVE'
                union all
                select child.id, child.manager_id, s.depth + 1
                  from employees child
                  join subtree s on child.manager_id = s.id
                 where child.status = 'ACTIVE'
            )
            select e.id, e.employee_number, e.full_name, e.email, e.job_title,
                   d.name, e.status, s.depth, e.manager_id
              from subtree s
              join employees e on e.id = s.id
              left join departments d on d.id = e.department_id
             order by s.depth, e.full_name
            """, nativeQuery = true)
    List<Object[]> findDescendants(@Param("rootId") UUID rootId);

    /**
     * The management chain upwards from {@code employeeId} to the root, nearest manager first.
     * Columns: id, employee_number, full_name, email, job_title, department name, status, depth.
     */
    @Query(value = """
            with recursive chain as (
                select e.id, e.manager_id, 0 as depth
                  from employees e
                 where e.id = :employeeId
                union all
                select parent.id, parent.manager_id, c.depth + 1
                  from employees parent
                  join chain c on parent.id = c.manager_id
            )
            select e.id, e.employee_number, e.full_name, e.email, e.job_title,
                   d.name, e.status, c.depth
              from chain c
              join employees e on e.id = c.id
              left join departments d on d.id = e.department_id
             where c.depth > 0
             order by c.depth
            """, nativeQuery = true)
    List<Object[]> findManagementChain(@Param("employeeId") UUID employeeId);

    /**
     * Every active employee with the data the org chart needs, in one query; the tree is
     * assembled in memory from this single result set.
     * Columns: id, employee_number, full_name, job_title, department name, manager_id.
     *
     * @deprecated the org chart is loaded level by level now - see {@link #findOrgChartRoots()}
     *     and {@link #findOrgChartChildren(UUID)}. Returning the whole company in one payload
     *     was 3.7 MB at 20,000 employees.
     */
    @Deprecated
    @Query(value = """
            with recursive tree as (
                select e.id, e.manager_id, 0 as depth
                  from employees e
                 where e.manager_id is null
                   and e.status = 'ACTIVE'
                union all
                select child.id, child.manager_id, t.depth + 1
                  from employees child
                  join tree t on child.manager_id = t.id
                 where child.status = 'ACTIVE'
            )
            select e.id, e.employee_number, e.full_name, e.job_title, d.name, e.manager_id
              from tree t
              join employees e on e.id = t.id
              left join departments d on d.id = e.department_id
             order by t.depth, e.full_name
            """, nativeQuery = true)
    List<Object[]> findOrgChartRows();

    /**
     * The root level of the org chart: the employees without a manager, each with the number of
     * its direct reports. Bounded pagination ensures the response remains efficient even with
     * thousands of roots.
     * Columns: id, employee_number, full_name, job_title, department name, direct report count.
     */
    @Query(value = """
            select e.id, e.employee_number, e.full_name, e.job_title, d.name, count(c.id)
              from employees e
              left join departments d on d.id = e.department_id
              left join employees c on c.manager_id = e.id and c.status = 'ACTIVE'
             where e.manager_id is null
               and e.status = 'ACTIVE'
             group by e.id, e.employee_number, e.full_name, e.job_title, d.name
             order by e.full_name, e.id
            """,
            countQuery = """
            select count(*) from employees e
             where e.manager_id is null
               and e.status = 'ACTIVE'
            """,
            nativeQuery = true)
    Page<Object[]> findOrgChartRootsPaged(Pageable pageable);

    /**
     * The direct reports of one employee, each with the number of ITS direct reports.
     * Bounded pagination ensures large teams can be navigated page-by-page.
     * Columns: id, employee_number, full_name, job_title, department name, direct report count.
     */
    @Query(value = """
            select e.id, e.employee_number, e.full_name, e.job_title, d.name, count(c.id)
              from employees e
              left join departments d on d.id = e.department_id
              left join employees c on c.manager_id = e.id and c.status = 'ACTIVE'
             where e.manager_id = :managerId
               and e.status = 'ACTIVE'
             group by e.id, e.employee_number, e.full_name, e.job_title, d.name
             order by e.full_name, e.id
            """,
            countQuery = """
            select count(*) from employees e
             where e.manager_id = :managerId
               and e.status = 'ACTIVE'
            """,
            nativeQuery = true)
    Page<Object[]> findOrgChartChildrenPaged(@Param("managerId") UUID managerId, Pageable pageable);
}
