package com.example.moviereservation.demo;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Opt-in portfolio reviewer demo configuration.
 * Disabled by default.
 */
@Configuration
@ConfigurationProperties(prefix = "app.demo")
public class DemoProperties {

    private boolean enabled = false;
    private int rateLimitPerMinute = 15;
    private long replenishDelayMs = 3600000L;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public int getRateLimitPerMinute() {
        return rateLimitPerMinute;
    }

    public void setRateLimitPerMinute(int rateLimitPerMinute) {
        this.rateLimitPerMinute = rateLimitPerMinute;
    }

    public long getReplenishDelayMs() {
        return replenishDelayMs;
    }

    public void setReplenishDelayMs(long replenishDelayMs) {
        this.replenishDelayMs = replenishDelayMs;
    }
}
