package com.example.moviereservation.tickets;

import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.util.StreamUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Public, non-sensitive landing pages for Stripe's browser redirect. Webhooks determine payment state. */
@RestController
public class PaymentReturnController {

    private String getSpaPageWithFallback(String markerHtml) {
        try {
            ClassPathResource indexResource = new ClassPathResource("static/index.html");
            if (indexResource.exists()) {
                String indexHtml = StreamUtils.copyToString(indexResource.getInputStream(), StandardCharsets.UTF_8);
                if (indexHtml.contains("</body>")) {
                    return indexHtml.replace("</body>", "<noscript>" + markerHtml + "</noscript></body>");
                }
                return indexHtml + "<noscript>" + markerHtml + "</noscript>";
            }
        } catch (IOException ignored) {
            // Fall back to plain marker HTML
        }
        return markerHtml;
    }

    @GetMapping(value = "/payment/success", produces = MediaType.TEXT_HTML_VALUE)
    public String success() {
        return getSpaPageWithFallback("<h1>Payment submitted</h1><p>Return to the app to see your ticket status.</p>");
    }

    @GetMapping(value = "/payment/cancel", produces = MediaType.TEXT_HTML_VALUE)
    public String cancel() {
        return getSpaPageWithFallback("<h1>Payment cancelled</h1><p>Return to the app to manage your ticket.</p>");
    }
}
