package com.example.moviereservation.movies;

import com.example.moviereservation.common.BadRequestException;
import com.example.moviereservation.common.ConflictException;
import com.example.moviereservation.theaters.CreateTheaterRequest;
import com.example.moviereservation.theaters.TheaterDto;
import com.example.moviereservation.theaters.TheaterService;
import com.example.moviereservation.theaters.TheaterSummaryDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Seeds the standard starting catalogue (10 movies, genres, 3 halls, and 14 days of upcoming showtimes)
 * into a new, empty installation.
 *
 * <p>Idempotent and strictly preserves existing data: if any movies already exist in the database,
 * or if the metadata table records that seeding has already occurred, seeding is skipped entirely.
 */
@Component
public class StartingCatalogueSeeder {

    private static final Logger log = LoggerFactory.getLogger(StartingCatalogueSeeder.class);

    private final JdbcTemplate jdbcTemplate;
    private final MovieService movieService;
    private final GenreService genreService;
    private final TheaterService theaterService;
    private final ScheduleService scheduleService;
    private final TransactionTemplate transactionTemplate;

    public StartingCatalogueSeeder(JdbcTemplate jdbcTemplate,
                                   MovieService movieService,
                                   GenreService genreService,
                                   TheaterService theaterService,
                                   ScheduleService scheduleService,
                                   PlatformTransactionManager transactionManager) {
        this.jdbcTemplate = jdbcTemplate;
        this.movieService = movieService;
        this.genreService = genreService;
        this.theaterService = theaterService;
        this.scheduleService = scheduleService;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        seedIfEmpty();
    }

    /**
     * Executes the starting catalogue seeding if the database is empty and has not yet run.
     * Uses a PostgreSQL advisory lock to ensure only one instance seeds in concurrent startup scenarios,
     * and wraps creation in a strict transaction so partial seeding cannot occur on failure.
     *
     * @return {@code true} if starting content was seeded, {@code false} if skipped
     */
    public synchronized boolean seedIfEmpty() {
        boolean lockAcquired = false;
        try {
            Boolean locked = jdbcTemplate.queryForObject(
                    "SELECT pg_try_advisory_lock(84729104)", Boolean.class);
            lockAcquired = Boolean.TRUE.equals(locked);
        } catch (Exception ex) {
            log.debug("Advisory lock not available or failed: {}; proceeding with instance-level synchronization", ex.getMessage());
            lockAcquired = true;
        }

        if (!lockAcquired) {
            log.info("Another instance holds the starting catalogue seeder lock; skipping.");
            return false;
        }

        try {
            Boolean result = transactionTemplate.execute(status -> doSeedIfEmpty());
            return Boolean.TRUE.equals(result);
        } finally {
            try {
                jdbcTemplate.queryForObject("SELECT pg_advisory_unlock(84729104)", Boolean.class);
            } catch (Exception ex) {
                log.debug("Failed to release advisory lock: {}", ex.getMessage());
            }
        }
    }

    private boolean doSeedIfEmpty() {
        try {
            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM app_metadata WHERE key = 'starting_catalogue_seeded'", Integer.class);
            if (count != null && count > 0) {
                log.debug("Starting catalogue seeder has already run according to app_metadata; skipping.");
                return false;
            }
        } catch (Exception ex) {
            log.warn("Could not check app_metadata for starting catalogue seeder: {}", ex.getMessage());
        }

        if (movieService.count() > 0 || theaterService.count() > 0) {
            log.info("Existing catalogue detected (movies > 0 or theaters > 0); skipping initial content seeding to preserve saved database.");
            recordMetadata("skipped_existing_data");
            return false;
        }

        log.info("Empty database detected; seeding 10 starting films, genres, 3 halls, and 14 days of showtimes.");
        Map<String, Long> genreMap = ensureGenres();
        List<Long> movieIds = ensureMovies(genreMap);
        List<TheaterSpec> theaters = ensureTheaters();
        ensureSchedules(movieIds, theaters, 14);

        recordMetadata("completed");
        log.info("Starting catalogue seeded successfully (10 movies, 3 theaters, 14 days of showtimes).");
        return true;
    }

    private void recordMetadata(String status) {
        try {
            jdbcTemplate.update(
                    "INSERT INTO app_metadata (key, value) VALUES ('starting_catalogue_seeded', ?) ON CONFLICT (key) DO NOTHING",
                    status);
        } catch (Exception ex) {
            log.error("Failed to record starting_catalogue_seeded in app_metadata: {}", ex.getMessage());
        }
    }

    private Map<String, Long> ensureGenres() {
        Map<String, Long> genreMap = new HashMap<>();
        for (GenreDto g : genreService.getAllGenres()) {
            genreMap.put(g.name().toLowerCase(Locale.ROOT), g.id());
        }

        String[] required = {
                "Action", "Adventure", "Sci-Fi", "Drama",
                "Thriller", "Mystery", "Family", "Fantasy", "Crime", "Music"
        };
        for (String name : required) {
            String key = name.toLowerCase(Locale.ROOT);
            if (!genreMap.containsKey(key)) {
                try {
                    GenreDto created = genreService.createGenre(new GenreRequest(name));
                    genreMap.put(key, created.id());
                } catch (ConflictException ex) {
                    for (GenreDto g : genreService.getAllGenres()) {
                        genreMap.put(g.name().toLowerCase(Locale.ROOT), g.id());
                    }
                }
            }
        }
        return genreMap;
    }

    private List<Long> ensureMovies(Map<String, Long> genreMap) {
        Map<String, Long> existingMovies = new HashMap<>();
        for (MovieSummaryDto m : movieService.listMovies(null, null, 0, 100, List.of("id,asc")).content()) {
            existingMovies.put(m.title().toLowerCase(Locale.ROOT), m.id());
        }

        List<MovieSpec> specs = List.of(
                new MovieSpec(
                        "Ember Road",
                        "A veteran courier undertakes one last perilous journey across scorched badlands to deliver a secret package that could end a decade-long conflict.",
                        "/posters/ember-road.svg",
                        125,
                        LocalDate.of(2026, 10, 14),
                        List.of("action", "adventure")
                ),
                new MovieSpec(
                        "Tidewatch",
                        "In an isolated coastal observatory, a solitary oceanographer detects an anomalous subsonic signal echoing from the deepest oceanic trench on Earth.",
                        "/posters/tidewatch.svg",
                        118,
                        LocalDate.of(2026, 9, 22),
                        List.of("sci-fi", "drama")
                ),
                new MovieSpec(
                        "The Neon Alchemist",
                        "In a sprawling rain-drenched cyberpunk metropolis, a renegade biochemist races against powerful synth-corps to synthesize a cure for the city's terminal neural plague.",
                        "/posters/neon-alchemist.svg",
                        134,
                        LocalDate.of(2026, 11, 1),
                        List.of("sci-fi", "thriller")
                ),
                new MovieSpec(
                        "Starlight Express",
                        "A wondrous retro-futuristic locomotive embarks on a whimsical voyage through uncharted planetary systems, carrying an eccentric crew and mysterious passengers.",
                        "/posters/starlight-express.svg",
                        102,
                        LocalDate.of(2026, 8, 15),
                        List.of("adventure", "family")
                ),
                new MovieSpec(
                        "Shadows in the Fog",
                        "In 1948 London, a private investigator untangles a web of deceit, counterfeit stamps, and stolen art beneath the shroud of the Great Smog.",
                        "/posters/shadows-fog.svg",
                        115,
                        LocalDate.of(2026, 10, 5),
                        List.of("mystery", "crime")
                ),
                new MovieSpec(
                        "Solaris Drift",
                        "When an experimental deep-space colony vessel slips off its planned orbital trajectory, the remaining skeleton crew must confront psychological dread and cosmic silence.",
                        "/posters/solaris-drift.svg",
                        140,
                        LocalDate.of(2026, 10, 28),
                        List.of("sci-fi", "drama")
                ),
                new MovieSpec(
                        "Whispers of the Forest",
                        "A cartographer mapping forgotten ancient woodlands discovers a secluded sanctuary where mythical guardian spirits guard memories of ancient epochs.",
                        "/posters/whispers-forest.svg",
                        110,
                        LocalDate.of(2026, 7, 20),
                        List.of("fantasy", "mystery")
                ),
                new MovieSpec(
                        "Midnight Encore",
                        "An aging jazz saxophonist gets an unexpected opportunity to play one unforgettable midnight concert at the legendary Blue Room that made him famous.",
                        "/posters/midnight-encore.svg",
                        108,
                        LocalDate.of(2026, 6, 11),
                        List.of("drama", "music")
                ),
                new MovieSpec(
                        "The Clockwork Heist",
                        "A master clockmaker and a ragtag crew of illusionists conspire to liberate an invaluable astronomical chronometer from the fortress-like Royal Vault.",
                        "/posters/clockwork-heist.svg",
                        122,
                        LocalDate.of(2026, 9, 2),
                        List.of("thriller", "action")
                ),
                new MovieSpec(
                        "Apex Horizon",
                        "Test pilots pushing hypersonic atmospheric boundaries in prototype aircraft uncover an unexplainable gravitational anomaly suspended above the poles.",
                        "/posters/apex-horizon.svg",
                        130,
                        LocalDate.of(2026, 11, 10),
                        List.of("action", "sci-fi")
                )
        );

        List<Long> movieIds = new ArrayList<>();
        for (MovieSpec spec : specs) {
            String key = spec.title().toLowerCase(Locale.ROOT);
            Long id = existingMovies.get(key);
            if (id == null) {
                Set<Long> genreIds = new HashSet<>();
                for (String gName : spec.genreNames()) {
                    Long gId = genreMap.get(gName);
                    if (gId != null) {
                        genreIds.add(gId);
                    }
                }
                MovieDto created = movieService.createMovie(new CreateMovieRequest(
                        spec.title(),
                        spec.description(),
                        spec.posterUrl(),
                        spec.durationMinutes(),
                        spec.releaseDate(),
                        genreIds
                ));
                id = created.id();
                existingMovies.put(key, id);
            }
            movieIds.add(id);
        }
        return movieIds;
    }

    private List<TheaterSpec> ensureTheaters() {
        Map<String, Long> existingTheaters = new HashMap<>();
        for (TheaterSummaryDto t : theaterService.listTheaters(0, 100, List.of("id,asc")).content()) {
            existingTheaters.put(t.name().toLowerCase(Locale.ROOT), t.id());
        }

        List<TheaterSpec> specs = List.of(
                new TheaterSpec(
                        null,
                        "Grand Vintage Hall",
                        "Main Screening Room, Level 1",
                        6, 10,
                        List.of("E", "F"),
                        new BigDecimal("14.00"),
                        new BigDecimal("20.00"),
                        List.of(LocalTime.of(13, 0), LocalTime.of(16, 30), LocalTime.of(20, 0))
                ),
                new TheaterSpec(
                        null,
                        "Retro Cinema 2",
                        "Auditorium 2, Level 2",
                        5, 8,
                        List.of("D", "E"),
                        new BigDecimal("12.50"),
                        new BigDecimal("18.00"),
                        List.of(LocalTime.of(13, 30), LocalTime.of(17, 0), LocalTime.of(20, 30))
                ),
                new TheaterSpec(
                        null,
                        "The Bijou Studio",
                        "Boutique Screening Room, Level 2",
                        4, 6,
                        List.of("C", "D"),
                        new BigDecimal("11.00"),
                        new BigDecimal("16.00"),
                        List.of(LocalTime.of(14, 0), LocalTime.of(17, 30), LocalTime.of(21, 0))
                )
        );

        List<TheaterSpec> result = new ArrayList<>();
        for (TheaterSpec spec : specs) {
            String key = spec.name().toLowerCase(Locale.ROOT);
            Long id = existingTheaters.get(key);
            if (id == null) {
                TheaterDto created = theaterService.createTheater(new CreateTheaterRequest(
                        spec.name(),
                        spec.location(),
                        spec.totalRows(),
                        spec.seatsPerRow(),
                        spec.vipRows()
                ));
                id = created.id();
                existingTheaters.put(key, id);
            }
            result.add(spec.withId(id));
        }
        return result;
    }

    private record ScheduleWindow(OffsetDateTime startTime, OffsetDateTime endTime) {
    }

    private void ensureSchedules(List<Long> movieIds, List<TheaterSpec> theaters, int days) {
        ZoneId zone = scheduleService.getZone();
        LocalDate today = LocalDate.now(zone);
        OffsetDateTime now = OffsetDateTime.now(zone);
        int bufferMinutes = scheduleService.getBufferMinutes();

        for (int dayOffset = 0; dayOffset < days; dayOffset++) {
            LocalDate targetDate = today.plusDays(dayOffset);
            boolean isToday = targetDate.equals(today);

            for (int tIdx = 0; tIdx < theaters.size(); tIdx++) {
                TheaterSpec theater = theaters.get(tIdx);
                List<ScheduleSummaryDto> existing = scheduleService.listSchedules(
                        null, theater.id(), targetDate, null, null, 0, 100, List.of("startTime,asc")
                ).content();

                List<ScheduleWindow> windows = new ArrayList<>();
                for (ScheduleSummaryDto s : existing) {
                    windows.add(new ScheduleWindow(s.startTime(), s.endTime()));
                }

                List<LocalTime> times = new ArrayList<>(theater.standardTimes());

                if (isToday) {
                    boolean hasFarSlot = windows.stream().anyMatch(w -> w.startTime().isAfter(now.plusHours(2).plusMinutes(35)));
                    if (!hasFarSlot && now.getHour() < 21) {
                        OffsetDateTime candidateFar = now.plusHours(2).plusMinutes(45).truncatedTo(ChronoUnit.HOURS);
                        if (candidateFar.isBefore(now.plusHours(2).plusMinutes(35))) {
                            candidateFar = candidateFar.plusHours(1);
                        }
                        if (candidateFar.toLocalDate().equals(today)) {
                            times.add(candidateFar.toLocalTime());
                        }
                    }
                }

                times.sort(java.util.Comparator.naturalOrder());

                for (int slotIdx = 0; slotIdx < times.size(); slotIdx++) {
                    LocalTime time = times.get(slotIdx);
                    OffsetDateTime startTime = targetDate.atTime(time).atZone(zone).toOffsetDateTime();

                    if (isToday && !startTime.isAfter(now.plusMinutes(15))) {
                        continue;
                    }

                    int movieIndex = (dayOffset * 3 + tIdx * 3 + slotIdx) % movieIds.size();
                    Long movieId = movieIds.get(movieIndex);
                    int durationMinutes = movieService.getDurationMinutes(movieId);
                    OffsetDateTime endTime = startTime.plusMinutes(durationMinutes + bufferMinutes);

                    boolean collision = windows.stream().anyMatch(w ->
                            startTime.isBefore(w.endTime()) && endTime.isAfter(w.startTime())
                    );
                    if (collision) {
                        continue;
                    }

                    scheduleService.createSchedule(new CreateScheduleRequest(
                            movieId,
                            theater.id(),
                            startTime,
                            theater.basePrice(),
                            theater.vipPrice()
                    ));
                    windows.add(new ScheduleWindow(startTime, endTime));
                }
            }
        }
    }

    private record MovieSpec(
            String title,
            String description,
            String posterUrl,
            int durationMinutes,
            LocalDate releaseDate,
            List<String> genreNames
    ) {
    }

    private record TheaterSpec(
            Long id,
            String name,
            String location,
            int totalRows,
            int seatsPerRow,
            List<String> vipRows,
            BigDecimal basePrice,
            BigDecimal vipPrice,
            List<LocalTime> standardTimes
    ) {
        TheaterSpec withId(Long newId) {
            return new TheaterSpec(
                    newId, name, location, totalRows, seatsPerRow, vipRows, basePrice, vipPrice, standardTimes
            );
        }
    }
}
