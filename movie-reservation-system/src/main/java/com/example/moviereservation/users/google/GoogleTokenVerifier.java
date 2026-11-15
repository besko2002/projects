package com.example.moviereservation.users.google;

public interface GoogleTokenVerifier {

    /**
     * Verifies the given Google ID token against published Google public keys, audience,
     * issuer, and expiration, returning verified identity claims.
     *
     * @param idToken raw Google JWT ID token
     * @return verified payload claims
     */
    GoogleTokenPayload verify(String idToken);

    /**
     * @return {@code true} if a Google Client ID has been configured
     */
    boolean isConfigured();

    /**
     * @return the configured Google Client ID, or empty string if unconfigured
     */
    String getClientId();
}
