package com.example.moviereservation.movies;

import com.example.moviereservation.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class StartingCatalogueIntegrationTest {

    @Autowired
    private StartingCatalogueSeeder seeder;

    @Autowired
    private MovieService movieService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void seederIsIdempotentAndPreservesExistingCatalogue() {
        // First run on empty database was executed by ApplicationReadyEvent or can be verified:
        long initialCount = movieService.count();
        assertThat(initialCount).isGreaterThanOrEqualTo(10L);

        // Calling seedIfEmpty a second time returns false (metadata check or existing movies check)
        boolean secondRun = seeder.seedIfEmpty();
        assertThat(secondRun).isFalse();

        // Count unchanged
        assertThat(movieService.count()).isEqualTo(initialCount);

        String status = jdbcTemplate.queryForObject(
                "SELECT value FROM app_metadata WHERE key = 'starting_catalogue_seeded'", String.class);
        assertThat(status).isNotNull();
        assertThat(status).isIn("completed", "skipped_existing_data");
    }
}
