package com.example.moviereservation.users;

import com.example.moviereservation.common.ConflictException;
import com.example.moviereservation.security.JwtService;
import com.example.moviereservation.users.google.GoogleTokenPayload;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.NoOpPasswordEncoder;

import java.sql.SQLException;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * CB-32 (test double: mocked repository). Only a unique violation of the users email (or, for
 * Google, the google_sub) constraint means "already registered"; any other integrity error is a
 * real fault and must not be reported to the client as a duplicate email.
 */
class UserServiceIntegrityErrorTest {

    private final UserRepository users = mock(UserRepository.class);
    @SuppressWarnings("deprecation")
    private final UserService service = new UserService(users, NoOpPasswordEncoder.getInstance(), mock(JwtService.class));

    private static DataIntegrityViolationException violation(String sqlState, String constraint) {
        SQLException sql = new SQLException("ERROR: violates constraint \"" + constraint + "\"", sqlState);
        return new DataIntegrityViolationException("could not execute statement",
                new org.hibernate.exception.ConstraintViolationException("could not execute statement", sql, constraint));
    }

    @Test
    void aDuplicateEmailOnRegisterIsAConflict() {
        when(users.existsByEmail(any())).thenReturn(false);
        when(users.saveAndFlush(any())).thenThrow(violation("23505", "users_email_key"));

        Throwable thrown = catchThrowable(() -> service.register(new RegisterRequest("A", "a@cinema.test", "Passw0rd!")));

        assertThat(thrown).isInstanceOf(ConflictException.class).hasMessage("Email is already registered");
    }

    @Test
    void anyOtherIntegrityErrorOnRegisterIsNotReportedAsADuplicateEmail() {
        when(users.existsByEmail(any())).thenReturn(false);
        when(users.saveAndFlush(any())).thenThrow(violation("23514", "users_role_check"));

        Throwable thrown = catchThrowable(() -> service.register(new RegisterRequest("A", "a@cinema.test", "Passw0rd!")));

        assertThat(thrown).isInstanceOf(DataIntegrityViolationException.class).isNotInstanceOf(ConflictException.class);
    }

    @Test
    void aGoogleSignUpRaceOnEmailOrSubjectIsRetriable() {
        when(users.findByGoogleSub(any())).thenReturn(Optional.empty());
        when(users.findByEmail(any())).thenReturn(Optional.empty());
        for (String constraint : new String[]{"users_email_key", "users_google_sub_key"}) {
            org.mockito.Mockito.doThrow(violation("23505", constraint)).when(users).saveAndFlush(any());
            Throwable thrown = catchThrowable(() -> service.authenticateWithGoogle(
                    new GoogleTokenPayload("sub-1", "g@cinema.test", "G", true)));
            assertThat(thrown).as(constraint).isInstanceOf(ConcurrentGoogleSignUpException.class);
        }
    }

    @Test
    void anyOtherIntegrityErrorOnGoogleSignUpIsNotTreatedAsARace() {
        when(users.findByGoogleSub(any())).thenReturn(Optional.empty());
        when(users.findByEmail(any())).thenReturn(Optional.empty());
        when(users.saveAndFlush(any())).thenThrow(violation("23502", "users_name_not_null"));

        Throwable thrown = catchThrowable(() -> service.authenticateWithGoogle(
                new GoogleTokenPayload("sub-2", "h@cinema.test", "H", true)));

        assertThat(thrown).isInstanceOf(DataIntegrityViolationException.class).isNotInstanceOf(ConflictException.class);
    }
}
