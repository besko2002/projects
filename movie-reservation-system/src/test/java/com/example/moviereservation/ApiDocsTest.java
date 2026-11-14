package com.example.moviereservation;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** springdoc must stay compatible with the Spring Boot version: the API docs and Swagger UI load. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ApiDocsTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void openApiDocumentIsServed() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.info.title").value("Movie Reservation System API"))
                .andExpect(jsonPath("$.paths['/api/movies']").exists())
                .andExpect(jsonPath("$.paths['/api/auth/register'].post.security").isEmpty())
                .andExpect(jsonPath("$.paths['/api/auth/login'].post.security").isEmpty())
                .andExpect(jsonPath("$.paths['/api/auth/logout'].post.security").doesNotExist())
                .andExpect(jsonPath("$.paths['/api/auth/logout'].post.responses['204']").exists())
                .andExpect(jsonPath("$.paths['/api/auth/logout'].post.responses['401']").exists());
    }

    @Test
    void swaggerUiIsServed() throws Exception {
        mockMvc.perform(get("/swagger-ui/index.html"))
                .andExpect(status().isOk());
    }
}
