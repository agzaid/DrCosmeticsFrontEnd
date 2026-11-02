/**
 * (c) Merchandising through the admin UI: bilingual product with two variants, image upload, edit, publish, public
 * visibility, archive (A-32..A-34, A-40, AR-1, AR-2, AR-6) and the upload / duplicate-SKU rejection paths.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Browser, ElementHandle, Page } from 'puppeteer-core';
import type { Product } from '../../../src/types';
import { ApiClient, adminClient, e2eEnv } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import {
  LANGS,
  PNG_BYTES,
  adminPage,
  adminProduct,
  clickText,
  control,
  createTestProduct,
  fill,
  openTab,
  pick,
  placeCustomerOrder,
  productBody,
  publicProductStatus,
  rawUpload,
  setValue,
  token,
  waitForText,
  waitForToast,
} from './admin-helpers.ts';

/** AR-1 fixture: stored and returned byte-identical. */
const AR1_NAME = 'أحمر شفاه حريري مخملي';

let uploadsDir = '';

function uploadFile(name: string, bytes: Buffer): string {
  const file = path.join(uploadsDir, name);
  writeFileSync(file, bytes);
  return file;
}

async function variantField(page: Page, label: string, row: number): Promise<void> {
  await page.waitForSelector(`input[aria-label="${label} ${row}"]`);
}

async function setVariant(
  page: Page,
  lang: Lang,
  row: number,
  values: { sku: string; shadeEn: string; shadeAr: string; hex: string; size: string; price: string; stock: string },
): Promise<void> {
  const labels = {
    shadeEn: pick(lang, 'Shade (EN)', 'الدرجة (EN)'),
    shadeAr: pick(lang, 'Shade (AR)', 'الدرجة (AR)'),
    hex: pick(lang, 'Shade hex', 'كود اللون'),
    size: pick(lang, 'Size', 'الحجم'),
    price: pick(lang, 'Price', 'السعر'),
    stock: pick(lang, 'Initial stock', 'المخزون الابتدائي'),
  };
  const set = async (label: string, value: string): Promise<void> => {
    await variantField(page, label, row);
    const handle = await page.$(`input[aria-label="${label} ${row}"]`);
    assert.ok(handle, `variant field ${label} ${row}`);
    await setValue(handle, value);
  };
  await set('SKU', values.sku);
  await set(labels.shadeEn, values.shadeEn);
  await set(labels.shadeAr, values.shadeAr);
  await set(labels.hex, values.hex);
  await set(labels.size, values.size);
  await set(labels.price, values.price);
  await set(labels.stock, values.stock);
}

async function openProductsTab(e2e: E2ePage): Promise<void> {
  await openTab(e2e, 'products');
  await e2e.page.waitForSelector('[data-panel="products"] tbody tr');
}

/** Which 1-based row of the open variant table carries `sku` (server order is not guaranteed). */
async function variantRowOf(page: Page, sku: string): Promise<number> {
  const row = await page.$$eval(
    '[data-variant-row]',
    (rows, wanted) =>
      rows.find((candidate) => candidate.querySelector<HTMLInputElement>('input[aria-label^="SKU"]')?.value === wanted)?.getAttribute('data-variant-row') ?? '',
    sku,
  );
  assert.notEqual(row, '', `variant ${sku} not found in the form`);
  return Number(row);
}

/** Submits the product form and waits for it to close; surfaces the form's own error if it stays open. */
async function submitProductForm(e2e: E2ePage): Promise<void> {
  await e2e.page.click('[role="dialog"] button[type="submit"]');
  const outcome = await Promise.race([
    e2e.page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 15_000 }).then(() => 'closed'),
    e2e.page
      .waitForSelector('[role="dialog"] [role="alert"]', { timeout: 15_000 })
      .then((alert) => alert?.evaluate((element) => element.textContent ?? '') ?? 'alert'),
  ]);
  assert.equal(outcome, 'closed', `product form stayed open: ${outcome}`);
}

async function searchProducts(page: Page, query: string): Promise<void> {
  const input = await page.waitForSelector('[data-panel="products"] input[type="text"]');
  assert.ok(input);
  await setValue(input, query);
}

async function waitForRow(page: Page, productId: string): Promise<void> {
  await page.waitForSelector(`[data-product-id="${productId}"]`, { timeout: 15_000 });
}

async function findByToken(admin: ApiClient, tok: string): Promise<Product[]> {
  return (await admin.adminProducts(`status=all&search=${encodeURIComponent(tok)}&pageSize=60`)).products;
}

describe('admin merchandising (products, variants, images)', () => {
  let browser: Browser;
  let admin: ApiClient;
  const { baseUrl, runDir } = (() => {
    const env = e2eEnv();
    return { baseUrl: env.baseUrl, runDir: env.runDir };
  })();

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
    uploadsDir = path.join(runDir, 'admin-uploads');
    mkdirSync(uploadsDir, { recursive: true });
  });

  after(async () => {
    await closeBrowser();
  });

  for (const lang of LANGS) {
    it(`[${lang}] create (archived) -> upload image -> edit -> publish -> public search by Arabic name -> archive`, async () => {
      const tok = token('MRC');
      const skuA = `e2e-a-${tok.toLowerCase()}`; // typed lower case: must be stored upper case (AR-6)
      const skuB = `E2E-B-${tok}`;
      const nameEn = `E2E Velvet Lip ${tok}`;
      const { e2e } = await adminPage(browser, lang);
      const shopper = await newPage(browser, { lang });
      try {
        await openProductsTab(e2e);
        const addLabel = pick(lang, 'Add New Product', 'إضافة منتج جديد');
        await clickText(e2e.page, '[data-panel="products"] button', addLabel);
        await e2e.page.waitForSelector('[role="dialog"] form[data-form="product"]');

        const nameLabel = pick(lang, 'Product name', 'اسم المنتج');
        await fill(e2e.page, `${nameLabel} (English) *`, nameEn);
        await fill(e2e.page, `${nameLabel} (العربية) *`, AR1_NAME);
        await fill(e2e.page, pick(lang, 'Base price (EGP) *', 'السعر الأساسي (ج.م) *'), '150');
        await fill(e2e.page, pick(lang, 'Subcategory', 'قسم فرعي'), 'E2E');
        await setValue(await control(e2e.page, pick(lang, 'Status', 'الحالة')), 'archived');

        // Image upload through the real file input.
        const input = await e2e.page.waitForSelector('input[data-upload="product"]');
        assert.ok(input);
        await input.uploadFile(uploadFile('lip.png', PNG_BYTES));
        await e2e.page.waitForSelector('[data-section="images"] img', { timeout: 15_000 });
        const imageUrl = await e2e.page.$eval(
          `input[aria-label="${pick(lang, 'Image URL', 'رابط الصورة')} 1"]`,
          (element) => (element as HTMLInputElement).value,
        );
        assert.match(imageUrl, /^\/media\/[0-9a-f]{32}\.png$/, 'upload returns a server-generated safe name');

        await setVariant(e2e.page, lang, 1, {
          sku: skuA,
          shadeEn: 'Cairo Plum',
          shadeAr: 'برقوقي قاهري',
          hex: '#7E3F50',
          size: '3.8g',
          price: '150',
          stock: '12',
        });
        await clickText(e2e.page, '[role="dialog"] button', pick(lang, 'Add variant', 'إضافة درجة'));
        await setVariant(e2e.page, lang, 2, {
          sku: skuB,
          shadeEn: 'Nile Rose',
          shadeAr: 'وردي النيل',
          hex: '#C47D76',
          size: '5g',
          price: '175.5',
          stock: '8',
        });
        await e2e.screenshot(`admin-products-${lang}-create-form`);
        await submitProductForm(e2e);
        await waitForToast(e2e.page, pick(lang, 'Product created.', 'تم إنشاء المنتج.'));

        // Persistence (API): bilingual name byte-identical, SKU normalised, both variants, image, archived => not public.
        const [created] = await findByToken(admin, tok);
        assert.ok(created, 'product persisted');
        assert.equal(created.name.en, nameEn);
        assert.equal(Buffer.from(created.name.ar, 'utf8').toString('hex'), Buffer.from(AR1_NAME, 'utf8').toString('hex'), 'AR-1 byte-identical');
        assert.equal(created.status, 'archived');
        assert.deepEqual(created.images, [imageUrl]);
        const bySku = new Map(created.variants.map((variant) => [variant.sku, variant]));
        assert.deepEqual([...bySku.keys()].sort(), [skuA.toUpperCase(), skuB].sort());
        const variantA = bySku.get(skuA.toUpperCase());
        const variantB = bySku.get(skuB);
        assert.equal(variantA?.stock, 12);
        assert.equal(variantA?.price, 150);
        assert.equal(variantA?.size, '3.8g');
        assert.equal(variantA?.shadeName?.ar, 'برقوقي قاهري');
        assert.equal(variantA?.shadeHex?.toUpperCase(), '#7E3F50');
        assert.equal(variantB?.price, 175.5);
        assert.equal(variantB?.stock, 8);
        assert.equal(await publicProductStatus(created.id, baseUrl), 404, 'an archived product is not public');
        const uploaded = await fetch(`${baseUrl}${imageUrl}`);
        assert.equal(uploaded.status, 200);
        assert.equal(uploaded.headers.get('content-type'), 'image/png');

        // The table shows it (localised name, status) and the variants' SKUs.
        await searchProducts(e2e.page, tok);
        await waitForRow(e2e.page, created.id);
        const row = `[data-product-id="${created.id}"]`;
        const rowText = await waitForText(e2e.page, row, (text) => text.includes(lang === 'ar' ? AR1_NAME : nameEn));
        assert.ok(rowText.includes(pick(lang, 'Archived', 'مؤرشف')), `status badge localised: ${rowText}`);
        assert.ok(rowText.includes(skuA.toUpperCase()) && rowText.includes(skuB));

        // Edit: change price / size / shade of variant 2, publish. Existing stock is read-only here.
        await e2e.page.click(`${row} button:nth-of-type(1)`);
        await e2e.page.waitForSelector('[role="dialog"] form[data-form="product"]');
        const arInput = await control(e2e.page, `${nameLabel} (العربية) *`);
        assert.equal(await arInput.evaluate((element) => (element as HTMLInputElement).value), AR1_NAME, 'Arabic name rendered byte-identical in the form');
        const stockInput = await e2e.page.$(`input[aria-label="${pick(lang, 'Current stock (read-only)', 'المخزون الحالي (للقراءة فقط)')} 1"]`);
        assert.equal(await stockInput?.evaluate((element) => (element as HTMLInputElement).readOnly), true, 'existing stock is read-only');
        const rowB = await variantRowOf(e2e.page, skuB);
        const field = async (label: string): Promise<ElementHandle<Element>> => {
          const handle = await e2e.page.$(`input[aria-label="${label} ${rowB}"]`);
          assert.ok(handle, `${label} ${rowB}`);
          return handle;
        };
        await setValue(await field(pick(lang, 'Price', 'السعر')), '199');
        await setValue(await field(pick(lang, 'Size', 'الحجم')), '6g');
        await setValue(await field(pick(lang, 'Shade (EN)', 'الدرجة (EN)')), 'Nile Rose Deep');
        await setValue(await control(e2e.page, pick(lang, 'Status', 'الحالة')), 'published');
        await submitProductForm(e2e);
        await waitForToast(e2e.page, pick(lang, 'Product updated.', 'تم تحديث المنتج.'));

        const edited = await adminProduct(admin, created.id);
        assert.equal(edited.status, 'published');
        const editedB = edited.variants.find((variant) => variant.sku === skuB);
        assert.equal(editedB?.price, 199);
        assert.equal(editedB?.size, '6g');
        assert.equal(editedB?.shadeName?.en, 'Nile Rose Deep');
        assert.equal(edited.variants.find((variant) => variant.sku === skuA.toUpperCase())?.stock, 12, 'stock unchanged by a product edit');
        assert.equal(Buffer.from(edited.name.ar, 'utf8').toString('hex'), Buffer.from(AR1_NAME, 'utf8').toString('hex'));
        assert.equal(await publicProductStatus(created.id, baseUrl), 200, 'published product is public');

        // Public storefront (second browser context): AR-2 search by the Arabic name finds it.
        await shopper.goto('/');
        const searchBox = await shopper.page.waitForSelector('[data-testid="nav-search"]');
        assert.ok(searchBox);
        await setValue(searchBox, AR1_NAME);
        await searchBox.focus();
        await shopper.page.keyboard.press('Enter');
        await shopper.page.waitForSelector(`[data-testid="product-card-${created.id}"]`, { timeout: 15_000 });
        const apiHits = await new ApiClient(baseUrl).products({ search: AR1_NAME, pageSize: 60 });
        assert.ok(apiHits.products.some((product) => product.id === created.id), 'API search by Arabic name');

        // Archive from the table: disappears publicly, stays for admin.
        await e2e.page.click(`${row} button:nth-of-type(2)`);
        await waitForText(e2e.page, row, (text) => text.includes(pick(lang, 'Archived', 'مؤرشف')));
        assert.equal(await e2e.page.$eval(`${row} button:nth-of-type(2)`, (button) => (button as HTMLButtonElement).disabled), true);
        const archived = await adminProduct(admin, created.id);
        assert.equal(archived.status, 'archived');
        assert.equal(await publicProductStatus(created.id, baseUrl), 404);
        const afterHits = await new ApiClient(baseUrl).products({ search: tok, pageSize: 60 });
        assert.equal(afterHits.products.length, 0);
        assert.ok(e2e.dialogs.some((message) => message.length > 0), 'archive asked for confirmation');
        await shopper.page.reload({ waitUntil: 'domcontentloaded' });
        await shopper.page.waitForSelector('[data-testid^="product-card-"]', { timeout: 15_000 });
        assert.equal(await shopper.page.$(`[data-testid="product-card-${created.id}"]`), null);

        await e2e.screenshot(`admin-products-${lang}-archived`);
        e2e.assertClean();
        shopper.assertClean();
      } finally {
        await shopper.close();
        await e2e.close();
      }
    });

    it(`[${lang}] duplicate SKU is rejected with a field message and nothing is created (A-33, AR-6)`, async () => {
      const existing = await createTestProduct(admin, { stock: 5 });
      const tok = token('DUP');
      const { e2e } = await adminPage(browser, lang);
      try {
        await openProductsTab(e2e);
        await clickText(e2e.page, '[data-panel="products"] button', pick(lang, 'Add New Product', 'إضافة منتج جديد'));
        await e2e.page.waitForSelector('[role="dialog"] form[data-form="product"]');
        const nameLabel = pick(lang, 'Product name', 'اسم المنتج');
        await fill(e2e.page, `${nameLabel} (English) *`, `E2E Dup ${tok}`);
        await fill(e2e.page, `${nameLabel} (العربية) *`, `منتج مكرر ${tok}`);
        await fill(e2e.page, pick(lang, 'Base price (EGP) *', 'السعر الأساسي (ج.م) *'), '90');
        const urlInput = await e2e.page.waitForSelector(`input[aria-label="${pick(lang, 'Image URL', 'رابط الصورة')} 1"]`);
        assert.ok(urlInput);
        await setValue(urlInput, 'https://images.example.com/dup.png');
        // Same SKU in a different case: SKUs are case-insensitive.
        await setVariant(e2e.page, lang, 1, {
          sku: existing.sku.toLowerCase(),
          shadeEn: '',
          shadeAr: '',
          hex: '',
          size: '10ml',
          price: '90',
          stock: '3',
        });
        await e2e.page.click('[role="dialog"] button[type="submit"]');
        const message = await waitForText(e2e.page, '[role="dialog"] [data-error="sku"]', (text) => text.length > 0);
        if (lang === 'en') {
          assert.match(message, /already in use/i);
        } else {
          assert.match(message, /مستخدم بالفعل/);
        }
        assert.ok(await e2e.page.$('[role="dialog"]'), 'the form stays open so the SKU can be fixed');
        assert.equal(await e2e.page.$eval('input[aria-label="SKU 1"]', (element) => element.getAttribute('aria-invalid')), 'true');
        assert.deepEqual((await findByToken(admin, tok)).map((product) => product.id), [], 'no product was created');
        await e2e.screenshot(`admin-products-${lang}-duplicate-sku`);
        // The failed save is an expected 409 from the API.
        e2e.assertClean({ statuses: [{ status: 409, method: 'POST', url: /\/api\/v1\/admin\/products$/ }] });
      } finally {
        await e2e.close();
      }
    });
  }

  it('[en] client-side form checks: two variants with one SKU, and a product without an image', async () => {
    const { e2e } = await adminPage(browser, 'en');
    try {
      await openProductsTab(e2e);
      await clickText(e2e.page, '[data-panel="products"] button', 'Add New Product');
      await e2e.page.waitForSelector('[role="dialog"] form[data-form="product"]');
      await fill(e2e.page, 'Product name (English) *', 'E2E Checks');
      await fill(e2e.page, 'Product name (العربية) *', 'فحوصات');
      await fill(e2e.page, 'Base price (EGP) *', '50');
      await setVariant(e2e.page, 'en', 1, { sku: 'E2E-SAME', shadeEn: '', shadeAr: '', hex: '', size: '1', price: '50', stock: '1' });
      await e2e.page.click('[role="dialog"] button[type="submit"]');
      const noImage = await waitForText(e2e.page, '[role="dialog"] [role="alert"]', (text) => text.length > 0);
      assert.match(noImage, /at least one product image/i);

      const urlInput = await e2e.page.waitForSelector('input[aria-label="Image URL 1"]');
      assert.ok(urlInput);
      await setValue(urlInput, 'https://images.example.com/a.png');
      await clickText(e2e.page, '[role="dialog"] button', 'Add variant');
      await setVariant(e2e.page, 'en', 2, { sku: 'e2e-same', shadeEn: '', shadeAr: '', hex: '', size: '2', price: '50', stock: '1' });
      await e2e.page.click('[role="dialog"] button[type="submit"]');
      const dup = await waitForText(e2e.page, '[role="dialog"] [data-error="sku"]', (text) => text.length > 0);
      assert.match(dup, /same SKU/i);
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });

  it('API: archiving keeps historical orders readable; unknown brand is 400; an omitted variants list preserves the variants (A-33, A-34)', async () => {
    const fixture = await createTestProduct(admin, { stock: 6, price: 80 });
    const { order, customer } = await placeCustomerOrder(fixture.variant.id, 1);
    const archived = await admin.request<{ product: Product }>('DELETE', `/api/v1/admin/products/${fixture.product.id}`);
    assert.equal(archived.status, 200);
    assert.equal(archived.data.product.status, 'archived');
    assert.equal(await publicProductStatus(fixture.product.id, baseUrl), 404);
    const historical = await customer.client.order(order.id);
    assert.equal(historical.status, 200, 'the old order still resolves');
    assert.equal(historical.data.order.items[0].productId, fixture.product.id);
    assert.equal(historical.data.order.items[0].productName.en, fixture.product.name.en);
    assert.equal((await adminProduct(admin, fixture.product.id)).status, 'archived');

    const current = await adminProduct(admin, fixture.product.id);
    const unknownBrand = await admin.request('PUT', `/api/v1/admin/products/${fixture.product.id}`, {
      body: { ...productBody({ sku: fixture.sku }), brand: 'No Such Brand', variants: [] },
    });
    assert.equal(unknownBrand.status, 400);
    assert.equal(current.variants.length, 1);
    const withoutVariants = await admin.request<{ product: Product }>('PUT', `/api/v1/admin/products/${fixture.product.id}`, {
      body: { ...productBody({ sku: fixture.sku }), status: 'published', variants: undefined },
    });
    assert.equal(withoutVariants.status, 200);
    assert.equal(withoutVariants.data.product.variants.length, 1, 'omitted variants are preserved');
    assert.equal(withoutVariants.data.product.variants[0].stock, 5, 'stock untouched (6 minus the order)');
  });

  describe('image upload rejection (A-40)', () => {
    for (const lang of LANGS) {
      it(`[${lang}] a renamed non-image and an oversized image are refused with a clear message and never uploaded`, async () => {
        const { e2e } = await adminPage(browser, lang);
        try {
          await openProductsTab(e2e);
          await clickText(e2e.page, '[data-panel="products"] button', pick(lang, 'Add New Product', 'إضافة منتج جديد'));
          await e2e.page.waitForSelector('input[data-upload="product"]');
          const input = await e2e.page.waitForSelector('input[data-upload="product"]');
          assert.ok(input);

          await input.uploadFile(uploadFile('not-really.png', Buffer.from('this is plain text, not an image')));
          const fake = await waitForText(e2e.page, '[data-error="upload"]', (text) => text.length > 0);
          assert.match(fake, lang === 'en' ? /not a real JPEG, PNG or WebP/ : /ليس صورة/);

          await input.uploadFile(uploadFile('huge.png', Buffer.concat([PNG_BYTES, Buffer.alloc(6 * 1024 * 1024)])));
          await waitForText(e2e.page, '[data-error="upload"]', (text) => (lang === 'en' ? text.includes('5 MB') : text.includes('5 ميجابايت')));

          const uploads = e2e.requests.filter((request) => request.method === 'POST' && request.url.endsWith('/api/v1/admin/images'));
          assert.equal(uploads.length, 0, 'rejected files never reach the server');
          assert.equal(await e2e.page.$eval('input[aria-label="' + pick(lang, 'Image URL', 'رابط الصورة') + ' 1"]', (element) => (element as HTMLInputElement).value), '', 'no URL was filled in');

          // A valid image still works afterwards and the error clears.
          await input.uploadFile(uploadFile('ok.png', PNG_BYTES));
          await e2e.page.waitForSelector('[data-section="images"] img', { timeout: 15_000 });
          assert.equal(await e2e.page.$('[data-error="upload"]'), null);
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });
    }

    it('API: a valid PNG gets a safe generated name and is served; non-images and >5 MB files are rejected', async () => {
      const ok = await rawUpload(admin, baseUrl, PNG_BYTES, '../../evil name.png', 'image/png');
      assert.equal(ok.status, 201);
      assert.match(ok.body?.url ?? '', /^\/media\/[0-9a-f]{32}\.png$/, 'safe generated name, client filename ignored');
      assert.equal((await fetch(`${baseUrl}${ok.body?.url}`)).status, 200);

      const text = await rawUpload(admin, baseUrl, Buffer.from('MZ not an image'), 'photo.png', 'image/png');
      assert.ok(text.status >= 400, `renamed non-image must be rejected, got ${text.status}`);
      const wrongType = await rawUpload(admin, baseUrl, PNG_BYTES, 'x.txt', 'text/plain');
      assert.equal(wrongType.status, 400);
      const huge = await rawUpload(admin, baseUrl, Buffer.concat([PNG_BYTES, Buffer.alloc(6 * 1024 * 1024)]), 'big.png', 'image/png');
      assert.ok(huge.status >= 400, `a 6 MB image must be rejected, got ${huge.status}`);
    });

    it('API: rejections are client errors (4xx), not server errors', async () => {
      const text = await rawUpload(admin, baseUrl, Buffer.from('MZ not an image'), 'photo.png', 'image/png');
      assert.ok(text.status >= 400 && text.status < 500, `renamed non-image answered ${text.status}`);
      const huge = await rawUpload(admin, baseUrl, Buffer.concat([PNG_BYTES, Buffer.alloc(6 * 1024 * 1024)]), 'big.png', 'image/png');
      assert.ok(huge.status >= 400 && huge.status < 500, `6 MB image answered ${huge.status}`);
    });
  });
});
