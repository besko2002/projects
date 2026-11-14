import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the Docker stack (the API behind the nginx-served frontend).
 *
 * The stack is started by the CI job (docker compose --profile app up -d --build); the base URL
 * points at the frontend, which proxies /api to the API container. The credentials of the
 * bootstrap administrator come from the environment, because there is no default password for it:
 *   E2E_BASE_URL   (default http://127.0.0.1:5175)
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
