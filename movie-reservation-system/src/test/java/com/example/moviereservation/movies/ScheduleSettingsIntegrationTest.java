package com.example.moviereservation.movies;

import com.example.moviereservation.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * CB-29: the admin UI must plan showtimes in the cinema's zone, not the admin's browser zone, so
 * the configured business zone is published (anonymously readable, like the schedules themselves).
 */
@SpringBootTest(properties = {"app.schedule.zone=Africa/Cairo", "app.schedule.buffer-minutes=20"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ScheduleSettingsIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void cinemaZoneAndBufferArePublishedToAnonymousClients() throws Exception {
        mockMvc.perform(get("/api/schedules/settings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.zone").value("Africa/Cairo"))
                .andExpect(jsonPath("$.bufferMinutes").value(20));
    }
}
