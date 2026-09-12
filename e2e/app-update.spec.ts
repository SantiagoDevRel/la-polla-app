import { expect, test } from '@playwright/test';

test('returning restores the update reminder during a slow worker check without losing a draft', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.set(window, '__DISABLE_AGENTATION__', true);
    Reflect.set(window, '__qaWorkerChecks', 0);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: async () => ({
          update: () => {
            Reflect.set(window, '__qaWorkerChecks', Reflect.get(window, '__qaWorkerChecks') + 1);
            return Reflect.get(window, '__qaHoldWorker')
              ? new Promise<void>(resolve => Reflect.set(window, '__qaReleaseWorker', resolve))
              : Promise.resolve();
          },
        }),
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  await page.goto('/soporte');
  await page.waitForFunction(() => Reflect.get(window, '__qaWorkerChecks') > 0);
  const documentTime = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Borrador de prueba');
    document.body.prepend(input);
    Reflect.set(window, '__qaHoldWorker', true);
  });
  await page.getByLabel('Borrador de prueba').fill('Pronóstico sin guardar');
  await page.route('**/api/app-version?*', route => route.fulfill({ json: { version: 'next-test-build' } }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('[data-app-update]')).toBeVisible();
  await page.getByRole('button', { name: 'Recordarme al volver', exact: true }).click();
  await expect(page.locator('[data-app-update]')).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('[data-app-update]')).toBeVisible();
  await expect(page.getByLabel('Borrador de prueba')).toHaveValue('Pronóstico sin guardar');
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentTime);
  await page.evaluate(() => Reflect.get(window, '__qaReleaseWorker')?.());
});
