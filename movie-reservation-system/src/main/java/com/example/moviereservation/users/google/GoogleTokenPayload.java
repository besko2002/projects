package com.example.moviereservation.users.google;

/**
 * Verified claims extracted from a valid Google ID token.
 *
 * @param sub           Google subject ID (unique permanent account identifier)
 * @param email         verified email address from Google
 * @param name          display name provided by Google profile
 * @param emailVerified whether Google verified ownership of the email
 */
public record GoogleTokenPayload(
        String sub,
        String email,
        String name,
        boolean emailVerified
) {
}
