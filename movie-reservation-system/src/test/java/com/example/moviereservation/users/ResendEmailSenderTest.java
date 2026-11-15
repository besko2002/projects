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
    void configuredWhenApiKeyAndValidSenderDomainProvided() {
        ResendEmailSender sender = new ResendEmailSender("re_test_123", "onboarding@resend.dev", objectMapper);
        assertThat(sender.isConfigured()).isTrue();

        ResendEmailSender customDomain = new ResendEmailSender("re_test_123", "support@cinebook.com", objectMapper);
        assertThat(customDomain.isConfigured()).isTrue();
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
