import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import type { CheckoutQuote } from '../../../src/api/types';
import { ApiClient, adminClient, e2eEnv } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import { TEXTS, egp } from '../harness/i18n.ts';
import { createSpecProduct, type SpecProduct } from '../harness/products.ts';
import {
  TIMEOUT,
  addProductToCart,
  click,
  fill,
  goToCheckout,
  gotoHome,
  money,
  openShop,
  text,
  waitForDrawerTotal,
} from '../harness/ui.ts';

const LANGS: Lang[] = ['en', 'ar'];

function code(prefix: string): string {
  return `${prefix}${randomBytes(3).toString('hex').toUpperCase()}`;
}

describe('storefront quote, coupons and free-delivery threshold (A-09..A-12)', () => {
  let browser: Browser;
  let admin: ApiClient;
  let anon: ApiClient;
  let pct15: string;
  let bigMinimum: string;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
    anon = new ApiClient(e2eEnv().baseUrl);
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    pct15 = code('E15');
    bigMinimum = code('BIG');
    await admin.createDiscount({ code: pct15, type: 'percentage', value: 15, minOrderAmount: 300, maxDiscount: 150, expiryDate: future, usageLimit: 0, active: true });
    await admin.createDiscount({ code: bigMinimum, type: 'fixed', value: 100, minOrderAmount: 5000, maxDiscount: null, expiryDate: future, usageLimit: 0, active: true });
  });

  after(async () => {
    await closeBrowser();
  });

  async function withPage(lang: Lang, body: (e2e: E2ePage) => Promise<void>): Promise<void> {
    const e2e = await newPage(browser, { lang });
    try {
      await body(e2e);
      e2e.assertOnlyApiTraffic();
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  }

  async function applyCoupon(e2e: E2ePage, value: string): Promise<void> {
    await fill(e2e.page, '[data-testid="coupon-input"]', value);
    await click(e2e.page, '[data-testid="coupon-apply"]');
    await e2e.page.waitForSelector('[data-testid="coupon-applied"], [data-testid="coupon-error"]', { timeout: TIMEOUT });
  }

  async function drawerTotals(e2e: E2ePage): Promise<{ subtotal: number; discount: number; delivery: number; total: number }> {
    const subtotal = await money(e2e.page, '[data-testid="totals-subtotal"] span:last-child');
    const total = await money(e2e.page, '[data-testid="totals-total"] span:last-child');
    const discountNode = await e2e.page.$('[data-testid="totals-discount"] span:last-child');
    const discount = discountNode ? Math.abs(await money(e2e.page, '[data-testid="totals-discount"] span:last-child')) : 0;
    const deliveryText = await text(e2e.page, '[data-testid="totals-delivery"] span:last-child');
    const delivery = deliveryText.includes(TEXTS[e2e.lang].free) ? 0 : await money(e2e.page, '[data-testid="totals-delivery"] span:last-child');
    return { subtotal, discount, delivery, total };
  }

  function expectedTotals(quote: CheckoutQuote): { subtotal: number; discount: number; delivery: number; total: number } {
    return { subtotal: quote.subtotal, discount: quote.discountAmount, delivery: quote.deliveryFee, total: quote.total };
  }

  for (const lang of LANGS) {
    const T = TEXTS[lang];

    describe(`[${lang}]`, () => {
      it('applies a valid coupon and shows the server-quoted totals in the drawer and at checkout (A-09, A-10)', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 450, stock: 20 });
        const variant = product.variants[0];
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token);
          const plain = await anon.quote([{ variantId: variant.id, quantity: 1 }]);
          await waitForDrawerTotal(e2e, plain.total);
          assert.deepEqual(await drawerTotals(e2e), expectedTotals(plain));
          assert.equal(plain.deliveryFee, 50);

          await applyCoupon(e2e, pct15.toLowerCase());
          const discounted = await anon.quote([{ variantId: variant.id, quantity: 1 }], pct15);
          assert.equal(discounted.appliedDiscountCode, pct15);
          assert.equal(discounted.discountAmount, 67.5, '15% of 450 with a 150 cap');
          await waitForDrawerTotal(e2e, discounted.total);
          assert.deepEqual(await drawerTotals(e2e), expectedTotals(discounted));
          assert.equal(await text(e2e.page, '[data-testid="coupon-applied"] span.font-bold'), pct15);
          assert.ok((await text(e2e.page, '[data-testid="coupon-applied"]')).includes(egp(67.5, lang)));
          await e2e.screenshot(`quote-coupon-drawer-${lang}`);

          // the coupon and the totals carry over to checkout unchanged
          await goToCheckout(e2e);
          await e2e.page.waitForFunction(
            () => !document.querySelector<HTMLButtonElement>('[data-testid="place-order-btn"]')?.disabled,
            { timeout: TIMEOUT },
          );
          assert.equal(await money(e2e.page, '[data-testid="checkout-total"] span:last-child'), discounted.total);
          assert.equal(await money(e2e.page, '[data-testid="checkout-subtotal"] span:last-child'), discounted.subtotal);
          assert.equal(Math.abs(await money(e2e.page, '[data-testid="checkout-discount"] span:last-child')), 67.5);
          assert.ok((await text(e2e.page, '[data-testid="checkout-discount"]')).includes(pct15));
          assert.ok((await text(e2e.page, '[data-testid="place-order-btn"]')).includes(egp(discounted.total, lang)));
          await e2e.screenshot(`quote-coupon-checkout-${lang}`);
        });
      });

      it('removes a coupon and returns to the undiscounted quote', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 450, stock: 20 });
        const variant = product.variants[0];
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token);
          await applyCoupon(e2e, pct15);
          const discounted = await anon.quote([{ variantId: variant.id, quantity: 1 }], pct15);
          await waitForDrawerTotal(e2e, discounted.total);
          await click(e2e.page, '[data-testid="coupon-applied"] button');
          const plain = await anon.quote([{ variantId: variant.id, quantity: 1 }]);
          await waitForDrawerTotal(e2e, plain.total);
          assert.equal(await e2e.page.$('[data-testid="totals-discount"]'), null);
          await e2e.page.waitForSelector('[data-testid="coupon-input"]', { timeout: TIMEOUT });
        });
      });

      it('explains invalid, expired and below-minimum coupons and still prices the cart (A-12)', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 450, stock: 20 });
        const variant = product.variants[0];
        // The API refuses to create an already-expired coupon, so create one that lapses in 2s and let it lapse.
        const expired = code('EXP');
        await admin.createDiscount({ code: expired, type: 'percentage', value: 10, minOrderAmount: 0, maxDiscount: null, expiryDate: new Date(Date.now() + 2000).toISOString(), usageLimit: 0, active: true });
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token);
          const plain = await anon.quote([{ variantId: variant.id, quantity: 1 }]);
          await waitForDrawerTotal(e2e, plain.total);

          for (const bad of ['NOSUCHCODE', expired, bigMinimum]) {
            await applyCoupon(e2e, bad);
            const shown = await text(e2e.page, '[data-testid="coupon-error"]');
            const api = await anon.quote([{ variantId: variant.id, quantity: 1 }], bad);
            const issue = api.issues.find((entry) => entry.code === 'CouponNotApplicable');
            assert.ok(issue, `API did not report ${bad} as not applicable`);
            assert.equal(shown, lang === 'ar' ? T.couponInvalid : issue.message, bad);
            assert.equal(api.total, plain.total, 'a rejected coupon must not change the price');
            assert.deepEqual(await drawerTotals(e2e), expectedTotals(plain));
            assert.equal(await e2e.page.$('[data-testid="coupon-applied"]'), null);
          }
          await e2e.screenshot(`quote-coupon-invalid-${lang}`);
        });
      });

      it('tracks free-delivery progress and the 600 EGP boundary on the pre-discount subtotal (P9..P11)', async () => {
        const cases: { name: string; product: SpecProduct }[] = [
          { name: '250', product: await createSpecProduct(admin, { price: 250, stock: 50 }) },
          { name: '599', product: await createSpecProduct(admin, { price: 599, stock: 50 }) },
          { name: '600', product: await createSpecProduct(admin, { price: 600, stock: 50 }) },
        ];

        for (const { name, product: spec } of cases) {
          await withPage(lang, async (e2e) => {
            const variant = spec.product.variants[0];
            await gotoHome(e2e);
            await openShop(e2e);
            await addProductToCart(e2e, spec.product, spec.token);
            const quote = await anon.quote([{ variantId: variant.id, quantity: 1 }]);
            await waitForDrawerTotal(e2e, quote.total);
            const price = Number(name);
            const expectedFee = price >= 600 ? 0 : 50;
            assert.equal(quote.deliveryFee, expectedFee, `server fee for ${name}`);
            assert.equal(quote.amountNeededForFreeDelivery, Math.max(0, 600 - price));

            const message = await text(e2e.page, '[data-testid="free-shipping-message"]');
            assert.equal(
              message,
              quote.amountNeededForFreeDelivery === 0 ? T.freeShippingUnlocked : T.freeShippingProgress(quote.amountNeededForFreeDelivery),
            );
            const progress = await e2e.page.$eval('[role="progressbar"]', (node) => node.getAttribute('aria-valuenow'));
            assert.equal(Number(progress), Math.min(100, Math.round((price / 600) * 100)));
            assert.equal((await drawerTotals(e2e)).delivery, expectedFee);

            if (name === '600') {
              // P11: a coupon never moves the threshold; the discount applies to the pre-discount subtotal
              await applyCoupon(e2e, pct15);
              const withCoupon = await anon.quote([{ variantId: variant.id, quantity: 1 }], pct15);
              assert.equal(withCoupon.deliveryFee, 0);
              assert.equal(withCoupon.discountAmount, 90);
              await waitForDrawerTotal(e2e, withCoupon.total);
              assert.deepEqual(await drawerTotals(e2e), expectedTotals(withCoupon));
              assert.equal(await text(e2e.page, '[data-testid="free-shipping-message"]'), T.freeShippingUnlocked);
            }
          });
        }
      });

      it('crosses the threshold when the quantity increases and re-quotes from the server', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 250, stock: 50 });
        const variant = product.variants[0];
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token);
          await waitForDrawerTotal(e2e, 300);
          assert.equal(await text(e2e.page, '[data-testid="free-shipping-message"]'), T.freeShippingProgress(350));

          await click(e2e.page, `[data-testid="cart-increase-${variant.id}"]`);
          await click(e2e.page, `[data-testid="cart-increase-${variant.id}"]`);
          const quote = await anon.quote([{ variantId: variant.id, quantity: 3 }]);
          assert.equal(quote.subtotal, 750);
          assert.equal(quote.deliveryFee, 0);
          await waitForDrawerTotal(e2e, quote.total);
          assert.deepEqual(await drawerTotals(e2e), expectedTotals(quote));
          assert.equal(await text(e2e.page, '[data-testid="free-shipping-message"]'), T.freeShippingUnlocked);
          await e2e.screenshot(`quote-free-delivery-${lang}`);
        });
      });
    });
  }
});
