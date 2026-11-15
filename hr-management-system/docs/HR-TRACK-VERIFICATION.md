# HR track verification

## H1 — attendance mutation barrier

- `npm test -- --run src/pages/DashboardPage.test.tsx -t 'blocks a second'`: RED on original code, both check-in and check-out fail the disabled-button assertion while GET is deferred.
- Made `useResource.reload()` awaitable and generation-aware; Dashboard awaits refresh before releasing busy. Superseded requests cannot release the barrier; current success/error or unmount settles it. Background refresh still does not disable available actions.
- Hook regression (success/failure/unmount): historical original hook restored temporarily in a try/finally harness, three expected boolean assertion failures; fixed hook restored safely. This additional coverage was authored after the first fix and verified by historical regression, not claimed as test-first implementation.
- `npm test -- --run`: 229 tests passed. `npm run build`, `npm run lint`, `git diff --check`: passed.
- Evidence: scratch `hr-h1-red.log`, `hr-h1-hook-red.log`, `hr-h1-green.log`. Fetch doubles/jsdom, not real browser/API.
- Scoped self-review: no authority changes, secrets, migrations or SQL; existing consumers may ignore the never-rejecting reload promise. No independent reviewer used at this step.
