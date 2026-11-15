package com.example.moviereservation.users.google;

import jakarta.validation.constraints.NotBlank;

public record GoogleAuthRequest(
        @NotBlank(message = "idToken must not be blank")
        String idToken
) {
}
