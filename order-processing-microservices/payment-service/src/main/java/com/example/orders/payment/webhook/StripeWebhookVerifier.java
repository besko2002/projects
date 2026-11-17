package com.example.orders.payment.webhook;

import com.example.orders.support.error.BadRequestException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Turns a raw webhook delivery into a verified {@link StripeEvent}: first the signature, then the
 * JSON.
 *
 * <h2>Why the signature check is hand-rolled</h2>
 * The scheme is small and stable, and implementing it here (HMAC-SHA256 over
 * {@code "<timestamp>.<body>"}, constant-time compare, five-minute timestamp tolerance) keeps the
 * whole path testable without the network and without the SDK's event parsing. The webhook secret
 * is the only credential this class needs — the API secret key plays no part, which is also why
 * deliveries can be rejected cleanly even when payments themselves are disabled.
 *
 * <p>Every failure is a {@link BadRequestException} (rendered as a 400): a delivery this server
 * cannot authenticate must never change any state, and 400 — rather than 500 — is what keeps
 * Stripe retrying a delivery that will never be accepted.
 */
@Component
public class StripeWebhookVerifier {

    /** How far the signed timestamp may be from now, matching Stripe's own default. */
    static final Duration TOLERANCE = Duration.ofMinutes(5);

    /** Header Stripe signs every delivery with. */
    public static final String SIGNATURE_HEADER = "Stripe-Signature";

    private static final String ALGORITHM = "HmacSHA256";
    private static final String TIMESTAMP_KEY = "t";
    private static final String SIGNATURE_KEY = "v1";

    private static final Logger log = LoggerFactory.getLogger(StripeWebhookVerifier.class);

    private final String webhookSecret;
    private final ObjectMapper objectMapper;

    StripeWebhookVerifier(@Value("${payments.webhook-secret:}") String webhookSecret,
            ObjectMapper objectMapper) {
        this.webhookSecret = webhookSecret;
        this.objectMapper = objectMapper;
    }

    /** @return whether deliveries can be authenticated at all */
    public boolean isConfigured() {
        return webhookSecret != null && !webhookSecret.isBlank();
    }

    /**
     * Verifies a delivery and maps it to this service's event shape.
     *
     * @param payload         raw request body, byte for byte as it was received; any
     *                        re-serialisation would break the signature
     * @param signatureHeader value of the {@code Stripe-Signature} header
     * @return the verified event
     * @throws BadRequestException when no secret is configured, or the header is missing,
     *                             malformed, stale or does not match the payload, or the body is
     *                             not a readable event
     */
    public StripeEvent verifyAndParse(String payload, String signatureHeader) {
        verify(payload, signatureHeader);
        return parse(payload);
    }

    private void verify(String payload, String signatureHeader) {
        if (!isConfigured()) {
            log.warn("Rejected a webhook delivery: STRIPE_WEBHOOK_SECRET is not configured");
            throw new BadRequestException("Webhook deliveries cannot be verified: this server has "
                    + "no Stripe webhook secret configured");
        }
        if (payload == null || payload.isEmpty()) {
            throw new BadRequestException("Webhook delivery has an empty body");
        }
        if (signatureHeader == null || signatureHeader.isBlank()) {
            throw new BadRequestException("Missing Stripe-Signature header");
        }

        String timestamp = null;
        for (String part : signatureHeader.split(",")) {
            String key = keyOf(part);
            if (TIMESTAMP_KEY.equals(key)) {
                timestamp = valueOf(part);
            }
        }
        if (timestamp == null) {
            throw new BadRequestException("Malformed Stripe-Signature header: no timestamp");
        }
        requireFreshTimestamp(timestamp);

        String expected = hmacSha256Hex(timestamp + "." + payload);
        for (String part : signatureHeader.split(",")) {
            if (SIGNATURE_KEY.equals(keyOf(part))
                    && constantTimeEquals(expected, valueOf(part))) {
                return; // any one matching v1 signature authenticates the delivery
            }
        }
        log.warn("Rejected a webhook delivery whose signature does not match the payload");
        throw new BadRequestException("Invalid Stripe webhook signature");
    }

    private static void requireFreshTimestamp(String timestamp) {
        long seconds;
        try {
            seconds = Long.parseLong(timestamp);
        }
        catch (NumberFormatException ex) {
            throw new BadRequestException("Malformed Stripe-Signature header: unreadable timestamp");
        }
        Duration age = Duration.between(Instant.ofEpochSecond(seconds), Instant.now()).abs();
        if (age.compareTo(TOLERANCE) > 0) {
            log.warn("Rejected a webhook delivery signed {}s away from now", age.toSeconds());
            throw new BadRequestException("Stripe-Signature timestamp is outside the tolerance zone");
        }
    }

    private String hmacSha256Hex(String signedPayload) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(webhookSecret.getBytes(StandardCharsets.UTF_8), ALGORITHM));
            return HexFormat.of().formatHex(mac.doFinal(signedPayload.getBytes(StandardCharsets.UTF_8)));
        }
        catch (GeneralSecurityException ex) {
            // HmacSHA256 is mandatory on every JVM, and the key is a non-empty byte array here.
            throw new IllegalStateException("HMAC-SHA256 is unavailable", ex);
        }
    }

    private static boolean constantTimeEquals(String expected, String actual) {
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                actual.getBytes(StandardCharsets.UTF_8));
    }

    private static String keyOf(String part) {
        int separator = part.indexOf('=');
        return separator <= 0 ? "" : part.substring(0, separator).trim();
    }

    private static String valueOf(String part) {
        int separator = part.indexOf('=');
        return separator <= 0 ? "" : part.substring(separator + 1).trim();
    }

    /**
     * Reads the fields this service acts on out of the event JSON.
     *
     * @param payload the verified body
     * @return the event
     * @throws BadRequestException when the body is not JSON or carries no event id/type
     */
    private StripeEvent parse(String payload) {
        JsonNode root;
        try {
            root = objectMapper.readTree(payload);
        }
        catch (JsonProcessingException ex) {
            throw new BadRequestException("Unreadable Stripe webhook payload: not valid JSON");
        }
        String id = text(root, "id");
        String type = text(root, "type");
        if (id == null || type == null) {
            throw new BadRequestException("Unreadable Stripe webhook payload: no event id or type");
        }

        JsonNode object = root.path("data").path("object");
        String objectType = text(object, "object");
        String objectId = text(object, "id");

        String sessionId = "checkout.session".equals(objectType) || type.startsWith("checkout.session.")
                ? objectId
                : null;
        String paymentIntentId = "payment_intent".equals(objectType)
                ? objectId
                : text(object, "payment_intent");

        return new StripeEvent(
                id,
                type,
                sessionId,
                paymentIntentId,
                text(object.path("metadata"), "orderId"),
                text(object, "payment_status"),
                text(object, "status"),
                text(object.path("last_payment_error"), "message"),
                firstLongValue(object, "amount_total", "amount"),
                longValue(object, "amount_refunded"),
                text(object, "currency"));
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }

    private static Long longValue(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isIntegralNumber() && value.canConvertToLong() ? value.asLong() : null;
    }

    /**
     * Stripe names a checkout session's total {@code amount_total}, while a charge or a payment
     * intent's total is {@code amount} — the event only cares about "the total, in minor units",
     * whichever shape the payload uses. The first present field wins; absent everywhere means
     * absent (and the service then skips its comparison).
     */
    private static Long firstLongValue(JsonNode object, String... fields) {
        for (String field : fields) {
            Long value = longValue(object, field);
            if (value != null) {
                return value;
            }
        }
        return null;
    }
}
