package com.example.moviereservation.users.email;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

@Component
public class ResendEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(ResendEmailSender.class);
    private static final String RESEND_API_URL = "https://api.resend.com/emails";

    private final String apiKey;
    private final String mailFrom;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    @org.springframework.beans.factory.annotation.Autowired
    public ResendEmailSender(@Value("${app.email.resend-api-key:}") String apiKey,
                             @Value("${app.email.mail-from:noreply@cinebook.local}") String mailFrom,
                             ObjectMapper objectMapper) {
        this(apiKey, mailFrom, objectMapper, HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build());
    }

    public ResendEmailSender(String apiKey,
                             String mailFrom,
                             ObjectMapper objectMapper,
                             HttpClient httpClient) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.mailFrom = (mailFrom == null || mailFrom.isBlank()) ? "noreply@cinebook.local" : mailFrom.trim();
        this.objectMapper = objectMapper;
        this.httpClient = httpClient;
    }

    @Override
    public boolean isConfigured() {
        if (apiKey.isBlank()) {
            return false;
        }
        if (mailFrom == null || mailFrom.isBlank()) {
            return false;
        }
        String address = mailFrom;
        int start = address.indexOf('<');
        int end = address.indexOf('>');
        if (start != -1 && end > start) {
            address = address.substring(start + 1, end);
        }
        String normalized = address.trim().toLowerCase(java.util.Locale.ROOT);
        if (normalized.equals("noreply@cinebook.local")
                || normalized.endsWith(".local")
                || !normalized.contains("@")
                || normalized.startsWith("@")
                || normalized.endsWith("@")) {
            return false;
        }
        String domain = normalized.substring(normalized.indexOf('@') + 1);
        return domain.contains(".") && !domain.endsWith(".local");
    }

    @Override
    public void sendPasswordReset(String toEmail, String resetLink) {
        if (!isConfigured()) {
            log.warn("Resend email sender is not configured; skipping password reset email to {}", toEmail);
            return;
        }

        String subject = "CineBook — Reset your password";
        String plainText = "Hello,\n\n"
                + "A password reset request was received for your CineBook account.\n"
                + "Please use the following link to choose a new password:\n"
                + resetLink + "\n\n"
                + "This link will expire in 30 minutes. If you did not request this, you can safely ignore this email.\n\n"
                + "— The CineBook Team";

        String html = "<!DOCTYPE html><html><body style=\"margin:0;padding:24px;background-color:#f3ead7;font-family:sans-serif;color:#221a14;\">"
                + "<div style=\"max-width:540px;margin:0 auto;background:#fff;border:2px solid #221a14;padding:32px;box-shadow:4px 4px 0 #221a14;\">"
                + "<h1 style=\"margin-top:0;font-size:24px;letter-spacing:1px;color:#b5302b;text-transform:uppercase;\">CineBook</h1>"
                + "<h2 style=\"margin:16px 0 8px 0;font-size:18px;\">Reset your password</h2>"
                + "<p style=\"font-size:14px;line-height:1.6;color:#55483c;\">"
                + "A password reset was requested for your CineBook account. Click the button below to set a new password:"
                + "</p>"
                + "<div style=\"margin:24px 0;\">"
                + "<a href=\"" + resetLink + "\" style=\"display:inline-block;background-color:#b5302b;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:4px;letter-spacing:0.5px;\">"
                + "Reset Password"
                + "</a>"
                + "</div>"
                + "<p style=\"font-size:13px;line-height:1.5;color:#857563;\">"
                + "This link is valid for 30 minutes. If you did not request a password reset, no action is needed."
                + "</p>"
                + "<hr style=\"border:none;border-top:1px solid #e0d7c5;margin:24px 0;\"/>"
                + "<p style=\"font-size:12px;color:#857563;margin:0;\">CineBook Classic Box Office</p>"
                + "</div></body></html>";

        dispatchEmail(toEmail, subject, plainText, html);
    }

    @Override
    public void sendPasswordChangedNotification(String toEmail) {
        if (!isConfigured()) {
            return;
        }

        String subject = "CineBook — Security notification: password updated";
        String plainText = "Hello,\n\n"
                + "Your CineBook account password was successfully updated.\n"
                + "All previous sessions have been signed out.\n\n"
                + "If you did not perform this change, please contact support immediately.\n\n"
                + "— The CineBook Team";

        String html = "<!DOCTYPE html><html><body style=\"margin:0;padding:24px;background-color:#f3ead7;font-family:sans-serif;color:#221a14;\">"
                + "<div style=\"max-width:540px;margin:0 auto;background:#fff;border:2px solid #221a14;padding:32px;box-shadow:4px 4px 0 #221a14;\">"
                + "<h1 style=\"margin-top:0;font-size:24px;letter-spacing:1px;color:#b5302b;text-transform:uppercase;\">CineBook</h1>"
                + "<h2 style=\"margin:16px 0 8px 0;font-size:18px;\">Security Notification</h2>"
                + "<p style=\"font-size:14px;line-height:1.6;color:#55483c;\">"
                + "Your CineBook password was successfully changed. All existing browser sessions have been invalidated."
                + "</p>"
                + "<p style=\"font-size:13px;line-height:1.5;color:#857563;\">"
                + "If you did not perform this change, please contact support immediately."
                + "</p>"
                + "</div></body></html>";

        dispatchEmail(toEmail, subject, plainText, html);
    }

    @Override
    public void sendPasswordReplacedByGoogleNotification(String toEmail) {
        if (!isConfigured()) {
            return;
        }

        String subject = "CineBook — Account linked with Google";
        String plainText = "Hello,\n\n"
                + "Your CineBook account was just linked with Google Sign-In.\n"
                + "For your security, your prior password was cleared and other active sessions were logged out.\n\n"
                + "You can now sign in directly with Google. If you ever need to set a password again, please use 'Forgot password' on the sign-in page.\n\n"
                + "— The CineBook Team";

        String html = "<!DOCTYPE html><html><body style=\"margin:0;padding:24px;background-color:#f3ead7;font-family:sans-serif;color:#221a14;\">"
                + "<div style=\"max-width:540px;margin:0 auto;background:#fff;border:2px solid #221a14;padding:32px;box-shadow:4px 4px 0 #221a14;\">"
                + "<h1 style=\"margin-top:0;font-size:24px;letter-spacing:1px;color:#b5302b;text-transform:uppercase;\">CineBook</h1>"
                + "<h2 style=\"margin:16px 0 8px 0;font-size:18px;\">Account Linked with Google</h2>"
                + "<p style=\"font-size:14px;line-height:1.6;color:#55483c;\">"
                + "Your CineBook account was linked with Google Sign-In. For security, your previous password was cleared and active sessions were signed out."
                + "</p>"
                + "<p style=\"font-size:13px;line-height:1.5;color:#857563;\">"
                + "You can now sign in directly with Google, or use 'Forgot password' anytime if you wish to set a new password."
                + "</p>"
                + "</div></body></html>";

        dispatchEmail(toEmail, subject, plainText, html);
    }

    private void dispatchEmail(String toEmail, String subject, String text, String html) {
        try {
            Map<String, Object> payload = Map.of(
                    "from", mailFrom,
                    "to", List.of(toEmail),
                    "subject", subject,
                    "text", text,
                    "html", html
            );
            String json = objectMapper.writeValueAsString(payload);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(RESEND_API_URL))
                    .timeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                log.info("Sent email to {} via Resend (status={})", toEmail, response.statusCode());
            } else {
                log.error("Failed to send email via Resend to {}: status={} body={}",
                        toEmail, response.statusCode(), response.body());
                throw new IllegalStateException("Resend rejected delivery with status " + response.statusCode() + ": " + response.body());
            }
        } catch (Exception ex) {
            log.error("Exception while sending email via Resend to {}: {}", toEmail, ex.getMessage());
            if (ex instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new RuntimeException("Resend email dispatch failed", ex);
        }
    }
}
