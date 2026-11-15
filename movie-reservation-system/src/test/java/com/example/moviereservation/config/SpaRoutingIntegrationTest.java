package com.example.moviereservation.config;

import com.example.moviereservation.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class SpaRoutingIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void rootAndClientSideSpaRoutesForwardToIndexHtml() throws Exception {
        mockMvc.perform(get("/"))
                .andExpect(forwardedUrl("/index.html"));

        mockMvc.perform(get("/movies"))
                .andExpect(forwardedUrl("/index.html"));

        mockMvc.perform(get("/movies/42"))
                .andExpect(forwardedUrl("/index.html"));

        mockMvc.perform(get("/admin/schedules"))
                .andExpect(forwardedUrl("/index.html"));
    }

    @Test
    void pathsWithPrefixMatchingExcludedWordsForwardCorrectly() throws Exception {
        // /apix and /assets-foo must not be blocked by prefix matching of api or assets
        mockMvc.perform(get("/apix"))
                .andExpect(forwardedUrl("/index.html"));

        mockMvc.perform(get("/assets-foo"))
                .andExpect(forwardedUrl("/index.html"));
    }

    @Test
    void apiAndActuatorPathsAreNotForwardedToSpa() throws Exception {
        // Unmapped /api paths should not forward to index.html
        mockMvc.perform(get("/api"))
                .andExpect(status().is4xxClientError());

        mockMvc.perform(get("/api/non-existent-endpoint"))
                .andExpect(status().is4xxClientError());
    }

    @Test
    void publicActuatorHealthIsAccessible() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
    }
}
