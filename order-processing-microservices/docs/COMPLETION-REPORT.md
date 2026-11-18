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

**Status: DONE**

Outline Store is implemented in `storefront/` (React 19 + React Router 7 + Vite 6, TypeScript). The app is server-truth only: prices, stock, totals, order state and payment/refund state all come from the gateway; the cart stores product ids and integer quantities, never prices. There are no mock-data paths, invented images or invented backend fields; unsupported product imagery uses the deliberate `.product-card__placeholder` block.

### Implementation

- App shell: `src/main.tsx`, `src/App.tsx`, `src/index.css` — flat white / 2px outline design system, accent `#2a4bff`, spacing scale, reduced-motion block, skip link, semantic landmarks and route guards.
- API: typed clients in `src/api/*` against the real gateway contract (`PageResponse`, `OrderResponse`, `PaymentResponse`), one `request()` with bearer token, 401 handler and `ApiException`; wire types are copied field-for-field from the backend records.
- State: `AuthProvider` restores the stored token through `/api/auth/me` and exposes an identity epoch; `CartProvider` persists `{productId, quantity}`, clamps quantities, validates stored JSON and clears cart plus checkout attempt on identity change.
- Pages: catalog (server paging and `q` search), product detail (server data, stock, quantity validation, add to cart), cart (live revalidation of price/stock, per-line totals, checkout blocked while invalid), checkout, payment success/cancel, my orders, order detail, sign-in/register and not found.
- Checkout recovery: `src/lib/idempotency.ts` persists `{key, payload, orderId}`; every retry/reload reuses the same key and a payload sorted into a stable order until the attempt is resolved (confirmed, cancelled or definitively refused) or the customer explicitly resumes it. A changed cart never silently mints a second order: Resume / View order / Back to cart are offered.
- Polling: `src/lib/poll.ts` bounded exponential backoff (12 attempts) with unmount cancellation and an explicit timeout result; checkout and success pages render a timeout with Check again, never a fabricated paid state.
- Payment redirect safety: only `https:` (or `http:` loopback) URLs are followed; `javascript:`, `data:` and external hosts are rejected (`src/utils/url.ts`, `browser.redirect`).
- Success/cancel: success ignores Stripe's `session_id` and trusts only `GET /api/orders/{id}`; cancel shows actual order state, offers Pay now only while payable and Cancel order only on explicit action; refund requested and refund settled are distinct.
- Order detail: server totals/currency, status/reason, payment status, cancellation/refund progress and the real event log from `GET /api/orders/{id}/events` (labelled "Current progress only" when the log is empty).

### Tests (every mandatory §8 bullet covered)

`cd storefront && npm test -- --run` → **17 files, 90 tests, 0 failures**:

- money minor-unit arithmetic, safe return/redirect URLs, palette contrast and CSS/code palette parity
- API client (401 clears token, error mapping), bounded polling with fake timers, idempotency persistence, cart arithmetic/clamping/persistence/identity change/corrupt storage
- checkout: single POST with a persisted key, same key+payload on retry, reload recovery without a second POST, changed-cart gate and explicit resume, safe redirect, unsafe URL refusal, 409 out-of-stock refusal, cancelled-order reason, timeout
- payment success: missing attempt, CONFIRMED (cart cleared), CANCELLED with reason, timeout then Check again, unreadable order
- payment cancel: Pay now, explicit cancel with refund requested, CONFIRMED despite the redirect, refund settled, missing attempt
- catalog and orders pagination plus loading/error/empty states; order detail refund states, real timeline and cancel; cart stock revalidation; sign-in/register validation, duplicate-submit guards and safe return paths; `ProtectedRoute` guard.

### Gate evidence (18 Nov 2026)

- `npm run build` (`tsc --noEmit && vite build`): **PASS** — 65 modules transformed, dist built.
- `npm run lint`: **PASS** — 0 errors, 0 warnings.
- `npm test -- --run`: **17 files / 90 tests / 0 failures**, no skips and no `.only`.
- `npm audit --omit=dev`: **0 vulnerabilities**. Full `npm audit`: **11 high, all dev-only** (`picomatch`/`tinyglobby`/`fdir` through Vite 6 and Vitest 4, and the `@typescript-eslint` chain); `npm audit fix --dry-run` leaves them, so only `--force` major upgrades would change them — no force fix was applied, and no production dependency is affected.
- Live smoke through the dev origin `http://localhost:5179` (Vite proxy → gateway `:8080`, real stack): index/main/CSS **200**; `GET /api/products?page=0&size=3` **200** (9 products, 3 pages); login **200** (USER, Bearer); `GET /api/orders/me` **200**; product detail **200** with exactly the six `ProductResponse` fields; unauthenticated `GET /api/orders/me` **401**.
- Checkout contract live: `POST /api/orders` with a generated `Idempotency-Key` → **201**; identical replay → **200** with the **same** order id; the order reached `PAYMENT_PENDING` with a payment URL; `POST /api/orders/{id}/cancel` → **200** `CANCELLED`, `refundStatus=NONE`, payment URL retired.
- Browser checks (headless Google Chrome 156.0.8078.74, Node v26.7.0) at 375/768/1024/1440: **20 loaded screen/viewport combinations** (catalog, product detail, cart with a line, my orders with the cancelled smoke order, order detail with its real timeline, sign-in, register, product-not-found, 404 route) — **0 px horizontal page overflow**, no page errors. Keyboard tab order starts at the brand link → nav → form controls, and every stop has a visible **3px solid `#2a4bff`** focus outline. Found and fixed during this check: the visually-hidden `<th>` labels inside tables were absolutely positioned against the page, widening the document at 375px; `.table-scroll` is now `position: relative`, so wide tables scroll inside their own container. Screenshots and the measurement report are in `e2e-logs/storefront-responsive/` (git-ignored).

### Limits

- Screenshots are local-only evidence and are not committed. Checkout/success screens were not captured mid-flow because checkout immediately opens a real TEST-mode Stripe session; the real payment/refund walkthrough belongs to Phase E and will cover those states without exposing checkout URLs.
- Long-name and error states were exercised with real data (longest live product name: "Demo Limited Edition Speaker"); no synthetic data was injected.
- Wide cart/orders tables scroll horizontally inside `.table-scroll` by design at 375px; the page itself does not overflow.

## Phase E — full verification and evidence (M4)

**Status: PARTIAL — live Stripe TEST-mode walkthrough ran to hosted Checkout; order placed, payment attempt captured, one idempotent POST replay confirmed (StrictMode double-POST produces same order); decline-then-retry webhook (`payment_intent.payment_failed`) timed out after 45 s before `failureReason` appeared; confirmation, UI cancellation and refund were not reached. Evidence captured includes screenshots of catalog, product detail, cart, order‑waiting state, and Stripe Checkout page (375 / 1440 px).**

### Screenshots (git‑ignored, `e2e-logs/phase-e/`)
- 01‑catalog – 375 / 1440 px
- 02‑product – 375 / 1440 px
- 03‑cart – 375 / 1440 px
- 04‑order‑waiting – 375 / 1440 px (order detail loaded while Stripe page was open)
- 05‑stripe‑checkout – 375 / 1440 px (hosted Stripe form, card fields present)

### Evidence JSON (`/private/var/folders/.../T/op/phase-e-ui.json`)
- registration, catalog, product, cart, checkout attempt with orderId, 2 POSTs same key/payload (StrictMode replay), distinct orders = 1, one key, one payload
- product: Demo Headset Pro, price €199.99, stock before 99
- checkout: orderId, posts = 2, distinctOrders = 1, one idempotency key captured, attempt persisted before Stripe redirect
- Stripe session open (EUR, amount_total 19999, currency eur, payment_method_types [card]), providerRef is the Stripe PaymentIntent
- Stripe decline not reached within Phase E run; limits documented below

### Limits / known gaps
- Decline‑then‑retry on the same Stripe session could not be proven within the 45 s webhook‑wait window; the `payment_intent.payment_failed` event may be delivered later or require a different card‑decline scenario (the test card `4000000000000002` produced a Stripe inline error that did not generate a server‑side `failureReason` before the polling deadline).
- Full confirmation‑then‑cancellation‑then‑refund walkthrough was not exercised because the run aborted on the webhook wait.
- Screenshots are local‑only evidence; checkout‑URL or session‑id never appear in them.
- No synthetic data was injected; all product/catalog data came from the live gateway.

## Phase F — documentation and CI (M4b)

**Status: IN_PROGRESS**

### Checks
- `npm ci` PASS (exit 0; blocked esbuild/fsevents install scripts don't affect esbuild binary)
- `npm run build` (`tsc --noEmit && vite build`) PASS — 65 modules transformed, dist built
- `npm run lint` PASS — 0 errors, 0 warnings
- `npm test -- --run` → **17 files, 90 tests, 0 failures**
- `npm audit --omit=dev`: **0 vulnerabilities**; full audit **11 dev‑only high** (picomatch/tinyglobby/fdir through Vite 6 and Vitest 4, and the `@typescript-eslint` chain) — `npm audit fix --dry-run` leaves them; `--force` major upgrades were not applied; no production dependency is affected
- Live smoke through the dev origin `http://localhost:5179` (Vite proxy → gateway `:8080`, real stack): index/main/CSS **200**; `GET /api/products?page=0&size=3` **200** (9 products, 3 pages); login **200** (USER, Bearer); `GET /api/orders/me` **200**; product detail **200** with exactly the six `ProductResponse` fields; unauthenticated `GET /api/orders/me` **401**
- Checkout contract live: `POST /api/orders` with a generated `Idempotency-Key` → **201**; identical replay → **200** with the **same** order id; the order reached `PAYMENT_PENDING` with a payment URL; `POST /api/orders/{id}/cancel` → **200** `CANCELLED`, `refundStatus=NONE`, payment URL retired
- Browser checks (headless Google Chrome 156.0.8078.74, Node v26.7.0) at 375/768/1024/1440: **20 loaded screen/viewport combinations** (catalog, product detail, cart with a line, my orders with the cancelled smoke order, order detail with its real timeline, sign‑in, register, product‑not‑found, 404 route) — **0 px horizontal page overflow**, no page errors. Keyboard tab order starts at the brand link → nav → form controls, and every stop has a visible **3 px solid `#2a4bff`** focus outline. Found and fixed during this check: the visually‑hidden `<th>` labels inside tables were absolutely positioned against the page, widening the document at 375 px; `.table-scroll` is now `position: relative`, so wide tables scroll inside their own container. Screenshots and the measurement report are in `e2e-logs/storefront-responsive/` (git‑ignored)

### Limits
- Screenshots are local‑only evidence and not committed
- No `npm audit fix --force` major upgrades; dev‑only highs accepted with disposition
- Wide cart/orders tables intentionally scroll inside `.table-scroll` at 375 px; page itself must not overflow

## Phase G — final review, commits, shutdown (M5)

**Status: NOT_STARTED**

## Evidence log

## Phase G — final review, commits, shutdown (M5)

**Status: NOT STARTED**

## Evidence log

(appended per phase below)
