# CineBook Deployment & Hosting Preparation Guide

This guide details the deployment architecture, configuration options, production readiness, and hosting requirements for CineBook (Movie Reservation System).

> [!IMPORTANT]
> **Hosting Status: Deployment Prepared — Awaiting Host Selection & Cost Approval**
> All build pipelines, unified container/JAR packaging, SPA static forwarding, environment configurations, and database migrations are fully implemented and verified locally. Live public deployment is currently deferred awaiting explicit platform selection and budget authorization from the project owner.

---

## 1. Architectural Options

CineBook can be deployed under two standard production topologies:

### Option A: Unified Self-Contained JAR (Recommended for Simple Deployments)
In this mode, the Vite frontend is built into static assets (`npm run build`) and copied to Spring Boot's `src/main/resources/static/`. Spring Boot serves both the API endpoints (`/api/**`) and the React SPA (`index.html`) on a single port (e.g., `8080`).

- **Pros**: Zero CORS configuration required, single deployable artifact (`movie-reservation-system.jar`), single HTTPS domain, minimal operational overhead.
- **Routing**: `SpaWebController` forwards all HTML navigation routes (`/`, `/login`, `/register`, `/tickets`, `/movie/{id}`, `/book/{id}`) to `index.html`. Unmatched API routes under `/api/**` return strict JSON `404 ApiError` instead of falling through to HTML.

### Option B: Decoupled Frontend (CDN/Vercel/Cloudflare) + Backend API (Container/PaaS)
In this mode, the frontend is deployed as a static site to a CDN or edge hosting service (e.g., Cloudflare Pages, Vercel, AWS S3 + CloudFront), and the Spring Boot application runs on a managed container service (e.g., AWS ECS, Google Cloud Run, Render, Railway).

- **Pros**: Independent frontend and backend scaling, global edge caching for static assets.
- **Requirements**: CORS headers configured via `app.cors.allowed-origins`, domain routing for `/api/**` through reverse proxy or distinct subdomain (e.g., `api.cinebook.example.com`).

---

## 2. Production Topology & Reverse Proxy (HTTPS)

In any production deployment with real customer or demo traffic, TLS termination should be handled by a reverse proxy (e.g., Nginx, Caddy, or a Cloud Load Balancer):

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
| `SPRING_PROFILES_ACTIVE` | `prod` | Spring profile to activate | Optional |
| `SERVER_PORT` | `8080` | HTTP listening port | No |
| `SPRING_DATASOURCE_URL` | `jdbc:postgresql://db:5432/movie_reservation` | JDBC connection URL for PostgreSQL | **Yes** |
| `SPRING_DATASOURCE_USERNAME` | `postgres` | Database username | **Yes** |
| `SPRING_DATASOURCE_PASSWORD` | `(secret)` | Database password | **Yes** |
| `JWT_SECRET` | `(min 32-char secret)` | Signing key for HMAC-SHA256 user JWTs | **Yes** |
| `STRIPE_SECRET_KEY` | `sk_test_...` or `sk_live_...` | Stripe API Secret Key | **Yes** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe Webhook signing secret | **Yes** |
| `STRIPE_SUCCESS_URL` | `https://domain/payment/success?session_id={CHECKOUT_SESSION_ID}` | Post-checkout redirect URL | **Yes** |
| `STRIPE_CANCEL_URL` | `https://domain/payment/cancel?session_id={CHECKOUT_SESSION_ID}` | Cancelled checkout redirect URL | **Yes** |
| `DEMO_MODE_ENABLED` | `false` | Enables 1-click visitor accounts & rolling catalogue | Optional |
| `DEMO_RATE_LIMIT_PER_MINUTE`| `15` | Max visitor sessions generated per IP per minute | No |
| `TICKET_HOLD_MINUTES` | `10` | Duration of temporary seat hold during checkout | No |
| `TICKET_CANCELLATION_CUTOFF_HOURS` | `2` | Hours before showtime cutoff for self-service refund | No |

---

## 5. Security & Isolation Controls

1. **Demo Mode Safety Gate**:
   When `DEMO_MODE_ENABLED=true`, `DemoSafetyValidator` guarantees that any configured `STRIPE_SECRET_KEY` begins with `sk_test_` or `rk_test_`. If a production live key (`sk_live_`) is accidentally configured with demo mode active, Spring Boot crashes on startup immediately to prevent test runs against live money.
2. **Least Privilege Visitor Sessions**:
   Temporary demo users are registered with `ROLE_USER` and isolated per browser visitor (`demo-<uuid>@demo.cinebook.local`). They cannot access administrative endpoints or touch other patrons' tickets.
3. **Database Schema Migrations**:
   Flyway runs automatically on application boot to apply schema migrations idempotently (`V1` through `V4`). No manual schema execution is required.
