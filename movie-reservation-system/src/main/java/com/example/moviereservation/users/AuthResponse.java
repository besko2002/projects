package com.example.moviereservation.users;

/**
 * Successful authentication result.
 *
 * @param accessToken signed JWT
 * @param tokenType   always {@code Bearer}
 * @param expiresIn   token lifetime in seconds
 * @param user        the authenticated user
 */
public record AuthResponse(String accessToken, String tokenType, long expiresIn, UserDto user, String notice) {

    public AuthResponse(String accessToken, String tokenType, long expiresIn, UserDto user) {
        this(accessToken, tokenType, expiresIn, user, null);
    }

    static AuthResponse of(String accessToken, long expiresIn, UserDto user) {
        return new AuthResponse(accessToken, "Bearer", expiresIn, user, null);
    }

    static AuthResponse of(String accessToken, long expiresIn, UserDto user, String notice) {
        return new AuthResponse(accessToken, "Bearer", expiresIn, user, notice);
    }
}
