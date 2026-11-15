package com.example.hr.auth;

import com.example.hr.access.EmployeeAccessPolicy;
import com.example.hr.common.BadRequestException;
import com.example.hr.common.ForbiddenException;
import com.example.hr.common.ResourceNotFoundException;
import com.example.hr.employee.Employee;
import com.example.hr.employee.EmployeeRepository;
import com.example.hr.employee.TemporaryPasswordGenerator;
import com.example.hr.security.CurrentEmployee;
import com.example.hr.security.SecurityEvent;
import jakarta.persistence.EntityManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Service
public class EmployeePasswordResetService {
    private final EmployeeRepository employees;
    private final CurrentEmployee currentEmployee;
    private final EmployeeAccessPolicy access;
    private final TemporaryPasswordGenerator generator;
    private final PasswordEncoder encoder;
    private final EntityManager entityManager;

    EmployeePasswordResetService(EmployeeRepository employees, CurrentEmployee currentEmployee,
                                 EmployeeAccessPolicy access, TemporaryPasswordGenerator generator,
                                 PasswordEncoder encoder, EntityManager entityManager) {
        this.employees = employees;
        this.currentEmployee = currentEmployee;
        this.access = access;
        this.generator = generator;
        this.encoder = encoder;
        this.entityManager = entityManager;
    }

    public record PasswordReset(UUID employeeId, String temporaryPassword) {
        @Override public String toString() { return "PasswordReset[employeeId=" + employeeId + "]"; }
    }

    @Transactional
    public PasswordReset reset(UUID id, String reason) {
        Employee actor = currentEmployee.require();
        access.requireHrOrAdmin(actor, "reset passwords");
        Employee target = employees.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("No employee with id " + id));
        access.requireCanManage(actor, target, "reset passwords for");
        if (actor.getId().equals(id)) {
            throw new ForbiddenException("You cannot reset your own password; use change password instead");
        }
        if (!target.isActive()) {
            throw new BadRequestException("Only active employees can have their password reset");
        }
        if (reason == null || reason.isBlank() || reason.length() > 400) {
            throw new BadRequestException("A password reset reason of 1 to 400 characters is required");
        }
        String temporaryPassword = generator.generate();
        target.resetPassword(encoder.encode(temporaryPassword));
        employees.saveAndFlush(target);
        // Atomic with the password update: a rolled-back reset must not leave a success audit.
        // Actor and target are recorded, never the credential or its hash.
        entityManager.persist(new SecurityEvent(SecurityEvent.Type.PASSWORD_CHANGED, actor.getEmail(),
                null, id, "Password reset by " + actor.getId() + "; reason: " + reason.trim(), Instant.now()));
        return new PasswordReset(id, temporaryPassword);
    }
}
