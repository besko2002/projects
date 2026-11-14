package com.example.moviereservation.users;

import com.example.moviereservation.common.ApiError;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import com.example.moviereservation.security.AuthenticatedUser;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public authentication endpoints and token invalidation. */
@RestController
@RequestMapping("/api/auth")
@Tag(name = "Authentication", description = "Registration and login")
public class AuthController {

    private final UserService userService;
    private final AuthRateLimiter rateLimiter;

    public AuthController(UserService userService, AuthRateLimiter rateLimiter) {
        this.userService = userService;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping("/register")
    @SecurityRequirements
    @Operation(summary = "Register a new user account (role USER)")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "Account created"),
            @ApiResponse(responseCode = "400", description = "Validation failed",
                    content = @Content(schema = @Schema(implementation = ApiError.class))),
            @ApiResponse(responseCode = "409", description = "Email already registered",
                    content = @Content(schema = @Schema(implementation = ApiError.class)))
    })
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request,
                                                 HttpServletRequest servletRequest) {
        rateLimiter.registration(servletRequest.getRemoteAddr());
        return ResponseEntity.status(HttpStatus.CREATED).body(userService.register(request));
    }

    @PostMapping("/login")
    @SecurityRequirements
    @Operation(summary = "Exchange email and password for an access token")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Authenticated"),
            @ApiResponse(responseCode = "401", description = "Invalid email or password",
                    content = @Content(schema = @Schema(implementation = ApiError.class)))
    })
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request,
                                              HttpServletRequest servletRequest) {
        String ip = servletRequest.getRemoteAddr(); // never trust unverified X-Forwarded-For
        rateLimiter.checkLogin(ip, request.email());
        try {
            AuthResponse response = userService.login(request);
            rateLimiter.successfulLogin(ip, request.email());
            return ResponseEntity.ok(response);
        } catch (org.springframework.security.authentication.BadCredentialsException ex) {
            rateLimiter.failedLogin(ip, request.email());
            throw ex;
        }
    }

    @PostMapping("/logout")
    @Operation(summary = "Invalidate all of the caller's access tokens")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "All access tokens revoked"),
            @ApiResponse(responseCode = "401", description = "Missing or invalid token",
                    content = @Content(schema = @Schema(implementation = ApiError.class)))
    })
    public ResponseEntity<Void> logout(@AuthenticationPrincipal AuthenticatedUser principal) {
        userService.logoutEverywhere(principal.id());
        return ResponseEntity.noContent().build();
    }
}
