package com.example.orders.payment.webhook;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Stripe webhook endpoint: where the verdicts of real payments actually arrive.
 *
 * <p>A hosted checkout is finished on Stripe's pages, not on this API, so nothing but this
 * endpoint can tell the system that a customer paid. It is therefore public (both the gateway and
 * this service permit it without a token) and its authentication is the {@code Stripe-Signature}
 * header, verified by {@link StripeWebhookVerifier} — never a JWT.
 *
 * <h2>Raw body</h2>
 * The parameter is a {@link String} annotated with {@link RequestBody}, which makes Spring use the
 * plain string converter: the body arrives byte for byte as Stripe sent it. That is essential,
 * because the signature is an HMAC over {@code "<timestamp>.<body>"} — had the body been bound to
 * an object first, Jackson would have re-serialised it (key order, spacing, number formatting) and
 * every genuine signature would fail. The JSON is parsed only <strong>after</strong> the signature
 * was accepted. {@code consumes = ALL_VALUE} because a replay tool may send any content type; it
 * plays no part in verification.
 *
 * <h2>Status codes</h2>
 * <ul>
 *   <li><strong>400</strong> — missing, malformed, stale or wrong signature, or an unreadable
 *       body. No state changes. Stripe marks the delivery as failed, which is what should happen
 *       to a delivery this server cannot authenticate.</li>
 *   <li><strong>200</strong> — the delivery was genuine, whether or not it changed anything:
 *       events this service does not act on, redeliveries, events for payments it does not know.
 *       Anything else would make Stripe retry a delivery that will never succeed.</li>
 * </ul>
 * Unhandled exceptions surface as 500 through the shared error handling, so a genuine bug makes
 * Stripe retry the delivery later.
 */
@RestController
@RequestMapping("/api/payments/stripe")
class StripeWebhookController {

    private static final Logger log = LoggerFactory.getLogger(StripeWebhookController.class);

    private final StripeWebhookVerifier verifier;
    private final StripeWebhookService service;

    StripeWebhookController(StripeWebhookVerifier verifier, StripeWebhookService service) {
        this.verifier = verifier;
        this.service = service;
    }

    /**
     * @param payload   raw delivery body
     * @param signature the {@code Stripe-Signature} header
     * @return what the delivery caused, e.g. {@code APPLIED}, {@code DUPLICATE}
     */
    @PostMapping(value = "/webhook", consumes = MediaType.ALL_VALUE)
    public Map<String, Object> receive(
            @RequestBody(required = false) String payload,
            @RequestHeader(value = StripeWebhookVerifier.SIGNATURE_HEADER, required = false)
            String signature) {
        // required = false on both: a missing body or header is this endpoint's own 400 with the
        // shared error body, not a framework error page.
        StripeEvent event = verifier.verifyAndParse(payload, signature);
        log.info("Verified Stripe event {} of type {}", event.eventId(), event.type());
        String result = service.apply(event);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("received", true);
        body.put("eventId", event.eventId());
        body.put("type", event.type());
        body.put("result", result);
        return body;
    }
}
