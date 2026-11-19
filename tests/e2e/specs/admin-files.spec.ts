/**
 * (h) The file library: an administrator uploads pictures and documents from the admin UI, the list shows what was
 * stored, a picture is public, a document is not, and a refusal is shown in the administrator's own language.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { e2eEnv } from '../harness/api.ts';
import { closeBrowser, launchBrowser, type E2ePage, type Lang } from '../harness/browser.ts';
import { LANGS, PNG_BYTES, adminPage, openTab, token, waitForText } from './admin-helpers.ts';

/** The smallest thing that is a real PDF: the signature, one object and the trailer. */
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'ascii');

let browser: Browser;
let workDir = '';

function fileOf(name: string, bytes: Buffer): string {
  const file = path.join(workDir, name);
  writeFileSync(file, bytes);
  return file;
}

async function upload(e2e: E2ePage, kind: 'image' | 'document', file: string): Promise<void> {
  const input = await e2e.page.waitForSelector(`input[data-upload="library-${kind}"]`);
  assert.ok(input);
  await input.uploadFile(file);
}

/** The row the library shows for a file, found by the name it was uploaded under. */
async function rowFor(e2e: E2ePage, fileName: string): Promise<{ kind: string; address: string }> {
  await waitForText(e2e.page, '[data-panel="files"]', (text) => text.includes(fileName), 20_000);
  return e2e.page.evaluate((name: string) => {
    const row = Array.from(document.querySelectorAll('[data-panel="files"] li[data-file]')).find((item) =>
      item.textContent?.includes(name),
    );
    if (!row) {
      throw new Error(`No library row for ${name}`);
    }

    const link = row.querySelector<HTMLAnchorElement>('a[download]');
    return { kind: row.querySelector('[data-kind]')?.getAttribute('data-kind') ?? '', address: link?.href ?? '' };
  }, fileName);
}

describe('admin file library', () => {
  before(async () => {
    browser = await launchBrowser();
    workDir = path.join(e2eEnv().runDir, 'library-uploads');
    mkdirSync(workDir, { recursive: true });
  });

  after(async () => {
    await closeBrowser();
  });

  for (const lang of LANGS) {
    it(`[${lang}] uploads a picture and a document, lists both, and keeps the document private`, async () => {
      const { e2e } = await adminPage(browser, lang as Lang);
      try {
        await openTab(e2e, 'files');
        const stamp = token();

        await upload(e2e, 'image', fileOf(`shot-${stamp}.png`, PNG_BYTES));
        const picture = await rowFor(e2e, `shot-${stamp}.png`);
        assert.equal(picture.kind, 'image');
        assert.match(new URL(picture.address).pathname, /^\/media\/[0-9a-f]{32}\.png$/);

        await upload(e2e, 'document', fileOf(`terms-${stamp}.pdf`, PDF_BYTES));
        const stored = await rowFor(e2e, `terms-${stamp}.pdf`);
        assert.equal(stored.kind, 'document');
        assert.match(new URL(stored.address).pathname, /^\/api\/v1\/files\/[0-9a-f-]{36}$/);

        // The administrator can download the document; nobody without that session can.
        const asAdmin = await e2e.page.evaluate(async (url: string) => {
          const response = await fetch(url, { credentials: 'include' });
          return { status: response.status, length: (await response.arrayBuffer()).byteLength };
        }, stored.address);
        assert.equal(asAdmin.status, 200);
        assert.equal(asAdmin.length, PDF_BYTES.length);

        assert.equal((await fetch(stored.address)).status, 401, 'a document needs an administrator');
        assert.equal((await fetch(picture.address)).status, 200, 'a picture is public');

        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });
  }

  it("[ar] a file the server will not take is refused in the administrator's language", async () => {
    const { e2e } = await adminPage(browser, 'ar');
    try {
      await openTab(e2e, 'files');

      // A real PNG offered as a document: the documents folder does not take pictures.
      await upload(e2e, 'document', fileOf(`wrong-${token()}.pdf`, PNG_BYTES));

      const message = await waitForText(e2e.page, '[data-error="upload"]', (text) => text.length > 0);
      assert.match(message, /PDF/, 'the refusal names what a document may be');
      assert.match(message, /[\u0600-\u06FF]/, 'and is worded in Arabic');

      e2e.assertClean({ statuses: [{ status: 400, method: 'POST', url: /\/api\/v1\/files\/documents$/ }] });
    } finally {
      await e2e.close();
    }
  });

  it('[en] the kind filter narrows the list to pictures or documents', async () => {
    const { e2e } = await adminPage(browser, 'en');
    try {
      await openTab(e2e, 'files');
      const stamp = token();
      await upload(e2e, 'image', fileOf(`only-${stamp}.png`, PNG_BYTES));
      await rowFor(e2e, `only-${stamp}.png`);
      await upload(e2e, 'document', fileOf(`only-${stamp}.pdf`, PDF_BYTES));
      await rowFor(e2e, `only-${stamp}.pdf`);

      await e2e.page.type('[data-panel="files"] input[type="search"]', stamp);
      await e2e.page.select('[data-panel="files"] select', 'document');
      await waitForText(
        e2e.page,
        '[data-panel="files"]',
        (text) => text.includes(`only-${stamp}.pdf`) && !text.includes(`only-${stamp}.png`),
        20_000,
      );

      await e2e.page.select('[data-panel="files"] select', 'image');
      await waitForText(
        e2e.page,
        '[data-panel="files"]',
        (text) => text.includes(`only-${stamp}.png`) && !text.includes(`only-${stamp}.pdf`),
        20_000,
      );

      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });
});
