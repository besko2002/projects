# Changelog

All notable changes to the Movie Reservation System backend are documented in this file.

## [Unreleased]

### Fixed
- **OpenAPI / Swagger Auth Documentation for Logout**: Resolved OpenAPI specification inconsistency where class-level `@SecurityRequirements` on `AuthController` caused `POST /api/auth/logout` to be declared as unauthenticated with an empty security array (`"security": []`) and a `200 OK` response. Restricted `@SecurityRequirements` strictly to public registration (`/api/auth/register`) and login (`/api/auth/login`) operations. Explicitly documented `@ApiResponse` `204 No Content` and `401 Unauthorized` on logout, ensuring Swagger UI and API clients correctly require `bearerAuth`.
- **Stale Pending Ticket Deadlock on Checkout**: Fixed checkout blockage in `TicketService.checkout` where a user with an expired or abandoned `PENDING_PAYMENT` ticket was permanently prevented from checking out newly held seats due to a unique constraint violation (`409 Conflict`). The service now automatically detects when an existing pending ticket has no active holds, safely marks the stale ticket as `EXPIRED`, releases dangling seats, cancels the Stripe session quietly, and proceeds to create a new ticket.

- **Stale Pending Ticket Row Lock**: The stale-ticket expiry path in checkout now locks the ticket row
  (`findByIdForUpdate`) and re-checks `PENDING_PAYMENT` before changing it, like every other ticket
  transition, so a concurrent webhook result is never overwritten.

- **Refund Idempotency Key Collision (found by a live Stripe test)**: The Stripe refund key was
  `ticket-{id}-refund`. Ticket ids restart in every database while Stripe idempotency keys are
  account-wide, so after a database reset/restore, or with several environments on one Stripe account,
  a refund reused a key from an earlier, different payment and Stripe refused it
  (`IdempotencyException`), leaving the ticket PAID. The key is now
  `refund-{paymentIntentId}-{amount}`: unique per payment, still stable across retries. Regression
  test: `RefundKeyTest`.

### Added (testing)
- **Docker-free test runs**: `python3 scripts/native.py test movies` runs the full suite against a
  fresh, uniquely named database per test context on the native PostgreSQL server
  (`NativeTestDatabase`), dropped afterwards. Without `MOVIE_TEST_DB_URL` the tests still use
  Testcontainers, so CI is unchanged. Verified: 209 tests, 0 failures, with Docker stopped.

### Verified
- **Live Stripe test mode (manual, 2026-11-14)**: against an isolated instance and throwaway database,
  a real Stripe Checkout session was paid with test card 4242 ($25.00 succeeded), the signed
  `checkout.session.completed` webhook (forwarded by the Stripe CLI) marked the ticket PAID, and
  cancelling it issued a full refund on Stripe with `charge.refunded` processed and the seats released.
  The automated suite (206 tests) still never calls Stripe over the network.

### Added
- **CineBook Customer Booking Frontend**: Built modern React 18, TypeScript, and Vite single-page application under `movie-reservation-system/frontend/` matching approved design:
  - Screen 1: Home page featuring now-showing catalogue, day selector (today + 6 days), genre chips, movie cards, and direct showtime pills.
  - Screen 2: Movie detail page with synopsis, metadata, and showtime slots grouped by cinema hall with standard and VIP pricing.
  - Screen 3: Interactive seat selection with SVG screen arc, dual-symbol seat map (Standard, VIP, Selected, Held, Booked), 8-seat cap enforcement, hold countdown timer, and booking summary.
  - Screen 4: Payment confirmed voucher page with webhook-based polling for payment verification, entry reference code, and refund cutoff warning.
  - Screen 5: Tabbed ticket management (`Upcoming`, `Past`, `Cancelled & refunded`) with self-service cancellation and automatic full Stripe refund.
  - Screens 6 & 7: Dark-themed Sign In and Registration pages supporting return-URL preserves during checkout.
- **Frontend Test Suite**: 15 unit and integration tests covering API client authentication, error handling, 8-seat limit enforcement, hold countdown expiration, auth redirects, payment success polling, ticket status rendering, and WCAG AA contrast verification.
- **Native Runtime Integration**: Integrated `movies-ui` into `scripts/native.py` running on port 5177 with automatic reverse proxy for `/api` and `/payment` to backend on port 8093.
- **Webhook Expiry and Out-of-Order Lifecycle Tests**: Added integration tests in `PaymentWebhookIntegrationTest` covering critical distributed edge cases:
  - `sessionExpiredMarksTicketExpiredAndReleasesSeats`: Verifies `checkout.session.expired` webhook transitions ticket to `EXPIRED` and frees seats for re-booking.
  - `outOfOrderExpiredAfterCompletedIsIgnored`: Verifies late `checkout.session.expired` webhook received after `checkout.session.completed` is ignored without altering `PAID` ticket or `CONFIRMED` seats.
  - `outOfOrderCompletedAfterExpiredRefundsExactlyOnce`: Verifies late `checkout.session.completed` webhook for an expired ticket issues an automatic refund exactly once and ignores duplicate deliveries.
- **Refund Gateway Failure & Retry Resilience Tests**: Added `refundRetriesStayConsistentWhenProviderFails` in `TicketCancellationIntegrationTest` demonstrating transactional rollback when the payment gateway fails (e.g., HTTP 503) during ticket cancellation, followed by consistent retry using the deterministic idempotency key (now `refund-{paymentIntentId}-{amount}`).
- **OpenAPI Schema Regression Tests**: Added schema assertions in `ApiDocsTest` to prevent regressions on endpoint authentication metadata and response status codes.

### Changed
- **CI Workflow Memory Limits**: Configured Maven memory bounds (`MAVEN_OPTS: "-Xmx512m"` and `-DargLine="-Xmx512m"`) in `.github/workflows/movie-reservation-system.yml` to guarantee stable execution within bounded memory constraints.
- **Documentation Alignment**: Updated `README.md` to reference Flyway migrations `V1`–`V10`, moved `POST /api/auth/logout` into the authentication endpoint table, and confirmed native runtime instructions.
