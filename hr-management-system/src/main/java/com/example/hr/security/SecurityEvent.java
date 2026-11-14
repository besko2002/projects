package com.example.hr.security;

import com.example.hr.employee.Employee;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * One security event: a sign-in that worked, one that did not, an account that was locked out,
 * a password that was changed.
 *
 * <p>Separate from the employee audit trail (Envers), which records changes to employee ROWS:
 * a sign-in changes nothing, but it is exactly what an operator wants to see after an incident.
 * No password and no token is ever stored here.
 */
@Entity
@Table(name = "security_events")
public class SecurityEvent {

    public enum Type {
        LOGIN_SUCCEEDED,
        LOGIN_FAILED,
        ACCOUNT_LOCKED,
        PASSWORD_CHANGED,
        LOGOUT
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, length = 30)
    private Type type;

    @Column(name = "email", length = 255)
    private String email;

    @Column(name = "client_ip", length = 64)
    private String clientIp;

    @Column(name = "employee_id")
    private UUID employeeId;

    @Column(name = "detail", length = 500)
    private String detail;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    protected SecurityEvent() {
    }

    /**
     * @param type       what happened
     * @param email      the e-mail that was used (may be null)
     * @param clientIp   the client address (may be null)
     * @param employeeId the employee behind it, when there is one
     * @param detail     a short, non-secret description
     * @param occurredAt when it happened
     */
    public SecurityEvent(Type type, String email, String clientIp, UUID employeeId, String detail,
                         Instant occurredAt) {
        this.id = null;
        this.type = type;
        this.email = email;
        this.clientIp = clientIp;
        this.employeeId = employeeId;
        this.detail = detail;
        this.occurredAt = occurredAt;
    }

    public Long getId() {
        return id;
    }

    public Type getType() {
        return type;
    }

    public String getEmail() {
        return email;
    }

    public String getClientIp() {
        return clientIp;
    }

    public UUID getEmployeeId() {
        return employeeId;
    }

    public String getDetail() {
        return detail;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }
}
