-- V12: Support passwordless Google authentication, secure password resets, and app metadata tracking.

-- Allow password_hash to be NULL for users registered via Google Identity Services
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Track Google subject ID to permanently bind Google accounts and prevent hijacking
ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) UNIQUE;

-- Password reset tokens with SHA-256 hash storage, 30-minute expiry, and single-use tracking
CREATE TABLE password_reset_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);

-- App metadata table for recording one-time seeder status and application settings
CREATE TABLE app_metadata (
    key VARCHAR(100) PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
