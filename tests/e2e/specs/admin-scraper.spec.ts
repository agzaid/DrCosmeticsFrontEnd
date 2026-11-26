/**
 * Price scraper tab of the admin console: every product is listed (linked or not) with its current price, a source URL is
 * typed into the row (an address into a private network is refused and nothing is stored), changed, discarded, filtered by
 * link state and removed; and the automatic daily scrape is switched on at a time of day, shown with its next run,
 * remembered, and switched off. Nothing here reaches another shop: reading a page and applying its price are covered by
 * the API integration tests, where the shops' pages are scripted.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, ElementHandle, Page } from 'puppeteer-core';
import type { ScraperRow, ScraperSchedule } from '../../../src/api/types';
import { ApiClient, adminClient } from '../harness/api.ts';
import { closeBrowser, launchBrowser } from '../harness/browser.ts';
import { LANGS, adminPage, createTestProduct, openTab, pick, setValue, textOf, token, waitForText, waitForToast } from './admin-helpers.ts';

async function rowOf(api: ApiClient, sku: string): Promise<ScraperRow> {
  const page = (await api.get<{ rows: ScraperRow[] }>(`/api/v1/admin/scraper?search=${encodeURIComponent(sku)}`)).data;
  const row = page.rows.find((entry) => entry.sku === sku);
  assert.ok(row, `the scraper lists ${sku}`);
  return row;
}

/** Waits (the page saves in the background) until the server holds `expected` as the product's source URL. */
async function waitForUrl(api: ApiClient, sku: string, expected: string | null): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await rowOf(api, sku)).url === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal((await rowOf(api, sku)).url, expected);
}

async function fieldAt(page: Page, selector: string): Promise<ElementHandle<Element>> {
  const handle = await page.waitForSelector(selector, { timeout: 15_000 });
  assert.ok(handle, `${selector} is on the page`);
  return handle;
}

async function scheduleOf(api: ApiClient): Promise<ScraperSchedule> {
  return (await api.get<{ schedule: ScraperSchedule }>('/api/v1/admin/scraper/schedule')).data.schedule;
}

async function saveSchedule(api: ApiClient, enabled: boolean, time: string): Promise<void> {
  const saved = await api.request('PUT', '/api/v1/admin/scraper/schedule', { body: { enabled, time } });
  assert.equal(saved.status, 200);
}

/** The digits the console prints for a time of day in this language ("23:45", "١١:٤٥" with the period dropped). */
function clockDigits(lang: 'en' | 'ar', time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, hours, minutes))
    .toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    .replace(/[^\d٠-٩:]/g, '');
}

describe('admin price scraper', () => {
  let browser: Browser;
  let admin: ApiClient;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
  });

  after(async () => {
    // The timer of this stack must never find a schedule left on by a failed run.
    await saveSchedule(admin, false, '03:00').catch(() => undefined);
    await closeBrowser();
  });

  for (const lang of LANGS) {
    it(`[${lang}] a product is listed with its current price, given a source URL, refused a private address, edited, filtered and unlinked`, async () => {
      const fixture = await createTestProduct(admin, { price: 100 });
      const { e2e } = await adminPage(browser, lang);
      const row = `[data-scraper-sku="${fixture.sku}"]`;
      const addressField = `${row} [data-field="source-url"]`;
      const disabled = (selector: string): Promise<boolean> =>
        e2e.page.$eval(selector, (button) => (button as HTMLButtonElement).disabled);
      const typedAddress = (): Promise<string> =>
        e2e.page.$eval(addressField, (input) => (input as HTMLInputElement).value);
      const gone = (selector: string): Promise<unknown> =>
        e2e.page.waitForFunction((target: string) => document.querySelector(target) === null, { timeout: 15_000 }, selector);
      const removedToast = pick(lang, 'The source URL was removed.', 'تمت إزالة رابط المصدر.');
      try {
        await openTab(e2e, 'scraper');
        await setValue(await fieldAt(e2e.page, '[data-panel="scraper"] input[type="text"]'), fixture.sku);
        await fieldAt(e2e.page, row);

        // Every product is listed whether or not it has a source URL: this one has none, shows what the shop charges, and
        // has no scraped price, nothing to scrape and nothing to apply.
        assert.ok((await textOf(e2e.page, `${row} [data-field="current-price"]`)).includes(pick(lang, '100', '١٠٠')));
        assert.equal(await textOf(e2e.page, `${row} [data-field="scraped-price"]`), '—');
        assert.equal(await typedAddress(), '');
        assert.equal(await disabled(`${row} [data-action="check"]`), true);
        assert.equal(await disabled(`${row} [data-action="apply"]`), true);
        assert.equal(await e2e.page.$(`${row} [data-action="save-link"]`), null, 'nothing to save before anything is typed');

        // An address into a private network is refused by the server, the row says why, and nothing is stored.
        e2e.allow({ statuses: [{ status: 400, method: 'PUT', url: /\/api\/v1\/admin\/scraper\/[^/]+\/link$/ }] });
        await setValue(await fieldAt(e2e.page, addressField), 'http://127.0.0.1/p');
        await e2e.page.click(`${row} [data-action="save-link"]`);
        const refusal = await waitForText(e2e.page, `${row} [data-field="source-url-error"]`, (text) => text.length > 0);
        assert.match(refusal, lang === 'en' ? /private or internal network/ : /يرجى مراجعة الحقول/);
        assert.equal((await rowOf(admin, fixture.sku)).url, null);
        assert.equal(await typedAddress(), 'http://127.0.0.1/p', 'what was typed stays for correction');

        // A public address is saved with Enter, and the refusal goes.
        const url = `https://shop.example/p/${token('P')}`;
        await setValue(await fieldAt(e2e.page, addressField), url);
        await e2e.page.focus(addressField);
        await e2e.page.keyboard.press('Enter');
        await waitForToast(e2e.page, pick(lang, 'The source URL was saved. Scrape the price to read it.', 'تم حفظ رابط المصدر. اسحب السعر لقراءته.'));
        assert.equal((await rowOf(admin, fixture.sku)).url, url);
        assert.equal(await e2e.page.$(`${row} [data-field="source-url-error"]`), null);
        assert.equal(await disabled(`${row} [data-action="check"]`), false);
        assert.equal(await disabled(`${row} [data-action="apply"]`), true, 'nothing to apply before a price is read');
        assert.equal(await textOf(e2e.page, `${row} [data-field="not-scraped"]`), pick(lang, 'Not scraped yet.', 'لم يُسحب بعد.'));

        // An unsaved change holds the scrape back (it would read the old address) and Escape takes the change back.
        await setValue(await fieldAt(e2e.page, addressField), `${url}-edited`);
        await fieldAt(e2e.page, `${row} [data-action="save-link"]`);
        assert.equal(await disabled(`${row} [data-action="check"]`), true, 'the scrape waits for the save');
        await e2e.page.focus(addressField);
        await e2e.page.keyboard.press('Escape');
        await gone(`${row} [data-action="save-link"]`);
        assert.equal(await typedAddress(), url);
        assert.equal(await disabled(`${row} [data-action="check"]`), false);
        assert.equal((await rowOf(admin, fixture.sku)).url, url, 'nothing was saved');

        // The state filter follows the link.
        await e2e.page.select('[data-panel="scraper"] select', 'unlinked');
        await gone(row);
        await e2e.page.select('[data-panel="scraper"] select', 'linked');
        await fieldAt(e2e.page, row);

        // Removing the link asks first, and the product leaves the "with a source URL" view.
        await e2e.page.click(`${row} [data-action="remove-link"]`);
        await waitForToast(e2e.page, removedToast);
        assert.equal(e2e.dialogs.length, 1);
        assert.ok(e2e.dialogs[0].includes(fixture.sku), 'the confirmation names the product');
        assert.equal((await rowOf(admin, fixture.sku)).url, null);
        await gone(row);

        // It is still a product of the shop, listed again under "all"; emptying a saved address removes it too, after asking.
        await e2e.page.select('[data-panel="scraper"] select', 'all');
        await fieldAt(e2e.page, row);
        await setValue(await fieldAt(e2e.page, addressField), url);
        await e2e.page.focus(addressField);
        await e2e.page.keyboard.press('Enter');
        await waitForUrl(admin, fixture.sku, url);
        await fieldAt(e2e.page, `${row} [data-action="remove-link"]`);
        await setValue(await fieldAt(e2e.page, addressField), '');
        await e2e.page.click(`${row} [data-action="save-link"]`);
        await waitForUrl(admin, fixture.sku, null);
        assert.equal(e2e.dialogs.length, 2, 'emptying the field asks like the remove button does');

        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });

    it(`[${lang}] automatic scraping is switched on at a time of day, shown with its next run, remembered and switched off`, async () => {
      await saveSchedule(admin, false, '03:00');
      const { e2e } = await adminPage(browser, lang);
      const dialog = '[role="dialog"] form[data-form="scraper-schedule"]';
      const timeField = `${dialog} [data-field="schedule-time"]`;
      const enabledField = `${dialog} [data-field="schedule-enabled"]`;
      const off = pick(lang, 'Automatic scraping is off.', 'السحب التلقائي متوقف.');
      try {
        await openTab(e2e, 'scraper');
        await fieldAt(e2e.page, '[data-action="schedule"]:not([disabled])');
        assert.equal(await textOf(e2e.page, '[data-field="schedule-line"]'), off);
        assert.equal(await e2e.page.$('[data-field="schedule-badge"]'), null);

        // A form without a time is refused before anything is sent.
        await e2e.page.click('[data-action="schedule"]');
        await fieldAt(e2e.page, dialog);
        assert.equal(
          await e2e.page.$eval(timeField, (input) => (input as HTMLInputElement).value),
          '03:00',
          'the time a schedule starts with before anybody sets one',
        );
        await setValue(await fieldAt(e2e.page, timeField), '');
        await e2e.page.click(`${dialog} button[type="submit"]`);
        assert.equal(
          await waitForText(e2e.page, `${dialog} [role="alert"]`, (text) => text.length > 0),
          pick(lang, 'Enter the time of day, for example 03:00.', 'أدخل وقت اليوم، مثل 03:00.'),
        );
        assert.equal((await scheduleOf(admin)).enabled, false);

        // Switched on at 23:45: the server answers with the next run, on the shop's clock, within a day.
        await setValue(await fieldAt(e2e.page, timeField), '23:45');
        await e2e.page.click(enabledField);
        await e2e.page.click(`${dialog} button[type="submit"]`);
        await e2e.page.waitForSelector('[role="dialog"]', { hidden: true });
        await waitForToast(e2e.page, pick(lang, 'Automatic scraping is on: every day at 23:45.', 'السحب التلقائي يعمل: كل يوم الساعة'));
        const saved = await scheduleOf(admin);
        assert.equal(saved.enabled, true);
        assert.equal(saved.time, '23:45');
        assert.ok(saved.nextRunAtUtc, 'an enabled schedule has a next run');
        const untilNext = Date.parse(saved.nextRunAtUtc) - Date.now();
        assert.ok(untilNext > 0 && untilNext <= 25 * 3_600_000, `the next run is within a day (${untilNext} ms)`);
        assert.equal(
          new Date(saved.nextRunAtUtc).toLocaleTimeString('en-GB', { timeZone: saved.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
          '23:45',
          'the time is read on the shop clock',
        );
        assert.equal(saved.lastRun, null);

        const status = await textOf(e2e.page, '[data-field="schedule-line"]');
        assert.ok(status.includes(clockDigits(lang, '23:45')), `the status names the time: ${status}`);
        assert.ok(status.includes(pick(lang, 'Next run', 'التشغيل القادم')), `the status names the next run: ${status}`);
        assert.ok((await textOf(e2e.page, '[data-field="schedule-badge"]')).includes(clockDigits(lang, '23:45')));

        // What was saved is what the form opens with.
        await e2e.page.click('[data-action="schedule"]');
        await fieldAt(e2e.page, dialog);
        assert.equal(await e2e.page.$eval(timeField, (input) => (input as HTMLInputElement).value), '23:45');
        assert.equal(await e2e.page.$eval(enabledField, (input) => (input as HTMLInputElement).checked), true);
        assert.ok((await textOf(e2e.page, `${dialog} [data-field="schedule-previous"]`)).includes(pick(lang, 'it has not run yet', 'لم يعمل بعد')));

        // Switched off, the time is remembered and there is no next run.
        await e2e.page.click(enabledField);
        await e2e.page.click(`${dialog} button[type="submit"]`);
        await e2e.page.waitForSelector('[role="dialog"]', { hidden: true });
        await waitForToast(e2e.page, pick(lang, 'Automatic scraping is off.', 'تم إيقاف السحب التلقائي.'));
        const stopped = await scheduleOf(admin);
        assert.equal(stopped.enabled, false);
        assert.equal(stopped.time, '23:45');
        assert.equal(stopped.nextRunAtUtc, null);
        assert.equal(await textOf(e2e.page, '[data-field="schedule-line"]'), off);
        assert.equal(await e2e.page.$('[data-field="schedule-badge"]'), null);

        e2e.assertClean();
      } finally {
        await e2e.close();
        await saveSchedule(admin, false, '03:00');
      }
    });

    it(`[${lang}] on a phone the page does not scroll sideways: the table scrolls inside its card`, async () => {
      // A linked row is the widest: its address field has the open and remove buttons beside it.
      const fixture = await createTestProduct(admin, { price: 100 });
      const linked = await admin.request('PUT', `/api/v1/admin/scraper/${fixture.variant.id}/link`, {
        body: { url: `https://shop.example/p/${token('P')}` },
      });
      assert.equal(linked.status, 200);
      const { e2e } = await adminPage(browser, lang, { width: 390, height: 844 });
      try {
        await openTab(e2e, 'scraper');
        await setValue(await fieldAt(e2e.page, '[data-panel="scraper"] input[type="text"]'), fixture.sku);
        await fieldAt(e2e.page, `[data-scraper-sku="${fixture.sku}"] [data-action="remove-link"]`);

        assert.equal(
          await e2e.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
          false,
          'the page itself does not scroll sideways',
        );
        assert.equal(
          await e2e.page.$eval('[data-panel="scraper"] table', (table) => {
            const card = table.parentElement as HTMLElement;
            return card.scrollWidth > card.clientWidth;
          }),
          true,
          'the table scrolls inside its card instead',
        );

        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });
  }
});
