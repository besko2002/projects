package com.example.moviereservation.users;

import com.example.moviereservation.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;

import static com.example.moviereservation.users.ProdForwardedHeadersIntegrationTest.PASSWORD;
import static com.example.moviereservation.users.ProdForwardedHeadersIntegrationTest.login;
import static com.example.moviereservation.users.ProdForwardedHeadersIntegrationTest.register;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * CB-17, direct-client case: the prod profile through real Tomcat, but the connecting peer is NOT a
 * trusted proxy (TRUSTED_PROXIES narrows the trusted range so 127.0.0.1 no longer matches). A client talking to
 * the app directly must not be able to choose its own rate-limit bucket with a forged header.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.jwt.secret=prod-profile-test-secret-6f0c1d2e3a4b5c6d7e8f9a0b1c2d3e4f",
        "app.admin.password=Prod-Profile-Admin-7!",
        "spring.datasource.password=not-the-demo-password",
        "TRUSTED_PROXIES=10\\.255\\.255\\.254"
})
@ActiveProfiles("prod")
@Import(TestcontainersConfiguration.class)
class ProdForwardedHeadersUntrustedPeerIntegrationTest {

    private final HttpClient http = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @Test
    void forgedForwardedForFromAnUntrustedPeerIsIgnored() throws Exception {
        String email = register(port, http);
        for (int attempt = 0; attempt < 5; attempt++) {
            // A fresh forged address on every attempt.
            HttpResponse<String> failed = login(port, http, email, "WrongPassword1!", "203.0.113." + attempt);
            assertThat(failed.statusCode()).isEqualTo(401);
        }
        HttpResponse<String> limited = login(port, http, email, PASSWORD, "203.0.113.99");
        assertThat(limited.statusCode()).isEqualTo(429);
    }
}
