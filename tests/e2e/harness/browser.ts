/**
 * Puppeteer harness: one isolated browser context per page, language preselected, strict error collection and a
 * single CDP Fetch session that (a) stubs every external host (fonts/images) so runs are deterministic and offline-safe
 * and (b) lets specs fail/fulfil requests or fail a RESPONSE after the server already committed it.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser, type BrowserContext, type CDPSession, type ConsoleMessage, type Page } from 'puppeteer-core';
import { SCREENS_DIR, findChrome } from './stack.ts';

export type Lang = 'en' | 'ar';

export interface NewPageOptions {
  lang: Lang;
  viewport?: { width: number; height: number };
  baseUrl?: string;
}

export interface Allowances {
  /** Console error texts (or Chrome "Failed to load resource" lines) that are expected. */
  console?: (string | RegExp)[];
  /** `method url` strings of requests that are expected to fail at network level. */
  failedRequests?: (string | RegExp)[];
  /** Expected HTTP error responses. */
  statuses?: { status: number; method?: string; url?: RegExp }[];
}

interface RecordedRequest {
  method: string;
  url: string;
  resourceType: string;
}

interface InterceptRule {
  stage: 'request' | 'response';
  method?: string;
  url: RegExp;
  times: number;
  action: 'abort' | 'fulfill' | 'failResponse' | 'delay';
  delayMs?: number;
  status?: number;
  body?: unknown;
  hits: number;
}

export interface InterceptHandle {
  readonly hits: number;
  remove(): void;
}

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let sharedBrowser: Browser | undefined;

export async function launchBrowser(): Promise<Browser> {
  sharedBrowser ??= await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    defaultViewport: null,
    // Only for a rehearsal staging copy that runs with a self-signed certificate (Rehearse-Release.ps1).
    acceptInsecureCerts: process.env.E2E_ACCEPT_INSECURE_CERTS === '1',
    args: ['--no-first-run', '--disable-extensions', '--disable-background-networking', '--lang=en-US'],
  });
  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  const browser = sharedBrowser;
  sharedBrowser = undefined;
  await browser?.close();
}

function matches(patterns: (string | RegExp)[] | undefined, text: string): boolean {
  return (patterns ?? []).some((pattern) => (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)));
}

export class E2ePage {
  readonly consoleErrors: { text: string; url: string }[] = [];
  readonly pageErrors: string[] = [];
  readonly failedRequests: { key: string; reason: string }[] = [];
  readonly badResponses: { status: number; method: string; url: string }[] = [];
  readonly requests: RecordedRequest[] = [];
  readonly externalRequests: RecordedRequest[] = [];
  readonly dialogs: string[] = [];
  private readonly expectedKeys = new Set<string>();
  private readonly allowances: Allowances = { console: [], failedRequests: [], statuses: [] };
  private readonly rules: InterceptRule[] = [];
  private session!: CDPSession;

  readonly page: Page;
  readonly context: BrowserContext;
  readonly lang: Lang;
  readonly baseUrl: string;
  private readonly origin: string;

  constructor(page: Page, context: BrowserContext, lang: Lang, baseUrl: string) {
    this.page = page;
    this.context = context;
    this.lang = lang;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.origin = new URL(this.baseUrl).origin;
  }

  async init(): Promise<void> {
    const { page } = this;

    // Anonymous visitors always receive 401 from GET /auth/me during boot; that is the documented contract.
    this.allow({
      statuses: [{ status: 401, method: 'GET', url: /\/api\/v1\/auth\/me$/ }],
    });

    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error') {
        this.consoleErrors.push({ text: message.text(), url: message.location().url ?? '' });
      }
    });
    page.on('pageerror', (error) => {
      this.pageErrors.push(String(error));
    });
    page.on('request', (request) => {
      const record = { method: request.method(), url: request.url(), resourceType: request.resourceType() };
      if (request.url().startsWith('data:') || request.url().startsWith('blob:')) {
        return;
      }
      (request.url().startsWith(this.origin) ? this.requests : this.externalRequests).push(record);
    });
    page.on('requestfailed', (request) => {
      this.failedRequests.push({
        key: `${request.method()} ${request.url()}`,
        reason: request.failure()?.errorText ?? 'unknown',
      });
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        this.badResponses.push({
          status: response.status(),
          method: response.request().method(),
          url: response.url(),
        });
      }
    });
    page.on('dialog', (dialog) => {
      this.dialogs.push(dialog.message());
      void dialog.accept();
    });

    this.session = await page.createCDPSession();
    this.session.on('Fetch.requestPaused', (event) => {
      void this.onPaused(event).catch(() => undefined);
    });
    await this.syncFetchPatterns();
  }

  private async syncFetchPatterns(): Promise<void> {
    const patterns: { urlPattern: string; requestStage: 'Request' | 'Response' }[] = [
      { urlPattern: '*', requestStage: 'Request' },
    ];
    if (this.rules.some((rule) => rule.stage === 'response')) {
      patterns.push({ urlPattern: '*/api/*', requestStage: 'Response' });
    }
    await this.session.send('Fetch.enable', { patterns });
  }

  private findRule(stage: InterceptRule['stage'], method: string, url: string): InterceptRule | undefined {
    return this.rules.find(
      (rule) =>
        rule.stage === stage &&
        rule.hits < rule.times &&
        (!rule.method || rule.method === method) &&
        rule.url.test(url),
    );
  }

  private async onPaused(event: {
    requestId: string;
    request: { url: string; method: string };
    resourceType: string;
    responseStatusCode?: number;
    responseErrorReason?: string;
  }): Promise<void> {
    const { requestId } = event;
    const { url, method } = event.request;
    const isResponseStage = event.responseStatusCode !== undefined || event.responseErrorReason !== undefined;
    const send = this.session.send.bind(this.session);

    if (isResponseStage) {
      const rule = this.findRule('response', method, url);
      if (rule) {
        rule.hits += 1;
        this.expectedKeys.add(`${method} ${url}`);
        await send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' });
        return;
      }
      await send('Fetch.continueResponse', { requestId });
      return;
    }

    const rule = this.findRule('request', method, url);
    if (rule) {
      rule.hits += 1;
      this.expectedKeys.add(`${method} ${url}`);
      if (rule.action === 'abort') {
        await send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' });
      } else if (rule.action === 'delay') {
        this.expectedKeys.delete(`${method} ${url}`);
        await new Promise((resolve) => setTimeout(resolve, rule.delayMs ?? 0));
        await send('Fetch.continueRequest', { requestId });
      } else {
        const body = JSON.stringify(rule.body ?? { title: 'Injected failure', errorCode: 'InternalError' });
        await send('Fetch.fulfillRequest', {
          requestId,
          responseCode: rule.status ?? 500,
          responseHeaders: [{ name: 'Content-Type', value: 'application/problem+json' }],
          body: Buffer.from(body).toString('base64'),
        });
      }
      return;
    }

    if (url.startsWith(this.origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      await send('Fetch.continueRequest', { requestId });
      return;
    }

    // External host (Google Fonts, remote product images): never leave the machine.
    const isImage = event.resourceType === 'Image';
    await send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: isImage ? 'image/png' : event.resourceType === 'Stylesheet' ? 'text/css' : 'application/octet-stream' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
      ],
      body: isImage ? PIXEL_PNG.toString('base64') : '',
    });
  }

  private addRule(rule: Omit<InterceptRule, 'hits'>): InterceptHandle {
    const entry: InterceptRule = { ...rule, hits: 0 };
    this.rules.push(entry);
    if (rule.stage === 'response') {
      void this.syncFetchPatterns();
    }
    return {
      get hits() {
        return entry.hits;
      },
      remove: () => {
        const index = this.rules.indexOf(entry);
        if (index >= 0) {
          this.rules.splice(index, 1);
        }
      },
    };
  }

  /** Fail matching requests at the network level before they reach the server. */
  abortRequests(url: RegExp, options: { method?: string; times?: number } = {}): InterceptHandle {
    return this.addRule({ stage: 'request', action: 'abort', url, method: options.method, times: options.times ?? Infinity });
  }

  /** Hold matching requests for `delayMs` before they reach the server (to observe loading states). */
  delayRequests(url: RegExp, delayMs: number, options: { method?: string; times?: number } = {}): InterceptHandle {
    return this.addRule({ stage: 'request', action: 'delay', delayMs, url, method: options.method, times: options.times ?? Infinity });
  }

  /** Answer matching requests with a synthetic problem+json response (the server never sees them). */
  fulfillRequests(
    url: RegExp,
    status: number,
    options: { method?: string; times?: number; body?: unknown } = {},
  ): InterceptHandle {
    return this.addRule({
      stage: 'request',
      action: 'fulfill',
      url,
      status,
      body: options.body,
      method: options.method,
      times: options.times ?? Infinity,
    });
  }

  /**
   * Lost response: the request reaches the server and is processed/committed, then the connection is reset at
   * the RESPONSE stage so the page sees a network error and never receives the body.
   */
  failResponses(url: RegExp, options: { method?: string; times?: number } = {}): InterceptHandle {
    return this.addRule({
      stage: 'response',
      action: 'failResponse',
      url,
      method: options.method,
      times: options.times ?? 1,
    });
  }

  /** Declare additional expected noise for assertClean(). */
  allow(allowances: Allowances): void {
    this.allowances.console?.push(...(allowances.console ?? []));
    this.allowances.failedRequests?.push(...(allowances.failedRequests ?? []));
    this.allowances.statuses?.push(...(allowances.statuses ?? []));
  }

  async goto(pathname = '/'): Promise<void> {
    await this.page.goto(`${this.baseUrl}${pathname}`, { waitUntil: 'domcontentloaded' });
  }

  async setLanguage(lang: Lang): Promise<void> {
    await setLanguage(this.page, lang);
  }

  async screenshot(name: string): Promise<string> {
    return screenshot(this.page, name);
  }

  /** Same-origin traffic must be the document, built assets, /api and /media only; no static data files. */
  assertOnlyApiTraffic(): void {
    const problems: string[] = [];
    for (const request of this.requests) {
      const { pathname } = new URL(request.url);
      const allowed =
        request.resourceType === 'document' ||
        pathname.startsWith('/api/') ||
        pathname.startsWith('/media/') ||
        pathname.startsWith('/assets/') ||
        pathname === '/favicon.ico';
      if (!allowed || /\.(json|csv|xml)$/i.test(pathname)) {
        problems.push(`${request.method} ${pathname} (${request.resourceType})`);
      }
    }
    for (const request of this.externalRequests) {
      if (!['image', 'stylesheet', 'font', 'other'].includes(request.resourceType)) {
        problems.push(`external ${request.method} ${request.url} (${request.resourceType})`);
      }
      if (request.resourceType === 'xhr' || request.resourceType === 'fetch') {
        problems.push(`external data request ${request.url}`);
      }
    }
    if (problems.length > 0) {
      throw new Error(`Unexpected non-API traffic:\n${problems.join('\n')}`);
    }
  }

  /** Fails when the page produced uncaught errors, unexpected console errors, failed requests or 4xx/5xx responses. */
  assertClean(extra: Allowances = {}): void {
    const consoleAllowed = [...(this.allowances.console ?? []), ...(extra.console ?? [])];
    const failedAllowed = [...(this.allowances.failedRequests ?? []), ...(extra.failedRequests ?? [])];
    const statusAllowed = [...(this.allowances.statuses ?? []), ...(extra.statuses ?? [])];
    const problems: string[] = [];

    for (const error of this.pageErrors) {
      problems.push(`pageerror: ${error}`);
    }
    for (const entry of this.consoleErrors) {
      const expectedByRule = [...this.expectedKeys].some((key) => entry.url && key.endsWith(` ${entry.url}`));
      const expectedStatus = this.badResponses.some(
        (response) =>
          response.url === entry.url &&
          statusAllowed.some(
            (rule) =>
              rule.status === response.status &&
              (!rule.method || rule.method === response.method) &&
              (!rule.url || rule.url.test(response.url)),
          ),
      );
      if (!expectedByRule && !expectedStatus && !matches(consoleAllowed, entry.text)) {
        problems.push(`console.error: ${entry.text} (${entry.url})`);
      }
    }
    for (const failure of this.failedRequests) {
      const url = failure.key.slice(failure.key.indexOf(' ') + 1);
      // Requests superseded by navigation/abort (React unmount) are not failures of the app.
      if (failure.reason === 'net::ERR_ABORTED') {
        continue;
      }
      if (!this.expectedKeys.has(failure.key) && !matches(failedAllowed, failure.key) && !url.startsWith('data:')) {
        problems.push(`request failed: ${failure.key} (${failure.reason})`);
      }
    }
    for (const response of this.badResponses) {
      const key = `${response.method} ${response.url}`;
      const allowed =
        this.expectedKeys.has(key) ||
        statusAllowed.some(
          (rule) =>
            rule.status === response.status &&
            (!rule.method || rule.method === response.method) &&
            (!rule.url || rule.url.test(response.url)),
        );
      if (!allowed) {
        problems.push(`HTTP ${response.status}: ${key}`);
      }
    }

    if (problems.length > 0) {
      throw new Error(`Page was not clean:\n${problems.join('\n')}`);
    }
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
  }
}

export async function newPage(browser: Browser, options: NewPageOptions): Promise<E2ePage> {
  const baseUrl = options.baseUrl ?? process.env.E2E_BASE_URL;
  if (!baseUrl) {
    throw new Error('E2E_BASE_URL is not set; run through "npm run test:e2e".');
  }
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(options.viewport ?? { width: 1280, height: 800 });
  await page.evaluateOnNewDocument((lang: string) => {
    // Preselect once; a later in-app switch (which writes the same key) must survive reloads.
    if (!localStorage.getItem('luma_language')) {
      localStorage.setItem('luma_language', lang);
    }
  }, options.lang);
  const wrapped = new E2ePage(page, context, options.lang, baseUrl);
  await wrapped.init();
  return wrapped;
}

export async function setLanguage(page: Page, lang: Lang): Promise<void> {
  await page.evaluate((value: string) => localStorage.setItem('luma_language', value), lang);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

export async function screenshot(page: Page, name: string): Promise<string> {
  mkdirSync(SCREENS_DIR, { recursive: true });
  const file = path.join(SCREENS_DIR, `${name.replace(/[^a-z0-9._-]+/gi, '_')}.png`);
  await page.screenshot({ path: file });
  return file;
}
