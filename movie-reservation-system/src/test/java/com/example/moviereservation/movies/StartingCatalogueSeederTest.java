package com.example.moviereservation.movies;

import com.example.moviereservation.theaters.TheaterService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * CB-23: the seeder's lock must be a transaction-scoped advisory lock taken inside the seeding
 * transaction (so it can never be left behind on a pooled connection), a lock error must not be
 * treated as "acquired", and an install that only has genres is not empty.
 */
class StartingCatalogueSeederTest {

    private final List<String> events = new ArrayList<>();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final MovieService movies = mock(MovieService.class);
    private final GenreService genres = mock(GenreService.class);
    private final TheaterService theaters = mock(TheaterService.class);
    private final ScheduleService schedules = mock(ScheduleService.class);
    private StartingCatalogueSeeder seeder;

    @BeforeEach
    void setUp() {
        PlatformTransactionManager tx = new PlatformTransactionManager() {
            @Override
            public TransactionStatus getTransaction(TransactionDefinition definition) {
                events.add("begin");
                return new SimpleTransactionStatus(true);
            }

            @Override
            public void commit(TransactionStatus status) {
                events.add("commit");
            }

            @Override
            public void rollback(TransactionStatus status) {
                events.add("rollback");
            }
        };
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenAnswer(call -> {
            events.add("sql:" + call.getArgument(0));
            return Boolean.TRUE;
        });
        when(jdbc.queryForObject(anyString(), eq(Integer.class))).thenAnswer(call -> {
            events.add("sql:" + call.getArgument(0));
            return 0;
        });
        when(movies.count()).thenReturn(0L);
        when(theaters.count()).thenReturn(0L);
        seeder = new StartingCatalogueSeeder(jdbc, movies, genres, theaters, schedules, tx);
    }

    @Test
    void anInstallThatOnlyHasGenresIsNotSeeded() {
        when(genres.getAllGenres()).thenReturn(List.of(new GenreDto(1L, "Owner Genre")));

        assertThat(seeder.seedIfEmpty()).isFalse();

        verify(movies, never()).createMovie(any());
        verify(theaters, never()).createTheater(any());
        verify(genres, never()).createGenre(any());
    }

    @Test
    void lockIsTransactionScopedAndTakenInsideTheSeedingTransaction() {
        when(genres.getAllGenres()).thenReturn(List.of(new GenreDto(1L, "Owner Genre")));

        seeder.seedIfEmpty();

        List<String> lockSql = events.stream().filter(e -> e.contains("advisory")).toList();
        assertThat(lockSql).containsExactly("sql:SELECT pg_try_advisory_xact_lock(84729104)");
        assertThat(events.indexOf("begin")).isLessThan(events.indexOf(lockSql.get(0)));
        assertThat(events.indexOf(lockSql.get(0))).isLessThan(events.lastIndexOf("commit"));
    }

    @Test
    void aLockErrorIsNotTreatedAsAcquired() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class)))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("connection reset"));
        when(genres.getAllGenres()).thenReturn(List.of());

        assertThat(seeder.seedIfEmpty()).isFalse();

        verify(genres, never()).createGenre(any());
        verify(movies, never()).createMovie(any());
    }

    @Test
    void aFailedSeedOfAnEmptyInstallIsNotSwallowed() {
        // CB-36: the error was logged and seedIfEmpty returned false, so the app started with an
        // empty catalogue as if nothing had happened.
        when(genres.getAllGenres()).thenReturn(List.of());
        when(genres.createGenre(any())).thenAnswer(call -> new GenreDto(1L, ((GenreRequest) call.getArgument(0)).name()));
        when(movies.listMovies(any(), any(), any(), any(), any()))
                .thenThrow(new IllegalArgumentException("movie lookup failed"));

        Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(seeder::seedIfEmpty);

        assertThat(thrown).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Starting catalogue seeding failed")
                .hasRootCauseMessage("movie lookup failed");
        assertThat(events).contains("rollback").doesNotContain("commit");
    }
}
