package com.example.moviereservation.users;

import com.example.moviereservation.common.ConflictException;

/**
 * Another request created the same Google user first (unique email/sub race). The current
 * transaction is aborted, so the caller retries once in a fresh one, where that row is visible.
 * If it ever escapes, it is still answered as 409.
 */
class ConcurrentGoogleSignUpException extends ConflictException {
    ConcurrentGoogleSignUpException() {
        super("Email is already registered");
    }
}
