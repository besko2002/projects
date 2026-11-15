package com.example.hr.attendance;

import com.example.hr.employee.Employee;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AttendanceSessionRepository extends JpaRepository<AttendanceSession, UUID> {

    /** Sentinel for {@link #overlapCandidates} when no existing row has to be ignored. */
    UUID NOTHING_EXCLUDED = new UUID(0L, 0L);

    List<AttendanceSession> findByEmployeeIdAndWorkDateBetweenOrderByCheckInAsc(
            UUID employeeId, LocalDate from, LocalDate to);

    @Query("""
            select s from AttendanceSession s
             where s.employee.id = :employeeId
               and s.checkOut is null
               and s.workDate = :workDate
            """)
    Optional<AttendanceSession> findOpenOn(@Param("employeeId") UUID employeeId,
                                           @Param("workDate") LocalDate workDate);

    /** All attendance writers take this database row lock before reading any sessions. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select e from Employee e where e.id = :employeeId")
    Optional<Employee> lockEmployee(@Param("employeeId") UUID employeeId);

    /** Resolve ownership without loading a possibly stale session before acquiring its employee lock. */
    @Query("select s.employee.id from AttendanceSession s where s.id = :sessionId")
    Optional<UUID> employeeIdOf(@Param("sessionId") UUID sessionId);

    /** Candidates; open ends are resolved to the next zoned day boundary by the service. */
    @Query("""
            select s from AttendanceSession s
             where s.employee.id = :employeeId
               and s.id <> :excludeId
               and s.checkIn < :checkOut
               and (s.checkOut is null or s.checkOut > :checkIn)
            """)
    List<AttendanceSession> overlapCandidates(@Param("employeeId") UUID employeeId,
                                              @Param("checkIn") Instant checkIn,
                                              @Param("checkOut") Instant checkOut,
                                              @Param("excludeId") UUID excludeId);

    /** Every session of a set of employees in a date range — one query for a team view or an export. */
    @Query("""
            select s from AttendanceSession s
              join fetch s.employee e
             where s.employee.id in :employeeIds
               and s.workDate between :from and :to
             order by e.fullName, s.checkIn
            """)
    List<AttendanceSession> findForEmployees(@Param("employeeIds") Collection<UUID> employeeIds,
                                             @Param("from") LocalDate from,
                                             @Param("to") LocalDate to);
}
