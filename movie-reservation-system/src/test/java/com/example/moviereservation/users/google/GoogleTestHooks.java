package com.example.moviereservation.users.google;

import java.security.PublicKey;
import java.util.function.Function;

/**
 * Test hook bridge allowing integration tests to configure mock Google keys
 * while keeping internal mutators package-private on production classes.
 */
public final class GoogleTestHooks {

    private GoogleTestHooks() {
    }

    public static void setTestKeyProvider(GoogleTokenVerifierImpl verifier, Function<String, PublicKey> provider) {
        verifier.setTestKeyProvider(provider);
    }
}
