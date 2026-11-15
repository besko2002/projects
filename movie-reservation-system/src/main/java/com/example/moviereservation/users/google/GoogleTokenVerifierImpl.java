package com.example.moviereservation.users.google;

import com.example.moviereservation.common.BadRequestException;
import com.example.moviereservation.common.ServiceUnavailableException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

@Component
public class GoogleTokenVerifierImpl implements GoogleTokenVerifier {

    private static final Logger log = LoggerFactory.getLogger(GoogleTokenVerifierImpl.class);
    private static final String GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
    private static final Set<String> VALID_ISSUERS = Set.of(
            "https://accounts.google.com",
            "accounts.google.com"
    );

    private final String clientId;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final HttpClient httpClient;
    private Function<String, PublicKey> keyProvider;
    private final AtomicReference<Map<String, PublicKey>> publicKeysRef = new AtomicReference<>(Map.of());
    private final AtomicLong certsCachedAt = new AtomicLong(0);
    private final AtomicBoolean isRefreshing = new AtomicBoolean(false);

    @org.springframework.beans.factory.annotation.Autowired
    public GoogleTokenVerifierImpl(@Value("${app.google.client-id:}") String clientId,
                                   ObjectMapper objectMapper) {
        this(clientId, objectMapper, Clock.systemUTC(), null, HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build());
    }

    public GoogleTokenVerifierImpl(String clientId,
                                   ObjectMapper objectMapper,
                                   Clock clock,
                                   Function<String, PublicKey> keyProvider) {
        this(clientId, objectMapper, clock, keyProvider, HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build());
    }

    public GoogleTokenVerifierImpl(String clientId,
                                   ObjectMapper objectMapper,
                                   Clock clock,
                                   Function<String, PublicKey> keyProvider,
                                   HttpClient httpClient) {
        this.clientId = clientId == null ? "" : clientId.trim();
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.keyProvider = keyProvider;
        this.httpClient = httpClient;
    }

    // Visible for testing within package (or via test hook helper)
    void setTestKeyProvider(Function<String, PublicKey> keyProvider) {
        this.keyProvider = keyProvider;
    }

    @Override
    public boolean isConfigured() {
        return !clientId.isBlank();
    }

    @Override
    public String getClientId() {
        return clientId;
    }

    @Override
    public GoogleTokenPayload verify(String idToken) {
        if (!isConfigured()) {
            throw new ServiceUnavailableException("Google sign-in is not configured");
        }

        if (idToken == null || idToken.isBlank()) {
            throw new BadCredentialsException("Missing Google ID token");
        }

        String[] parts = idToken.split("\\.");
        if (parts.length != 3) {
            throw new BadCredentialsException("Malformed Google ID token");
        }

        JsonNode headerNode;
        JsonNode payloadNode;
        byte[] signatureBytes;

        try {
            headerNode = objectMapper.readTree(Base64.getUrlDecoder().decode(parts[0]));
            payloadNode = objectMapper.readTree(Base64.getUrlDecoder().decode(parts[1]));
            signatureBytes = Base64.getUrlDecoder().decode(parts[2]);
        } catch (Exception ex) {
            throw new BadCredentialsException("Malformed Google ID token encoding: " + ex.getMessage());
        }

        String alg = headerNode.path("alg").asText("");
        if (!"RS256".equals(alg)) {
            throw new BadCredentialsException("Unsupported token algorithm: " + alg);
        }

        String kid = headerNode.path("kid").asText("");
        PublicKey publicKey = resolvePublicKey(kid);
        if (publicKey == null) {
            log.warn("resolvePublicKey returned null for kid={}", kid);
            throw new BadCredentialsException("Unable to resolve Google public key for kid=" + kid);
        }

        // Verify cryptographic RSA signature
        try {
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(publicKey);
            sig.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            if (!sig.verify(signatureBytes)) {
                log.warn("sig.verify failed for token");
                throw new BadCredentialsException("Invalid Google ID token signature");
            }
        } catch (BadCredentialsException ex) {
            throw ex;
        } catch (Exception ex) {
            log.warn("sig exception: {}", ex.getMessage());
            throw new BadCredentialsException("Failed to verify token signature: " + ex.getMessage());
        }

        // Verify standard claims
        String iss = payloadNode.path("iss").asText("");
        if (!VALID_ISSUERS.contains(iss)) {
            log.warn("Invalid issuer: {}", iss);
            throw new BadCredentialsException("Google ID token issuer is invalid: " + iss);
        }

        JsonNode audNode = payloadNode.path("aud");
        boolean audMatch = false;
        if (audNode.isTextual()) {
            audMatch = clientId.equals(audNode.asText());
        } else if (audNode.isArray()) {
            for (JsonNode item : audNode) {
                if (clientId.equals(item.asText())) {
                    audMatch = true;
                    break;
                }
            }
        }
        if (!audMatch) {
            log.warn("Audience mismatch: expected={}, actual={}", clientId, audNode);
            throw new BadCredentialsException("Google ID token audience does not match configured client ID");
        }

        long exp = payloadNode.path("exp").asLong(0);
        long nowSeconds = clock.millis() / 1000;
        if (exp <= nowSeconds) {
            throw new BadCredentialsException("Google ID token has expired");
        }

        boolean emailVerified = payloadNode.path("email_verified").asBoolean(false);
        if (!emailVerified) {
            throw new BadRequestException("Google email is not verified");
        }

        String sub = payloadNode.path("sub").asText("");
        if (sub.isBlank()) {
            throw new BadCredentialsException("Google ID token missing subject ID");
        }

        String email = payloadNode.path("email").asText("");
        if (email.isBlank()) {
            throw new BadCredentialsException("Google ID token missing email");
        }

        String name = payloadNode.path("name").asText(null);

        return new GoogleTokenPayload(sub, email, name, emailVerified);
    }

    private PublicKey resolvePublicKey(String kid) {
        if (keyProvider != null) {
            return keyProvider.apply(kid);
        }

        Map<String, PublicKey> currentKeys = publicKeysRef.get();
        long now = clock.millis();
        if (currentKeys.containsKey(kid) && (now - certsCachedAt.get() < 3600_000)) {
            return currentKeys.get(kid);
        }

        refreshGooglePublicKeys();
        return publicKeysRef.get().get(kid);
    }

    private void refreshGooglePublicKeys() {
        long now = clock.millis();
        if (now - certsCachedAt.get() < 60_000 && !publicKeysRef.get().isEmpty()) {
            return;
        }

        // Concurrency guard: avoid multiple simultaneous HTTP fetches without blocking other threads
        if (!isRefreshing.compareAndSet(false, true)) {
            return;
        }

        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(GOOGLE_CERTS_URL))
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();

            HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                try (InputStream in = response.body()) {
                    JsonNode root = objectMapper.readTree(in);
                    JsonNode keys = root.path("keys");
                    if (keys.isArray()) {
                        Map<String, PublicKey> newKeys = new ConcurrentHashMap<>();
                        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
                        for (JsonNode keyNode : keys) {
                            String kid = keyNode.path("kid").asText();
                            String nStr = keyNode.path("n").asText();
                            String eStr = keyNode.path("e").asText();
                            if (!kid.isEmpty() && !nStr.isEmpty() && !eStr.isEmpty()) {
                                BigInteger modulus = new BigInteger(1, Base64.getUrlDecoder().decode(nStr));
                                BigInteger exponent = new BigInteger(1, Base64.getUrlDecoder().decode(eStr));
                                PublicKey key = keyFactory.generatePublic(new RSAPublicKeySpec(modulus, exponent));
                                newKeys.put(kid, key);
                            }
                        }
                        publicKeysRef.set(Map.copyOf(newKeys));
                        certsCachedAt.set(now);
                        log.info("Refreshed Google public certificates: {} keys cached", newKeys.size());
                    }
                }
            } else {
                log.warn("Failed to fetch Google public certs: status={}", response.statusCode());
            }
        } catch (Exception ex) {
            log.warn("Failed to fetch Google public certs: {}", ex.getMessage());
        } finally {
            isRefreshing.set(false);
        }
    }
}
