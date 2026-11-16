package com.example.moviereservation.users;

import com.example.moviereservation.users.email.ResendEmailSender;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ResendEmailSenderTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void unconfiguredWhenApiKeyIsBlank() {
        ResendEmailSender sender = new ResendEmailSender("", "onboarding@resend.dev", objectMapper);
        assertThat(sender.isConfigured()).isFalse();
    }

    @Test
    void unconfiguredWhenMailFromIsDefaultPlaceholder() {
        ResendEmailSender sender = new ResendEmailSender("re_test_123", "noreply@cinebook.local", objectMapper);
        assertThat(sender.isConfigured()).isFalse();
    }

    @Test
    void unconfiguredWhenMailFromEndsWithLocalDomain() {
        ResendEmailSender sender = new ResendEmailSender("re_test_123", "tickets@theatre.local", objectMapper);
        assertThat(sender.isConfigured()).isFalse();
    }

    @Test
    void unconfiguredWhenMailFromHasDisplayNameWithLocalDomain() {
        ResendEmailSender sender = new ResendEmailSender("re_test_123", "CineBook <noreply@cinebook.local>", objectMapper);
        assertThat(sender.isConfigured()).isFalse();

        ResendEmailSender customLocal = new ResendEmailSender("re_test_123", "Support <tickets@theatre.local>", objectMapper);
        assertThat(customLocal.isConfigured()).isFalse();
    }

    @Test
    void configuredWhenMailFromHasDisplayNameWithValidDomain() {
        ResendEmailSender sender = new ResendEmailSender("re_test_123", "CineBook <onboarding@resend.dev>", objectMapper);
        assertThat(sender.isConfigured()).isTrue();

        ResendEmailSender custom = new ResendEmailSender("re_test_123", "CineBook Box Office <tickets@cinebook.com>", objectMapper);
        assertThat(custom.isConfigured()).isTrue();
    }

    @Test
    void configuredWhenApiKeyAndValidSenderDomainProvided() {
        ResendEmailSender sender = new ResendEmailSender("re_test_123", "onboarding@resend.dev", objectMapper);
        assertThat(sender.isConfigured()).isTrue();

        ResendEmailSender customDomain = new ResendEmailSender("re_test_123", "support@cinebook.com", objectMapper);
        assertThat(customDomain.isConfigured()).isTrue();
    }

    @Test
    void malformedMailFromIsNeverConfigured() {
        // CB-36: "Name <a@b.com" (no closing bracket) and similar values used to pass.
        for (String from : new String[]{
                "CineBook <onboarding@resend.dev",
                "onboarding@resend.dev>",
                "<onboarding@resend.dev",
                "CineBook <onboarding@resend.dev> extra",
                "CineBook <<onboarding@resend.dev>>",
                "Cine<Book <onboarding@resend.dev>",
                "onboarding@resend.dev, other@resend.dev",
                "a@b@resend.dev",
                "on boarding@resend.dev",
                "onboarding@resend.dev\r\nBcc: x@evil.example",
                "CineBook\n <onboarding@resend.dev>",
                "onboarding@.resend.dev",
                "onboarding@resend..dev",
                "onboarding@-resend.dev",
                "onboarding@resend.d",
                "CineBook <>",
                "CineBook"}) {
            ResendEmailSender sender = new ResendEmailSender("re_test_123", from, objectMapper);
            assertThat(sender.isConfigured()).as("MAIL_FROM %s", from).isFalse();
        }
    }

    @Test
    void wellFormedMailFromIsConfigured() {
        for (String from : new String[]{
                "onboarding@resend.dev",
                "CineBook <onboarding@resend.dev>",
                "CineBook Box Office <tickets@cine-book.co.uk>",
                "\"CineBook, Box Office\" <tickets@cinebook.com>",
                "<tickets@cinebook.com>",
                "first.last+tag@mail.cinebook.com"}) {
            ResendEmailSender sender = new ResendEmailSender("re_test_123", from, objectMapper);
            assertThat(sender.isConfigured()).as("MAIL_FROM %s", from).isTrue();
        }
    }

    @Test
    void throwsWhenResendApiReturnsNon2xxStatus() throws IOException, InterruptedException {
        HttpClient mockClient = mock(HttpClient.class);
        @SuppressWarnings("unchecked")
        HttpResponse<String> mockResponse = mock(HttpResponse.class);
        when(mockResponse.statusCode()).thenReturn(403);
        when(mockResponse.body()).thenReturn("{\"message\":\"domain not verified\"}");
        org.mockito.Mockito.doReturn(mockResponse).when(mockClient).send(any(HttpRequest.class), any());

        ResendEmailSender sender = new ResendEmailSender("re_test_123", "onboarding@resend.dev", objectMapper, mockClient);

        assertThatThrownBy(() -> sender.sendPasswordReset("patron@test.com", "http://localhost:5177/reset#token=abc"))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("403");
    }
}
