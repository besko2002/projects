package com.example.moviereservation.demo;

import com.example.moviereservation.common.ResourceNotFoundException;
import com.example.moviereservation.users.AuthRateLimiter;
import com.example.moviereservation.users.AuthResponse;
import com.example.moviereservation.users.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Endpoints for checking demo status and acquiring one-click guest sessions.
 */
@RestController
@RequestMapping("/api/demo")
public class DemoController {

    private static final Logger log = LoggerFactory.getLogger(DemoController.class);

    private final DemoProperties demoProperties;
    private final UserService userService;
    private final AuthRateLimiter rateLimiter;
    private final String stripeSecretKey;

    public DemoController(DemoProperties demoProperties,
                          UserService userService,
                          AuthRateLimiter rateLimiter,
                          @Value("${app.stripe.secret-key:}") String stripeSecretKey) {
        this.demoProperties = demoProperties;
        this.userService = userService;
        this.rateLimiter = rateLimiter;
        this.stripeSecretKey = stripeSecretKey;
    }

    @GetMapping("/status")
    public DemoStatusDto getStatus() {
        if (!demoProperties.isEnabled()) {
            return DemoStatusDto.disabled();
        }
        String stripeMode = (stripeSecretKey != null && !stripeSecretKey.isBlank()) ? "test" : "disabled";
        return DemoStatusDto.enabled(stripeMode);
    }

    @PostMapping("/session")
    public ResponseEntity<AuthResponse> createSession(HttpServletRequest request) {
        if (!demoProperties.isEnabled()) {
            throw new ResourceNotFoundException("Demo mode is disabled");
        }
        String clientIp = clientIp(request);
        rateLimiter.demoSession(clientIp, demoProperties.getRateLimitPerMinute());
        AuthResponse session = userService.createDemoSession();
        return ResponseEntity.status(HttpStatus.CREATED).body(session);
    }

    private static String clientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isBlank()) {
            return xForwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr() != null ? request.getRemoteAddr() : "127.0.0.1";
    }
}
