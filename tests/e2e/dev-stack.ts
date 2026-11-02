/**
 * Starts the same isolated stack as the e2e orchestrator (fresh SPA, fresh LumaBeauty_E2E_<hex> database, API) and
 * keeps it running for manual exploration. Run through the hub/long-running process facility, stop with SIGINT.
 * Prints the URL and the per-run random credentials to stdout only.
 */
import path from 'node:path';
import { ApiClient } from './harness/api.ts';
import { ensureCatalogFixture } from './harness/catalog.ts';
import { ARTIFACTS_DIR, randomHex, startStack } from './harness/stack.ts';

const runId = `dev-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomHex(3)}`;
const stack = await startStack(runId, path.join(ARTIFACTS_DIR, 'runs', runId));
const admin = new ApiClient(stack.baseUrl);
await admin.login(stack.credentials.adminEmail, stack.credentials.adminPassword);
await ensureCatalogFixture(admin);

console.log(`STACK_READY ${stack.baseUrl}`);
console.log(`ADMIN ${stack.credentials.adminEmail} ${stack.credentials.adminPassword}`);
console.log(`CUSTOMER ${stack.credentials.customerEmail} ${stack.credentials.customerPassword}`);
console.log(`DB ${stack.dbName}`);

const shutdown = async (): Promise<void> => {
  await stack.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
setInterval(() => undefined, 60_000);
