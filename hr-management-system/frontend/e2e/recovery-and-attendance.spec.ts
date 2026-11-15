import { expect, test } from '@playwright/test';
import { adminCredentials, adminToken, completePasswordChange, createEmployee, getAdminPassword, signIn } from './helpers';

async function admin(request: Parameters<typeof adminToken>[0]): Promise<string> {
  return adminToken(request, adminCredentials().email, await getAdminPassword());
}

async function employeeToken(request: Parameters<typeof adminToken>[0], email: string, password: string): Promise<string> {
  const response = await request.post('/api/auth/login', { data: { email, password } });
  expect(response.status()).toBe(200);
  return (await response.json()).accessToken as string;
}

test('HR resets a lost password, revokes old tokens and a wrong current password remains recoverable', async ({ page, request }) => {
  const token = await admin(request);
  const employee = await createEmployee(request, token, 'E2E Password Recovery');
  const oldPassword = 'BeforeRecovery@2026';
  await completePasswordChange(page, employee.email, employee.password, oldPassword);
  const oldToken = await employeeToken(request, employee.email, oldPassword);
  await signIn(page, adminCredentials().email, await getAdminPassword());
  await page.goto(`/employees/${employee.id}`);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await page.getByLabel('Audit reason').fill('Verified identity after lost onboarding credentials');
  await page.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  const secret = page.locator('code[aria-label="Temporary password"]');
  await expect(secret).toBeVisible();
  const temporaryPassword = (await secret.innerText()).trim();
  expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
  expect((await request.get('/api/employees/me', { headers: { Authorization: `Bearer ${oldToken}` } })).status()).toBe(401);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(secret).toBeVisible();
  await page.getByLabel('I have securely shared or recorded this password.').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await signIn(page, employee.email, temporaryPassword);
  await expect(page.getByRole('heading', { name: /change.*password/i })).toBeVisible();
  await page.getByLabel(/current password/i).fill('AnIncorrectCurrentPassword@2026');
  await page.getByLabel(/^new password/i).fill('AfterRecovery@2026');
  await page.getByLabel(/repeat new password/i).fill('AfterRecovery@2026');
  await page.getByRole('button', { name: /change password/i }).click();
  await expect(page.getByText('The current password is incorrect', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/change-password/);
  await page.getByLabel(/current password/i).fill(temporaryPassword);
  await page.getByRole('button', { name: /change password/i }).click();
  await expect(page.getByRole('heading', { name: /hello,/i })).toBeVisible();
});

test('HR adds and corrects missing attendance, with overlap errors kept in the repair dialog', async ({ page, request }) => {
  const token = await admin(request);
  const employee = await createEmployee(request, token, 'E2E Attendance Repair');
  const past = new Date();
  past.setUTCDate(past.getUTCDate() - 2);
  const date = past.toISOString().slice(0, 10);
  await signIn(page, adminCredentials().email, await getAdminPassword());
  await page.goto(`/employees/${employee.id}`);
  await page.getByRole('link', { name: 'Manage attendance' }).click();
  await page.getByLabel('Pick a month').fill(date.slice(0, 7));
  await page.getByRole('button', { name: 'Add missing session' }).click();
  await page.getByLabel('Check-in (UTC)', { exact: false }).fill(`${date}T07:00`);
  await page.getByLabel('Check-out (UTC)').fill(`${date}T15:00`);
  await page.getByLabel('Audit reason').fill('Recovered missing paper clock record');
  const added = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/attendance/employees/${employee.id}/sessions`);
  await page.getByRole('button', { name: 'Save attendance' }).click();
  const response = await added;
  expect(response.status()).toBe(201);
  const session = await response.json();
  await expect(page.getByText('Missing attendance session added.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Correct session ${session.id}`, exact: true }).click();
  await page.getByLabel('Check-out (UTC)').fill(`${date}T16:00`);
  await page.getByLabel('Audit reason').fill('Verified the actual checkout with employee and manager');
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page.getByText('Attendance session corrected.', { exact: true })).toBeVisible();
  const actual = await request.get(`/api/attendance/employees/${employee.id}?from=${date}&to=${date}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(actual.status()).toBe(200);
  expect((await actual.json()).workedMinutes).toBe(540);
  await page.getByRole('button', { name: 'Add missing session' }).click();
  await page.getByLabel('Check-in (UTC)', { exact: false }).fill(`${date}T08:00`);
  await page.getByLabel('Check-out (UTC)').fill(`${date}T10:00`);
  await page.getByLabel('Audit reason').fill('Deliberately conflicting correction for regression verification');
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/overlap/i);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('deciding the last request on page two returns to the remaining approvals', async ({ page, request }) => {
  const token = await admin(request);
  const manager = await createEmployee(request, token, 'E2E Queue Manager');
  await completePasswordChange(page, manager.email, manager.password, 'QueueManager@2026');
  const employee = await createEmployee(request, token, 'E2E Queue Report', manager.id);
  await completePasswordChange(page, employee.email, employee.password, 'QueueEmployee@2026');
  const employeeJwt = await employeeToken(request, employee.email, 'QueueEmployee@2026');
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 14);
  for (let i = 0; i < 11; i++) {
    while ([5, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
    const date = day.toISOString().slice(0, 10);
    const response = await request.post('/api/leave/requests', { headers: { Authorization: `Bearer ${employeeJwt}` }, data: { type: 'UNPAID', startDate: date, endDate: date, reason: 'Pagination regression fixture' } });
    expect(response.status()).toBe(201);
    day.setUTCDate(day.getUTCDate() + 1);
  }
  await signIn(page, manager.email, 'QueueManager@2026');
  await page.goto('/approvals');
  await expect(page.getByText('Page 1 of 2 · 11 total', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 2 · 11 total', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Approve ${employee.fullName}'s leave request`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Page 1 of 1 · 10 total', { exact: true })).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(11);
  await expect(page.getByText('Every request has been decided.', { exact: true })).toHaveCount(0);
});

test('a browser on another calendar day can still check in and out using the company day', async ({ browser, request }) => {
  const token = await admin(request);
  const todayResponse = await request.get('/api/attendance/today', { headers: { Authorization: `Bearer ${token}` } });
  expect(todayResponse.status()).toBe(200);
  const businessDay: string = (await todayResponse.json()).from;
  const zones = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'];
  const browserZone = zones.find(timeZone => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}` !== businessDay;
  });
  expect(browserZone).toBeDefined();
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5175', timezoneId: browserZone });
  try {
    const page = await context.newPage();
    await signIn(page, adminCredentials().email, await getAdminPassword());
    await expect(page.getByText(/company calendar/)).toBeVisible();
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check out', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(page.getByText('Checked out.', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
