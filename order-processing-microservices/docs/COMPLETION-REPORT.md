# Completion report — Order Processing Microservices

Live checklist for the 17 November 2026 completion run
(plan: `plans/OPENCODE-MICROSERVICES-COMPLETION-PLAN.md`).
Updated as work progresses; every DONE needs evidence in this file.

## Phase A — inventory, baseline, preserved work (M0)

**Status: DONE**

### Baseline recorded 17 November 2026 (no secrets)

| Item | Value |
|---|---|
| Repository | `/Users/god_fatheer/Downloads/PROJECT/cv-projects` (mono-repo) |
| Project | `order-processing-microservices/` |
| HEAD at start | `2002fc8` on `main`, tracking `origin/main`, no outgoing commits |
| Working tree | 27 modified paths + 11 untracked paths (inherited, preserved — see below) |
| Java | Temurin 21.0.13+9 at `.native/tools/jdk-21.0.13+9/Contents/Home` |
| Node / npm | v26.7.0 / 12.0.2 |
| Stripe CLI | 1.55.11 at `.native/tools/stripe-cli/stripe` |
| Docker daemon | NOT running at start; Desktop launch requested. Confirmed running (29.8.2) before Phase B test runs. |
| Stripe credentials | `.env` has `STRIPE_SECRET_KEY` with `sk_test_` prefix (verified internally, value never printed). `STRIPE_WEBHOOK_SECRET` absent — will come from the `stripe listen` session for THIS listener. `PAYMENT_PROVIDER` absent — compose default selection by key applies. |

### Preserved (inherited) uncommitted work — accounted for, nothing discarded

Modified paths (OpenCode Stripe changes + integration edits):

- `.env.example`, `docker-compose.yml` — Stripe/provider/storefront settings forwarding.
- `api-gateway/…/SecurityConfig.java`, `application.yml` — webhook POST permitted without JWT, CORS.
- `common-events/…/EventTypes.java`, `Topics.java` — `PaymentAwaitingCustomer`, `ExpirePayment`.
- `order-service/…/OrderResponse.java`, `Order.java`, `OrderRepository.java`, `OrderSaga*.java`, `application.yml` — checkout URL persistence, awaiting-customer saga step, sweeper window.
- `payment-service/…/pom.xml`, `PaymentResponse.java`, `Payment.java`, `PaymentRepository.java`, `PaymentStatus.java`, `SimulatedPaymentGateway.java`, `PaymentListeners.java`, `PaymentSaga.java`, `PaymentSagaTransactions.java`, `application.yml` — provider selection, checkout sessions, 3-act saga structure.
- `order-service/…/OrderRefundRetryTimingTest.java`, payment-service tests updated.

Untracked paths:

- `common-events`: `ExpirePayment.java`, `PaymentAwaitingCustomer.java`.
- `order-service`: `db/migration/V7__checkout_url.sql`.
- `payment-service`: `config/`, `domain/PaymentProvider.java`, `domain/StripeWebhookEvent(.java)`, `domain/StripeWebhookEventRepository.java`, `gateway/*` (provider port + Stripe/simulated/unavailable implementations), `webhook/*` (controller, service, verifier, StripeEvent), `db/migration/V4__stripe_payments.sql`, `test/…/PaymentWebhookTest.java`, `test/…/saga/`.
- `storefront/` — scaffold: `package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `index.html`, `src/api/*` (client, auth, products, orders, payments), `src/types/api.ts`, `src/utils/*` (money, url, contrast). Missing: entry point (`src/main.tsx`), app, pages, styles, tests.

### Independent checks run (17 November)

| Check | Result |
|---|---|
| `.env` key prefixes (internal check only) | `STRIPE_SECRET_KEY` = `sk_test_…` ✓ TEST mode |
| Compose interpolation | forwards `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY`, `STOREFRONT_BASE_URL`, `PAYMENT_CHECKOUT_TTL`, `ORDER_SAGA_PAYMENT_WINDOW` ✓ |
| Gateway + payment-service webhook security | exact `POST /api/payments/stripe/webhook` permitted without JWT on both ✓ (other payment APIs stay JWT-guarded) |

### Phase A checklist

- [x] Read the whole plan, current diff, untracked sources, migrations, regression tests, README, workflow.
- [x] Record HEAD, dirty paths, tool versions, Docker state, running services (this section).
- [x] Confirm API contracts (controllers inspected), migration order (V1–V7 order-side, V1–V4 payment-side), provider selection, existing test assumptions, source ownership.
- [x] Classify preserved changes: coherent Stripe-payment feature set; to be committed as the payment-integration phase after PAY-1..5 repairs and green tests.
- [x] Test mode stays the default safety: absent/misconfigured Stripe → `UnavailablePaymentGateway` (no fake success); simulation is explicit (`PAYMENT_PROVIDER=simulated`) and labelled (`simulated: true`).

## Phase B — repair payment correctness before UI (M2)

**Status: DONE**

- [x] PAY-1 — late `PaymentAwaitingCustomer` after cancellation still closes the checkout: the expiry command is built from the event's payment id (`checkout_payment_id`), no URL needed; duplicates (fresh event ids, same fact) queue no second close (`checkout_closed_at` stamp). Evidence: `OrderSagaCheckoutTest` (7 tests, real Postgres + Kafka) — `aLateAwaitingEventForACancelledOrderStillClosesItsCheckout`, `cancellationAndTheAwaitingEventConvergeOnOneClosedCheckoutWhoeverWins`.
- [x] PAY-2 — `payment_intent.payment_failed` on an `AWAITING_CUSTOMER` checkout records the attempt (`Payment.recordAttemptFailure`), announces nothing, returns `ATTEMPT_FAILED`; the same session completes after a retry and clears the attempt reason; out-of-order deliveries move nothing. Evidence: `PaymentWebhookTest` — `aFailedAttemptOnAnOpenCheckoutIsRecordedButKeepsThePaymentWaiting`, `aCompletionAfterAFailedAttemptStillCompletesAndClearsTheAttempt`, `aFailedAttemptForAnAlreadyCompletedPaymentMovesNothing`.
- [x] PAY-3 — Stripe create-session retries reuse identical parameters + idempotency key: the attempt identity (`ChargeAttempt`, `charge_attempts`, `V5__charge_attempts.sql`) is persisted before the network call, the key is `"charge:" + attempt.eventId`, the loser of a primary-key race adopts the winner's attempt, and a provider that cannot be asked is retried bounded (`MAX_UNAVAILABLE_ASKS = 3`) then recorded as an honest `FAILED`. Evidence: `PaymentSagaTest` — `aLostChargeResponseIsRetriedWithTheSameIdentityAndParameters`, `aLaterCommandAdoptsTheAttemptAnEarlierDeliveryOpened`, `aProviderThatCannotBeAskedIsRetriedBoundedAndThenRecordedAsAnHonestFailure`.
- [x] PAY-4 — cancelling an unpaid checkout emits `ExpirePayment`, never `RefundPayment`; `refund_status` stays `NONE`; the recovery sweep has nothing to re-command; a charge that completes anyway is still tracked and refunded to settlement. Evidence: `OrderSagaCheckoutTest` — `cancellingAnOrderWithAnOpenCheckoutClosesItWithoutClaimingARefund`, `aTimedOutUnpaidCheckoutIsClosedNotRefunded`, `aLateCompletionAfterAnUnpaidCancelIsTrackedAndRefundedToSettlement`.
- [x] PAY-5 — the sweeper cancels a checkout past the provider's `checkout_expires_at` even when the payment window would wait ("payment page expired" reason), never a still-valid one, and `timeOut` re-checks staleness + deadline inside the cancelling transaction so a stale scan cannot cancel a progressed order. Evidence: `OrderSagaCheckoutTest` — `aCheckoutPastTheProviderDeadlineIsCancelledEvenWhenTheWindowWouldWait`, `aStaleScanDoesNotCancelAnOrderThatProgressedAfterIt`.
- [x] Additional payment review items: `checkout.session.completed` validates currency + amount in the currency's own minor units (`amount_total`/`amount` both read by the verifier — a real Stripe session payload would otherwise have skipped the check); completion refusal leaves the row awaiting (`AMOUNT_MISMATCH`). Evidence: `PaymentWebhookTest` — `aCompletionInADifferentCurrencyIsRefused`, `aCompletionPayingADifferentAmountIsRefused`, `aCompletionPayingExactlyTheAskedAmountCompletes`, `aCompletionOfAZeroFractionCurrencyComparesInItsOwnMinorUnits`.

Main-code changes made while reaching green (all part of PAY-1..5):

- `Order` gained `checkout_closed_at` (+ `V8__checkout_identity.sql` third column): stamped once when the `ExpirePayment` close is queued; de-duplicates the close and retires the stored `payment_url` (a cancelled order never exposes a payable link).
- `OrderSagaTransactions.expireCheckout` guards on the stamp; `onPaymentAwaitingCustomer`'s cancelled-order branch drops re-announced awaiting events for a closed checkout; `onPaymentFailed` now also closes a held checkout before cancelling.
- `StripeWebhookVerifier` reads the session total from `amount_total` (falling back to `amount`), so the amount check actually fires for real Stripe deliveries.
- `V5__charge_attempts.sql` gained the `version`/`updated_at` columns the `ChargeAttempt` mapping validates.
- Test hygiene: `PaymentIntegrationTest.resetDatabase()` also clears `charge_attempts`.

Suite evidence (17 Nov 2026, Docker 29.8.2, Temurin 21.0.13+9):

- order-service: **121 tests, 0 failures** (`mvnw -pl order-service -am test`)
- payment-service: **47 tests, 0 failures** (`mvnw -pl payment-service -am test`)

## Phase C — compose/gateway integration (M1)

**Status: DONE**

Stack: `docker compose up -d --force-recreate payment-service` after webhook-secret wiring; `op-gateway` (healthy) and `op-payment` (healthy) front the same stack rebuilt earlier on 17 Nov with Flyway V7/V8 (order_db) and V4/V5 (payment_db) applied, backups taken before migrations (`/private/var/folders/.../T/op/backups/*.dump`). Ports conflict-free (every published port is `127.0.0.1`-bound and unique). `docker compose config --quiet`: **PASS**.

### Checklist

- [x] Compose forwards every required setting: `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY`, `STOREFRONT_BASE_URL`, `PAYMENT_CHECKOUT_TTL` (payment-service) and `ORDER_SAGA_TIMEOUT`, `ORDER_SAGA_PAYMENT_WINDOW`, `ORDER_SAGA_REFUND_RETRY_INTERVAL` (order-service), all with safe defaults read from the git-ignored `.env`.
- [x] Gateway permits only the exact `POST /api/payments/stripe/webhook` without JWT — `GET /api/payments/stripe/webhook` through the gateway returns **401**; every other payment API (`GET /api/payments/order/{id}`) and business API (`POST /api/orders`, `DELETE /api/products/{id}`) returns **401** without a token; `GET /api/products` stays public (**200**).
- [x] Real signature-authenticated webhook verified **through the gateway :8080** (HMAC-SHA256 over `t.payload`, signed with THIS listener's secret in the shell, never printed; deliveries reference a synthetic session id so no payment row is touched):

| Delivery | Result |
|---|---|
| unsigned | **400** `Missing Stripe-Signature header` |
| tampered `v1` | **400** `Invalid Stripe webhook signature` |
| signed with a wrong secret | **400** `Invalid Stripe webhook signature` |
| valid signature, 10-min-old timestamp | **400** `…outside the tolerance zone` |
| valid signature, no JWT, unknown session | **200** `UNKNOWN_PAYMENT` |
| duplicate delivery (same event id) | **200** `DUPLICATE` — no duplicate effect (event-id dedup) |

- [x] CORS from the documented origin: preflight `POST /api/orders` from `http://localhost:5179` → **200** with `Access-Control-Allow-Origin: http://localhost:5179`, `Access-Control-Allow-Headers: … idempotency-key …` (the checkout idempotency key survives CORS); foreign origin `http://evil.example` → **403**, no allow headers. Storefront default URL `http://localhost:5179` in compose and payment-service config.
- [x] Missing key/provider behavior — no fake confirmation: with neither provider nor key, `PaymentGatewayConfiguration` wires `UnavailablePaymentGateway` and every charge answers `Unavailable`; the saga retries bounded (`MAX_UNAVAILABLE_ASKS = 3`) and then records an **honest FAILED** which cancels the order with a clear reason (test: `PaymentSagaTest.aProviderThatCannotBeAskedIsRetriedBoundedAndThenRecordedAsAnHonestFailure`). The simulated provider exists only behind explicit `PAYMENT_PROVIDER=simulated`. Live stack log confirms provider selection (`STRIPE chosen because STRIPE_SECRET_KEY is set`). A transiently empty `STRIPE_WEBHOOK_SECRET` in the container was also observed live: every delivery 400s ("no Stripe webhook secret configured") and no state changes — the unconfigured case fails closed.
- [x] `.env.example` updated without credentials: empty placeholders, listener command documented, "keep real values only in `.env`" reminder.
- [x] Webhook secret belongs to **THIS** listener: a fresh `stripe listen` (v1.55.11, `--api-key` of this project's own `sk_test_` key, events `checkout.session.completed,checkout.session.expired,payment_intent.payment_failed,charge.refunded`, forwarded to `localhost:8080/api/payments/stripe/webhook`) was started on 17 Nov and left running for Phase E; its `whsec_…` is stored only in the git-ignored `.env` and in the running `op-payment` container (never printed). No other project's listener or config was touched.

## Phase D — storefront (M3)

**Status: NOT STARTED**

## Phase E — full verification and evidence (M4)

**Status: NOT STARTED**

## Phase F — documentation and CI (M4b)

**Status: NOT STARTED**

## Phase G — final review, commits, shutdown (M5)

**Status: NOT STARTED**

## Evidence log

(appended per phase below)
