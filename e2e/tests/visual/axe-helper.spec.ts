import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './helpers';

// T102: the axe helper must catch a planted violation and pass a clean page.
test.describe('expectNoA11yViolations', () => {
  test('fails on a serious/critical violation', async ({ page }) => {
    await page.setContent(
      '<html lang="tr"><head><title>x</title></head><body><main>' +
        '<button></button><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">' +
        '</main></body></html>',
    );
    let message = '';
    try {
      await expectNoA11yViolations(page);
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain('button-name');
    expect(message).toContain('image-alt');
  });

  test('passes a clean page', async ({ page }) => {
    await page.setContent(
      '<html lang="tr"><head><title>x</title></head><body><main><h1>Başlık</h1>' +
        '<button>Kaydet</button></main></body></html>',
    );
    await expectNoA11yViolations(page);
  });
});
