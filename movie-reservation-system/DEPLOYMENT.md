# CineBook Deployment & Hosting Preparation Guide

This guide details the deployment architecture, configuration options, production readiness, and hosting requirements for CineBook (Movie Reservation System).

> [!IMPORTANT]
> **Live Public URL: Not deployed / not verified.**
> All build pipelines, unified packaging, SPA static forwarding, environment configurations, and database migrations are implemented and verified locally: the full backend suite against native PostgreSQL, the frontend suite, and an isolated browser run with a Stripe TEST payment and refund. The container image was built with `docker build` from a normal development checkout (with `frontend/node_modules` present); the container itself has not been run against a real deployment. Live public cloud deployment is intentionally out of current scope awaiting host selection and budget approval from the project owner.

---

## 1. Architectural Options

CineBook can be deployed under two standard production topologies:

### Option A: Unified Self-Contained JAR (Recommended for Simple Deployments)
In this mode, the Vite frontend is built into static assets (`npm run build`) and served from Spring Boot's `src/main/resources/static/`. Spring Boot serves both the API endpoints (`/api/**`) and the React SPA (`index.html`) on a single port (e.g., `8080` in Docker or `8093` in native development).

- **Pros**: Zero CORS configuration required, single deployable artifact (`movie-reservation-system.jar`), single HTTPS domain, minimal operational overhead.
- **Routing**: `SpaWebController` forwards client HTML navigation routes (`/`, `/movie/:id`, `/book/:scheduleId`, `/tickets`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/admin`, `/admin/movies`, `/admin/genres`, `/admin/halls`, `/admin/showtimes`, `/admin/reports`) to `index.html`. Stripe return routes (`/payment/success`, `/payment/cancel`) are handled by `PaymentReturnController` which serves index HTML with `<noscript>` fallback indicators. Unmatched API routes under `/api/**` return strict JSON `404 ApiError` instead of falling through to HTML.

### Option B: Decoupled Frontend (CDN/Vercel/Cloudflare) + Backend API (Container/PaaS)
In this mode, the frontend is deployed as a static site to a CDN or edge hosting service (e.g., Cloudflare Pages, Vercel, AWS S3 + CloudFront), and the Spring Boot application runs on a managed container service (e.g., AWS ECS, Google Cloud Run, Render, Railway).

- **Pros**: Independent frontend and backend scaling, global edge caching for static assets.
- **Routing**: Domain routing through a reverse proxy (e.g. Nginx path-routing) or distinct subdomains (e.g., `app.cinebook.example.com` and `api.cinebook.example.com`).

---

## 2. Production Topology & Reverse Proxy (HTTPS)

In any production deployment with real customer traffic, TLS termination and client IP forwarding should be handled by a reverse proxy (e.g., Nginx, Caddy, or a Cloud Load Balancer):

```
                     Internet (HTTPS :443)
                               │
                               ▼
               ┌───────────────────────────────┐
               │    TLS Reverse Proxy (Nginx)  │
               └───────────────┬───────────────┘
                               │ HTTP
                               ▼
               ┌───────────────────────────────┐
               │    Spring Boot Application    │
               │          (Port 8080)          │
               │  ┌──────────────┬───────────┐ │
               │  │ React SPA UI │ REST API  │ │
               │  └──────────────┴───────────┘ │
               └───────────────┬───────────────┘
                               │ TCP
                               ▼
               ┌───────────────────────────────┐
               │       PostgreSQL Database     │
               │         (Port 5432)           │
               └───────────────────────────────┘
```

### Trusted Proxy & Client IP Configuration
When running behind a reverse proxy or load balancer, ensure Spring Boot trusts the forwarded headers (`X-Forwarded-For`, `X-Forwarded-Proto`) so that rate limiters and audit logs correctly track client IP addresses rather than the proxy's internal IP:

```yaml
server:
  forward-headers-strategy: native
  tomcat:
    remoteip:
      remote-ip-header: x-forwarded-for
      protocol-header: x-forwarded-proto
      host-header: ''   # ignore client-supplied X-Forwarded-Host
      port-header: ''   # ignore client-supplied X-Forwarded-Port
      internal-proxies: '${TRUSTED_PROXIES:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}|::1|0:0:0:0:0:0:0:1}'
```

`TRUSTED_PROXIES` (optional) replaces the trusted-proxy regex. The default trusts loopback and private ranges, which is right for a reverse proxy on the same host or private network; if clients can reach the app directly from a private network, set it to the proxy's exact address, e.g. `TRUSTED_PROXIES=10\.0\.0\.5`.

### Sample Nginx Configuration Snippet
```nginx
server {
    listen 443 ssl http2;
    server_name cinebook.example.com;

    ssl_certificate     /etc/letsencrypt/live/cinebook.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cinebook.example.com/privkey.pem;

    # Gzip compression for static web assets
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

---

## 3. Stripe Webhook Registration for Public Hosting

For live payments or reviewer testing in hosted environments:

1. **Webhook Endpoint URL**:
   Register `https://cinebook.example.com/api/payments/stripe/webhook` in the Stripe Dashboard (under Developers > Webhooks).
2. **Subscribed Events**:
   - `checkout.session.completed` (transitions ticket from `PENDING_PAYMENT` to `PAID`, confirms seat reservations).
   - `checkout.session.expired` (releases held seats when checkout expires).
   - `payment_intent.payment_failed` (marks ticket `PAYMENT_FAILED`, releases seats).
   - `charge.refunded` (marks ticket `REFUNDED`, releases seats).
3. **Secret Provisioning**:
   Obtain the signing secret (`whsec_...`) from Stripe Dashboard and set it as `STRIPE_WEBHOOK_SECRET` in the application environment.

---

## 4. Environment Variables Reference

| Environment Variable | Default / Example | Purpose | Required in Prod |
| :--- | :--- | :--- | :---: |
| `SPRING_PROFILES_ACTIVE` | `prod` | Spring profile to activate (`prod` enforces strong secrets guard) | **Yes** |
| `SCHEDULE_ZONE` | `Africa/Cairo` | Cinema time zone; admin showtime entry and listing use it (default `UTC`) | Recommended |
| `SERVER_PORT` | `8080` | HTTP listening port (`8093` in local native development) | No |
| `APP_BASE_URL` | `https://cinebook.example.com` | Public base URL used to construct Stripe checkout success/cancel return URLs | **Yes** |
| `FRONTEND_BASE_URL` | `https://cinebook.example.com` | Public frontend URL used to construct password reset links (defaults to `APP_BASE_URL`) | No |
| `DB_URL` | `jdbc:postgresql://db:5432/movie_reservation` | JDBC connection URL for PostgreSQL | **Yes** |
| `DB_USERNAME` | `postgres` | Database username | **Yes** |
| `DB_PASSWORD` | `(secret)` | Database password | **Yes** |
| `JWT_SECRET` | `(min 32-char secret)` | Signing key for HMAC-SHA256 user JWTs (refuses dev defaults in `prod`) | **Yes** |
| `ADMIN_EMAIL` | `admin@cinema.local` | Email address of seeded staff administrator | **Yes** |
| `ADMIN_PASSWORD` | `(secret)` | Password of seeded administrator (must change from default in `prod`) | **Yes** |
| `STRIPE_SECRET_KEY` | `sk_test_...` or `sk_live_...` | Stripe API Secret Key | **Yes** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe Webhook signing secret | **Yes** |
| `STRIPE_CURRENCY` | `usd` | ISO 4217 currency for Stripe checkout | No |
| `RESERVATION_HOLD_MINUTES` | `10` | Duration of temporary seat hold during checkout | No |
| `TICKET_CANCELLATION_CUTOFF_HOURS` | `2` | Hours before showtime cutoff for self-service refund | No |
| `GOOGLE_CLIENT_ID` | `...apps.googleusercontent.com` | Google OAuth Web Client ID for Google Identity Services sign-in | Optional |
| `RESEND_API_KEY` | `re_...` | Resend HTTPS API key for sending transactional password reset emails | Optional |
| `MAIL_FROM` | `CineBook <noreply@yourdomain.com>` | Sender email header for password reset notifications | Optional |

---

## 5. Security & Isolation Controls

1. **Production Secret Startup Guard**:
   When `SPRING_PROFILES_ACTIVE=prod` is activated, Spring Boot inspects configured credentials on startup. It immediately halts initialization if default placeholder secrets (`dev-secret...`, `Admin@12345`, etc.) or weak JWT signing keys are detected.
2. **Role-Based Access Control**:
   - Customer accounts are registered with `ROLE_USER`.
   - The staff administration console (`/admin`, `/api/admin/**`, `/api/movies` [mutations], `/api/theaters` [mutations], `/api/schedules` [mutations], `/api/genres` [mutations]) strictly enforces `ROLE_ADMIN`.
   - Attempting to access administrative facilities with standard user tokens yields `403 Forbidden`.
3. **Password Reset Token Security**:
   - Random 32-byte cryptographically secure tokens (`SecureRandom`).
   - Only SHA-256 hashes of tokens are stored in PostgreSQL; raw tokens never touch logs or databases.
   - Tokens expire after 30 minutes and are strictly single-use.
   - Completing a password reset automatically revokes all existing JWT sessions (`tokenVersion` increment).
4. **Google Identity Verification**:
   - Server-side cryptographic verification of Google ID tokens against Google's public RSA JWK sets (`https://www.googleapis.com/oauth2/v3/certs`).
   - Verifies signature, issuer (`accounts.google.com` or `https://accounts.google.com`), audience (`GOOGLE_CLIENT_ID`), expiration, and email verification.
   - Newly created Google users are strictly assigned `ROLE_USER` (never `ADMIN`).
5. **Database Schema Migrations**:
   Flyway runs automatically on application boot to apply schema migrations idempotently (`V1` through `V12`).
   - `V1`–`V10`: Core entities, theaters, seat maps, reservations, tickets, refunds, showtime exclusion constraint.
   - `V11`: Safe cleanup of leftover demo accounts.
   - `V12`: Nullable password hash for Google SSO, `google_sub` column, `password_reset_tokens` table, and `app_metadata` table.
