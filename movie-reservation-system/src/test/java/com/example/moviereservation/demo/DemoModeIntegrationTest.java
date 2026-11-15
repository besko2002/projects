package com.example.moviereservation.demo;

import com.example.moviereservation.TestcontainersConfiguration;
import com.example.moviereservation.movies.MovieService;
import com.example.moviereservation.movies.MovieSummaryDto;
import com.example.moviereservation.movies.ScheduleService;
import com.example.moviereservation.movies.ScheduleSummaryDto;
import com.example.moviereservation.theaters.TheaterService;
import com.example.moviereservation.theaters.TheaterSummaryDto;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "app.demo.enabled=true",
        "app.demo.rate-limit-per-minute=3"
})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class DemoModeIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DemoSeederService demoSeederService;

    @Autowired
    private MovieService movieService;

    @Autowired
    private TheaterService theaterService;

    @Autowired
    private ScheduleService scheduleService;

    @Test
    void demoStatusReturnsEnabledAndTestGuidance() throws Exception {
        mockMvc.perform(get("/api/demo/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.banner").value("Portfolio demo — fictional data, Stripe test payments only."));
    }

    @Test
    void visitorSessionsAreIsolatedAndRateLimited() throws Exception {
        // Visitor 1 session
        MvcResult res1 = mockMvc.perform(post("/api/demo/session")
                        .with(req -> {
                            req.setRemoteAddr("10.0.0.1");
                            return req;
                        }))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accessToken").isString())
                .andExpect(jsonPath("$.user.role").value("USER"))
                .andReturn();
        String token1 = JsonPath.read(res1.getResponse().getContentAsString(), "$.accessToken");
        Number userId1 = JsonPath.read(res1.getResponse().getContentAsString(), "$.user.id");

        // Visitor 2 session
        MvcResult res2 = mockMvc.perform(post("/api/demo/session")
                        .with(req -> {
                            req.setRemoteAddr("10.0.0.1");
                            return req;
                        }))
                .andExpect(status().isCreated())
                .andReturn();
        String token2 = JsonPath.read(res2.getResponse().getContentAsString(), "$.accessToken");
        Number userId2 = JsonPath.read(res2.getResponse().getContentAsString(), "$.user.id");

        assertThat(userId1.longValue()).isNotEqualTo(userId2.longValue());
        assertThat(token1).isNotEqualTo(token2);

        // Verify each token identifies its own distinct user
        mockMvc.perform(get("/api/users/me")
                        .header("Authorization", "Bearer " + token1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(userId1.longValue()));

        mockMvc.perform(get("/api/users/me")
                        .header("Authorization", "Bearer " + token2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(userId2.longValue()));

        // Visitor 3 session (hits the rate limit of 3 for 10.0.0.1)
        mockMvc.perform(post("/api/demo/session")
                        .with(req -> {
                            req.setRemoteAddr("10.0.0.1");
                            return req;
                        }))
                .andExpect(status().isCreated());

        // 4th attempt from same IP triggers 429
        mockMvc.perform(post("/api/demo/session")
                        .with(req -> {
                            req.setRemoteAddr("10.0.0.1");
                            return req;
                        }))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.status").value(429))
                .andExpect(jsonPath("$.message").value("Too many demo sessions created; please wait a moment and try again"));

        // Different IP is not blocked
        mockMvc.perform(post("/api/demo/session")
                        .with(req -> {
                            req.setRemoteAddr("10.0.0.2");
                            return req;
                        }))
                .andExpect(status().isCreated());
    }

    @Test
    void demoCatalogueIsPopulatedAndSeederIsIdempotent() {
        // Verify 10 movies exist
        List<MovieSummaryDto> movies = movieService.listMovies(null, null, 0, 100, List.of("id,asc")).content();
        assertThat(movies)
                .extracting("title")
                .contains(
                        "Ember Road",
                        "Tidewatch",
                        "The Neon Alchemist",
                        "Starlight Express",
                        "Shadows in the Fog",
                        "Solaris Drift",
                        "Whispers of the Forest",
                        "Midnight Encore",
                        "The Clockwork Heist",
                        "Apex Horizon"
                );

        // Verify 3 theaters exist
        List<TheaterSummaryDto> theaters = theaterService.listTheaters(0, 100, List.of("id,asc")).content();
        assertThat(theaters)
                .extracting("name")
                .contains("Grand Vintage Hall", "Retro Cinema 2", "The Bijou Studio");

        int initialMovieCount = movies.size();
        int initialTheaterCount = theaters.size();

        // Run seed() again - must be completely idempotent
        demoSeederService.seed();

        List<MovieSummaryDto> moviesAfter = movieService.listMovies(null, null, 0, 100, List.of("id,asc")).content();
        List<TheaterSummaryDto> theatersAfter = theaterService.listTheaters(0, 100, List.of("id,asc")).content();

        assertThat(moviesAfter).hasSize(initialMovieCount);
        assertThat(theatersAfter).hasSize(initialTheaterCount);

        // Verify showtimes for the next 7 days and no overlaps per theater
        ZoneId zone = scheduleService.getZone();
        LocalDate today = LocalDate.now(zone);

        for (TheaterSummaryDto theater : theaters) {
            for (int d = 0; d < 7; d++) {
                LocalDate date = today.plusDays(d);
                List<ScheduleSummaryDto> schedules = new java.util.ArrayList<>(scheduleService.listSchedules(
                        null, theater.id(), date, null, null, 0, 100, List.of("startTime,asc")
                ).content());

                // Sort by start time and check no overlapping windows
                schedules.sort(Comparator.comparing(ScheduleSummaryDto::startTime));
                for (int i = 0; i < schedules.size() - 1; i++) {
                    ScheduleSummaryDto current = schedules.get(i);
                    ScheduleSummaryDto next = schedules.get(i + 1);
                    assertThat(current.endTime())
                            .as("Schedule %d endTime must be <= next schedule %d startTime in theater %s",
                                    current.id(), next.id(), theater.name())
                            .isBeforeOrEqualTo(next.startTime());
                }
            }
        }
    }

    @Test
    void spaRoutingForwardsToFrontendWhileUnknownApiIs404() throws Exception {
        // Direct nested frontend routes forward to index.html
        mockMvc.perform(get("/movie/1"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));

        mockMvc.perform(get("/tickets"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));

        mockMvc.perform(get("/book/1"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));

        // Unknown API route on public path returns 404 ApiError, NEVER forwards to index.html
        mockMvc.perform(get("/api/movies/999999999")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404));

        // Unknown unauthenticated API route returns 401 ApiError (JSON), NEVER forwards to index.html
        mockMvc.perform(get("/api/unknown-endpoint")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.status").value(401));
    }
}
