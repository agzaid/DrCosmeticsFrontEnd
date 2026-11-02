/**
 * User-level actions on the storefront (click/type like a customer). Every helper waits for the observable result,
 * never sleeps.
 */
import type { Page } from 'puppeteer-core';
import type { Product } from '../../../src/types';
import type { E2ePage } from './browser.ts';
import { ApiClient } from './api.ts';
import { parseMoney } from './i18n.ts';

export const TIMEOUT = 20_000;

export interface Address {
  fullName: string;
  mobileNumber: string;
  governorate?: string;
  city: string;
  streetAddress: string;
  buildingApt?: string;
  deliveryNotes?: string;
}

export const VALID_ADDRESS = {
  fullName: 'Sarah Ahmed',
  mobileNumber: '01012345678',
  governorate: 'Cairo',
  city: 'New Cairo',
  streetAddress: 'Street 90, Villa 12',
};

function isMobile(e2e: E2ePage): boolean {
  return (e2e.page.viewport()?.width ?? 1280) < 768;
}

export async function click(page: Page, selector: string): Promise<void> {
  await page.locator(selector).setTimeout(TIMEOUT).click();
}

/** Replaces the content of an input like a user would (select all, type). */
export async function fill(page: Page, selector: string, value: string): Promise<void> {
  const input = await page.waitForSelector(selector, { timeout: TIMEOUT, visible: true });
  if (!input) {
    throw new Error(`No element ${selector}`);
  }
  await input.click({ count: 3 });
  if (value === '') {
    await page.keyboard.press('Backspace');
  } else {
    await input.type(value);
  }
}

export async function text(page: Page, selector: string): Promise<string> {
  const element = await page.waitForSelector(selector, { timeout: TIMEOUT });
  return ((await element?.evaluate((node) => node.textContent)) ?? '').trim();
}

export async function money(page: Page, selector: string): Promise<number> {
  return parseMoney(await text(page, selector));
}

export async function gotoHome(e2e: E2ePage): Promise<void> {
  await e2e.goto('/');
  await e2e.page.waitForSelector('[data-testid^="product-card-"]', { timeout: TIMEOUT });
}

export async function waitForShopIdle(e2e: E2ePage): Promise<void> {
  await e2e.page.waitForFunction(() => !document.querySelector('[data-testid="shop-loading"]'), {
    timeout: TIMEOUT,
  });
}

export async function openShop(e2e: E2ePage): Promise<void> {
  await click(e2e.page, isMobile(e2e) ? '[data-testid="mobile-nav-shop"]' : '[data-testid="nav-cat-all"]');
  await e2e.page.waitForSelector('[data-testid="shop-search"]', { timeout: TIMEOUT });
  await waitForShopIdle(e2e);
}

/** Types into the shop search and waits for the matching API response and the end of loading. */
export async function searchShop(e2e: E2ePage, term: string): Promise<void> {
  const responded = e2e.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/products') &&
      (new URL(response.url()).searchParams.get('search') ?? '') === term.trim(),
    { timeout: TIMEOUT },
  );
  await fill(e2e.page, '[data-testid="shop-search"]', term);
  await responded;
  await waitForShopIdle(e2e);
}

export async function shopProductIds(e2e: E2ePage): Promise<string[]> {
  return e2e.page.$$eval('[data-testid^="product-card-"]', (nodes) =>
    nodes.map((node) => node.getAttribute('data-testid')?.replace('product-card-', '') ?? ''),
  );
}

/** Finds the product through the shop search (by its unique token) and opens its detail modal. */
export async function openProduct(e2e: E2ePage, product: Product, token: string): Promise<void> {
  if (!(await e2e.page.$('[data-testid="shop-search"]'))) {
    await openShop(e2e);
  }
  const current = await e2e.page.$eval('[data-testid="shop-search"]', (node) => (node as HTMLInputElement).value);
  if (current !== token) {
    await searchShop(e2e, token);
  }
  const detail = e2e.page.waitForResponse(
    (response) => response.url().endsWith(`/api/v1/products/${product.id}`) && response.status() === 200,
    { timeout: TIMEOUT },
  );
  await click(e2e.page, `[data-testid="product-card-${product.id}"]`);
  await e2e.page.waitForSelector('[data-testid="product-modal"]', { timeout: TIMEOUT });
  await detail;
}

export async function closeModal(e2e: E2ePage): Promise<void> {
  await e2e.page.keyboard.press('Escape');
  await e2e.page.waitForSelector('[data-testid="product-modal"]', { hidden: true, timeout: TIMEOUT });
}

export async function selectVariant(e2e: E2ePage, variantId: string): Promise<void> {
  await click(e2e.page, `[data-testid="variant-option"][data-variant-id="${variantId}"]`);
}

/** In the open product modal: set the quantity with the stepper and press Add to Bag. */
export async function addFromModal(e2e: E2ePage, quantity = 1): Promise<void> {
  for (let current = 1; current < quantity; current += 1) {
    await click(e2e.page, '[data-testid="qty-increase"]');
  }
  await click(e2e.page, '[data-testid="modal-add-to-bag"]');
  await e2e.page.waitForSelector('[data-testid="cart-drawer"]', { timeout: TIMEOUT });
}

/** Searches, opens the product, optionally picks a variant, adds `quantity` and leaves the drawer open. */
export async function addProductToCart(
  e2e: E2ePage,
  product: Product,
  token: string,
  options: { variantId?: string; quantity?: number } = {},
): Promise<void> {
  await openProduct(e2e, product, token);
  if (options.variantId) {
    await selectVariant(e2e, options.variantId);
  }
  await addFromModal(e2e, options.quantity ?? 1);
}

export async function waitForQuote(e2e: E2ePage): Promise<void> {
  await e2e.page.waitForResponse(
    (response) => response.url().includes('/api/v1/checkout/quote') && response.status() === 200,
    { timeout: TIMEOUT },
  );
}

export async function openCart(e2e: E2ePage): Promise<void> {
  await click(e2e.page, '[data-testid="nav-cart"]');
  await e2e.page.waitForSelector('[data-testid="cart-drawer"]', { timeout: TIMEOUT });
}

export async function closeCart(e2e: E2ePage): Promise<void> {
  await e2e.page.keyboard.press('Escape');
  await e2e.page.waitForSelector('[data-testid="cart-drawer"]', { hidden: true, timeout: TIMEOUT });
}

/** The cart count shown in the drawer header. */
export async function cartCount(e2e: E2ePage): Promise<number> {
  return Number(await text(e2e.page, '[data-testid="cart-count"]'));
}

/** Waits until the drawer total settles on the server quote (the quote request has finished). */
export async function waitForDrawerTotal(e2e: E2ePage, expected: number): Promise<void> {
  await e2e.page.waitForFunction(
    (value: number) => {
      const node = document.querySelector('[data-testid="totals-total"] span:last-child');
      if (!node?.textContent) {
        return false;
      }
      const digits = node.textContent
        .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/\u066b/g, '.')
        .replace(/[\u066c,]/g, '');
      const match = /-?\d+(\.\d+)?/.exec(digits);
      return match !== null && Number(match[0]) === value;
    },
    { timeout: TIMEOUT },
    expected,
  );
}

export async function goToCheckout(e2e: E2ePage): Promise<void> {
  await click(e2e.page, '[data-testid="drawer-checkout-btn"]');
  await e2e.page.waitForSelector('#checkout-fullName', { timeout: TIMEOUT });
}

export async function waitForPlaceOrderEnabled(e2e: E2ePage): Promise<void> {
  await e2e.page.waitForFunction(
    () => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="place-order-btn"]');
      return button !== null && !button.disabled;
    },
    { timeout: TIMEOUT },
  );
}

export async function fillCheckout(e2e: E2ePage, address: Address, email?: string): Promise<void> {
  await fill(e2e.page, '#checkout-fullName', address.fullName);
  await fill(e2e.page, '#checkout-mobileNumber', address.mobileNumber);
  await e2e.page.select('#checkout-governorate', address.governorate ?? 'Cairo');
  await fill(e2e.page, '#checkout-city', address.city);
  await fill(e2e.page, '#checkout-streetAddress', address.streetAddress);
  if (address.buildingApt !== undefined) {
    await fill(e2e.page, '#checkout-buildingApt', address.buildingApt);
  }
  if (address.deliveryNotes !== undefined) {
    await fill(e2e.page, '#checkout-deliveryNotes', address.deliveryNotes);
  }
  if (email !== undefined && (await e2e.page.$('#checkout-email'))) {
    await fill(e2e.page, '#checkout-email', email);
  }
}

/** Presses the place-order button once the server quote is ready. */
export async function submitOrder(e2e: E2ePage): Promise<void> {
  await waitForPlaceOrderEnabled(e2e);
  await click(e2e.page, '[data-testid="place-order-btn"]');
}

export async function orderNumber(e2e: E2ePage): Promise<string> {
  return text(e2e.page, '[data-testid="order-number"]');
}

export async function navigateTo(e2e: E2ePage, target: 'wishlist' | 'account'): Promise<void> {
  if (isMobile(e2e)) {
    await click(e2e.page, `[data-testid="mobile-nav-${target}"]`);
  } else if (target === 'wishlist') {
    await click(e2e.page, '[data-testid="nav-wishlist"]');
  } else {
    await click(e2e.page, '[data-testid="nav-account"]');
    await click(e2e.page, '[data-testid="nav-account"] + div button');
  }
}

export async function setLanguageViaUi(e2e: E2ePage): Promise<void> {
  await click(e2e.page, '[data-testid="nav-language"]');
}

/** Horizontal overflow check: the document must not be wider than the viewport. */
export async function horizontalOverflow(e2e: E2ePage): Promise<{ scrollWidth: number; clientWidth: number }> {
  return e2e.page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

/** Runs a UI action that triggers a catalog fetch and waits for that response and for loading to finish. */
export async function afterProductsResponse(e2e: E2ePage, action: () => Promise<void>): Promise<URL> {
  const responded = e2e.page.waitForResponse(
    (response) => response.url().includes('/api/v1/products?') && response.status() === 200,
    { timeout: TIMEOUT },
  );
  await action();
  const response = await responded;
  await waitForShopIdle(e2e);
  return new URL(response.url());
}

/** Sets a range input the way a user drag does (native setter + input event, which React listens to). */
export async function setRange(e2e: E2ePage, selector: string, value: number): Promise<void> {
  await e2e.page.$eval(
    selector,
    (node, next) => {
      const input = node as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, String(next));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    value,
  );
}

/** An API client that carries the browser's own cookies (guest or auth), to verify what that browser created. */
export async function apiClientFromPage(e2e: E2ePage): Promise<ApiClient> {
  const client = new ApiClient(e2e.baseUrl);
  for (const cookie of await e2e.context.cookies()) {
    client.setCookie(cookie.name, cookie.value);
  }
  return client;
}

/** The order id the storefront remembers for the confirmation page (survives a hard reload). */
export async function rememberedOrderId(e2e: E2ePage): Promise<string | null> {
  return e2e.page.evaluate(() => localStorage.getItem('luma_last_order_id'));
}

export async function openAccount(e2e: E2ePage): Promise<void> {
  await navigateTo(e2e, 'account');
}

/** Signs in through the account page form (anonymous visitor -> account -> credentials). */
export async function loginViaUi(e2e: E2ePage, email: string, password: string): Promise<void> {
  await openAccount(e2e);
  await fill(e2e.page, '#auth-email', email);
  await fill(e2e.page, '#auth-password', password);
  await click(e2e.page, '[data-testid="auth-submit"]');
  await e2e.page.waitForSelector('[data-testid="account-name"]', { timeout: TIMEOUT });
}

export async function logoutViaUi(e2e: E2ePage): Promise<void> {
  await click(e2e.page, '[data-testid="account-logout"]');
  await e2e.page.waitForSelector('[data-testid="auth-form"]', { timeout: TIMEOUT });
}

/** Wishlist badge count in the navbar (0 when no badge is rendered). */
export async function wishlistBadge(e2e: E2ePage): Promise<number> {
  return e2e.page.$eval('[data-testid="nav-wishlist"]', (node) => Number(node.querySelector('span')?.textContent ?? '0'));
}
