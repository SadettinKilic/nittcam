import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  KITCHEN,
  fill,
  goStep,
  openGrainedProject,
  paste,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

/**
 * T187: offline / save-failure banner with the unsent queue count and "Tekrar dene"; the queue
 * goes out by itself when the network is back and nothing is lost; client errors reach the
 * server log endpoint. (The revision-conflict notice is covered by t023-wizard.)
 */
const w = tr.wizard;
const b = w.saveBanner;
const PROJECT_PUT = /\/api\/projects\/[0-9a-f-]{36}$/;

test('server down mid-edit: banner counts the queue, Tekrar dene and recovery keep every change', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGrainedProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  // The paste re-renders in a transition (T304): wait for its rows, so saved() sees the paste save.
  await expect(page.getByTestId('cut-list-count')).toHaveText(
    fill(tr.cutList.count, { rows: 5, pieces: 30 }),
  );
  await saved(page);
  const id = await projectId(page);
  await goStep(page, 'makine');

  // The server stops answering project writes.
  let down = true;
  await page.route(PROJECT_PUT, (route) =>
    down && route.request().method() === 'PUT'
      ? route.abort('connectionrefused')
      : route.continue(),
  );
  await page.getByTestId('sheet-grain-dial-quick-90').click();
  const banner = page.getByTestId('save-banner');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toHaveAttribute('data-kind', 'failed');
  await expect(banner).toContainText(b.failedTitle);
  await expect(page.getByTestId('save-banner-count')).toContainText(fill(b.unsent, { count: 1 }));

  // A second edit joins the queue; "Tekrar dene" while still down keeps the banner.
  await page.getByLabel(fill(w.machine.preset, { a: '1.220', b: '2.440' })).check();
  // (the count wording only: commands of one kind may merge in the queue)
  await expect(page.getByTestId('save-banner-count')).toContainText(/\d+ değişiklik/);
  await page.getByTestId('save-banner-retry').click();
  await expect(banner).toBeVisible();

  // Browser offline: the banner says so.
  await page.context().setOffline(true);
  await expect(banner).toHaveAttribute('data-kind', 'offline');
  await expect(banner).toContainText(b.offlineTitle);

  // Back online: the queue is sent at once (no backoff wait) and the banner goes.
  down = false;
  await page.context().setOffline(false);
  await expect(banner).toBeHidden({ timeout: 10_000 });
  await saved(page);

  // Nothing lost: a fresh load shows both edits from the server.
  await page.goto(`/projeler/${id}?adim=makine`);
  await wizardReady(page, 'makine');
  await expect(page.getByLabel(fill(w.machine.preset, { a: '1.220', b: '2.440' }))).toBeChecked();
  // (tester) the first queued edit survived too: sheet grain 90°.
  await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '90');
});

test('client errors are written to the server log', async ({ page, request }) => {
  const ok = await request.post('/api/client-log', {
    data: { kind: 'error', message: 'e2e probe', url: '/e2e' },
  });
  expect(ok.status()).toBe(204);
  const bad = await request.post('/api/client-log', { data: { kind: 'error' } });
  expect(bad.status()).toBe(400);

  // An uncaught error in the page is reported by the shell's listener (after hydration).
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const sent = page.waitForRequest(
    (r) => r.url().endsWith('/api/client-log') && r.method() === 'POST',
  );
  await page.evaluate(() => {
    const error = new Error('t187 uncaught');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
  });
  const req = await sent;
  expect(req.postDataJSON()).toMatchObject({ kind: 'error', url: '/' });
  expect((req.postDataJSON() as { message: string }).message).toContain('t187 uncaught');
});
