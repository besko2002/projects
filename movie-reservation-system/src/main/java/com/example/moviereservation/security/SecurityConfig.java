package com.example.moviereservation.security;

import com.example.moviereservation.users.TokenAccountValidator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/** Stateless JWT security: no sessions, no form login, no HTTP basic. */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    /** Endpoints reachable without a token. */
    private static final String[] PUBLIC_GET_PATHS = {
            "/",
            "/login",
            "/register",
            "/forgot-password",
            "/reset-password",
            "/admin",
            "/admin/**",
            "/tickets",
            "/movie/**",
            "/book/**",
            "/posters/**",
            "/assets/**",
            "/favicon.ico",
            "/index.html",
            "/api/auth/config",
            "/api/movies/**",
            "/api/genres/**",
            "/api/theaters/**",
            "/api/schedules/**"
    };

    private static final String[] PUBLIC_PATHS = {
            "/api/auth/login",
            "/api/auth/register",
            "/api/auth/google",
            "/api/auth/forgot-password",
            "/api/auth/reset-password",
            "/payment/success",
            "/payment/cancel",
            "/actuator/health",
            "/actuator/health/**",
            "/v3/api-docs",
            "/v3/api-docs/**",
            "/swagger-ui/**",
            "/swagger-ui.html"
    };

    private final JwtService jwtService;
    private final TokenAccountValidator accountValidator;
    private final RestAuthenticationEntryPoint authenticationEntryPoint;
    private final RestAccessDeniedHandler accessDeniedHandler;

    public SecurityConfig(JwtService jwtService,
                          TokenAccountValidator accountValidator,
                          RestAuthenticationEntryPoint authenticationEntryPoint,
                          RestAccessDeniedHandler accessDeniedHandler) {
        this.jwtService = jwtService;
        this.accountValidator = accountValidator;
        this.authenticationEntryPoint = authenticationEntryPoint;
        this.accessDeniedHandler = accessDeniedHandler;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .logout(logout -> logout.disable())
                .anonymous(Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(PUBLIC_PATHS).permitAll()
                        // Stripe calls the webhook with its own signature, not with a JWT (phase 7).
                        .requestMatchers(HttpMethod.POST, "/api/payments/stripe/webhook").permitAll()
                        .requestMatchers(HttpMethod.GET, PUBLIC_GET_PATHS).permitAll()
                        .requestMatchers("/api/admin/**").hasRole("ADMIN")
                        // Allow frontend SPA and static assets to be served on non-API/non-actuator GET/HEAD requests (e.g. /foo, /assets/...)
                        .requestMatchers(request -> {
                            String method = request.getMethod();
                            if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
                                return false;
                            }
                            String uri = request.getRequestURI();
                            if (uri.equals("/api") || uri.startsWith("/api/")) {
                                return false;
                            }
                            if (uri.equals("/actuator") || uri.startsWith("/actuator/")) {
                                return false;
                            }
                            return true;
                        }).permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                .addFilterBefore(new JwtAuthenticationFilter(jwtService, accountValidator),
                        UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
