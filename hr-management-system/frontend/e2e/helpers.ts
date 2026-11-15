import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

let resolvedAdminPassword: string | null = null;

export async function getAdminPassword(): Promise<string> {
  if (resolvedAdminPassword) {
    return resolvedAdminPassword;
  }
  const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@hr.local';
  const initial = process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdmin@2026';
  const rotated = `${initial.replace(/#Rotated$/, '')}#Rotated`;

  try {
    const res = await fetch(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5176'}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: rotated }),
    });
    if (res.status === 200) {
      resolvedAdminPassword = rotated;
      return rotated;
    }
  } catch {
    // If request fails, fall back to initial
  }

  resolvedAdminPassword = initial;
  return initial;
}

/** Signs in through the real login form. */
export async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Ignore in non-browser context
    }
  });
  await page.goto('/login');

  const enterBtn = page.getByRole('button', { name: /enter|sign in/i }).first();
  if (await enterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await enterBtn.click();
  }

  const adminEmail = (process.env.E2E_ADMIN_EMAIL ?? 'admin@hr.local').toLowerCase();
  const isAdmin = email.toLowerCase() === adminEmail;
  let activePassword = password;
  if (isAdmin) {
    activePassword = await getAdminPassword();
  }

  await page.getByLabel(/work email/i).fill(email);
  await page.getByLabel('Password').fill(activePassword);
  await page.getByRole('button', { name: /sign in/i }).last().click();

  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15000 });

  // If bootstrap admin was forced to change password, complete it to reach dashboard
  if (isAdmin) {
    const changePasswordHeading = page.getByRole('heading', { name: /change.*password/i });
    if (await changePasswordHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
      const initial = process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdmin@2026';
      const rotated = `${initial.replace(/#Rotated$/, '')}#Rotated`;
      await page.getByLabel(/current password/i).fill(activePassword);
      await page.getByLabel(/^new password/i).fill(rotated);
      await page.getByLabel(/repeat new password/i).fill(rotated);
      await page.getByRole('button', { name: /change password/i }).click();
      await page.waitForURL((url) => !url.pathname.includes('/change-password'), { timeout: 15000 });
      resolvedAdminPassword = rotated;
    }
  }
}

/** Completes the initial forced-password change flow after first sign-in. */
export async function completePasswordChange(
  page: Page,
  email: string,
  temporaryPassword: string,
  newPassword = 'E2eRotated@2026',
): Promise<string> {
  await signIn(page, email, temporaryPassword);
  await expect(page.getByRole('heading', { name: /change.*password/i })).toBeVisible();
  await page.getByLabel(/current password/i).fill(temporaryPassword);
  await page.getByLabel(/^new password/i).fill(newPassword);
  await page.getByLabel(/repeat new password/i).fill(newPassword);
  await page.getByRole('button', { name: /change password/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/change-password'), { timeout: 15000 });
  return newPassword;
}

/** The credentials of the bootstrap administrator, from the environment. */
export function adminCredentials(): { email: string; password: string } {
  const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@hr.local';
  const initial = process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdmin@2026';
  return { email, password: resolvedAdminPassword ?? initial };
}

/**
 * Creates an employee through the API (as the administrator) and returns the record together
 * with the temporary password the employee signs in with.
 */
export async function createEmployee(
  request: APIRequestContext,
  token: string,
  fullName: string,
  managerId?: string,
): Promise<{ id: string; fullName: string; email: string; password: string }> {
  const data: Record<string, unknown> = {
    fullName,
    email: `${fullName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}-${Date.now()}-${Math.floor(Math.random() * 1000)}@hr.local`,
    role: 'EMPLOYEE',
    jobTitle: 'Tester',
    hireDate: '2024-01-15',
    salary: '4200.00',
  };
  if (managerId !== undefined) {
    data.managerId = managerId;
  }
  const response = await request.post('/api/employees', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data,
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return {
    id: body.employee.id,
    fullName: body.employee.fullName,
    email: body.employee.email,
    password: body.temporaryPassword,
  };
}

/** The access token of the administrator, through the API. */
export async function adminToken(
  request: APIRequestContext,
  email: string,
  password?: string,
): Promise<string> {
  // A previous worker may already have rotated the bootstrap password. Resolve it again
  // rather than trusting an initial credential captured before that worker completed.
  const isBootstrapAdmin = email.toLowerCase() === (process.env.E2E_ADMIN_EMAIL ?? 'admin@hr.local').toLowerCase();
  const adminPwd = isBootstrapAdmin ? await getAdminPassword() : password || await getAdminPassword();
  const response = await request.post('/api/auth/login', {
    data: { email, password: adminPwd },
  });
  expect(response.status()).toBe(200);
  const data = await response.json();
  let token: string = data.accessToken;
  if (data.user?.mustChangePassword) {
    const initial = process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdmin@2026';
    const rotated = `${initial.replace(/#Rotated$/, '')}#Rotated`;
    const changeRes = await request.post('/api/auth/change-password', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        currentPassword: adminPwd,
        newPassword: rotated,
      },
    });
    expect(changeRes.status()).toBe(200);
    const newHeader = changeRes.headers()['x-access-token'];
    if (newHeader) {
      token = newHeader;
    }
    resolvedAdminPassword = rotated;
  }
  return token;
}
