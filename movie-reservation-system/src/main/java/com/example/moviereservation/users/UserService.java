package com.example.moviereservation.users;

import com.example.moviereservation.common.BadRequestException;
import com.example.moviereservation.common.ConflictException;
import com.example.moviereservation.common.ResourceNotFoundException;
import com.example.moviereservation.security.JwtService;
import com.example.moviereservation.users.email.EmailSender;
import com.example.moviereservation.users.email.ResendEmailSender;
import com.example.moviereservation.users.google.GoogleTokenPayload;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * Public API of the users module: registration, login and user lookup.
 *
 * <p>Other modules must depend on this service, never on {@code UserRepository}.
 */
@Service
public class UserService {

    private static final Logger log = LoggerFactory.getLogger(UserService.class);

    /** Deliberately identical for "unknown email" and "wrong password" so the API leaks nothing. */
    private static final String INVALID_CREDENTIALS = "Invalid email or password";

    /** PostgreSQL names of the unique constraints on users (V2 email UNIQUE, V12 google_sub UNIQUE). */
    static final String EMAIL_UNIQUE = "users_email_key";
    static final String GOOGLE_SUB_UNIQUE = "users_google_sub_key";
    private static final String UNIQUE_VIOLATION = "23505";

    /** BCrypt only uses the first 72 bytes and Spring Security rejects anything longer. */
    private static final int BCRYPT_MAX_PASSWORD_BYTES = 72;

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final ObjectProvider<EmailSender> emailSenderProvider;
    private final Executor emailExecutor;

    /** Checked against when the email is unknown, so both failure paths cost one BCrypt comparison. */
    private final String dummyPasswordHash;

    @Autowired
    public UserService(UserRepository userRepository,
                       PasswordEncoder passwordEncoder,
                       JwtService jwtService,
                       ObjectProvider<EmailSender> emailSenderProvider,
                       @Qualifier("applicationTaskExecutor") ObjectProvider<Executor> taskExecutor) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.emailSenderProvider = emailSenderProvider;
        Executor executor = taskExecutor == null ? null : taskExecutor.getIfAvailable();
        this.emailExecutor = executor != null ? executor : Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "account-notice-email");
            t.setDaemon(true);
            return t;
        });
        this.dummyPasswordHash = passwordEncoder.encode("dummy-password-for-timing-equalisation");
    }

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtService jwtService) {
        this(userRepository, passwordEncoder, jwtService, null, null);
    }

    /** Creates a {@link Role#USER} account and returns a freshly issued token. */
    @Transactional
    public AuthResponse register(RegisterRequest request) {
        if (exceedsBcryptLimit(request.password())) {
            // @Size counts characters; non-ASCII passwords (e.g. Arabic) can be <= 72 chars but > 72 bytes.
            throw new BadRequestException("password must be at most %d bytes".formatted(BCRYPT_MAX_PASSWORD_BYTES));
        }
        String email = normaliseEmail(request.email());
        if (userRepository.existsByEmail(email)) {
            throw new ConflictException("Email is already registered");
        }
        User user = new User(request.name().trim(), email, passwordEncoder.encode(request.password()), Role.USER);
        try {
            user = userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException ex) {
            // Unique index is the final arbiter when two registrations race. Any other integrity
            // error is a real fault, not a duplicate email, and is not reported as one.
            if (isUniqueViolationOf(ex, EMAIL_UNIQUE)) {
                throw new ConflictException("Email is already registered");
            }
            throw ex;
        }
        log.info("Registered user id={} role={}", user.getId(), user.getRole());
        return issueToken(user);
    }

    /** Verifies credentials and returns a token, or fails with a generic 401 message. */
    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest request) {
        Optional<User> user = userRepository.findByEmail(normaliseEmail(request.email()));
        // Always run one BCrypt comparison, even for an unknown email or passwordless user,
        // so response time does not reveal which emails are registered.
        String hash = user.map(User::getPasswordHash).filter(h -> h != null && !h.isBlank()).orElse(dummyPasswordHash);
        boolean passwordMatches = !exceedsBcryptLimit(request.password())
                && passwordEncoder.matches(request.password(), hash);
        if (user.isEmpty() || user.get().getPasswordHash() == null || !passwordMatches || !user.get().isEnabled()) {
            throw new BadCredentialsException(INVALID_CREDENTIALS);
        }
        return issueToken(user.get());
    }

    /**
     * Authenticates a user using verified Google ID token claims.
     * Links by email if an account already exists; otherwise registers a new account with {@link Role#USER}.
     * Never grants administrator privileges via Google.
     */
    @Transactional
    public AuthResponse authenticateWithGoogle(GoogleTokenPayload payload) {
        if (payload.sub() == null || payload.sub().isBlank()) {
            throw new BadRequestException("Google subject ID is required");
        }
        String email = normaliseEmail(payload.email());

        // 1. Check if user with this google_sub already exists
        Optional<User> userBySub = userRepository.findByGoogleSub(payload.sub());
        User user;
        if (userBySub.isPresent()) {
            user = userBySub.get();
            if (user.getRole() == Role.ADMIN) {
                throw new AccessDeniedException("Staff administrator accounts must sign in with email and password");
            }
        } else {
            // 2. Check if user with this verified email already exists
            Optional<User> userByEmail = userRepository.findByEmail(email);
            if (userByEmail.isPresent()) {
                user = userByEmail.get();
                if (user.getRole() == Role.ADMIN) {
                    throw new AccessDeniedException("Staff administrator accounts must sign in with email and password");
                }
                // Ensure the account is not already linked to a different Google subject ID
                if (user.getGoogleSub() != null && !user.getGoogleSub().equals(payload.sub())) {
                    throw new ConflictException("An account with this email is already linked to a different Google account");
                }
                // Pre-hijack defense (CB-1): if the account had a password, clear it and revoke existing sessions
                boolean hadPassword = user.getPasswordHash() != null;
                if (hadPassword) {
                    user.setPasswordHash(null);
                    user.revokeTokens();
                    log.info("Cleared password and revoked sessions on Google link for user id={}", user.getId());
                    notifyPasswordReplacedAfterCommit(user.getEmail());
                }
                user.setGoogleSub(payload.sub());
                user = userRepository.saveAndFlush(user);
                log.info("Linked existing user id={} to Google sub={}", user.getId(), payload.sub());
                if (hadPassword) {
                    return issueToken(user, "Your CineBook account was linked with Google. For security, your previous password was cleared and other active sessions were logged out. You can sign in with Google or use 'Forgot password' anytime if you need to set a password again.");
                }
            } else {
                // 3. Create new user account with Role.USER (strictly never ADMIN)
                String name = (payload.name() != null && !payload.name().isBlank())
                        ? payload.name().trim()
                        : email.split("@")[0];
                name = truncateName(name, 100);
                user = new User(name, email, null, Role.USER, payload.sub());
                try {
                    user = userRepository.saveAndFlush(user);
                } catch (DataIntegrityViolationException ex) {
                    // Do not query the database within the aborted transaction, which causes 500 error.
                    // Only a race on the same email/Google subject is retried; anything else is a fault.
                    if (!isUniqueViolationOf(ex, EMAIL_UNIQUE, GOOGLE_SUB_UNIQUE)) {
                        throw ex;
                    }
                    log.warn("Unique constraint violation registering user via Google email={}", ResendEmailSender.maskEmail(email));
                    throw new ConcurrentGoogleSignUpException();
                }
                log.info("Registered new user via Google id={} email={}", user.getId(), ResendEmailSender.maskEmail(user.getEmail()));
            }
        }

        if (!user.isEnabled()) {
            throw new BadCredentialsException("Account is disabled");
        }

        return issueToken(user);
    }

    /** @throws ResourceNotFoundException when no user has that id */
    @Transactional(readOnly = true)
    public UserDto getById(Long id) {
        return userRepository.findById(id)
                .map(UserDto::from)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));
    }

    /** @return the user with that email, if any */
    @Transactional(readOnly = true)
    public Optional<UserDto> findByEmail(String email) {
        return userRepository.findByEmail(normaliseEmail(email)).map(UserDto::from);
    }

    /** Invalidate every outstanding access token for this account, including this request's. */
    @Transactional
    public void logoutEverywhere(Long userId) {
        userRepository.revokeTokens(userId);
    }

    /**
     * Creates the administrator account when its email is not taken yet. Idempotent: running it
     * again on an existing database changes nothing.
     *
     * @return {@code true} when a new admin was created
     */
    @Transactional
    public boolean createAdminIfAbsent(String name, String email, String rawPassword) {
        String normalisedEmail = normaliseEmail(email);
        if (userRepository.existsByEmail(normalisedEmail)) {
            return false;
        }
        try {
            userRepository.saveAndFlush(
                    new User(name.trim(), normalisedEmail, passwordEncoder.encode(rawPassword), Role.ADMIN));
            return true;
        } catch (DataIntegrityViolationException ex) {
            return false;
        }
    }

    /**
     * Emails the owner that Google replaced their password (CB-25), after the commit and on the task
     * executor (CB-34): a slow or failing email provider never holds the request thread or its
     * database connection, and a rolled-back link sends nothing.
     */
    private void notifyPasswordReplacedAfterCommit(String targetEmail) {
        EmailSender sender = emailSenderProvider == null ? null : emailSenderProvider.getIfAvailable();
        if (sender == null) {
            return;
        }
        Runnable send = () -> {
            try {
                sender.sendPasswordReplacedByGoogleNotification(targetEmail);
            } catch (Exception ex) {
                log.warn("Failed to dispatch password replaced notification to {}: {}",
                        ResendEmailSender.maskEmail(targetEmail), ex.getMessage());
            }
        };
        Runnable dispatch = () -> {
            try {
                emailExecutor.execute(send);
            } catch (RuntimeException rejected) {
                log.warn("Could not queue password replaced notification to {}: {}",
                        ResendEmailSender.maskEmail(targetEmail), rejected.getMessage());
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    dispatch.run();
                }
            });
        } else {
            dispatch.run();
        }
    }

    private AuthResponse issueToken(User user) {
        return issueToken(user, null);
    }

    private AuthResponse issueToken(User user, String notice) {
        String token = jwtService.generateToken(user.getId(), user.getEmail(), user.getRole().name(),
                user.getTokenVersion());
        return AuthResponse.of(token, jwtService.getExpirationSeconds(), UserDto.from(user), notice);
    }

    static String truncateName(String name, int maxCodePoints) {
        if (name == null) {
            return null;
        }
        int codePointCount = name.codePointCount(0, name.length());
        if (codePointCount <= maxCodePoints) {
            return name;
        }
        int endIndex = name.offsetByCodePoints(0, maxCodePoints);
        return name.substring(0, endIndex);
    }

    /**
     * True when {@code ex} is a unique violation (SQLSTATE 23505) of one of the named constraints.
     * The constraint name comes from Hibernate's dialect-specific extraction (present in the message
     * even with {@code logServerErrorDetail=false}, which only drops the DETAIL line with the values).
     */
    static boolean isUniqueViolationOf(DataIntegrityViolationException ex, String... constraints) {
        for (Throwable t = ex; t != null && t.getCause() != t; t = t.getCause()) {
            if (t instanceof org.hibernate.exception.ConstraintViolationException cve) {
                String constraint = cve.getConstraintName();
                if (!UNIQUE_VIOLATION.equals(cve.getSQLState()) || constraint == null) {
                    return false;
                }
                for (String name : constraints) {
                    if (name.equalsIgnoreCase(constraint)) {
                        return true;
                    }
                }
                return false;
            }
        }
        return false;
    }

    private static boolean exceedsBcryptLimit(String rawPassword) {
        return rawPassword.getBytes(StandardCharsets.UTF_8).length > BCRYPT_MAX_PASSWORD_BYTES;
    }

    private static String normaliseEmail(String email) {
        return email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }
}
