package com.example.moviereservation.users;

import com.example.moviereservation.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class DemoEndpointsRemovedTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @WithMockUser
    void demoStatusEndpointIsRemovedAndAnswers404() throws Exception {
        mockMvc.perform(get("/api/demo/status"))
                .andExpect(status().isNotFound());
    }

    @Test
    @WithMockUser
    void demoSessionEndpointIsRemovedAndAnswers404() throws Exception {
        mockMvc.perform(post("/api/demo/session")
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound());
    }
}

