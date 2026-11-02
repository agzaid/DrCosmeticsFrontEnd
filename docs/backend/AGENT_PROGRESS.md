# LumaBeauty — Agent Progress

**Last updated:** 2026-11-01
**Authorized scope:** Phases 0–8. A live rollout is a separate action and was **not** performed.

---

## Status board

| Phase | Tasks | State |
|---|---|---|
| 0 — Baseline and decisions | P0.1–P0.3 | **complete** |
| 1 — Foundation and early connection | P1.1–P1.3 | **complete** |
| 2 — SQL Server persistence | P2.1–P2.3 | **complete** |
| 3 — Accounts and ownership | P3.1–P3.3 | **complete** |
| 4 — Catalog and store administration | P4.1–P4.3 | **complete** |
| 5 — Checkout | P5.1–P5.4 | **complete** |
| 6 — Fulfillment and customer history | P6.1–P6.3 | **complete** |
| 7 — Full integration and cutover | P7.1–P7.3 | **complete** |
| 8 — Release preparation | P8.1–P8.2 | **complete for the available environment**; IIS-specific checks are **blocked** (not installed), see `RELEASE_CHECKLIST.md` |

Release candidate: **1.0.0-rc.1** (`RELEASE_CHECKLIST.md` carries the package hash and every check as passed / failed / blocked).

---

## Phase 1 — Foundation and early connection

**Delivered**
- `backend/LumaBeauty.sln` with six projects and enforced references:
  Domain ← Application ← Infrastructure ← Api; tests reference only what they exercise.
- Central package management (`Directory.Packages.props`, `Directory.Build.props`), .NET 10 / EF Core 10.0.14.
- Result/`AppError` contracts, RFC 9457 problem details with `errorCode`, `traceId`, field errors and context.
- Central exception handler, antiforgery middleware, OpenAPI + Swagger UI (Development, or `OpenApi:Enabled`), `/health/live`, `/health/ready`.
- React connected early: `src/api/httpClient.ts`, `src/api/api.ts`, `src/api/types.ts`; Vite `/api` + `/media` proxy to `http://localhost:5080`; `npm run dev` runs Vite (the legacy Express server was retired at P7.3).
- Pricing port, address validator, quote token service, architecture boundary tests.

**Evidence**
- `dotnet build backend/LumaBeauty.sln` → succeeded.
- `npm run typecheck` (`tsc -p tsconfig.app.json`) → exit 0.
- `npm run build` → succeeded.
- `npm test` → 8/8 existing frontend pricing tests pass.
- Browser: Vite proxied `/api/v1/products` returns 200 with seeded products.

## Phase 2 — SQL Server persistence

**Delivered**
- `ApplicationDbContext` (partial configurations per feature): localized `{en,ar}` as owned `NVARCHAR` columns, decimal(18,2), UTC `datetime2`, `rowversion` on variants/orders/coupons, check constraints (`Stock >= 0`, `Quantity > 0`, money >= 0), filtered indexes, unique SKUs/order numbers.
- Machine keys use `Latin1_General_100_BIN2` (idempotency Scope/Key, SKU, order number, guest secret hash, discount code). Database provisioned with `Arabic_100_CI_AI`.
- `InitialCreate` migration + idempotent script `backend/db/LumaBeauty.sql` + `backend/db/provision.sql`.
- Repositories (focused), read queries (no-tracking + SQL paging/projection), `UnitOfWork` sharing the scoped context, `TransactionRunner` with Result-aware rollback and a fresh DI scope per execution-strategy attempt.
- Development seed from the prototype snapshot: 22 products / 41 variants / 5 categories / 7 brands (missing `Botanica Haircare` repaired) / 2 banners / 3 coupons / 3 historical orders.

**Evidence**
- `dotnet ef database update` → applied `InitialCreate`; 24 tables + `OrderNumberSeq`.
- Seeded counts verified by SQL and API (`total: 22`).
- Integration tests create `LumaBeauty_Test_<32 hex>` databases and drop exactly that name; guarded by regex + local-server check.

## Phase 3 — Accounts and ownership

**Delivered**
- ASP.NET Core Identity, customer-only public registration, roles `admin`/`customer`, lockout (5/15 min), rate limits on auth/checkout.
- Cookie `luma_auth` (HttpOnly, SameSite=Lax, 7-day sliding), antiforgery `X-XSRF-TOKEN` with automatic client retry, JSON 401/403.
- Guest scope: `POST /guest/session` issues `luma_guest` before checkout; only the SHA-256 hash is stored; 30-day read-only order access; `DELETE` revokes.
- Addresses and wishlist with ownership enforcement; wishlist uses idempotent PUT/DELETE (toggle removed); per-user state cleared on account change.
- Admin provisioned from configuration (user-secrets), demo customer from configuration; no committed password.

**Evidence**
- Browser: customer login (Sarah), admin login, account switching showed admin an empty wishlist and customer her saved item.
- Integration: wrong password 401, customer→admin 403, anonymous→admin 401, registration ignores `role`, missing CSRF 400, cross-customer order/address access 404.

## Phase 4 — Catalog and store administration

**Delivered**
- Public catalog: published-only, server-side search/filter/sort/paging with stable tie-breakers, batch `ids` lookup, detail by id.
- Admin products: list (`status=all`), create with default variant, update (stock changes on existing variants rejected → inventory tab), archive (never delete).
- Inventory adjustment: atomic delta or version-guarded absolute set via `OUTPUT` SQL, with audited `InventoryAdjustments`.
- Discount administration (create/archive/list) with normalised codes and lifetime usage.
- Banner administration (upsert; absent banners deactivated).
- Image upload: magic-byte sniffing, 5 MB cap, server-generated filename, local storage behind `IImageStorage`, served at `/media`.
- Frontend: ShopPage server paging/filters with reset-on-filter-change and stale-response cancellation; Home collections and product modal related items use their own queries; wishlist resolves by ids; Navbar search queries the API; AdminPage rewritten on the typed client with variant editing, upload, inventory, discounts, banners.

**Evidence**
- Browser: shop renders 22 products; admin dashboard shows 22 products and real metrics.
- Integration: 61-product fixture paging (total 83, 4 pages), last-page search, stable sort, invalid pageSize 400, archived hidden publicly but visible to admin.

## Phase 5 — Checkout

**Delivered**
- `POST /checkout/quote`: authoritative pricing, duplicate-line merging, 1..99 quantity validation, coupon issues reported non-fatally, signed 15-minute quote token.
- Idempotency: reservation inserted before inventory mutation, unique `(Scope, Key)` binary, replay-before-expiry, payload conflict 409, bounded stale-reservation takeover, release on failure.
- `POST /orders`: address validation, variant/price reload, quote revalidation with `QuoteChanged`, sorted conditional stock deduction, guarded coupon redemption, order + snapshot + history + redemption + audit + idempotency completion in one transaction.
- `GET /orders/{id}` owner-or-guest access; `GET /checkout/attempts/{key}` recovery.
- Frontend: CartContext uses the server quote for all displayed totals; coupon apply/remove via quote; checkout persists the attempt key and quote token before sending, recovers lost responses, surfaces field errors, refreshes the quote on `QuoteChanged` and requires a new click; confirmation page re-fetches the order and survives reload; checkout sends the customer's cookie or creates a guest scope.

**Evidence**
- Live API + SQL: order `LUM-100001` created, stock 40→39, coupon usage incremented once, replay returned the same order, different payload returned 409.
- Browser: guest checkout end-to-end (500 EGP), confirmation survived reload, customer login shows seeded order, coupon applied through quote (450 − 67.5 + 50 = 432.5).
- Tests: `CheckoutIntegrationTests` (last-unit race, same-key parallel, second-line rollback, replay, quote rules), `HistoricalSnapshotTests`, `OwnershipIntegrationTests`.

---

## Phase 6 — Fulfillment and customer history

**Delivered**
- Order transition matrix enforced in the domain and at the database guard: Pending → Confirmed|Cancelled, Confirmed → Shipped|Cancelled, Shipped → Delivered; Delivered/Cancelled terminal.
- Customer cancellation `POST /orders/{id}/cancel`: ownership checked, refused once payment is collected, guarded update sets `Status=Cancelled` + `StockRestored` before any stock movement, stock restored atomically exactly once, cancellation audit rows written, coupon usage deliberately left untouched.
- Admin status change `PATCH /admin/orders/{id}/status` with the same matrix; cancellation via admin reuses the exactly-once restock path; a concurrent state change loses the guard (409).
- COD collection `POST /admin/orders/{id}/payment/collect`: only Shipped/Delivered and Unpaid; amount must equal the order total; guarded update records actor, server time and amount; repeated collection with the same amount replays, a different amount conflicts; collected orders cannot be cancelled; shipping/delivery never touches payment status.
- Admin order search/paging `GET /admin/orders?status&search&page&pageSize` (order number, customer name, phone).
- Metrics `GET /admin/metrics`: order value excluding cancellations, collected revenue, order count, average order value, counts per status, active product count, low-stock variants (0 < stock ≤ 5) with bilingual names.
- Migration `AddPaymentCollection` adds `Orders.PaymentCollectedAmount`; legacy delivered orders backfilled to their total.
- Frontend: AccountPage cancel action (Pending/Confirmed, unpaid) with refresh; AdminPage Overview replaced with real metrics and low-stock table; AdminPage Orders replaced with filter/search, status actions, and a Collect cash action; API client extended.

**Evidence**
- Live browser: customer cancelled `LUM-100001` (stock 23 → 24, status Cancelled, toast); admin changed `LUM-849202` Shipped → Delivered (payment stayed Unpaid), then collected 500 EGP (badge Collected, actor user-admin); metrics showed 1,559 EGP order value, 629 → 1,129 EGP collected after the collection, 1 low-stock variant.
- SQL: `LUM-849202` = Delivered/Collected/500.00/user-admin; cancellation audit row present; non-cancelled sales unchanged by the cancellation.
- Tests: 9 new integration tests (cancel exactly once, concurrent cancel, cross-customer 404, shipped cancel 409, transition matrix, payment eligibility/replay/conflict, collection blocks cancellation, metrics semantics, admin search/filter/paging, customer forbidden from admin endpoints).

---

## Phase 7 — Full integration and cutover

### P7.1 — Critical failure and concurrency suite

**Delivered**
- Deterministic contention (`RowLockGate`), fault injection through the real EF pipeline, a real `KILL` of a live connection, direct-write constraint probes, an executed-deployment-script test, an opt-in whole-suite run under the runtime grant.
- Production fixes the suite demanded: commit-ambiguity handling (never re-execute after COMMIT; verify or 503 `OutcomeUnknown`), a bounded wait for in-flight duplicates, exact stock audit rows, nine CHECK constraints and restricting foreign keys, retention of idempotency rows and guest sessions, deterministic variant order, the variant row version on admin reads, upload validation, logout that kills a copied cookie, 404 for non-owners, guest access counted from placement, `InvalidQuantity` for fractions, the standard problem body for rate limits, `no-store` on the API, 404 for missing files, a collation check in readiness, MARS removed.
- Evidence matrices: `TEST_EVIDENCE.md` (five review-focus conditions, PLAN section 9, every acceptance row, what is real / simulated / unavailable).

**Evidence:** unit 70, integration 450 (and 450 under the runtime-grant gate), no leaked test database or login afterwards.

### P7.2 — Frontend flows in both languages

**Delivered**
- A real-browser suite (`tests/e2e`, `npm run test:e2e`): 149 tests covering anonymous browse/quote/order, customer account/addresses/wishlist/orders/cancellation, and admin merchandise/promotions/fulfilment/collection, each in English and Arabic, with the page failing on console errors, failed requests and unexpected statuses.
- Frontend defects found by the walk were fixed in the sources; fake-success behaviour of deferred features was removed; dead translation keys and error copy removed; `OutcomeUnknown` and `RateLimited` have English and Arabic copy.

**Evidence:** **149 of 149 passed**, 0 failed, 0 skipped (two complete runs on the final tree); the same suite against the packaged HTTPS staging copy: 148 passed, 1 skipped by design.

### P7.3 — Reconciliation and retirement of the prototype runtime

**Delivered**
- `backend/tools/LumaBeauty.LegacyData` (`import`, `reconcile`): the real `data/db.json` reconciles with 0 differences across 16 checks; a tampered price and a stock change are detected as designed.
- Backups and a source checkpoint with SHA-256, then removal of `server.ts`, `server/`, the `dev:legacy` and `start` scripts, `express`, `dotenv`, `@google/genai`, `@types/express`, `.env.example` and the Gemini capability claim. `npm run lint` now type-checks the app and the browser tests.
- Proof from the documented commands starting from no database: an Arabic guest order survived an API restart.
- Record: `CUTOVER.md`.

## Phase 8 — Release preparation

### P8.1 — Production configuration and operations

**Delivered**
- Hosting hardening: fail-fast settings validation, persisted and encrypted key ring, security headers and CSP, HTTPS redirect and HSTS, forwarded headers only on request, OpenAPI off by default, live/ready health, `--setup-admin`, SPA publication with JSON API 404s.
- `db/provision.sql`, `grant-deploy-access.sql`, `grant-runtime-access.sql`, `verify-runtime-permissions.sql`, the generated `db/LumaBeauty.sql` (`Update-SchemaScript.ps1`), `web.config`, `Build-Release.ps1`, `Rehearse-Release.ps1`.
- `DEPLOYMENT.md` (topology, prerequisites, identities, exact commands, configuration reference, update and rollback, operations, backups and restore, security, open decisions) and `appsettings.Production.example.json` (placeholders only).

### P8.2 — Release candidate

**Delivered** (details and the package hash in `RELEASE_CHECKLIST.md`)
- A versioned package built by one script that stops at the first failing gate and inspects itself (a planted secret makes it fail).
- The package unpacked, provisioned, granted, migrated twice, loaded and reconciled, started in Staging over HTTPS with a certificate-protected key ring, driven by the whole browser suite, restarted, backed up and **restored after a simulated disaster** (every table identical, an old sign-in cookie still valid, an image byte-identical).
- The guide's own commands were executed wherever IIS and a second Windows account are not needed (`RELEASE_CHECKLIST.md` section 6). Doing so found two defects, both fixed: the administrator command left a trailing space in every value and the host refused to start, and a backup folder must grant the SQL Server service account. The package was rebuilt so that it carries the corrected guide, and the whole rehearsal was repeated on it.

---

## Test results (actual)

| Suite | Command | Result |
|---|---|---|
| Backend build | `dotnet build backend/LumaBeauty.sln` | succeeded, 0 warnings, 0 errors |
| Unit tests | `dotnet test backend/LumaBeauty.sln` | **70 passed, 0 failed** |
| Integration tests (SQL Server) | same | **450 passed, 0 failed** |
| Integration tests under the runtime grant | `LUMA_TEST_RUNTIME_GRANT=true dotnet test …` | **450 passed, 0 failed** |
| Frontend type-check (app + browser tests) | `npm run lint` | passes |
| Frontend tests | `npm test` | **8 passed, 0 failed** |
| Frontend build | `npm run build` | succeeded |
| Browser suite | `npm run test:e2e` | **149 of 149 passed**, 0 failed, 0 skipped (two complete runs on the final tree) |

Environment: .NET SDK 10.0.301 (runtime 10.0.14), SQL Server 2022 Developer (localhost), Node 24.11.1, headless Chrome.

## Deliberate scope boundaries

| Item | State | Reason |
|---|---|---|
| Admin metrics dashboard, order list/status/collection, customer cancellation | implemented | P6 |
| Password recovery / e-mail | **not implemented** | no e-mail provider configured |
| Profile editing, category/brand CRUD UI | **deferred** | P0.3 decision |
| Online payment, tax | **out of scope** | COD only; no tax in this product |
| Legacy Express runtime | **removed** | P7.3, after reconciliation and browser acceptance |
| Live rollout | **not performed** | a separate, authorised action |

## Known issues / risks

1. IIS in-process hosting, the ASP.NET Core Module, the application-pool identity and the pool's use of the Windows event log were not exercised: IIS is not installed on the build machine. `DEPLOYMENT.md` is reviewed but those steps are unexecuted; run them in a staging server first.
2. No durable application log sink is bundled (`DECISIONS.md` section 17); only the console, the Windows event log and IIS request logs exist.
3. Signing out ends every session of the account, in every browser (D-P7-6). Per-device sessions need a server-side session store.
4. There is no password-reset path (no e-mail provider); a lost administrator password is handled by creating another administrator.
5. Uploaded images are local files outside the database: they must be backed up with it (`DEPLOYMENT.md` section 9).
6. No version-control repository exists; the source checkpoint is the archive recorded in `CUTOVER.md`.
7. The production SQL Server edition, host name and certificate are not decided (`DECISIONS.md` section 17).

## Next eligible task

**An authorised deployment**: prepare a staging server by `DEPLOYMENT.md`, tick the IIS items of `RELEASE_CHECKLIST.md` there, then release.
