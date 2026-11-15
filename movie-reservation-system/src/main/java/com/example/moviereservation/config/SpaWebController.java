package com.example.moviereservation.config;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Forwards SPA routes to index.html for client-side routing.
 *
 * <p>API routes ({@code /api/**}), Swagger, Actuator and static assets are deliberately excluded,
 * ensuring unknown API routes answer with proper {@code ApiError} 404 responses instead of HTML.
 */
@Controller
public class SpaWebController {

    @GetMapping(value = {
            "/",
            "/login",
            "/register",
            "/tickets",
            "/movie/{id}",
            "/book/{id}"
    })
    public String forwardSpa() {
        return "forward:/index.html";
    }
}
