import { expect, test } from '@playwright/test';
import { adminCredentials, signIn } from './helpers';

/** The attendance clocking: check in, then check out again. */
test('checks in and out again', async ({ page }) => {
  const { email, password } = adminCredentials();

  await signIn(page, email, password);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /today/i })).toBeVisible();

  const checkIn = page.getByRole('button', { name: 'Check in' });
  const checkOut = page.getByRole('button', { name: 'Check out' });

  if (await checkIn.isEnabled()) {
    await checkIn.click();
  }
  await expect(checkOut).toBeEnabled();
  await checkOut.click();

  // After the check-out the check-in is available again.
  await expect(checkIn).toBeEnabled();
});
