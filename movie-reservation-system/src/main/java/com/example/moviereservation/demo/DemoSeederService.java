package com.example.moviereservation.demo;

import com.example.moviereservation.common.BadRequestException;
import com.example.moviereservation.common.ConflictException;
import com.example.moviereservation.movies.CreateMovieRequest;
import com.example.moviereservation.movies.CreateScheduleRequest;
import com.example.moviereservation.movies.GenreDto;
import com.example.moviereservation.movies.GenreRequest;
import com.example.moviereservation.movies.GenreService;
import com.example.moviereservation.movies.MovieDto;
import com.example.moviereservation.movies.MovieService;
import com.example.moviereservation.movies.MovieSummaryDto;
import com.example.moviereservation.movies.ScheduleService;
import com.example.moviereservation.movies.ScheduleSummaryDto;
import com.example.moviereservation.theaters.CreateTheaterRequest;
import com.example.moviereservation.theaters.TheaterDto;
import com.example.moviereservation.theaters.TheaterService;
import com.example.moviereservation.theaters.TheaterSummaryDto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

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
 * Idempotent demo seeder that populates a realistic cinema catalogue and rolling
 * upcoming showtimes across the next 7 days when {@code app.demo.enabled=true}.
 */
@Service
public class DemoSeederService {

    private static final Logger log = LoggerFactory.getLogger(DemoSeederService.class);

    private final DemoProperties demoProperties;
    private final MovieService movieService;
    private final GenreService genreService;
    private final TheaterService theaterService;
    private final ScheduleService scheduleService;

    public DemoSeederService(DemoProperties demoProperties,
                             MovieService movieService,
                             GenreService genreService,
                             TheaterService theaterService,
                             ScheduleService scheduleService) {
        this.demoProperties = demoProperties;
        this.movieService = movieService;
        this.genreService = genreService;
        this.theaterService = theaterService;
        this.scheduleService = scheduleService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        if (!demoProperties.isEnabled()) {
            return;
        }
        log.info("Demo mode enabled; running initial catalogue and schedule seeder");
        seed();
    }

    @Scheduled(fixedDelayString = "${app.demo.replenish-delay-ms:3600000}", initialDelay = 3600000)
    public void replenishSchedules() {
        if (!demoProperties.isEnabled()) {
            return;
        }
        log.info("Running periodic demo schedule replenishment");
        seed();
    }

    public synchronized void seed() {
        if (!demoProperties.isEnabled()) {
            return;
        }
        Map<String, Long> genreMap = ensureGenres();
        List<Long> movieIds = ensureMovies(genreMap);
        List<DemoTheaterSpec> theaters = ensureTheaters();
        ensureSchedules(movieIds, theaters);
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
                    // Refetch if created concurrently
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

        List<DemoMovieSpec> specs = List.of(
                new DemoMovieSpec(
                        "Ember Road",
                        "A veteran courier undertakes one last perilous journey across scorched badlands to deliver a secret package that could end a decade-long conflict.",
                        "/posters/ember-road.svg",
                        125,
                        LocalDate.of(2026, 10, 14),
                        List.of("action", "adventure")
                ),
                new DemoMovieSpec(
                        "Tidewatch",
                        "In an isolated coastal observatory, a solitary oceanographer detects an anomalous subsonic signal echoing from the deepest oceanic trench on Earth.",
                        "/posters/tidewatch.svg",
                        118,
                        LocalDate.of(2026, 9, 22),
                        List.of("sci-fi", "drama")
                ),
                new DemoMovieSpec(
                        "The Neon Alchemist",
                        "In a sprawling rain-drenched cyberpunk metropolis, a renegade biochemist races against powerful synth-corps to synthesize a cure for the city's terminal neural plague.",
                        "/posters/neon-alchemist.svg",
                        134,
                        LocalDate.of(2026, 11, 1),
                        List.of("sci-fi", "thriller")
                ),
                new DemoMovieSpec(
                        "Starlight Express",
                        "A wondrous retro-futuristic locomotive embarks on a whimsical voyage through uncharted planetary systems, carrying an eccentric crew and mysterious passengers.",
                        "/posters/starlight-express.svg",
                        102,
                        LocalDate.of(2026, 8, 15),
                        List.of("adventure", "family")
                ),
                new DemoMovieSpec(
                        "Shadows in the Fog",
                        "In 1948 London, a private investigator untangles a web of deceit, counterfeit stamps, and stolen art beneath the shroud of the Great Smog.",
                        "/posters/shadows-fog.svg",
                        115,
                        LocalDate.of(2026, 10, 5),
                        List.of("mystery", "crime")
                ),
                new DemoMovieSpec(
                        "Solaris Drift",
                        "When an experimental deep-space colony vessel slips off its planned orbital trajectory, the remaining skeleton crew must confront psychological dread and cosmic silence.",
                        "/posters/solaris-drift.svg",
                        140,
                        LocalDate.of(2026, 10, 28),
                        List.of("sci-fi", "drama")
                ),
                new DemoMovieSpec(
                        "Whispers of the Forest",
                        "A cartographer mapping forgotten ancient woodlands discovers a secluded sanctuary where mythical guardian spirits guard memories of ancient epochs.",
                        "/posters/whispers-forest.svg",
                        110,
                        LocalDate.of(2026, 7, 20),
                        List.of("fantasy", "mystery")
                ),
                new DemoMovieSpec(
                        "Midnight Encore",
                        "An aging jazz saxophonist gets an unexpected opportunity to play one unforgettable midnight concert at the legendary Blue Room that made him famous.",
                        "/posters/midnight-encore.svg",
                        108,
                        LocalDate.of(2026, 6, 11),
                        List.of("drama", "music")
                ),
                new DemoMovieSpec(
                        "The Clockwork Heist",
                        "A master clockmaker and a ragtag crew of illusionists conspire to liberate an invaluable astronomical chronometer from the fortress-like Royal Vault.",
                        "/posters/clockwork-heist.svg",
                        122,
                        LocalDate.of(2026, 9, 2),
                        List.of("thriller", "action")
                ),
                new DemoMovieSpec(
                        "Apex Horizon",
                        "Test pilots pushing hypersonic atmospheric boundaries in prototype aircraft uncover an unexplainable gravitational anomaly suspended above the poles.",
                        "/posters/apex-horizon.svg",
                        130,
                        LocalDate.of(2026, 11, 10),
                        List.of("action", "sci-fi")
                )
        );

        List<Long> movieIds = new ArrayList<>();
        for (DemoMovieSpec spec : specs) {
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

    private List<DemoTheaterSpec> ensureTheaters() {
        Map<String, Long> existingTheaters = new HashMap<>();
        for (TheaterSummaryDto t : theaterService.listTheaters(0, 100, List.of("id,asc")).content()) {
            existingTheaters.put(t.name().toLowerCase(Locale.ROOT), t.id());
        }

        List<DemoTheaterSpec> specs = List.of(
                new DemoTheaterSpec(
                        null,
                        "Grand Vintage Hall",
                        "Main Screening Room, Level 1",
                        6, 10,
                        List.of("E", "F"),
                        new BigDecimal("14.00"),
                        new BigDecimal("20.00"),
                        List.of(LocalTime.of(13, 0), LocalTime.of(16, 30), LocalTime.of(20, 0))
                ),
                new DemoTheaterSpec(
                        null,
                        "Retro Cinema 2",
                        "Auditorium 2, Level 2",
                        5, 8,
                        List.of("D", "E"),
                        new BigDecimal("12.50"),
                        new BigDecimal("18.00"),
                        List.of(LocalTime.of(13, 30), LocalTime.of(17, 0), LocalTime.of(20, 30))
                ),
                new DemoTheaterSpec(
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

        List<DemoTheaterSpec> result = new ArrayList<>();
        for (DemoTheaterSpec spec : specs) {
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

    private void ensureSchedules(List<Long> movieIds, List<DemoTheaterSpec> theaters) {
        ZoneId zone = scheduleService.getZone();
        LocalDate today = LocalDate.now(zone);
        OffsetDateTime now = OffsetDateTime.now(zone);
        int bufferMinutes = scheduleService.getBufferMinutes();

        for (int dayOffset = 0; dayOffset < 7; dayOffset++) {
            LocalDate targetDate = today.plusDays(dayOffset);
            boolean isToday = targetDate.equals(today);

            for (int tIdx = 0; tIdx < theaters.size(); tIdx++) {
                DemoTheaterSpec theater = theaters.get(tIdx);
                List<ScheduleSummaryDto> existing = scheduleService.listSchedules(
                        null, theater.id(), targetDate, null, null, 0, 100, List.of("startTime,asc")
                ).content();

                List<LocalTime> times = new ArrayList<>(theater.standardTimes());

                // If today, ensure we also have an evening/late slot sufficiently far ahead (>= 2.5h)
                // for full refund testing if standard slots don't cover it.
                if (isToday) {
                    boolean hasFarSlot = existing.stream().anyMatch(s -> s.startTime().isAfter(now.plusHours(2).plusMinutes(35)));
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

                for (int slotIdx = 0; slotIdx < times.size(); slotIdx++) {
                    LocalTime time = times.get(slotIdx);
                    OffsetDateTime startTime = targetDate.atTime(time).atZone(zone).toOffsetDateTime();

                    // If today, skip any slot that is already in the past or starts too soon (< 15 mins)
                    if (isToday && !startTime.isAfter(now.plusMinutes(15))) {
                        continue;
                    }

                    int movieIndex = (dayOffset * 3 + tIdx * 3 + slotIdx) % movieIds.size();
                    Long movieId = movieIds.get(movieIndex);
                    int durationMinutes = movieService.getDurationMinutes(movieId);
                    OffsetDateTime endTime = startTime.plusMinutes(durationMinutes + bufferMinutes);

                    // Check for collision with existing schedules in this theater on this date
                    boolean collision = existing.stream().anyMatch(s ->
                            startTime.isBefore(s.endTime()) && endTime.isAfter(s.startTime())
                    );
                    if (collision) {
                        continue;
                    }

                    try {
                        scheduleService.createSchedule(new CreateScheduleRequest(
                                movieId,
                                theater.id(),
                                startTime,
                                theater.basePrice(),
                                theater.vipPrice()
                        ));
                    } catch (ConflictException | BadRequestException ex) {
                        log.debug("Skipping schedule create collision: {}", ex.getMessage());
                    }
                }
            }
        }
    }

    private record DemoMovieSpec(
            String title,
            String description,
            String posterUrl,
            int durationMinutes,
            LocalDate releaseDate,
            List<String> genreNames
    ) {
    }

    private record DemoTheaterSpec(
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
        DemoTheaterSpec withId(Long newId) {
            return new DemoTheaterSpec(
                    newId, name, location, totalRows, seatsPerRow, vipRows, basePrice, vipPrice, standardTimes
            );
        }
    }
}
