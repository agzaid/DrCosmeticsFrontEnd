# LumaBeauty — Baseline (P0.1)

**Task:** P0.1 — Verify the repository, environment, and data baseline
**Status:** complete
**Recorded:** 2026-10-31 (Africa/Cairo)

All statements below are observed command output from this machine, not restated plan claims.

---

## 1. Repository state

| Fact | Value |
|---|---|
| Working tree | `D:\Programming\luma-beauty` |
| Git | **Not a repository** — `git rev-parse --is-inside-work-tree` → `fatal: not a git repository` |
| Branch / commit baseline | **None exists** |
| CI configuration | None present |
| Existing scripts | `dev`, `start` = `tsx server.ts`; `build` = `vite build`; `preview`; `clean`; `lint` = `tsc --noEmit` |

**Risk (recorded):** with no VCS there is no commit checkpoint to roll back to. Mitigation: an
out-of-tree checksummed backup exists (§5). P7.3 requires a source-history checkpoint — one must be
created before cutover (either `git init` or a versioned archive). Not created in P0.1 because
initializing VCS changes the user's workspace.

## 2. Environment

| Component | Observed | Notes |
|---|---|---|
| .NET SDK | `10.0.301` | plus SDKs `10.0.100`, `9.0.318` |
| .NET runtimes | `Microsoft.NETCore.App` and `Microsoft.AspNetCore.App` `10.0.9`, `10.0.0` | ASP.NET Core 10 target confirmed |
| Node | `v24.11.1` | |
| npm | `11.6.2` | |
| SQL Server | `Microsoft SQL Server 2022 (RTM) - 16.0.1000.6 (X64)`, Developer Edition | service `MSSQLSERVER` running |
| SQL instance | `localhost` (default instance), Windows auth | `sqlcmd -S localhost -E -C` succeeds |
| Server collation | **`SQL_Latin1_General_CP1_CI_AS`** | full name confirmed via `SERVERPROPERTY('Collation')` and `DATABASEPROPERTYEX` |
| LocalDB | `MSSQLLocalDB` version `15.0.4382.1`, state Stopped | not used; full SQL Server preferred |
| `dotnet-ef` | `10.0.5` (global tool) | matches EF Core 10 target |
| `nswag` | `14.7.1` (global tool) | available for TypeScript generation |
| Databases named Luma*/Test* | **none** | `SELECT name FROM sys.databases WHERE name LIKE '%Luma%' OR name LIKE '%Test%'` → empty |
| Unrelated databases | 18 (`InventoryManagement`, `Qorrect*`, `Clinics_v1`, `KACCC*`, `PatientTracker*`, `TebraziDb`, `ChicStore`, `InOut`, …) | **must never be touched**; integration-test cleanup is restricted to an exact run-scoped name |

## 3. Existing behavior verification

### 3.1 Frontend type check — **FAILS (pre-existing)**

```
> tsc --noEmit
server.ts(493,14): error TS2769: No overload matches this call.
  Argument of type 'string | 3000' is not assignable to parameter of type 'number'.
```

Cause: `const PORT = process.env.PORT || 3000` (line 37) is `string | number`, passed to
`app.listen(PORT, '0.0.0.0', …)` (line 493). Exit code 1. This is in the **legacy Express entry point
that P7.3 retires**; not fixed in P0.1 (out of task scope). See B1.

### 3.2 Frontend build — **PASSES**

```
vite v8.3.5 building client environment for production...
✓ 1680 modules transformed.
dist/assets/index-Dtkb_W4f.css   60.27 kB │ gzip:   9.94 kB
dist/assets/index-BPWbHCZ-.js   399.42 kB │ gzip: 107.01 kB
✓ built in 279ms
```

One warning (non-fatal): `vite.config.ts` uses `__dirname` which is unsupported by
`configLoader: 'native'` in a future Vite major.

### 3.3 Existing test execution — **PASSES (8/8)**

There is no `test` npm script. The suite is `node:test`-based and runs via:

```
node --import tsx --test src/utils/shopLogic.test.ts
# ✔ 8 tests, ℹ pass 8, ℹ fail 0, duration_ms 209.57
```

P1.2 must wire this into an explicit named script (runbook §8).

### 3.4 Legacy server runtime

Verified previously in this session: `cmd.exe /c npm run dev` → `✨ Luma Beauty server listening on
http://0.0.0.0:3000`, `GET /` → 200, `GET /api/products` → JSON, React root rendered (~71 KB DOM).
The legacy dev topology is Express-mounted Vite middleware on **one origin**.

## 4. Data baseline

### 4.1 Counts (`data/db.json`)

| Collection | Count |
|---|---|
| products | 22 |
| — product variants | 41 |
| categories | 5 |
| brands | 6 |
| banners | 2 |
| discountCodes | 3 |
| users | 2 |
| orders | 3 |
| idempotencyKeys | 1 |

### 4.2 Integrity checks

| Check | Result |
|---|---|
| Products with zero variants | **0** (every product has ≥1 purchasable variant) |
| Duplicate SKUs | **none** (41 unique) |
| Duplicate variant IDs | **none** |
| Duplicate order numbers | **none** |
| Negative stock | **none** |
| Price JSON type | `number` (all) |
| Product `status` values | `published: 22` (no archived products yet) |
| Category references | all product `category` values exist in `categories[].id` |
| **Brand references** | **BROKEN** — see §4.3 |

### 4.3 Data defects found

**D-DATA-1 — missing brand reference.**
Products `prod-11`, `prod-12`, `prod-13` carry `brand: "Botanica Haircare"`, but the `brands`
collection contains only:

| id | name |
|---|---|
| `luma-signature` | Luma Signature |
| `glowlab` | GlowLab Botanicals |
| `velvet-rouge` | Velvet Rouge Paris |
| `k-pure` | K-Pure Derma |
| `maison-orient` | Maison Orient |
| `silk-artisans` | Silk Artisans |

A naive `Product.BrandId` FK migration will fail or silently drop three haircare products. Resolution
is required in P2.1 (decision: add brand `botanica-haircare` / `Botanica Haircare` as a seeded reference row,
preserving the display string — recorded in `DECISIONS.md` D-DATA-1).

**D-DATA-2 — one runtime order exists.** `ord-1793405636807-335295` / `LUM-335295` (guest,
`Pending`, total 430, created `2026-10-31T00:13:56.807Z`, 1 × `prod-1/var-1-2`) is **not** seed data.
Its idempotency key `idemp_1793405634472_p5lhqf04a0b` is also present.

**D-DATA-3 — stock drift caused by D-DATA-2.** `prod-1/var-1-2` stock is **11** live vs **12** in
`server/seedData.ts:158`. Only this variant drifted; the deduction is fully explained by D-DATA-2.

**D-DATA-4 — seed and live agree otherwise.** Discount usage is identical in both:
`WELCOME15=34/500`, `LUMA50=19/300`, `GLOW10=82/1000`. Seed orders = 2 (`ord-1001`/`LUM-849201`
Delivered, `ord-1002`/`LUM-849202` Shipped); live = 3.

**D-DATA-5 — orders are not normalized.** Seed orders lack `stockRestored` entirely (`null`/absent)
while the runtime order has `stockRestored: false`. `ord-1001` has `customerId`, `ord-1002` and the
runtime order are guest orders with only `customerEmail`.

### 4.4 Classification (R08)

| Data | Classification | Handling |
|---|---|---|
| 22 products / 41 variants / 5 categories / 6 brands / 2 banners / 3 coupons | **demo catalog** | seed into SQL, then reconcile |
| `user-admin` `admin@lumabeauty.com`, `user-customer` `sarah@example.com` | **demo accounts** — no password hashes exist anywhere (confirmed by record keys: `addresses,email,fullName,id,mobileNumber,role,wishlist`) | import profiles; Identity accounts created only via Development seeding with config-supplied passwords, or via admin-issued reset. **No passwordless login, no shared default password** |
| `ord-1001`, `ord-1002` | **seed orders** | import as historical |
| `ord-1793405636807-335295`, `idemp_1793405634472_p5lhqf04a0b` | **operational / ambiguous — preserve** | import as historical order; no guest recovery credential exists for it (pre-dates guest scopes) |
| brand `Botanica Haircare` | **defect** | added as reference row before product import |

### 4.5 Backup manifest

Location (outside the source tree): `D:\Programming\luma-beauty_backups\2026-10-31_baseline\`

| File | Bytes |
|---|---|
| `db.json` | 57,612 |
| `seedData.ts` | 50,395 |
| `package.json` | 899 |
| `PLAN.md` | 30,543 |
| `LumaBeauty_Agent_Runbook.md` | 50,418 |

`sha256(data/db.json)` = `a3733d86a354a81b02051cfd0d086e9f84c8710c42b1d142b25e60ff76079cc8`
— identical to the backup copy (verified). Restore = copy back over `data/db.json`.

## 5. Baseline failures and blockers

| ID | Item | State | Owner |
|---|---|---|---|
| B1 | `npm run lint` fails on legacy `server.ts:493` (`PORT` type) | pre-existing, **not fixed** in P0.1 | P1.2 adds a type-check command scoped to `src/`; legacy file disappears at P7.3 |
| B2 | No VCS checkpoint | blocked on a user/workspace decision (`git init` vs archive) | P7.3 pre-cutover |
| B3 | No `test` npm script for the 8 existing pricing tests | workaround command recorded (§3.3) | P1.2 |
| B4 | `data/db.json` is committed as the mutable store (`.gitignore` does not exclude it) | recorded | P7.3 |

## 6. Differences from the uploaded `PLAN.md`

| # | PLAN.md claim | Observation |
|---|---|---|
| 1 | "Greenfield — no data-preservation obligation" | **Wrong.** No SQL database existed, but `data/db.json` holds live records including one runtime order. Corrected by R08. |
| 2 | Data counts 22 products / 41 variants / 3 orders / 2 users / 3 coupons / 2 banners / 5 categories / 6 brands | **Confirmed exactly.** |
| 3 | Brand FK is a "trap" (products store display name) | **Confirmed and worse**: one brand referenced by 3 products does not exist in the collection at all (§4.3). |
| 4 | "Keep client-side shop filtering" | **Overridden by R04** — server-side filtering + paging together. |
| 5 | No tax; flat 600/50 EGP shipping | Confirmed in source and in all fixtures. |
| 6 | `collation: Arabic_100_CI_AI` for the DB | Raw material only. Server default is `SQL_Latin1_General_CP1_CI_AS`; R09 requires separating storage (NVARCHAR) from comparison (linguistic for names, binary for machine keys). |
| 7 | Arabic text needs only `NVARCHAR` | Confirmed as *storage* requirement; comparison behaviour is a separate decision (D-COLLATION). |
| 8 | `npm run lint`/build status unstated | `build` passes; `lint` **fails** (§3.1). |
| 9 | `TaxRate` setting wired at 0 for future use | **Rejected by R10** — no dormant tax setting. |
| 10 | 26 endpoints mapped from the Express app | Confirmed: 27 routes including the SPA fallback (26 JSON endpoints). |

## 7. Reproducibility

```bash
# baseline checks
dotnet --list-sdks
sqlcmd -S localhost -E -C -Q "SELECT SERVERPROPERTY('Collation')"
npm run build
node --import tsx --test src/utils/shopLogic.test.ts
jq -r 'to_entries | map("\(.key): \(.value|length)") | .[]' data/db.json
sha256sum data/db.json
```
