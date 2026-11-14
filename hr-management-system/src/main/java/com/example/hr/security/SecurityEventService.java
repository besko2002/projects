package com.example.hr.security;

import java.time.Instant;
import java.util.UUID;

import com.example.hr.security.SecurityEvent.Type;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.EntityManager;

/**
 * Writes the security events: who signed in, who failed, which account was locked and which
 * password was changed.
 *
 * <p>They are written in their own transaction ({@code REQUIRES_NEW}), so a failed sign-in is
 * recorded even though the sign-in itself rolls back (and even though the answer to the client
 * is the same for every failure mode).
 */
@Service
public class SecurityEventService {

    private final EntityManager entityManager;

    public SecurityEventService(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    /**
     * @param type       what happened
     * @param email      the e-mail that was used
     * @param clientIp   the client address
     * @param employeeId the employee behind it, when there is one
     * @param detail     a short, non-secret description
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(Type type, String email, String clientIp, UUID employeeId, String detail) {
        entityManager.persist(new SecurityEvent(type, email, clientIp, employeeId, detail,
                Instant.now()));
    }

    /**
     * @param type     what happened
     * @param email    the e-mail that was used
     * @param clientIp the client address
     * @param detail   a short, non-secret description
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(Type type, String email, String clientIp, String detail) {
        record(type, email, clientIp, null, detail);
    }
}
