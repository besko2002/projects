package com.example.moviereservation.demo;

/**
 * Public metadata describing demo mode availability for frontend guidance.
 */
public record DemoStatusDto(
        boolean enabled,
        String banner,
        String stripeMode
) {
    public static DemoStatusDto enabled(String stripeMode) {
        return new DemoStatusDto(
                true,
                "Portfolio demo — fictional data, Stripe test payments only.",
                stripeMode
        );
    }

    public static DemoStatusDto disabled() {
        return new DemoStatusDto(false, null, null);
    }
}
