/**
 * Per-run isolated stack: fresh SQL Server database, one API instance (a fresh Release publish of the current
 * source), a freshly built SPA copy.
 * SQL access is confined to this file (database create/drop); specs only talk HTTP.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, writeSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts', 'e2e');
export const SCREENS_DIR = path.join(ARTIFACTS_DIR, 'screens');
export const PUBLISH_DIR = path.join(ARTIFACTS_DIR, 'api');

const E2E_DB_PATTERN = /^LumaBeauty_E2E_[0-9a-f]{32}$/;
const SQL_SERVER = process.env.E2E_SQL_SERVER || 'localhost';

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function randomSecret(): string {
  // Complies with the Identity password policy (upper, lower, digit, symbol) without being guessable.
  return `Aa1!${randomBytes(12).toString('base64url')}`;
}

export function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('No Chrome/Edge executable found. Set CHROME_PATH.');
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('Could not allocate a port'))));
    });
  });
}

function sqlcmd(query: string): string {
  const result = spawnSync('sqlcmd', ['-S', SQL_SERVER, '-E', '-C', '-b', '-h', '-1', '-W', '-Q', query], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`sqlcmd failed (${result.status}): ${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

export function assertE2eDatabaseName(name: string): void {
  if (!E2E_DB_PATTERN.test(name)) {
    throw new Error(`Refusing to touch database "${name}": it does not match ${E2E_DB_PATTERN}`);
  }
}

export function createDatabase(name: string): void {
  assertE2eDatabaseName(name);
  sqlcmd(`CREATE DATABASE [${name}] COLLATE Arabic_100_CI_AI`);
}

/** Drops exactly the named database (guarded by the strict regex). */
export function dropDatabase(name: string): void {
  assertE2eDatabaseName(name);
  sqlcmd(
    `IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]; END`,
  );
}

export function killTree(pid: number | undefined): void {
  if (!pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

export function buildSpa(outDir: string): void {
  const viteBin = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const result = spawnSync(process.execPath, [viteBin, 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // The SPA under test is served by the API under test, so it must call its own origin whatever .env.production
    // says: a production address there must never redirect a test run (which writes data) to a real server.
    env: { ...process.env, VITE_API_URL: '' },
  });
  if (result.status !== 0) {
    throw new Error(`SPA build failed:\n${result.stdout}\n${result.stderr}`);
  }
  if (!existsSync(path.join(outDir, 'index.html'))) {
    throw new Error(`SPA build produced no index.html in ${outDir}`);
  }
}

/**
 * Publishes the API from the current source into the run folder. A stale publish would silently test old code, so
 * this always runs; E2E_SKIP_PUBLISH=1 reuses the previous output for quick iteration on the specs themselves.
 */
export function publishApi(): void {
  if (process.env.E2E_SKIP_PUBLISH === '1' && existsSync(path.join(PUBLISH_DIR, 'LumaBeauty.Api.dll'))) {
    return;
  }
  const project = path.join(REPO_ROOT, 'backend', 'src', 'LumaBeauty.Api', 'LumaBeauty.Api.csproj');
  const result = spawnSync(
    'dotnet',
    ['publish', project, '-c', 'Release', '-o', PUBLISH_DIR, '--nologo', '-v', 'q'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`API publish failed:\n${result.stdout}\n${result.stderr}`);
  }
  if (!existsSync(path.join(PUBLISH_DIR, 'LumaBeauty.Api.dll'))) {
    throw new Error(`API publish produced no LumaBeauty.Api.dll in ${PUBLISH_DIR}`);
  }
}

export interface StackCredentials {
  adminEmail: string;
  adminPassword: string;
  customerEmail: string;
  customerPassword: string;
}

export interface Stack {
  runId: string;
  runDir: string;
  baseUrl: string;
  dbName: string;
  credentials: StackCredentials;
  stop(): Promise<void>;
}

async function waitFor<T>(label: string, timeoutMs: number, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${String(lastError)}` : ''}`);
}

export function tailFile(file: string, lines = 40): string {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export async function startStack(runId: string, runDir: string): Promise<Stack> {
  publishApi();

  const dbName = `LumaBeauty_E2E_${randomHex(16)}`;
  assertE2eDatabaseName(dbName);
  const webDir = path.join(runDir, 'web');
  const uploadsDir = path.join(runDir, 'uploads');
  const logPath = path.join(runDir, 'api.log');
  mkdirSync(runDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });

  const credentials: StackCredentials = {
    adminEmail: 'admin@lumabeauty.com',
    adminPassword: randomSecret(),
    customerEmail: 'sarah@example.com',
    customerPassword: randomSecret(),
  };

  let databaseCreated = false;
  let api: ChildProcess | undefined;
  let logFd: number | undefined;
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    killTree(api?.pid);
    if (api && api.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000);
        api?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (logFd !== undefined) {
      closeSync(logFd);
      logFd = undefined;
    }
    if (databaseCreated) {
      try {
        dropDatabase(dbName);
        databaseCreated = false;
      } catch (error) {
        console.error(`[e2e] FAILED to drop ${dbName}: ${String(error)}`);
      }
    }
    rmSync(uploadsDir, { recursive: true, force: true });
  };

  try {
    buildSpa(webDir);
    createDatabase(dbName);
    databaseCreated = true;

    const port = await freePort();
    const baseUrl = `http://localhost:${port}`;
    logFd = openSync(logPath, 'w');

    api = spawn('dotnet', ['LumaBeauty.Api.dll'], {
      cwd: PUBLISH_DIR,
      env: {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: 'Development',
        ASPNETCORE_URLS: baseUrl,
        ASPNETCORE_WEBROOT: webDir,
        ConnectionStrings__Default: `Server=${SQL_SERVER};Database=${dbName};Trusted_Connection=True;TrustServerCertificate=True`,
        AdminSetup__Email: credentials.adminEmail,
        AdminSetup__Password: credentials.adminPassword,
        DemoSeed__Enabled: 'true',
        DemoSeed__CustomerPassword: credentials.customerPassword,
        Quotes__SigningKey: randomHex(32),
        RateLimits__AuthPermitLimit: '100000',
        RateLimits__CheckoutPermitLimit: '100000',
        Uploads__RootPath: uploadsDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let listening = false;
    let exited = false;
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      if (logFd !== undefined) {
        writeSync(logFd, text);
      }
      if (text.includes('Now listening on')) {
        listening = true;
      }
    };
    api.stdout?.on('data', onData);
    api.stderr?.on('data', onData);
    api.once('exit', () => {
      exited = true;
    });

    await waitFor('API "Now listening on"', 120_000, async () => {
      if (exited) {
        throw new Error(`API exited early. Log tail:\n${tailFile(logPath)}`);
      }
      return listening ? true : undefined;
    });

    await waitFor('/health/ready', 120_000, async () => {
      if (exited) {
        throw new Error(`API exited early. Log tail:\n${tailFile(logPath)}`);
      }
      const response = await fetch(`${baseUrl}/health/ready`);
      return response.status === 200 ? true : undefined;
    });

    return { runId, runDir, baseUrl, dbName, credentials, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
