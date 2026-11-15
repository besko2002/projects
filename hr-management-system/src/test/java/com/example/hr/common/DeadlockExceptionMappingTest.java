package com.example.hr.common;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.support.SQLStateSQLExceptionTranslator;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.sql.SQLException;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DeadlockExceptionMappingTest {
    @Test
    void postgresDeadlockSqlStateIsTranslatedToRetryableHttp409() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new DeadlockController())
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        mvc.perform(get("/deadlock"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("status").value(409))
                .andExpect(jsonPath("message").value("A concurrent update locked this record; please retry"));
    }

    @RestController
    static class DeadlockController {
        @GetMapping("/deadlock")
        void deadlock() {
            throw new SQLStateSQLExceptionTranslator().translate("insert", "test SQL",
                    new SQLException("deadlock detected", "40P01"));
        }
    }
}
