# Changelog

All notable changes to the HR Management System are documented in this file.

## [Unreleased] - 2026-11-14

### Security & Dependency Hardening
- **Frontend Vulnerability Remediation**: Resolved development and production tooling advisories, achieving 0 vulnerabilities across both `npm audit` and `npm audit --omit=dev --audit-level=low`.
- **Environment & Secret Hygiene**: Hardened `.env.example` and documentation for Docker Compose to mandate non-default `DB_PASSWORD` and `JWT_SECRET`. Secured `.env.local` permissions (`0600`) and verified config validation without committing secrets.
- **Strict Role-Based Access & Admin Forced Rotation**: Verified admin bootstrap forces initial password change (`mustChangePassword: true`) prior to accessing any business endpoints.

### Core Architecture & Business Workflow Refinement
- **Payroll Recalculation Count Synchronization**: Updated `PayrollService.recalculate()` to build and persist replacement payslips before assembling the response envelope, ensuring `run.payslipCount`, `totals.employees`, and database rows remain in exact agreement.
- **Pessimistic Concurrency Serialization & Rollback**: Added `@Lock(LockModeType.PESSIMISTIC_WRITE)` query (`findByIdForUpdate`) in `PayrollRunRepository`. Serialized recalculate, finalize, and delete workflows under database row-level locking with strict status checking, preventing race conditions and ensuring later-batch failures roll back completely without leaving partial payslips.
- **Bounded Org-Chart Pagination & Continuation**: Replaced silent `LIMIT 500` truncation in `EmployeeRepository` with bounded pagination (`findOrgChartRootsPaged`, `findOrgChartChildrenPaged`) returning `PageResponse<OrgChartNode>`. Added frontend continuation ("Load more roots", "Load more reports") to make arbitrary organizational depths and breadths accessible without unbounded memory payloads.
- **Org-Chart Continuation Cache**: Keep already expanded report branches visible when appending more root pages; retry page zero after an initial reports request fails instead of skipping it. Added regression coverage for both cases.
- **Manager Selection Display**: Separated manager identity/display from search query in `ManagerCombobox.tsx`. Added `initialLabel` support to render existing managers on load, show selected candidate labels upon choice, and remove display badges cleanly when cleared, while preserving keyboard navigation and search cancellation.
- **Redis Sliding-Window Rate Limiting**: Replaced fixed-window counter with Redis Sorted Sets (ZSET) in `RedisLoginThrottle`, using millisecond scores, atomic Lua scripts for pruning and recording, and explicit fail-open logging on Redis outages to match `LoginRateLimiter` sliding-window semantics.
- **Predictable Employee Numbering**: Standardized sequential identifier generation (`EMP-10000+`) across employee creation and import pipelines.
- **Streaming Excel Export**: Replaced standard in-memory workbook with Apache POI `SXSSFWorkbook` (100-row sliding window) and batch-queried payslips (`PayrollService.payslipsBatch()`) to stream multi-thousand-row Excel exports with bounded JVM heap consumption.
- **Container Resource Isolation**: Configured container memory limits (`deploy.resources.limits.memory`) and health checks in `docker-compose.yml`, mounting Redis persistence to `/data`.
- **Admin TOTP MFA Assessment**: Evaluated TOTP MFA requirements and documented technical deferral justification in favor of forced password rotation and session invalidation for single-node deployments.

### Quality Assurance, Scale Benchmarks & Documentation
- **Targeted Integration Verification**: Verified targeted regression suites against isolated Testcontainers:
  - `PayrollRunIntegrationTest` & `PayrollBatchBoundaryIntegrationTest`: 27/27 tests passed.
  - `HierarchyIntegrationTest`: 17/17 tests passed.
  - `RedisLoginThrottleIntegrationTest`: 6/6 tests passed.
  - `PayrollFullStackScaleTest`: 5,000-employee roster full-stack workload passed (payroll calculation in ~7.3s, streaming export in ~2.2s, heap snapshot ~166 MB).
  - Explicitly documented that 20,000 employee full-stack capacity remains unverified due to runner container limits.
- **Final Native Verification**: Full backend `verify` completed with 613 tests, zero failures/errors/skips, using native Java 21 and isolated Testcontainers databases. All five browser workflows passed against a throwaway native PostgreSQL database, and payroll recalculation counts matched response totals and stored rows.
- **Frontend Regression Verification**: The earlier full frontend run passed 200 tests. After the latest changes, all 39 targeted manager, employee-detail, payroll, and org-chart regression tests passed; build and lint also passed. Unchanged frontend suites were not rerun.
- **Documentation Accuracy**: Corrected claims regarding zero-downtime rolling updates on single-node compose, documented container restart gap, updated locking and pagination documentation, and marked production templates (`docker-compose.prod.yml`, `Caddyfile`, `deploy.yml`) as unverified reference designs.
