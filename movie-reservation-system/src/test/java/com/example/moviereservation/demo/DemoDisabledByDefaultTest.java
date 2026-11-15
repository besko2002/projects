package com.example.moviereservation.demo;

import com.example.moviereservation.TestcontainersConfiguration;
import com.example.moviereservation.movies.MovieService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class DemoDisabledByDefaultTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DemoProperties demoProperties;

    @Autowired
    private MovieService movieService;

    @Test
    void demoIsDisabledByDefault() throws Exception {
        assertThat(demoProperties.isEnabled()).isFalse();

        mockMvc.perform(get("/api/demo/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false));

        mockMvc.perform(post("/api/demo/session"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.message").value("Demo mode is disabled"));

        // Seeder must not run when disabled
        assertThat(movieService.listMovies(null, null, 0, 100, List.of("id,asc")).content())
                .extracting("title")
                .doesNotContain("Ember Road", "The Neon Alchemist", "Tidewatch");
    }
}
