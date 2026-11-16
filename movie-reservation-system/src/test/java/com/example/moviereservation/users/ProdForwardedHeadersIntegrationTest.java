package com.example.moviereservation.users;

import com.example.moviereservation.TestcontainersConfiguration;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * CB-17: the auth rate limits must hold in the real {@code prod} profile, through real Tomcat
 * (MockMvc never runs Tomcat's {@code RemoteIpValve}, so it cannot prove the {@code native}
 * forward-headers strategy).
 *
 * <p>The test client always connects from 127.0.0.1, which the prod profile trusts by default as a
 * co-located reverse proxy (and nothing else: CB-31). A real proxy appends the peer it saw ({@code $proxy_add_x_forwarded_for}), so a
 * forged left-most {@code X-Forwarded-For} entry must never become the client address.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.jwt.secret=prod-profile-test-secret-6f0c1d2e3a4b5c6d7e8f9a0b1c2d3e4f",
        "app.admin.password=Prod-Profile-Admin-7!",
        "spring.datasource.password=not-the-demo-password"
})
@ActiveProfiles("prod")
@Import(TestcontainersConfiguration.class)
class ProdForwardedHeadersIntegrationTest {

    static final String PASSWORD = "Sup3rSecret!";

    private final HttpClient http = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private Environment environment;

    @Value("${app.admin.email}")
    private String adminEmail;

    @Test
    void forgedLeftMostForwardedForBehindTheTrustedProxyStillHitsTheLoginLimit() throws Exception {
        String email = register(port, http);
        String realClient = "198.51.100.7";
        for (int attempt = 0; attempt < 5; attempt++) {
            // A fresh forged address every time; the proxy appends the real client last.
            HttpResponse<String> failed = login(port, http, email, "WrongPassword1!",
                    "203.0.113." + attempt + ", " + realClient);
            assertThat(failed.statusCode()).isEqualTo(401);
        }
        HttpResponse<String> limited = login(port, http, email, PASSWORD, "203.0.113.99, " + realClient);
        assertThat(limited.statusCode()).isEqualTo(429);
    }

    @Test
    void forgedForwardedForFromAPrivateNetworkClientStillHitsTheLoginLimit() throws Exception {
        // CB-31: a client on a LAN/VPN/container network (10.0.0.9) goes through the co-located proxy,
        // which appends the address it saw. Private ranges are not trusted proxies by default, so
        // 10.0.0.9 is the client and the forged left-most entries never pick a fresh bucket.
        String email = register(port, http);
        for (int attempt = 0; attempt < 5; attempt++) {
            HttpResponse<String> failed = login(port, http, email, "WrongPassword1!",
                    "203.0.113." + attempt + ", 10.0.0.9");
            assertThat(failed.statusCode()).isEqualTo(401);
        }
        HttpResponse<String> limited = login(port, http, email, PASSWORD, "203.0.113.99, 10.0.0.9");
        assertThat(limited.statusCode()).isEqualTo(429);
    }

    @Test
    void trustedProxyPatternTrustsOnlyLoopbackByDefault() {
        String regex = environment.getProperty("server.tomcat.remoteip.internal-proxies");
        assertThat(environment.getProperty("server.forward-headers-strategy")).isEqualTo("native");
        assertThat(regex).isNotBlank();
        Pattern pattern = Pattern.compile(regex);
        for (String trusted : new String[]{"127.0.0.1", "127.1.2.3", "::1", "0:0:0:0:0:0:0:1"}) {
            assertThat(pattern.matcher(trusted).matches()).as("trusted %s", trusted).isTrue();
        }
        for (String untrusted : new String[]{"10.0.0.9", "10.1.2.3", "172.16.0.1", "172.17.0.1",
                "172.31.255.255", "192.168.1.10", "169.254.0.1", "203.0.113.5", "8.8.8.8",
                "1270.0.0.1", "127.0.0.1.evil", "fd00::1", "::ffff:10.0.0.9"}) {
            assertThat(pattern.matcher(untrusted).matches()).as("untrusted %s", untrusted).isFalse();
        }
    }

    @Test
    void forwardedHostCannotSteerTheLocationHeader() throws Exception {
        String token = token(login(port, http, adminEmail, "Prod-Profile-Admin-7!", null));
        String name = "Hall " + UUID.randomUUID().toString().substring(0, 8);
        HttpResponse<String> created = http.send(HttpRequest.newBuilder(uri(port, "/api/theaters"))
                        .header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + token)
                        .header("X-Forwarded-Host", "evil.example")
                        .header("X-Forwarded-Proto", "https")
                        .header("X-Forwarded-Port", "6666")
                        .header("Forwarded", "host=evil.example;proto=https")
                        .POST(HttpRequest.BodyPublishers.ofString("""
                                {"name":"%s","location":"Downtown","totalRows":2,"seatsPerRow":2,"vipRows":[]}"""
                                .formatted(name)))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(created.statusCode()).isEqualTo(201);
        String location = created.headers().firstValue("Location").orElseThrow();
        assertThat(URI.create(location).getHost()).isEqualTo("localhost");
        assertThat(location).doesNotContain("evil.example");
        assertThat(location).doesNotContain("6666");
    }

    private String token(HttpResponse<String> response) throws Exception {
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode body = objectMapper.readTree(response.body());
        return body.get("accessToken").asText();
    }

    // --- helpers -----------------------------------------------------------------------------

    static URI uri(int port, String path) {
        return URI.create("http://localhost:" + port + path);
    }

    static String register(int port, HttpClient client) throws Exception {
        String email = "fwd-" + UUID.randomUUID() + "@example.com";
        HttpResponse<String> response = client.send(HttpRequest.newBuilder(uri(port, "/api/auth/register"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("""
                                {"name":"Forwarded Test","email":"%s","password":"%s"}""".formatted(email, PASSWORD)))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(201);
        return email;
    }

    static HttpResponse<String> login(int port, HttpClient client, String email, String password,
                                      String forwardedFor) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(uri(port, "/api/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("""
                        {"email":"%s","password":"%s"}""".formatted(email, password)));
        if (forwardedFor != null) {
            request.header("X-Forwarded-For", forwardedFor);
        }
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
