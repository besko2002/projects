import { expect, test } from '@playwright/test';
import { adminCredentials, adminToken, signIn } from './helpers';

/**
 * Signing in, and the forced password change: a fresh account may do nothing but change its
 * password until it has.
 */
test('signs in and reaches the dashboard', async ({ page }) => {
  const { email, password } = adminCredentials();

  await signIn(page, email, password);

  await expect(page.getByRole('link', { name: /attendance/i }).first()).toBeVisible();
});

test('a new employee has to change the password before it can do anything else', async ({
  page,
  request,
}) => {
  const { email, password } = adminCredentials();
  const token = await adminToken(request, email, password);

  const response = await request.post('/api/employees', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      fullName: 'E2E Forced Change',
      email: `e2e-forced-${Date.now()}@hr.local`,
      role: 'EMPLOYEE',
      jobTitle: 'Tester',
      hireDate: '2024-01-15',
      salary: '4200.00',
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  const temporaryPassword: string = body.temporaryPassword;

  await signIn(page, body.employee.email, temporaryPassword);

  // The password change is the only thing the account may do.
  await expect(page.getByRole('heading', { name: /change.*password/i })).toBeVisible();
  await page.getByLabel(/current password/i).fill(temporaryPassword);
  await page.getByLabel(/^new password/i).fill('E2eRotated@2026');
  await page.getByLabel(/repeat new password/i).fill('E2eRotated@2026');
  await page.getByRole('button', { name: /change password/i }).click();

  // And afterwards the dashboard is reachable.
  await expect(page.getByRole('link', { name: /attendance/i }).first()).toBeVisible();
});
