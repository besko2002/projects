import { expect, test } from '@playwright/test';
import { adminCredentials, signIn } from './helpers';

/** A payroll run: create it for a month, recalculate it, and finalize it. */
test('creates a payroll run, recalculates it, and finalizes it', async ({ page }) => {
  const { email, password } = adminCredentials();

  await signIn(page, email, password);
  await page.goto('/payroll');

  // The run for the current month
  await page.getByRole('button', { name: /create run/i }).first().click();

  // The run page shows the totals and the payslips of the run.
  await expect(page.getByRole('heading', { name: /totals/i })).toBeVisible();

  // Recalculate draft run
  const recalculate = page.getByRole('button', { name: 'Recalculate' });
  await expect(recalculate).toBeVisible();
  await recalculate.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Recalculate' }).click();
  await expect(page.getByText(/payroll run recalculated/i)).toBeVisible();

  // Finalize run
  const finalize = page.getByRole('button', { name: 'Finalize' });
  await expect(finalize).toBeVisible();
  await finalize.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finalize' }).click();
  await expect(page.getByText(/payroll run finalized/i)).toBeVisible();

  // A finalized run can no longer be recalculated.
  await expect(page.getByRole('button', { name: 'Recalculate' })).toHaveCount(0);
});
