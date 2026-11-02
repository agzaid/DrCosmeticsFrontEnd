/**
 * `npm run test:e2e [-- <filter>...] [--attach <baseUrl>]`
 *
 * Creates an isolated stack (fresh SPA build, fresh LumaBeauty_E2E_<hex> database, one API instance), runs the
 * matching specs with node:test (sequentially), then tears everything down and drops exactly its own database.
 * `--attach <baseUrl>` runs the same specs against an already deployed instance (credentials from the environment).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ApiClient } from './harness/api.ts';
import { ensureCatalogFixture } from './harness/catalog.ts';
import { ARTIFACTS_DIR, REPO_ROOT, killTree, randomHex, startStack, type Stack } from './harness/stack.ts';

const SPEC_DIR = path.join(REPO_ROOT, 'tests', 'e2e', 'specs');

function parseArgs(argv: string[]): { filters: string[]; attach?: string } {
  const filters: string[] = [];
  let attach: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--attach') {
      attach = argv[index + 1];
      index += 1;
    } else if (argument.startsWith('--attach=')) {
      attach = argument.slice('--attach='.length);
    } else if (argument !== '--') {
      filters.push(argument);
    }
  }
  return { filters, attach };
}

function selectSpecs(filters: string[]): string[] {
  const all = readdirSync(SPEC_DIR)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort();
  const selected =
    filters.length === 0 ? all : all.filter((name) => filters.some((filter) => name.includes(filter)));
  return selected.map((name) => path.join(SPEC_DIR, name));
}

async function main(): Promise<number> {
  const { filters, attach } = parseArgs(process.argv.slice(2));
  const specs = selectSpecs(filters);
  if (specs.length === 0) {
    console.error(`[e2e] No spec files match ${JSON.stringify(filters)} in ${SPEC_DIR}`);
    return 2;
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomHex(3)}`;
  const runDir = path.join(ARTIFACTS_DIR, 'runs', runId);
  mkdirSync(runDir, { recursive: true });

  let stack: Stack | undefined;
  let child: ChildProcess | undefined;
  let tornDown = false;

  const teardown = async (): Promise<void> => {
    if (tornDown) {
      return;
    }
    tornDown = true;
    killTree(child?.pid);
    await stack?.stop();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.error(`[e2e] ${signal} received, tearing down`);
      void teardown().finally(() => process.exit(130));
    });
  }

  try {
    let env: Record<string, string>;
    if (attach) {
      const adminEmail = process.env.E2E_ADMIN_EMAIL;
      const adminPassword = process.env.E2E_ADMIN_PASSWORD;
      if (!adminEmail || !adminPassword) {
        throw new Error('--attach requires E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD in the environment');
      }
      env = {
        E2E_BASE_URL: attach.replace(/\/+$/, ''),
        E2E_ADMIN_EMAIL: adminEmail,
        E2E_ADMIN_PASSWORD: adminPassword,
        E2E_CUSTOMER_EMAIL: process.env.E2E_CUSTOMER_EMAIL ?? '',
        E2E_CUSTOMER_PASSWORD: process.env.E2E_CUSTOMER_PASSWORD ?? '',
        E2E_ATTACH: '1',
      };
      console.log(`[e2e] attach mode: ${env.E2E_BASE_URL} (no database created or dropped)`);
    } else {
      console.log(`[e2e] run ${runId}: building SPA, creating database, starting API ...`);
      stack = await startStack(runId, runDir);
      console.log(`[e2e] API ${stack.baseUrl} database ${stack.dbName}; log ${path.join(runDir, 'api.log')}`);
      const admin = new ApiClient(stack.baseUrl);
      await admin.login(stack.credentials.adminEmail, stack.credentials.adminPassword);
      const created = await ensureCatalogFixture(admin);
      console.log(`[e2e] catalog fixture: created ${created} extra product(s)`);
      env = {
        E2E_BASE_URL: stack.baseUrl,
        E2E_ADMIN_EMAIL: stack.credentials.adminEmail,
        E2E_ADMIN_PASSWORD: stack.credentials.adminPassword,
        E2E_CUSTOMER_EMAIL: stack.credentials.customerEmail,
        E2E_CUSTOMER_PASSWORD: stack.credentials.customerPassword,
        E2E_ATTACH: '0',
      };
    }
    env.E2E_RUN_DIR = runDir;

    child = spawn(
      process.execPath,
      ['--import', 'tsx', '--test', '--test-concurrency=1', ...specs],
      { cwd: REPO_ROOT, env: { ...process.env, ...env }, stdio: 'inherit' },
    );
    const exitCode = await new Promise<number>((resolve) => {
      child?.once('exit', (code) => resolve(code ?? 1));
      child?.once('error', () => resolve(1));
    });
    return exitCode;
  } finally {
    await teardown();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`[e2e] FATAL: ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  },
);
