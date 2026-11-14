package com.example.hr.auth;

import java.time.Instant;
import java.util.Optional;

/**
 * The login throttle: how many failed logins are allowed per (e-mail, client IP) and when an
 * account is locked out.
 *
 * <p>Two implementations exist and one of them is chosen by {@code app.login-rate-limit.store}:
 * the in-memory one (the default - right for a single instance and for the tests) and the Redis
 * one (right when the stack runs more than one instance, because the counters then have to be
 * shared). Both behave the same, so the application does not care which one is active.
 */
public interface LoginThrottle {

    /** True when this (e-mail, IP) has used up its failures within the window. */
    boolean isBlocked(String email, String ip);

    /** Counts one failed login. */
    void recordFailure(String email, String ip);

    /** Forgets the failures of this (e-mail, IP) - after a successful login. */
    void reset(String email, String ip);

    /**
     * When the ACCOUNT itself is locked out, if it is. The lock is per e-mail (not per IP): the
     * point is to stop the guessing, and a locked account stays locked for everyone.
     *
     * @param email the normalised e-mail
     * @return the moment the lock ends, or empty when the account is not locked
     */
    Optional<Instant> lockedUntil(String email);

    /** Locks the account until {@code until}. */
    void lock(String email, Instant until);

    /** Clears every counter (tests). */
    void clear();
}
