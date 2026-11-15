package com.example.moviereservation.users;

import com.example.moviereservation.common.ApiError;
import com.example.moviereservation.security.AuthenticatedUser;
import com.example.moviereservation.users.google.GoogleAuthRequest;
import com.example.moviereservation.users.google.GoogleTokenPayload;
import com.example.moviereservation.users.google.GoogleTokenVerifier;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public authentication endpoints, password recovery, and token invalidation. */
@RestController
@RequestMapping("/api/auth")
@Tag(name = "Authentication", description = "Registration, login, Google auth, and password recovery")
public class AuthController {

    private final UserService userService;
    private final AuthRateLimiter rateLimiter;
    private final GoogleTokenVerifier googleTokenVerifier;
    private final PasswordResetService passwordResetService;

    public AuthController(UserService userService,
                          AuthRateLimiter rateLimiter,
                          GoogleTokenVerifier googleTokenVerifier,
                          PasswordResetService passwordResetService) {
        this.userService = userService;
        this.rateLimiter = rateLimiter;
        this.googleTokenVerifier = googleTokenVerifier;
        this.passwordResetService = passwordResetService;
    }

    @GetMapping("/config")
    @SecurityRequirements
    @Operation(summary = "Get public auth capabilities (Google sign-in client ID, password reset availability)")
    public ResponseEntity<AuthConfigResponse> getConfig() {
        return ResponseEntity.ok(new AuthConfigResponse(
                googleTokenVerifier.getClientId(),
                passwordResetService.isPasswordResetConfigured()
        ));
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

    @PostMapping("/google")
    @SecurityRequirements
    @Operation(summary = "Exchange a Google Identity Services ID token for a CineBook session token")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Authenticated"),
            @ApiResponse(responseCode = "400", description = "Unverified Google email or invalid token",
                    content = @Content(schema = @Schema(implementation = ApiError.class))),
            @ApiResponse(responseCode = "401", description = "Invalid token signature, expired, or wrong audience",
                    content = @Content(schema = @Schema(implementation = ApiError.class))),
            @ApiResponse(responseCode = "409", description = "Account linking conflict",
                    content = @Content(schema = @Schema(implementation = ApiError.class))),
            @ApiResponse(responseCode = "503", description = "Google authentication is not configured",
                    content = @Content(schema = @Schema(implementation = ApiError.class)))
    })
    public ResponseEntity<AuthResponse> googleLogin(@Valid @RequestBody GoogleAuthRequest request,
                                                    HttpServletRequest servletRequest) {
        rateLimiter.googleAuth(servletRequest.getRemoteAddr());
        GoogleTokenPayload payload = googleTokenVerifier.verify(request.idToken());
        AuthResponse response;
        try {
            response = userService.authenticateWithGoogle(payload);
        } catch (ConcurrentGoogleSignUpException race) {
            // A simultaneous first sign-in of the same Google user won the insert; its row is
            // committed now, so a fresh transaction signs this request in to that account.
            response = userService.authenticateWithGoogle(payload);
        }
        return ResponseEntity.ok(response);
    }

    @PostMapping("/forgot-password")
    @SecurityRequirements
    @Operation(summary = "Request a password reset email")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Uniform status response (anti-enumeration)"),
            @ApiResponse(responseCode = "400", description = "Invalid email format",
                    content = @Content(schema = @Schema(implementation = ApiError.class))),
            @ApiResponse(responseCode = "503", description = "Email service not configured",
                    content = @Content(schema = @Schema(implementation = ApiError.class)))
    })
    public ResponseEntity<MessageResponse> forgotPassword(@Valid @RequestBody ForgotPasswordRequest request,
                                                          HttpServletRequest servletRequest) {
        rateLimiter.forgotPassword(servletRequest.getRemoteAddr(), request.email());
        MessageResponse response = passwordResetService.requestReset(request.email());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/reset-password")
    @SecurityRequirements
    @Operation(summary = "Reset password using a one-time token")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Password reset completed"),
            @ApiResponse(responseCode = "400", description = "Invalid/expired token or password policy violation",
                    content = @Content(schema = @Schema(implementation = ApiError.class)))
    })
    public ResponseEntity<MessageResponse> resetPassword(@Valid @RequestBody ResetPasswordRequest request,
                                                         HttpServletRequest servletRequest) {
        rateLimiter.resetPassword(servletRequest.getRemoteAddr());
        MessageResponse response = passwordResetService.resetPassword(request.token(), request.newPassword());
        return ResponseEntity.ok(response);
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
