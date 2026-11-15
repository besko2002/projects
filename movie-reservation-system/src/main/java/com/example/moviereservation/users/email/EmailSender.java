package com.example.moviereservation.users.email;

public interface EmailSender {

    /**
     * @return {@code true} if an email provider (such as Resend) is configured
     */
    boolean isConfigured();

    /**
     * Sends a password reset link to the recipient.
     *
     * @param toEmail   user's email address
     * @param resetLink complete URL to the frontend reset password page with token
     */
    void sendPasswordReset(String toEmail, String resetLink);

    /**
     * Sends a security notification informing the user that their password was changed.
     *
     * @param toEmail user's email address
     */
    void sendPasswordChangedNotification(String toEmail);

    /**
     * Sends a security notification informing the user that their account was linked with Google
     * and their prior password was cleared for security.
     *
     * @param toEmail user's email address
     */
    void sendPasswordReplacedByGoogleNotification(String toEmail);
}
