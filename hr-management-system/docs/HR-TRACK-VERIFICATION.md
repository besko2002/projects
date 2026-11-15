# HR track verification

## H1 — attendance mutation barrier

- `npm test -- --run src/pages/DashboardPage.test.tsx -t 'blocks a second'`: RED on original code, both check-in and check-out fail the disabled-button assertion while GET is deferred.
- Made `useResource.reload()` awaitable and generation-aware; Dashboard awaits refresh before releasing busy. Superseded requests cannot release the barrier; current success/error or unmount settles it. Background refresh still does not disable available actions.
- Hook regression (success/failure/unmount): historical original hook restored temporarily in a try/finally harness, three expected boolean assertion failures; fixed hook restored safely. This additional coverage was authored after the first fix and verified by historical regression, not claimed as test-first implementation.
- `npm test -- --run`: 229 tests passed. `npm run build`, `npm run lint`, `git diff --check`: passed.
- Evidence: scratch `hr-h1-red.log`, `hr-h1-hook-red.log`, `hr-h1-green.log`. Fetch doubles/jsdom, not real browser/API.
- Scoped self-review: no authority changes, secrets, migrations or SQL; existing consumers may ignore the never-rejecting reload promise. No independent reviewer used at this step.

## H2 — meaningful focus/deadlock regressions

- Focus test now awaits initial readiness and `act(focus)`, asserts exactly two `/today` reads, and settles its deferred response inside `act`. Historical loading-disable mutation fails the post-focus enabled assertion (not initial loading); restored code passes.
- Mutual HR correction test uses two independent transaction-bound JDBC connections (distinct `pg_backend_pid`), acquires the production employee lock on both targets before either request proceeds, and requires HTTP `201, 201` plus both committed cross-actor rows. Replacing only `FOR NO KEY UPDATE` with historical `FOR UPDATE` in the isolated build produces a real PostgreSQL deadlock; restored code passes.
- New standalone MVC unit regression translates SQLSTATE `40P01` through Spring's SQL-state translator and checks the advice response is retryable 409. Removing the existing pessimistic-lock handler in the isolated copy yields expected 409/actual 500; restored handler passes.
- Native runner safety reviewed: generated `hr_test_<uuid>` databases only, restricted role, cleanup in finally; Redis excluded. Backend source and Maven output are isolated in scratch `hr-track-isolated/hr-management-system`. The source runner is adapted only for copy root and optional test selector. No live JAR rebuilt.
- `python3 /Users/god_fatheer/.hermes/cache/scratch/hr-track-run.py h2-backend`: 634 tests, zero failures/errors/skips. `npm test -- --run`: 229 passed.
- Evidence: scratch `hr-h2-focus-red.log`, `hr-lock-red.log`, `hr-lock-green.log`, `hr-mapping-red.log`, `hr-h2-backend.log`, `hr-h2-frontend.log`. Real native PostgreSQL for concurrency; MVC/HTTP in-process, synthetic SQL exception for mapping; jsdom/fetch doubles for focus.
- Harness correction: restored source timestamps initially let Maven reuse mutated bytecode. The runner now removes isolated classes/test-classes/maven-status before every run; clean recompilation is green. This initial failed green attempt is retained in the execution history, not counted as an application regression.

## H3 — role/session coherence and transaction requirement

- Chosen policy: changing an employee's role revokes previous JWTs (increment `token_version` only on a real change); the next request returns 401 with an explicit sign-in instruction. Fresh login receives the new role. No-op role changes preserve sessions. README documents this choice.
- Two parameterized API regressions (promotion and demotion) fail before implementation, then pass; they check no-op preservation, version bump, old-token reset rejection and fresh-token reset permission.
- Repository lock now requires `Propagation.MANDATORY`. New integration test first fails because autocommit silently succeeds; after the guard, outside-transaction use throws and inside-transaction use succeeds.
- `python3 /Users/god_fatheer/.hermes/cache/scratch/hr-track-run.py h3-backend-final`: 637 tests, zero failures/errors/skips (Redis excluded), real native PostgreSQL, in-process MVC.
- The first full run correctly caught three existing tests asserting the former password-only message. Updated only their message expectations; all three fail against the historical message mutation and pass against the new generic credential/permission message. Existing token-revocation assertions retained.
- Evidence: scratch `hr-h3-role-red.log`, `hr-h3-role-green.log`, `hr-h3-transaction-red.log`, `hr-message-red.log`, `hr-h3-backend-final.log`. No schema changes or saved-data access.
