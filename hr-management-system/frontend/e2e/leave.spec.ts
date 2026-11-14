import { expect, test } from '@playwright/test';
import {
  adminCredentials,
  adminToken,
  completePasswordChange,
  createEmployee,
  signIn,
} from './helpers';

/**
 * A leave request from an employee and its approval by a real manager.
 *
 * Both the manager and employee are created through the API with temporary passwords.
 * Each completes their forced password change. The employee submits a leave request for
 * dynamic future dates, and the manager approves it through the manager approvals dashboard.
 */
test('an employee asks for leave and the real manager approves it', async ({ page, request }) => {
  const { email: adminEmail, password: adminPassword } = adminCredentials();
  const token = await adminToken(request, adminEmail, adminPassword);

  // 1. Create a real manager
  const manager = await createEmployee(request, token, 'E2E Real Manager');
  // Complete forced password change for the manager
  const managerNewPassword = 'ManagerRotated@2026';
  await completePasswordChange(page, manager.email, manager.password, managerNewPassword);

  // 2. Create direct report reporting to manager
  const employee = await createEmployee(request, token, 'E2E Direct Report', manager.id);
  // Complete forced password change for the direct report
  const employeeNewPassword = 'EmployeeRotated@2026';
  await completePasswordChange(page, employee.email, employee.password, employeeNewPassword);

  // 3. Dynamic future dates: choose ~2 weeks ahead on weekdays
  const now = new Date();
  const futureStart = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const dayOfWeek = futureStart.getDay();
  if (dayOfWeek === 0) futureStart.setDate(futureStart.getDate() + 1); // Sunday -> Monday
  if (dayOfWeek === 6) futureStart.setDate(futureStart.getDate() + 2); // Saturday -> Monday
  const futureEnd = new Date(futureStart.getTime() + 24 * 60 * 60 * 1000);

  const startStr = futureStart.toISOString().slice(0, 10);
  const endStr = futureEnd.toISOString().slice(0, 10);

  // 4. Employee submits leave request (already signed in as employee after password change)
  await page.goto('/leave');
  await page.getByLabel(/start date/i).fill(startStr);
  await page.getByLabel(/end date/i).fill(endStr);
  await page.getByLabel(/reason/i).fill('E2E: planned vacation');
  await page.getByRole('button', { name: /submit request/i }).click();
  await expect(page.getByText(/filed:/i)).toBeVisible();

  // 5. Manager signs in and approves the request
  await signIn(page, manager.email, managerNewPassword);
  await page.goto('/approvals');

  const row = page.getByRole('row').filter({ hasText: employee.fullName });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /approve/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /approve/i }).click();
  await expect(page.getByText(new RegExp(`approved ${employee.fullName}'s leave`, 'i'))).toBeVisible();
});
