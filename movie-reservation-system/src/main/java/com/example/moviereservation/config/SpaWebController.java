package com.example.moviereservation.config;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Forwards frontend SPA routes to index.html for client-side routing.
 *
 * <p>API routes ({@code /api/**}), Stripe return routes ({@code /payment/**}), Swagger,
 * Actuator, and static assets (containing extensions or under {@code /assets/**}, {@code /posters/**})
 * are deliberately excluded so that unknown API routes return standard {@code ApiError} 404 JSON.
 */
@Controller
public class SpaWebController {

    @GetMapping(value = {
            "/",
            "/{path:^(?!api|payment|actuator|v3|swagger-ui|posters|assets|favicon\\.ico)[^\\.]*}",
            "/{path:^(?!api|payment|actuator|v3|swagger-ui|posters|assets|favicon\\.ico)[^\\.]*}/**"
    })
    public String forwardSpa() {
        return "forward:/index.html";
    }
}
