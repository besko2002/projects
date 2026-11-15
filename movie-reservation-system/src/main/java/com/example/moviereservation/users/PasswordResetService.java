package com.example.moviereservation.users;

import com.example.moviereservation.common.BadRequestException;
import com.example.moviereservation.common.ServiceUnavailableException;
import com.example.moviereservation.users.email.EmailSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Optional;

@Service
public class PasswordResetService {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);
    private static final int TOKEN_BYTE_LENGTH = 32;
    private static final int TOKEN_EXPIRY_MINUTES = 30;
    private static final int BCRYPT_MAX_PASSWORD_BYTES = 72;

    private final UserRepository userRepository;
    private final PasswordResetTokenRepository tokenRepository;
    private final EmailSender emailSender;
    private final PasswordEncoder passwordEncoder;
    private final String frontendBaseUrl;
    private final Clock clock;
    private final SecureRandom secureRandom = new SecureRandom();

    @org.springframework.beans.factory.annotation.Autowired
    public PasswordResetService(UserRepository userRepository,
                                PasswordResetTokenRepository tokenRepository,
                                EmailSender emailSender,
                                PasswordEncoder passwordEncoder,
                                @Value("${app.email.frontend-base-url:http://localhost:5177}") String frontendBaseUrl) {
        this(userRepository, tokenRepository, emailSender, passwordEncoder, frontendBaseUrl, Clock.systemUTC());
    }

    public PasswordResetService(UserRepository userRepository,
                                PasswordResetTokenRepository tokenRepository,
                                EmailSender emailSender,
                                PasswordEncoder passwordEncoder,
                                String frontendBaseUrl,
                                Clock clock) {
        this.userRepository = userRepository;
        this.tokenRepository = tokenRepository;
        this.emailSender = emailSender;
        this.passwordEncoder = passwordEncoder;
        this.frontendBaseUrl = frontendBaseUrl == null ? "http://localhost:5177" : frontendBaseUrl.trim();
        this.clock = clock;
    }

    public boolean isPasswordResetConfigured() {
        return emailSender.isConfigured();
    }

    /**
     * Requests a password reset link. Always answers with a uniform message to prevent email enumeration.
     */
    @Transactional
    public MessageResponse requestReset(String rawEmail) {
        if (!emailSender.isConfigured()) {
            throw new ServiceUnavailableException("Password reset email service is currently unavailable");
        }

        String email = rawEmail.trim().toLowerCase(Locale.ROOT);
        Optional<User> userOpt = userRepository.findByEmail(email);

        if (userOpt.isPresent()) {
            User user = userOpt.get();
            if (user.isEnabled()) {
                // Invalidate all previous unused tokens for this user
                tokenRepository.invalidateAllForUser(user.getId());

                // Generate cryptographically secure random token (32 bytes = 64 hex characters)
                byte[] bytes = new byte[TOKEN_BYTE_LENGTH];
                secureRandom.nextBytes(bytes);
                String rawToken = HexFormat.of().formatHex(bytes);
                String tokenHash = sha256(rawToken);

                OffsetDateTime expiresAt = OffsetDateTime.now(clock).plusMinutes(TOKEN_EXPIRY_MINUTES);
                PasswordResetToken token = new PasswordResetToken(user, tokenHash, expiresAt);
                tokenRepository.saveAndFlush(token);

                String cleanBase = frontendBaseUrl.replaceAll("/+$", "");
                String resetLink = cleanBase + "/reset-password#token=" + rawToken;

                // Send email; raw token is NEVER logged
                emailSender.sendPasswordReset(user.getEmail(), resetLink);
                log.info("Issued password reset token for user id={}", user.getId());
            } else {
                log.warn("Password reset requested for disabled user id={}", user.getId());
            }
        } else {
            log.debug("Password reset requested for non-existent email {}", email);
        }

        return new MessageResponse("If an account matches that email, a password reset link has been sent.");
    }

    /**
     * Completes password reset given the raw token and the new password.
     */
    @Transactional
    public MessageResponse resetPassword(String rawToken, String newPassword) {
        if (newPassword == null || newPassword.isBlank()) {
            throw new BadRequestException("Password must not be blank");
        }
        if (newPassword.length() < 8 || newPassword.length() > 72) {
            throw new BadRequestException("Password must be between 8 and 72 characters");
        }
        if (newPassword.getBytes(StandardCharsets.UTF_8).length > BCRYPT_MAX_PASSWORD_BYTES) {
            throw new BadRequestException("Password exceeds BCrypt 72-byte limit");
        }

        String tokenHash = sha256(rawToken.trim());
        Optional<PasswordResetToken> tokenOpt = tokenRepository.findByTokenHashForUpdate(tokenHash);

        if (tokenOpt.isEmpty()) {
            throw new BadRequestException("Invalid or expired password reset token");
        }

        PasswordResetToken token = tokenOpt.get();
        if (token.isUsed() || token.getExpiresAt().isBefore(OffsetDateTime.now(clock))) {
            throw new BadRequestException("Invalid or expired password reset token");
        }

        // Mark token as used immediately
        token.setUsed(true);
        tokenRepository.saveAndFlush(token);

        User user = token.getUser();
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        // Revoke all existing sessions (increments token_version)
        user.revokeTokens();
        userRepository.saveAndFlush(user);

        log.info("Password successfully reset and sessions revoked for user id={}", user.getId());
        emailSender.sendPasswordChangedNotification(user.getEmail());

        return new MessageResponse("Password has been successfully reset. You may now sign in with your new password.");
    }

    static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 digest unavailable", ex);
        }
    }
}
