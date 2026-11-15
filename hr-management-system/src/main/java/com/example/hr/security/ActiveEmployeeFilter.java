package com.example.hr.security;

import com.example.hr.common.ApiError;
import com.example.hr.employee.EmployeeRepository;
import com.example.hr.employee.EmployeeStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Rejects tokens belonging to employees who no longer exist or who have been terminated.
 *
 * <p>Design decision: instead of a denylist scheme, every authenticated request performs one
 * indexed primary-key lookup ({@code select status, token_version from employees where id = ?}).
 * Revocation is therefore immediate — a termination takes effect on the terminated person's
 * very next request, with no need to re-issue or track tokens — at the cost of a single cheap
 * query per request, which the connection pool absorbs easily.
 *
 * <p>The same lookup also rejects tokens issued before the last password change (401). That
 * check is the employee's <b>token version</b>, not a timestamp: the JWT {@code iat} has
 * one-second resolution, so a token minted in the same second as the password change was
 * indistinguishable from one minted before it and survived the old timestamp comparison. The
 * version is bumped on every password change, so it separates the two without any clock
 * resolution at all. Tokens issued before the version existed carry no claim and count as
 * version 0 — and every employee who had already changed their password when the version was
 * introduced starts at version 1, so those old tokens do not survive either.
 *
 * <p>While {@code must_change_password} is set the filter only lets the caller change the
 * password or read their own profile — everything else is 403.
 */
public class ActiveEmployeeFilter extends OncePerRequestFilter {

    static final String CHANGE_PASSWORD = "/api/auth/change-password";
    static final String CURRENT_USER = "/api/employees/me";

    private final EmployeeRepository employees;
    private final ObjectMapper json;

    public ActiveEmployeeFilter(EmployeeRepository employees, ObjectMapper json) {
        this.employees = employees;
        this.json = json;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken token) {
            Optional<EmployeeRepository.AuthState> state = authState(token.getName());
            if (state.isEmpty() || !EmployeeStatus.ACTIVE.name().equals(state.get().getStatus())) {
                reject(request, response, HttpStatus.UNAUTHORIZED, "This account is no longer active");
                return;
            }
            // The version is the decisive check: it changes on every password or role change, so a
            // token minted in the same second as the change is rejected as well.
            if (tokenVersion(token.getToken()) != state.get().getTokenVersion()) {
                reject(request, response, HttpStatus.UNAUTHORIZED,
                        "Your account credentials or permissions changed; please sign in again");
                return;
            }
            // Secondary, coarse signal kept as a second line of defence: the timestamp has
            // second resolution, so it can only ever reject tokens from an earlier second.
            Instant changedAt = state.get().getPasswordChangedAt();
            Instant issuedAt = token.getToken().getIssuedAt();
            if (changedAt != null && (issuedAt == null || issuedAt.isBefore(changedAt))) {
                reject(request, response, HttpStatus.UNAUTHORIZED,
                        "This token was issued before the last password change");
                return;
            }
            if (state.get().isMustChangePassword() && !allowedWhilePasswordChangeRequired(request)) {
                response.setStatus(HttpStatus.FORBIDDEN.value());
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                json.writeValue(response.getOutputStream(), ApiError.mustChangePassword(
                        "You must change your password before using this resource", request.getRequestURI()));
                return;
            }
        }
        chain.doFilter(request, response);
    }

    /**
     * The token version carried in the JWT. A token issued before the version existed has no
     * claim and counts as version 0.
     *
     * @param jwt the presented token
     * @return the version it was issued with
     */
    private static int tokenVersion(Jwt jwt) {
        Object claim = jwt.getClaims().get(JwtService.TOKEN_VERSION_CLAIM);
        return claim instanceof Number number ? number.intValue() : 0;
    }

    private static boolean allowedWhilePasswordChangeRequired(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        String method = request.getMethod();
        return ("POST".equals(method) && CHANGE_PASSWORD.equals(path))
                || ("GET".equals(method) && CURRENT_USER.equals(path));
    }

    private void reject(HttpServletRequest request, HttpServletResponse response, HttpStatus status,
                        String message) throws IOException {
        if (status == HttpStatus.UNAUTHORIZED) {
            SecurityContextHolder.clearContext();
        }
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(response.getOutputStream(),
                ApiError.of(status.value(), status.getReasonPhrase(), message, request.getRequestURI()));
    }

    private Optional<EmployeeRepository.AuthState> authState(String subject) {
        UUID id;
        try {
            id = UUID.fromString(subject);
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
        return employees.findAuthStateById(id);
    }
}
