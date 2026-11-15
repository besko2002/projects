# CineBook Portfolio Demo Guide

Welcome to the CineBook Portfolio Demo. This guide explains how the isolated demo mode works, its safety guarantees, and how to run and verify it locally.

---

## 1. Overview & Purpose

CineBook's Demo Mode provides reviewers and portfolio visitors with an immediate, full-fidelity cinema booking experience:
- **Rich, Populated Catalogue**: 10 fictional feature films with original vector poster art across diverse retro genres.
- **7-Day Rolling Showtimes**: 3 unique cinema halls (Grand Vintage, Silver Screen, Royal Balcony) with realistic schedules across today and the next 6 days, strictly enforcing zero hall overlaps and 15-minute cleaning buffers.
- **Immediate One-Click Access**: Visitors can click **"⚡ Try demo"** anywhere in the app (Top Bar, Home hero, Sign In page, or during seat selection) to instantly receive a temporary authenticated session (`ROLE_USER`) without email registration or verification hurdles.
- **Real Stripe Payment & Refund Journey**: Supports full end-to-end checkout using Stripe's official test card, verified webhook status confirmation (`PAID`), and one-click self-service ticket cancellation with a full refund.

---

## 2. Safety & Isolation Guarantees

Demo mode is engineered to be strictly non-destructive and isolated from production:

| Safety Pillar | Guarantee |
| :--- | :--- |
| **Complete Database Isolation** | Demo mode runs exclusively against the `cinebook_demo` database. The owner's saved database (`movie_reservation`) is never touched, migrated, seeded, or dropped. |
| **Disabled by Default** | Controlled by `app.demo.enabled` (`DEMO_MODE_ENABLED: false`). In standard production or default startup, demo endpoints return `404 Not Found` and seeder beans remain dormant. |
| **Live Stripe Key Prohibition** | `DemoSafetyValidator` inspects the active Stripe API key on startup. If demo mode is enabled and a live key (`sk_live_` or `rk_live_`) is detected, the application immediately aborts startup with an `IllegalStateException`. Only test keys (`sk_test_` or `rk_test_`) are permitted. |
| **Rate-Limited Visitor Sessions** | `POST /api/demo/session` is protected by `AuthRateLimiter` (default: 15 sessions/min per IP) to prevent denial-of-service or session flooding. |
| **Least-Privilege Accounts** | Each visitor receives a dedicated unique account (`demo-<uuid>@demo.cinebook.local`) with standard customer permissions (`ROLE_USER`). Demo users cannot access admin endpoints. |

---

## 3. Quick Start (Native / Zero-Docker)

The repository provides a dedicated, native Python launcher (`scripts/demo.py`) that manages PostgreSQL preparation, Flyway schema migrations, and single-port SPA serving on port **8094**.

### Prerequisites
- macOS or Linux with PostgreSQL (e.g., Postgres.app or native PostgreSQL on port 55432 or standard 5432).
- Java 21 (Temurin or OpenJDK).
- Node.js 18+ (only if rebuilding frontend).

### Commands

Run commands from the repository git root (`cv-projects/`):

```bash
# 1. Start the isolated demo server
python3 scripts/demo.py start

# 2. Check status and health
python3 scripts/demo.py status

# 3. Stop the demo server cleanly
python3 scripts/demo.py stop

# 4. (Optional) Rebuild frontend bundle & package unified JAR
python3 scripts/demo.py build
```

---

## 4. Service Endpoints & Ports

When running, the demo serves both the React Single Page Application and the Spring Boot REST API from a single unified port:

- **Web Application (SPA)**: [http://127.0.0.1:8094](http://127.0.0.1:8094)
- **Actuator Health Check**: [http://127.0.0.1:8094/actuator/health](http://127.0.0.1:8094/actuator/health)
- **Demo Status API**: [http://127.0.0.1:8094/api/demo/status](http://127.0.0.1:8094/api/demo/status)
- **Demo Session API**: `POST http://127.0.0.1:8094/api/demo/session`

---

## 5. Reviewer Experience & Test Scenarios

### Reviewer Guidance Ribbon
A non-intrusive top banner alerts reviewers that the app is running in portfolio demo mode. Clicking **"Reviewer Guide"** expands test guidance:
- **Stripe Test Card**: `4242 4242 4242 4242`
- **Expiry Date**: Any valid future date (e.g., `12/34`)
- **CVC**: Any 3 digits (e.g., `123`)
- **Seat Hold Window**: 10-minute hold countdown before unpaid reserved seats are released back to other patrons.

### One-Click Try Demo
Visitors do not need to register. Clicking **"⚡ Try demo"** instantly generates a genuine visitor token, updates the header with a friendly badge (e.g. `Demo Guest a1b2c3d4`), and preserves any in-progress seat selections so users can proceed immediately to checkout.

### Full Booking & Refund Journey
1. Browse the 10 movies on the Home page, filter by genre chips, or switch between calendar days.
2. Select a movie (e.g., *Ember Road* or *Midnight Encore*) and choose an upcoming showtime today.
3. Select seats (Standard or VIP balcony seats). The real-time seat summary updates pricing and holds seats for 10 minutes.
4. Click **"Continue to secure payment"**. The application creates a Stripe Checkout session and redirects to Stripe.
5. Enter the test card details and submit payment.
6. Stripe redirects back to CineBook's success page (`/payment/success?session_id=...`).
7. Once the webhook confirms the payment, the ticket displays as **PAID**.
8. Go to **My tickets** (`/tickets`).
9. Click **"Cancel & refund"** and confirm. Because the showtime is in the future (> 2 hours), the system immediately issues a 100% full refund on Stripe and marks the ticket as **REFUNDED**.
