package com.example.hr.payroll;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface PayrollRunRepository extends JpaRepository<PayrollRun, UUID> {

    boolean existsByYearAndMonth(int year, int month);

    Page<PayrollRun> findAllByOrderByYearDescMonthDesc(Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from PayrollRun r where r.id = :id")
    Optional<PayrollRun> findByIdForUpdate(@Param("id") UUID id);
}
