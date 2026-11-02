# Luma Beauty — cutover from the prototype runtime (P7.3)

**Result.** The application now runs on .NET and SQL Server only. The Express prototype, its in-memory sessions and its
JSON file store are retired; the prototype's data is accounted for in SQL Server and proven equal by an independent
reconciliation; recoverable backups and a source checkpoint exist.

| | |
|---|---|
| Cutover date | 2026-11-01 |
| Source of truth before | `data/db.json` (57,612 bytes, SHA-256 `a3733d86a354a81b02051cfd0d086e9f84c8710c42b1d142b25e60ff76079cc8`) |
| Source of truth after | SQL Server database `LumaBeauty` |
| Reconciliation | PASS, 16 checks, 0 differences (section 3) |
| Browser acceptance before retirement | 147 of 149 on the first complete runs after the last backend changes; the two failures were a stale CSRF token kept by the test harness after a sign-out (fixed; that spec then passed in isolation, 2 of 2) |
| Browser acceptance after retirement | **149 of 149**, twice (right after the retirement and again on the final tree); 148 of 149 plus one skipped-by-design against the packaged HTTPS staging copy |

## 1. What the prototype held, and where it went

Decisions: `DECISIONS.md` D-LEGACY-1…5, D-DATA-1, D-LEGACY-PAY, D-FUL-4, D-P7-12.

| Prototype data | In SQL Server | How it is proven |
|---|---|---|
| 5 categories, 6 brands + the `Botanica Haircare` reference the prototype used but never defined (brand id `botanica-haircare`) | imported, ids preserved | `reconcile`: categories, brands |
| 2 banners, 3 coupons (usage 34 / 19 / 82 preserved) | imported | `reconcile`: banners, coupons, control totals |
| 22 products, 41 variants, 25 images, 19 skin-type tags (ids, SKUs normalised to upper case, prices, stock) | imported | `reconcile`: products, variants, images, skin types, sums of stock and price |
| 3 orders with items, status history and address snapshots | imported with `--scope full`; delivered orders are recorded as collected (the prototype had no payment state: an inference, D-LEGACY-PAY) | `reconcile`: orders, items, history, arithmetic, totals |
| order number counter | `OrderNumberSeq` restarted above the highest imported number (849203; the first new order was `LUM-849203`) | `reconcile`: order number sequence |
| 2 user profiles (admin, customer) | **not imported**: no password material existed. The administrator is created with `--setup-admin`; customers register | listed as *accounted*; `reconcile` fails if a login already carries a source user id |
| 1 runtime idempotency record | **not imported**: it only deduplicated a browser retry inside the prototype | listed as *accounted* |
| in-memory login sessions | not carried: sessions were tokens in process memory and never persisted | — |

Nothing else in the prototype held state (`server/seedData.ts` was the seed of `db.json`).

## 2. Freeze, backups and checkpoint

- **Writes stopped.** The prototype server was not running during the build, and `data/db.json` still has the SHA-256
  recorded at the start of the project, so the file holds exactly what was backed up then.
- **Inputs backup** (start of project): `D:\Programming\luma-beauty_backups\2026-10-31_baseline\` — `db.json`,
  `seedData.ts`, `package.json`, `PLAN.md`, the runbook.
- **Pre-retirement checkpoint** (this cutover): `D:\Programming\luma-beauty_backups\2026-11-01_pre-retirement\`

  | File | SHA-256 |
  |---|---|
  | `db.json` | `a3733d86a354a81b02051cfd0d086e9f84c8710c42b1d142b25e60ff76079cc8` |
  | `luma-beauty-source.tar.gz` (the whole working tree except `node_modules`, `dist`, `bin`, `obj`, `artifacts`; includes `server.ts` and `server/`) | `d927c6d8e0a5c579238afc89d53676de12b5e7e60c927f6fc6b2b38b567230d1` |

  There is no version-control repository in this project, so this archive is the source-history checkpoint.

## 3. Reconciliation

Run against the real `data/db.json` and a fresh database prepared exactly as `DEPLOYMENT.md` prescribes (provision,
apply `LumaBeauty.sql` with plain `sqlcmd`, import):

```text
sqlcmd -S localhost -E -C -b -v DatabaseName=LumaBeauty_Cutover RecoveryModel=SIMPLE -i backend\db\provision.sql
sqlcmd -S localhost -E -C -b -d LumaBeauty_Cutover -i backend\db\LumaBeauty.sql
LumaBeauty.LegacyData import    --source data\db.json --connection "<sql>" --scope full --dry-run   -> rolled back, counts only
LumaBeauty.LegacyData import    --source data\db.json --connection "<sql>" --scope full
LumaBeauty.LegacyData reconcile --source data\db.json --connection "<sql>" --scope full --report reconcile-full.json
```

| Imported | Count | | Control totals | Source | SQL |
|---|---|---|---|---|---|
| categories | 5 | | sum of variant stock | 764 | 764 |
| brands (incl. 1 created) | 7 | | sum of variant prices | 18,650.00 | 18,650.00 |
| banners | 2 | | sum of order totals | 1,559.00 | 1,559.00 |
| coupons | 3 | | collected total (Delivered orders) | 629.00 | 629.00 |
| products / variants / images | 22 / 41 / 25 | | orders Pending / Shipped / Delivered | 1 / 1 / 1 | 1 / 1 / 1 |
| orders / items / history rows | 3 / 4 / 8 | | coupon usage WELCOME15 / LUMA50 / GLOW10 | 34 / 19 / 82 | 34 / 19 / 82 |

`reconcile` never calls the importer: it computes the expected rows from the raw file and the documented normalisation,
reads SQL with plain queries, and compares field by field.

```text
source values PASS 28 · categories PASS 5 · brands PASS 7 · banners PASS 2 · coupons PASS 3 · products PASS 22
product images PASS 25 · product skin types PASS 19 · variants PASS 41 · orders PASS 3 · order items PASS 4
order status history PASS 8 · order arithmetic PASS 6 · order number sequence PASS 1 · control totals PASS 24
identity accounts PASS 2
RESULT: PASS (16 checks, 0 differences)
```

The check has teeth (same database, same file):

| Perturbation | Result |
|---|---|
| `UPDATE ProductVariants SET Price = Price + 1 WHERE Id = 'var-1-1'` | exit 1: `variants[var-1-1].Price: source 380.00 but SQL has 381.00` and the price control total |
| stock reduced by 3 (a sale) | strict run exit 1; `--ignore-stock` exit 0 (everything but live stock still equal) |

The development database, seeded by the application from the embedded copy of the same file, reconciles too
(`--scope catalog --ignore-stock`: PASS, 11 checks). That shows the shipped seed holds the current data and not an
older snapshot.

## 4. Retirement of the prototype runtime

Done only after the reconciliation above and the browser acceptance suite passed.

| Removed | Because |
|---|---|
| `server.ts`, `server/db.ts`, `server/seedData.ts` | the Express runtime and its seed module |
| npm scripts `dev:legacy` and `start` | they started that runtime; `clean` no longer removes a compiled `server.js` |
| dependencies `express`, `dotenv`, `@google/genai`, `@types/express` (117 packages with their own dependencies) | nothing in `src/`, `vite.config.ts` or the tests imports them |
| `.env.example` (`GEMINI_API_KEY`, `PORT`, `APP_URL`) | nothing reads a `.env` file any more |
| the `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` claim in `metadata.json` | no server-side AI call exists |

Kept: `tsx` (runs `npm test` and the browser suite), `data/db.json` (read-only history and the input of the import tool),
the shopping-rule unit tests (`src/utils/shopLogic.test.ts`, 8 passing), and `npm run lint`, which type-checked nothing
usable while `server.ts` existed and now runs the type-check of the app and of the browser tests.

## 5. Proof from the documented commands

Starting from **no database**: the development database was dropped and recreated with the documented commands
(`provision.sql`, then `npm run dev:api`, with `npm run dev` already serving the storefront):

1. `/health/ready` Healthy; 22 products, 41 variants, collation `Arabic_100_CI_AI`.
2. In a browser, in **Arabic** (`lang="ar" dir="rtl"`), a guest added two units of a product, checked out (cash on
   delivery, 900 EGP) and reached the confirmation: order `LUM-849203`, status "قيد الانتظار".
3. SQL showed the order (`Pending`, `Unpaid`, `Guest`, 900.00), stock 40 → 38 and one inventory audit row.
4. The API process was **restarted**. After the restart SQL still held the order and the stock; reloading the page in the same
   browser showed the same confirmation from the database, and `GET /api/v1/orders/{id}` with the browser's cookies returned
   200, `LUM-849203`, 900, `Pending`.

## 6. Rollback

- **Before real orders exist in SQL Server:** restore the checkpoint (`luma-beauty-source.tar.gz`) into a clean folder,
  `npm ci`, and `npm start` brings the prototype back with `data/db.json` (verify its SHA-256 against section 2). The SQL
  database can simply be dropped.
- **After real orders exist in SQL Server** there is no automatic way back: orders, stock movements and accounts exist only
  there and the prototype cannot read them. Rolling the *application* back means redeploying the previous release package
  (`DEPLOYMENT.md` section 7); rolling the *data* back means restoring a database backup, and loses everything written since.
- The archive and `db.json` copy are **not** a substitute for database backups of the running system (`DEPLOYMENT.md` section 9).

## 7. Repeating this for a new environment

`DEPLOYMENT.md` section 5, steps 3 and 7: provision, apply the schema, import (`--scope catalog` for a store that starts
fresh with the prototype's products, `--scope full` to carry the three historical orders), then `reconcile`.
Keep the console output and the JSON report with the release evidence.
