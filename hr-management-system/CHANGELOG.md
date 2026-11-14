# Changelog

All notable changes to the HR Management System are documented in this file.

## [Unreleased] - 2026-11-14

### Security & Dependency Hardening (Phase 1)
- **Frontend Vulnerability Remediation**: Resolved development and production tooling advisories, achieving 0 vulnerabilities across both `npm audit` and `npm audit --omit=dev --audit-level=low`.
- **Environment & Secret Hygiene**: Hardened `.env.example` and documentation for Docker Compose to mandate non-default `DB_PASSWORD` and `JWT_SECRET`. Secured `.env.local` permissions (`0600`) and verified config validation without committing secrets.
- **Strict Role-Based Access & Admin Forced Rotation**: Verified admin bootstrap forces initial password change (`mustChangePassword: true`) prior to accessing any business endpoints.

### Core Architecture & Gap Implementation (Phase 2)
- **Gap 1 (Payroll Recalculation & Clamping)**: Added automatic recalculation trigger and page clamping to `PayrollRunPage.tsx` when employee rosters or parameters change.
- **Gap 2 (Large-Batch Payroll Processing)**: Validated boundary handling for batches exceeding 500 employees (tested up to 505 employees) with 100-record batch chunking, individual calculation isolation, and strict transaction rollback on unhandled batch errors.
- **Gap 3 (Optimistic Concurrency & Lock Serialization)**: Implemented `@Version` optimistic concurrency control on `PayrollRun` entity with explicit `saveAndFlush()` to prevent race conditions during concurrent recalculate/finalize operations.
- **Gap 4 (Accessible Manager Combobox)**: Upgraded `ManagerCombobox.tsx` with ARIA combobox pattern, keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`), clear selection button, and abort controller to prevent stale search results.
- **Gap 5 (Org Chart Scalability)**: Added bounded query limits (`LIMIT 500`) to `EmployeeRepository.findOrgChartRoots()` and `findOrgChartChildren()` to protect against memory exhaustion on large organizational hierarchies.
- **Gap 6 (Predictable Employee Numbering)**: Standardized sequential identifier generation (`EMP-10000+`) across employee creation and import pipelines.
- **Gap 7 (Streaming Excel Export)**: Replaced standard in-memory workbook with Apache POI `SXSSFWorkbook` (100-row sliding window) and batch-queried payslips (`PayrollService.payslipsBatch()`) to stream multi-thousand-row Excel exports within a 128MB JVM heap.
- **Gap 8 (Atomic Redis Login Throttling)**: Implemented atomic Lua script in `RedisLoginThrottle` with sliding TTL window and graceful fail-open fallback if Redis becomes unavailable.
- **Gap 9 (Container Resource Isolation)**: Configured hard container memory limits (`deploy.resources.limits.memory`) and health checks in `docker-compose.yml`, mounting Redis persistence to `/data`.
- **Gap 10 (Admin TOTP MFA Assessment)**: Evaluated TOTP MFA requirements and documented technical deferral justification in favor of forced password rotation and session invalidation for single-node deployments.

### Quality Assurance & CI/CD Pipeline (Phase 3)
- **Comprehensive Backend Testing**: All 607 backend unit, integration, and architecture tests passing (`BUILD SUCCESS`) via isolated Testcontainers.
- **Robust Frontend Testing**: 200/200 Vitest unit tests passing; ESLint clean with 0 errors and 0 warnings.
- **Playwright End-to-End Suite**: Fixed session pollution, multi-field password change confirmation, and dynamic table row selectors across `sign-in.spec.ts`, `attendance.spec.ts`, `leave.spec.ts`, and `payroll.spec.ts`.
- **Automated GitHub Actions CI**: Configured `.github/workflows/hr-management-system.yml` with parallel backend, frontend, audit, and containerized E2E test jobs.
