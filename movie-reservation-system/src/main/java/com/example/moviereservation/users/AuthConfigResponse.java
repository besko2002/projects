package com.example.moviereservation.users;

public record AuthConfigResponse(
        String googleClientId,
        boolean passwordResetEnabled
) {
}
