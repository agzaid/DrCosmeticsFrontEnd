/**
 * (e) Promotions: coupon create / use in a real storefront checkout / usage / limit / expiry / archive (A-38) and
 * homepage banner editing, deactivation and upload (A-39, A-40). Storefront actions run in a second browser context.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import type { Product, PromotionalBanner } from '../../../src/types';
import type { DiscountRecord } from '../../../src/api/types';
import { ApiClient, adminClient, e2eEnv, registerCustomer } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage } from '../harness/browser.ts';
import { createSpecProduct } from '../harness/products.ts';
import {
  VALID_ADDRESS,
  addProductToCart,
  click,
  fill as typeInto,
  goToCheckout,
  fillCheckout,
  orderNumber,
  submitOrder,
} from '../harness/ui.ts';
import {
  LANGS,
  PNG_BYTES,
  adminOrder,
  adminPage,
  clickText,
  fill,
  openTab,
  pick,
  setValue,
  token,
  waitForText,
  waitForToast,
} from './admin-helpers.ts';

async function listDiscounts(admin: ApiClient): Promise<DiscountRecord[]> {
  const result = await admin.get<{ discounts: DiscountRecord[] }>('/api/v1/admin/discounts');
  assert.equal(result.status, 200);
  return result.data.discounts;
}

async function discountByCode(admin: ApiClient, code: string): Promise<DiscountRecord | undefined> {
  return (await listDiscounts(admin)).find((discount) => discount.code === code);
}

async function applyCouponInDrawer(shopper: E2ePage, code: string): Promise<void> {
  await typeInto(shopper.page, '[data-testid="coupon-input"]', code);
  await click(shopper.page, '[data-testid="coupon-apply"]');
}

async function quoteStatus(client: ApiClient, variantId: string, code: string): Promise<{ applied?: string; issues: string[] }> {
  const result = await client.request<{ quote: { appliedDiscountCode?: string; issues: { code: string }[] } }>(
    'POST',
    '/api/v1/checkout/quote',
    { body: { items: [{ variantId, quantity: 1 }], discountCode: code } },
  );
  assert.equal(result.status, 200, `quote ${result.status}`);
  return { applied: result.data.quote.appliedDiscountCode ?? undefined, issues: result.data.quote.issues.map((issue) => issue.code) };
}

async function placeOnStorefront(shopper: E2ePage, tokenText: string, product: Product, coupon: string): Promise<string> {
  await shopper.goto('/');
  await addProductToCart(shopper, product, tokenText);
  await applyCouponInDrawer(shopper, coupon);
  await shopper.page.waitForSelector('[data-testid="coupon-applied"]', { timeout: 20_000 });
  // The success toast sits over the drawer's checkout button in LTR; wait for it to go (see report: storefront finding).
  await shopper.page.waitForFunction(() => document.querySelector('[role="status"]') === null, { timeout: 15_000 });
  await goToCheckout(shopper);
  await fillCheckout(shopper, VALID_ADDRESS);
  await submitOrder(shopper);
  await shopper.page.waitForSelector('[data-testid="order-number"]', { timeout: 30_000 });
  return orderNumber(shopper);
}

describe('admin promotions: coupons', () => {
  let browser: Browser;
  let admin: ApiClient;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
  });

  after(async () => {
    await closeBrowser();
  });

  for (const lang of LANGS) {
    it(`[${lang}] create (code upper-cased) -> use at checkout -> usage count -> limit reached -> archive keeps history`, async () => {
      const tok = token('CPN');
      const typed = `e2e${tok.toLowerCase()}`; // typed in lower case on purpose
      const code = typed.toUpperCase();
      const spec = await createSpecProduct(admin, { price: 300, stock: 10 });
      const { e2e } = await adminPage(browser, lang);
      const shopper = await newPage(browser, { lang });
      const shopperTwo = await newPage(browser, { lang });
      try {
        // --- create through the form ---
        await openTab(e2e, 'discounts');
        await clickText(e2e.page, '[data-panel="discounts"] button', pick(lang, 'Create coupon', 'إنشاء كوبون'));
        await e2e.page.waitForSelector('[role="dialog"] form[data-form="discount"]');
        await fill(e2e.page, pick(lang, 'Coupon code *', 'كود الكوبون *'), typed);
        await fill(e2e.page, pick(lang, 'Discount value *', 'قيمة الخصم *'), '10');
        await fill(e2e.page, pick(lang, 'Min. order (EGP)', 'أقل قيمة للطلب (ج.م)'), '100');
        await fill(e2e.page, pick(lang, 'Max cap (EGP)', 'أقصى خصم (ج.م)'), '50');
        await fill(e2e.page, pick(lang, 'Usage limit', 'حد الاستخدام'), '1');
        await e2e.screenshot(`admin-promotions-${lang}-coupon-form`);
        await e2e.page.click('[role="dialog"] button[type="submit"]');
        await e2e.page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 15_000 });
        await waitForToast(e2e.page, pick(lang, 'Discount code created.', 'تم إنشاء كود الخصم.'));

        const created = await discountByCode(admin, code);
        assert.ok(created, `coupon ${code} persisted upper-cased`);
        assert.equal(await discountByCode(admin, typed), undefined, 'the lower-case spelling is not a separate coupon');
        assert.deepEqual(
          { type: created.type, value: created.value, min: created.minOrderAmount, cap: created.maxDiscount, limit: created.usageLimit, used: created.currentUsage, active: created.active },
          { type: 'percentage', value: 10, min: 100, cap: 50, limit: 1, used: 0, active: true },
        );
        const card = `[data-coupon="${code}"]`;
        await e2e.page.waitForSelector(card);
        assert.equal(await e2e.page.$eval(card, (element) => element.getAttribute('data-coupon-state')), 'active');

        // --- use it in a real storefront checkout (second browser context), typed in lower case ---
        const number = await placeOnStorefront(shopper, spec.token, spec.product, typed);
        const order = await adminOrder(admin, number);
        assert.equal(order.discountCode, code);
        assert.equal(order.discountAmount, 30, '10% of 300, below the 50 cap');
        assert.equal(order.total, 300 - 30 + order.deliveryFee);

        // --- usage count increased (API + UI after re-entering the tab) ---
        assert.equal((await discountByCode(admin, code))?.currentUsage, 1);
        await openTab(e2e, 'orders');
        await openTab(e2e, 'discounts');
        await waitForText(e2e.page, `${card} [data-field="usage"]`, (text) => text.includes('1 / 1'));

        // --- limit reached: storefront rejects, API refuses to place an order with it ---
        await shopperTwo.goto('/');
        await addProductToCart(shopperTwo, spec.product, spec.token);
        await applyCouponInDrawer(shopperTwo, code);
        const rejection = await waitForText(shopperTwo.page, '[data-testid="coupon-error"]', (text) => text.length > 0);
        assert.ok(rejection.length > 0);
        assert.equal(await shopperTwo.page.$('[data-testid="coupon-applied"]'), null, 'an exhausted coupon is never shown as applied');
        const second = await registerCustomer('cpn');
        const quote = await quoteStatus(second.client, spec.product.variants[0].id, code);
        assert.equal(quote.applied, undefined);
        assert.ok(quote.issues.includes('CouponNotApplicable'), `issues: ${quote.issues.join(',')}`);
        assert.equal((await discountByCode(admin, code))?.currentUsage, 1, 'a rejected attempt does not consume usage');

        // --- archive keeps the record and the history ---
        await e2e.page.click(`${card} button`);
        await e2e.page.waitForFunction(
          (selector: string) => document.querySelector(selector)?.getAttribute('data-coupon-state') === 'archived',
          { timeout: 15_000 },
          card,
        );
        assert.equal(await e2e.page.$eval(`${card} button`, (button) => (button as HTMLButtonElement).disabled), true);
        const archived = await discountByCode(admin, code);
        assert.equal(archived?.active, false);
        assert.equal(archived?.currentUsage, 1, 'usage history is preserved');
        const history = await adminOrder(admin, number);
        assert.equal(history.discountCode, code, 'the historical order still references the archived coupon');
        assert.equal(history.discountAmount, 30);
        const afterArchive = await quoteStatus(second.client, spec.product.variants[0].id, code);
        assert.equal(afterArchive.applied, undefined, 'an archived coupon cannot be applied');
        await e2e.screenshot(`admin-promotions-${lang}-coupon-archived`);

        e2e.assertClean();
        shopper.assertClean();
        shopperTwo.assertClean({ statuses: [{ status: 409 }, { status: 400 }, { status: 404 }] });
      } finally {
        await shopperTwo.close();
        await shopper.close();
        await e2e.close();
      }
    });
  }

  it('[en] a coupon with a past expiry date is refused by the form with an inline error; nothing is created', async () => {
    const code = `E2EPAST${token('P')}`;
    const { e2e } = await adminPage(browser, 'en');
    try {
      await openTab(e2e, 'discounts');
      await clickText(e2e.page, '[data-panel="discounts"] button', 'Create coupon');
      await e2e.page.waitForSelector('[role="dialog"] form[data-form="discount"]');
      await fill(e2e.page, 'Coupon code *', code);
      await fill(e2e.page, 'Expiry date *', '2020-01-01T10:00');
      await e2e.page.click('[role="dialog"] button[type="submit"]');
      const message = await waitForText(e2e.page, '[role="dialog"] [role="alert"]', (text) => text.length > 0);
      assert.match(message, /future/i);
      assert.equal(await discountByCode(admin, code), undefined);
      e2e.assertClean({ statuses: [{ status: 400, method: 'POST', url: /\/api\/v1\/admin\/discounts$/ }] });
    } finally {
      await e2e.close();
    }
  });

  it('[ar] the same refusal is shown in Arabic', async () => {
    const code = `E2EPASTAR${token('P')}`;
    const { e2e } = await adminPage(browser, 'ar');
    try {
      await openTab(e2e, 'discounts');
      await clickText(e2e.page, '[data-panel="discounts"] button', 'إنشاء كوبون');
      await e2e.page.waitForSelector('[role="dialog"] form[data-form="discount"]');
      await fill(e2e.page, 'كود الكوبون *', code);
      await fill(e2e.page, 'تاريخ الانتهاء *', '2020-01-01T10:00');
      await e2e.page.click('[role="dialog"] button[type="submit"]');
      const message = await waitForText(e2e.page, '[role="dialog"] [role="alert"]', (text) => text.length > 0);
      assert.match(message, /[\u0600-\u06FF]/, 'the error is Arabic');
      assert.equal(await discountByCode(admin, code), undefined);
      e2e.assertClean({ statuses: [{ status: 400, method: 'POST', url: /\/api\/v1\/admin\/discounts$/ }] });
    } finally {
      await e2e.close();
    }
  });

  it('API: codes are normalised to upper case; a duplicate in another case is rejected; a coupon that expires stops applying and shows as expired', async () => {
    const code = `E2EAPI${token('A')}`;
    const lower = code.toLowerCase();
    const expiry = new Date(Date.now() + 6_000).toISOString();
    const create = await admin.request<{ discount: DiscountRecord }>('POST', '/api/v1/admin/discounts', {
      body: { code: lower, type: 'fixed', value: 20, minOrderAmount: 0, maxDiscount: null, expiryDate: expiry, usageLimit: 0, active: true },
    });
    assert.equal(create.status, 201);
    assert.equal(create.data.discount.code, code);
    const duplicate = await admin.request('POST', '/api/v1/admin/discounts', {
      body: { code, type: 'fixed', value: 5, minOrderAmount: 0, maxDiscount: null, expiryDate: expiry, usageLimit: 0, active: true },
    });
    assert.equal(duplicate.status, 409);

    const spec = await createSpecProduct(admin, { price: 200, stock: 5 });
    const customer = await registerCustomer('exp');
    const before = await quoteStatus(customer.client, spec.product.variants[0].id, lower);
    assert.equal(before.applied, code, 'applies before it expires (case-insensitive)');

    await sleep(7_000);
    const after = await quoteStatus(customer.client, spec.product.variants[0].id, code);
    assert.equal(after.applied, undefined, 'expired coupon is not applied');
    assert.ok(after.issues.includes('CouponNotApplicable'));

    const { e2e } = await adminPage(browser, 'en');
    try {
      await openTab(e2e, 'discounts');
      await e2e.page.waitForSelector(`[data-coupon="${code}"]`);
      assert.equal(await e2e.page.$eval(`[data-coupon="${code}"]`, (element) => element.getAttribute('data-coupon-state')), 'expired');
      assert.match(await waitForText(e2e.page, `[data-coupon="${code}"] [data-field="usage"]`, (text) => text.length > 0), /unlimited/);
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });
});

describe('admin promotions: homepage banners', () => {
  let browser: Browser;
  let admin: ApiClient;
  let original: PromotionalBanner[] = [];
  const { baseUrl, runDir } = e2eEnv();

  async function adminBanners(): Promise<PromotionalBanner[]> {
    const result = await admin.get<{ banners: PromotionalBanner[] }>('/api/v1/admin/banners');
    assert.equal(result.status, 200);
    return result.data.banners;
  }

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
    original = await adminBanners();
  });

  after(async () => {
    // Leave the seeded banners exactly as found for the specs that follow.
    if (original.length > 0) {
      await admin.request('PUT', '/api/v1/admin/banners', { body: { banners: original } });
    }
    await closeBrowser();
  });

  for (const lang of LANGS) {
    it(`[${lang}] edit bilingual copy and image, deactivate: home hero follows, admin still lists it (A-39, A-40)`, async () => {
      const banners = await adminBanners();
      const target = [...banners].filter((banner) => banner.active).sort((a, b) => a.order - b.order)[0];
      assert.ok(target, 'an active banner exists');
      const tok = token('BN');
      const titleEn = `E2E Glow ${tok}`;
      const titleAr = `وهج المساء ${tok}`;
      const badgeAr = 'عرض لفترة محدودة';
      const { e2e } = await adminPage(browser, lang);
      const shopper = await newPage(browser, { lang });
      try {
        await openTab(e2e, 'banners');
        const scope = `xpath///*[@data-banner=${JSON.stringify(target.id)}]`;
        const input = async (label: string) => {
          const handle = await e2e.page.waitForSelector(`${scope}//label[normalize-space(span[1])=${JSON.stringify(label)}]//input`);
          assert.ok(handle, label);
          return handle;
        };
        const title = pick(lang, 'Title', 'العنوان');
        await setValue(await input(`${title} (English)`), titleEn);
        await setValue(await input(`${title} (العربية)`), titleAr);
        await setValue(await input(`${pick(lang, 'Badge', 'الشارة')} (العربية)`), badgeAr);

        // Image upload on the banner card.
        const file = path.join(runDir, `banner-${tok}.png`);
        writeFileSync(file, PNG_BYTES);
        const upload = await e2e.page.waitForSelector(`input[data-upload="${target.id}"]`);
        assert.ok(upload);
        await upload.uploadFile(file);
        await e2e.page.waitForFunction(
          (selector: string) => /^\/media\//.test(document.querySelector<HTMLInputElement>(selector)?.value ?? ''),
          { timeout: 15_000 },
          `[data-banner="${target.id}"] input[dir="ltr"]`,
        );

        const firstSave = e2e.page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/v1/admin/banners'), { timeout: 15_000 });
        await clickText(e2e.page, '[data-panel="banners"] button', pick(lang, 'Save banners', 'حفظ البانرات'));
        assert.equal((await firstSave).status(), 200);
        await waitForToast(e2e.page, pick(lang, 'Homepage banners saved.', 'تم حفظ بانرات الصفحة الرئيسية.'));

        const saved = (await adminBanners()).find((banner) => banner.id === target.id);
        assert.ok(saved);
        assert.equal(Buffer.from(saved.title.ar, 'utf8').toString('hex'), Buffer.from(titleAr, 'utf8').toString('hex'));
        assert.equal(saved.title.en, titleEn);
        assert.equal(saved.badge.ar, badgeAr);
        assert.match(saved.imageUrl, /^\/media\/[0-9a-f]{32}\.png$/);
        assert.deepEqual(saved.subtitle, target.subtitle, 'untouched fields are preserved');
        const publicBanners = (await new ApiClient(baseUrl).get<{ banners: PromotionalBanner[] }>('/api/v1/banners')).data.banners;
        assert.equal(publicBanners.find((banner) => banner.id === target.id)?.title.en, titleEn);

        // Home hero (second context) shows the saved copy in the visitor's language.
        await shopper.goto('/');
        const expectedTitle = lang === 'ar' ? titleAr : titleEn;
        await shopper.page.waitForFunction(
          (text: string) => document.querySelector('[data-testid="hero-banner"]')?.textContent?.includes(text) ?? false,
          { timeout: 20_000 },
          expectedTitle,
        );

        // Deactivate: gone from the public API and the hero, still listed (inactive) for admin.
        await e2e.page.click(`[data-banner="${target.id}"] input[type="checkbox"]`);
        const savedResponse = e2e.page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/v1/admin/banners'), { timeout: 15_000 });
        await clickText(e2e.page, '[data-panel="banners"] button', pick(lang, 'Save banners', 'حفظ البانرات'));
        assert.equal((await savedResponse).status(), 200);
        await e2e.page.waitForFunction(
          (selector: string, text: string) => (document.querySelector(selector)?.textContent ?? '').includes(text),
          { timeout: 15_000 },
          `[data-banner="${target.id}"]`,
          pick(lang, 'Inactive', 'غير مفعّل'),
        );
        const stillListed = (await adminBanners()).find((banner) => banner.id === target.id);
        assert.equal(stillListed?.active, false);
        assert.equal(stillListed?.title.en, titleEn, 'admin keeps the content of an inactive banner');
        const afterPublic = (await new ApiClient(baseUrl).get<{ banners: PromotionalBanner[] }>('/api/v1/banners')).data.banners;
        assert.equal(afterPublic.some((banner) => banner.id === target.id), false);
        await shopper.page.reload({ waitUntil: 'domcontentloaded' });
        await shopper.page.waitForSelector('[data-testid^="product-card-"]', { timeout: 20_000 });
        const heroText = await shopper.page.$eval('[data-testid="hero-banner"]', (element) => element.textContent ?? '').catch(() => '');
        assert.ok(!heroText.includes(expectedTitle), 'a deactivated banner is not shown as the hero');
        await e2e.screenshot(`admin-promotions-${lang}-banner-inactive`);

        e2e.assertClean();
        shopper.assertClean();
      } finally {
        await shopper.close();
        await e2e.close();
        await admin.request('PUT', '/api/v1/admin/banners', { body: { banners: original } });
      }
    });
  }
});

