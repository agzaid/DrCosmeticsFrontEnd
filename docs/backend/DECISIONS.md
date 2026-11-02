# LumaBeauty — Decisions (P0.2)

**Task:** P0.2 — Freeze corrected contracts and critical behavior
**Status:** complete
**Authority:** the runbook corrections R01–R10 supersede `PLAN.md` wherever they differ.

Anything marked **FROZEN** is consumed by later tasks and may change only by updating every dependent
caller and this document in the same change.

---

## 1. Adoption of R01–R10

| Rule | Adopted as | Owner task(s) |
|---|---|---|
| R01 — explicit transaction failure behaviour | D-TX-1…D-TX-5 | P2.3, P5.3 |
| R02 — replay-safe retries and idempotency coordination | D-IDEM-1…D-IDEM-7 | P2.1, P5.2, P5.3 |
| R03 — recoverable guest checkout | D-GUEST-1…D-GUEST-6 | P3.2, P5.2, P5.4 |
| R04 — server-driven catalog filters **and** paging | D-CAT-1…D-CAT-4 | P4.1 |
| R05 — authoritative server quote | D-QUOTE-1…D-QUOTE-5 | P5.1, P5.3 |
| R06 — early browser authentication integration | D-AUTH-1…D-AUTH-4 | P1.2, P3.2 |
| R07 — complete contracts and UI ownership | D-CONTRACT-1…D-CONTRACT-4 | P0.2, P3.3, P4.2, P4.3, P6.1, P6.2, P5.4 |
| R08 — preserve prototype data during cutover | §2, D-LEGACY-1…D-LEGACY-4 | P0.1, P2.2, P7.3 |
| R09 — separate storage from comparison rules | D-COLLATION-1…D-COLLATION-4 | P2.1, P2.2 |
| R10 — business-policy and release details | D-QTY, D-COUPON, D-PAY, D-REL | P1.3, P5.1, P6.2, P8 |

---

## 2. Data preservation (R08)

**FROZEN D-LEGACY-1 — source of truth during build.** `data/db.json` is the current operational record,
not a seed file. It and `server/seedData.ts` are backed up at
`D:\Programming\luma-beauty_backups\2026-10-31_baseline\` (SHA-256 in `BASELINE.md` §4.5).

**FROZEN D-LEGACY-2 — import set.** `LumaBeauty.LegacyData import` writes the 5 categories, 6 brands + the
missing `Botanica Haircare` reference row, 2 banners, 3 coupons, 22 products with their 41 variants and images
and, with `--scope full`, all 3 orders with items and status history. Product, variant, category, brand and
order IDs are preserved verbatim. The two user profiles and the runtime idempotency record are **not**
imported: the profiles carry no password material (D-LEGACY-3) and the idempotency row only deduplicated a
browser retry inside the prototype. `reconcile` prints both as *accounted* so nothing is silently dropped.

**FROZEN D-LEGACY-3 — passwordless users are not recreated.** The two prototype users have no password
material, so no Identity login is created for them. Development seeding may create Identity accounts **only**
from `DemoSeed:*` values supplied through user-secrets or the environment; in every other environment the
administrator is created with `--setup-admin` and customers register themselves. No shared or default
password, no email-only login. Orders of the prototype's customers keep their original `customerId` string.

**FROZEN D-LEGACY-4 — legacy guest order.** `ord-1793405636807-335295` has no guest scope (it pre-dates
scopes). It is imported with `CustomerId = null`, `GuestScopeId = null`, `Origin = 'LegacyImport'`,
visible to administrators and to no one else. No retroactive guest credential is issued.

**D-DATA-1 — missing brand.** `Botanica Haircare` is referenced by `prod-11/12/13` but absent from the
brands collection. The importer creates a brand row `{ Id: "botanica-haircare", Name: "Botanica Haircare",
Origin: "Egypt" }` before products (a missing brand's id is the slug of its display name), preserving the
display string. No product data is altered.

**FROZEN D-LEGACY-PAY — imported order payment inference.** The prototype has no payment status. Imported
orders are assigned `PaymentStatus = Collected` when `status = Delivered`, otherwise `Unpaid`, with
`paymentCollectedAt = updatedAt` for collected ones. This is recorded as an inference; it is not
recoverable from the source data and no collection audit actor exists for those rows (use
`ActorId = "legacy-import"`).

---

## 3. Transactions (R01)

**FROZEN D-TX-1 — Result-aware boundary.**

```csharp
// Application/Common/Abstractions.cs
public interface ITransactionRunner
{
    Task<Result<T>> ExecuteAsync<T>(
        Func<TransactionAttempt, CancellationToken, Task<Result<T>>> operation,
        CancellationToken cancellationToken = default,
        Func<TransactionAttempt, CancellationToken, Task<Result<T>?>>? verifyCommitted = null);
}
```

Semantics, mandatory:

1. `var result = await operation(ct)` — **a normally-returned `Result.Failure` is not success**.
2. On failure → `RollbackAsync`, return the failed result. No `SaveChanges` is attempted.
3. On success → `SaveChangesAsync`, then `CommitAsync`, then return the result.
4. On exception or cancellation → rollback, rethrow. Never swallow into a `Result`. A transient exception
   raised **before** COMMIT is sent is retried as a whole (D-TX-2); once COMMIT has been sent the operation is
   never re-executed (D-TX-6).
5. The explicit transaction encompasses the **first mutation through commit**, including any immediate
   (`ExecuteUpdateAsync`/`ExecuteDeleteAsync`) commands.

Implementation: `Infrastructure/Persistence/TransactionRunner.cs`. (The runbook's suggested filename
`CheckoutTransactionRunner.cs` is superseded because cancellation, collection and inventory also need the
same runner; the *semantics* are exactly R01's.)

**FROZEN D-TX-2 — retries get a clean attempt.** The runner wraps execution in
`Database.CreateExecutionStrategy().ExecuteAsync(...)`. Each attempt resolves a **fresh DI scope** →
fresh `ApplicationDbContext`, fresh repositories, fresh `IUnitOfWork`. No `DbContext` or tracked entity
survives an attempt.

**FROZEN D-TX-3 — no stale overlay.** Checkout and cancellation read current stock/order state with
`AsNoTracking()`. Immediate guarded updates are issued via `ExecuteUpdateAsync`, so a stale tracked entity
can never be written back over a concurrent change.

**FROZEN D-TX-4 — direct updates carry their own obligations.** Every `ExecuteUpdateAsync` must include
(a) the guard predicate, (b) an affected-row check, (c) `UpdatedAtUtc`, and (d) a corresponding audit row
(`InventoryAdjustments` / `OrderStatusHistory`) written in the same transaction. A zero-row result is an
application failure (`Result.Conflict`), not an exception.

**FROZEN D-TX-5 — transaction isolation.** Checkout uses the default `READ COMMITTED` plus the unique
index and guarded updates below. `SERIALIZABLE` is not required and is not used, to avoid deadlock
surface.

**FROZEN D-TX-6 — a failure during COMMIT is not a rollback.** If the exception arrives after COMMIT was sent,
the server may have committed. Re-running the operation could apply it twice (a relative stock adjustment
would remove stock twice). The runner therefore asks the operation's `verifyCommitted` delegate, in a fresh
scope, whether the first attempt is durable and returns that result when it is. Checkout verifies through the
idempotency table. An operation without a verifier, or a verification that cannot read the database, ends in
`CommitOutcomeUnknownException`, answered as **503 `OutcomeUnknown`**; the operation is not repeated.
The administrator screens reload the stored values on that error instead of inviting a blind retry.

---

## 4. Idempotency (R02)

**FROZEN D-IDEM-1 — scope and key.**
- Scope: `customer:{userId}` for an authenticated customer; `guest:{guestScopeId}` for a guest.
  The two never interoperate.
- Key: request header `X-Idempotency-Key` (keeps the existing frontend header name), 16–64 chars
  `[A-Za-z0-9_-]`. Missing/invalid → 400 `IdempotencyKeyRequired` / `InvalidIdempotencyKey`.

**FROZEN D-IDEM-2 — algorithm (reserve before mutating).**

```
BEGIN TRANSACTION
  INSERT CheckoutIdempotency (Scope, Key, Fingerprint, Status='Reserved', OrderId=NULL, CreatedAtUtc)
    -- UNIQUE INDEX UX_CheckoutIdempotency_Scope_Key (Scope, Key) BIN2
  ├─ success            → continue: validate → price → guard stock → guard coupon → create order
  │                       → UPDATE row (Status='Completed', OrderId=@orderId) → COMMIT
  └─ duplicate key (after the concurrent transaction resolved)
       ├─ existing.Status='Completed' ∧ existing.Fingerprint = @fp  → ROLLBACK → REPLAY original order
       ├─ existing.Status='Completed' ∧ existing.Fingerprint <> @fp → ROLLBACK → 409 IdempotencyKeyReuse
       └─ still reserved (first attempt still open)                → bounded wait, then 409 CheckoutInProgress
ON SUCCESS: CommitAsync makes order + stock + coupon + idempotency row durable atomically.
ON FAILURE: RollbackAsync removes the reservation, so the SAME key is retryable. No tombstone row.
```

A unique index checked only at final save is **not** the algorithm; the insert happens before any
inventory mutation and a concurrent insert blocks on the index until the first attempt resolves.

**FROZEN D-IDEM-3 — fingerprint.** Computed server-side from validated, canonicalised inputs:

```
sha256( json({
  items:       [{ variantId, quantity }] sorted by variantId,
  coupon:      upper(trim(discountCode)) | null,
  address:     { fullName, mobileNumber, governorate, city, streetAddress, buildingApt, deliveryNotes }
               with values trimmed and nulls omitted,
  contact:     lower(trim(customerEmail)) | null,
  quoteHash:   sha256(quoteTokenPayload)
}) )
```

Client-supplied prices/totals are excluded — they are not inputs to the order at all.

**FROZEN D-IDEM-4 — replay precedes expiry checks.** A committed attempt with a matching fingerprint is
replayed **before** re-checking quote expiry, coupon expiry, or current stock. A retried request must not
fail because time passed after a successful commit.

**FROZEN D-IDEM-5 — bounded wait.** A request that carries the key of an attempt still in flight waits for
that attempt to finish, at most `Checkout:LockTimeoutSeconds` (default 10), and then replays its order,
takes the reservation over when the first attempt failed, or answers 409 `CheckoutInProgress` with
`Retry-After: 2`. Never an unbounded wait.

**FROZEN D-IDEM-6 — ambiguous commit.** Inside one request the runner verifies a possibly lost commit
instead of repeating it (D-TX-6). Across requests, if the client loses the response, its retry with the same
key hits the replay branch and returns the committed order; if the commit really rolled back, the retry
proceeds normally.

**FROZEN D-IDEM-7 — retention.** `Status='Completed'` rows are purged after 30 days by a hosted service
(`Retention:IdempotencyDays`, default 30). Purge is disabled in tests.

---

## 5. Guest checkout (R03)

**FROZEN D-GUEST-1 — credential exists before submission.** `POST /api/v1/guest/session` creates a
server-side guest scope and sets an HttpOnly cookie `luma_guest` (32 random bytes, base64url; only its
SHA-256 hash is stored). The client calls it before checkout, so a lost *response* cannot lose the
credential.

**FROZEN D-GUEST-2 — attributes.** `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, absolute 30-day
expiry. Never placed in a URL query string, never logged (only the non-secret `GuestScopeId` may be
logged).

**FROZEN D-GUEST-3 — recovery.** `GET /api/v1/checkout/attempts/{idempotencyKey}` returns the committed
order when the caller's session or guest cookie owns that key's scope; `404` otherwise. This is the
documented lost-response path.

**FROZEN D-GUEST-4 — read retention.** The order remains readable by its guest scope for **30 days from
placement**, read-only, including after `Delivered` or `Cancelled`. Explicit revocation via
`DELETE /api/v1/guest/session` clears the cookie and revokes the scope immediately.

**FROZEN D-GUEST-5 — loss of the cookie.** If cookies are cleared, the guest order is not recoverable
from an order number or email. Cross-device recovery is **deferred** (requires an email integration).

**FROZEN D-GUEST-6 — identity changes mid-attempt.** Logging in or out during an unresolved guest attempt
does not transfer the guest scope. The attempt completes under the scope that created it; a subsequent
login starts a new scope. Another scope's order is never returned.

---

## 6. Quotes (R05)

**FROZEN D-QUOTE-1 — authoritative preview.** `POST /api/v1/checkout/quote` accepts
`{ items:[{variantId, quantity}], discountCode?, governorate? }` and returns server-computed line prices,
discount, delivery fee and total. The client never supplies a subtotal. `POST /discounts/validate` is
replaced by this endpoint and removed.

**FROZEN D-QUOTE-2 — quote token.** `quoteToken = "v1." + b64url(payload) + "." +
b64url(HMAC-SHA256(key, payload))`. Payload contains the canonical lines, computed monetary values,
currency, `issuedAt`, `expiresAt`. Key: `Quotes:SigningKey` (user-secrets in development, environment in
deployment; startup fails outside Development when absent). Expiry **15 minutes**.

**FROZEN D-QUOTE-3 — placement revalidates.** `POST /orders` requires `quoteToken`. The server recomputes
from current data. If any monetary value or line differs → **409 `QuoteChanged`** with a fresh `quote` and
`quoteToken`; the client must display the new total and require explicit re-acceptance. A changed total is
never confirmed silently.

**FROZEN D-QUOTE-4 — quotes never reserve.** Quoting does not touch stock or coupon usage.

**FROZEN D-QUOTE-5 — rounding.** `decimal` throughout; each monetary output rounded once with
`MidpointRounding.AwayFromZero` to 2 dp. Tests assert decimal business results (599 → 50 fee, 600 → 0,
discount does not move the threshold, midpoint cases). Bit-for-bit equivalence with JavaScript floating
point is **not** claimed.

---

## 7. Catalog (R04)

**FROZEN D-CAT-1 — paging everywhere.** `page` default 1; `pageSize` default 24, maximum 60. Response
gains `page`, `pageSize`, `total`, `totalPages` beside the unchanged `products` array.

**FROZEN D-CAT-2 — stable sorting.** `sort ∈ {featured, priceAsc, priceDesc, newest, bestSellers}`
(existing frontend literals), each with tie-breaker `Id ASC` for deterministic pages.

**FROZEN D-CAT-3 — filter semantics preserved.** `category`, `brand` (slug **or** display name,
case-insensitive), `skinType` (membership), `finish`, `coverage`, `shadeFamily`, `search`
(case-insensitive `contains` over `name.en`, `name.ar`, `description.en`, `description.ar`, brand name,
`subCategory`), plus `inStock`, `minPrice`, `maxPrice`. `status` is **admin-only**; the public catalog is
always published-only.

**FROZEN D-CAT-4 — consumers fetch what they need.** No consumer may assume the first page is the whole
catalog. Home collections use dedicated queries; wishlist/cart resolve by explicit IDs; product details
use the by-ID endpoint.

---

## 8. Authentication (R06)

**FROZEN D-AUTH-1 — transport.** ASP.NET Core Identity + HttpOnly cookie `luma_auth`, 7-day sliding
(matches the prototype session length), `Secure`, `SameSite=Lax`, `Path=/`. API returns 401/403 as JSON
Problem Details; never a redirect.

**FROZEN D-AUTH-2 — CSRF.** `GET /api/v1/auth/csrf` returns `{ token, headerName: "X-XSRF-TOKEN" }` and
sets the antiforgery cookie. Every unsafe method on a cookie-authenticated request must echo the header.
The client fetches a **fresh token after login and logout**. Same-origin hosting does not remove this
requirement.

**FROZEN D-AUTH-3 — passwords are real.** Login requires and verifies the password. Public registration
creates `customer` only. Roles are assigned exclusively by an administrator. Lockout: 5 failures / 15
minutes. Rate limits: `/auth/*` 10 requests/min/IP, `/orders` 5/min per identity.

**FROZEN D-AUTH-4 — dev topology.** Vite runs as its own server (`vite`) on its own port with
`server.proxy['/api'] → https://localhost:<api-port>` (`changeOrigin: true`, `secure: false`).
`npm run dev` must be repointed explicitly; adding the proxy alone does not change what it starts. The
legacy `tsx server.ts` command is retained only as `dev:legacy` until P7.3. HTTPS dev certificate trust is
a documented prerequisite (`dotnet dev-certs https --trust`).

---

## 9. Contracts and ownership (R07)

**FROZEN D-CONTRACT-1 — idempotent wishlist.** Replace `POST /customer/wishlist/toggle` with
`PUT /customer/wishlist/{productId}` (204, idempotent add) and
`DELETE /customer/wishlist/{productId}` (204, idempotent remove); add `GET /customer/wishlist`.
Hardcoded favorites (`['prod-1','prod-7','prod-14']`) are removed from account initialisation.

**FROZEN D-CONTRACT-2 — explicit reads.** `GET /customer/addresses` added. Admin catalog reads added:
`GET /admin/products?status=published|archived|all&page=…`, `GET /admin/products/{id}`.

**FROZEN D-CONTRACT-3 — UI ownership.**

| UI capability | Owner |
|---|---|
| Variant editing (SKU, shade, swatch, size, price, stock, active) | P4.2 |
| Image upload | P4.3 |
| Banner editing | P4.3 |
| Customer order cancellation | P6.1 |
| COD collection action | P6.2 |
| Confirmation recovery after reload | P5.4 |

**FROZEN D-CONTRACT-4 — deferred scope (no fake-success controls).**

| Feature | Status | Reason |
|---|---|---|
| Profile editing | **deferred** | no UI; `'profile'` union member is dead code |
| Password recovery | **deferred** | requires an email provider and credentials |
| Category/brand CRUD UI | **deferred** | product form gets selection only; brand becomes a `<select>` |
| Failed/refused delivery | **deferred** | would add statuses the UI cannot display |
| Refunds after COD collection | **deferred** | no payment integration |
| Server-persisted cart | **deferred** | browser cart is the release behaviour |
| Cross-device guest recovery | **deferred** | needs email |
| Multi-currency (`Currency` union) | **deferred** | EGP only; no UI |
| Tax | **not implemented, not configurable** | no tax concept in the UI (R10) |

Guest→account merge: wishlist union on login into the authenticated account; cart is browser-local and
merges client-side; addresses never merge automatically. Per-user cached state is cleared on logout or
account change.

---

## 10. Collation (R09)

**FROZEN D-COLLATION-1 — storage.** All user text is `NVARCHAR` (required for Arabic regardless of the
server's `SQL_Latin1_General_CP1_CI_AS` default).

**FROZEN D-COLLATION-2 — comparison.** The database is created with `COLLATE Arabic_100_CI_AI` so Arabic
names sort and compare linguistically. Machine keys are explicitly **binary**, independent of the database
default:

| Column | Collation |
|---|---|
| `CheckoutIdempotency.Scope`, `.Key` | `Latin1_General_100_BIN2` |
| `GuestSessions.SecretHash`, `GuestSessions.Id` | `Latin1_General_100_BIN2` |
| `ProductVariants.Sku` (stored uppercase-normalised) | `Latin1_General_100_BIN2` |
| `Orders.OrderNumber` | `Latin1_General_100_BIN2` |
| `AspNetUsers.NormalizedEmail/NormalizedUserName` | binary (Identity normaliser already uppercases) |
| `LocalizedText` name/description columns | database default (`Arabic_100_CI_AI`) |

**FROZEN D-COLLATION-3 — verified behaviour.** Tests must prove `X`/`x` and accent variants are distinct
in idempotency keys and SKUs, and that Arabic search/sort behaves linguistically.

**FROZEN D-COLLATION-4 — provisioning.** The database is created **separately** from applying migrations.
Provisioning SQL lives in `backend/db/provision.sql`; the idempotent migration script is
`backend/db/LumaBeauty.sql`. Both are reviewable in SSMS.

---

## 11. Business policy (R10)

**FROZEN D-QTY — quantity validation.** Order/quote quantity is an integer `1..99`. `0`, negative,
fractional, or > 99 → 400 `InvalidQuantity` with the field path. **Never clamped.**

**FROZEN D-MONEY — money.** `decimal(18,2)`, `Currency char(3)` default `'EGP'`. Rounding as D-QUOTE-5.
`DeliveryFee` is computed from the **pre-discount** subtotal (600 free / 50 flat / 0 on an empty quote).

**FROZEN D-STATUS — fulfilment and payment are separate.**

| Fulfilment | Allowed next |
|---|---|
| `Pending` | `Confirmed`, `Cancelled` |
| `Confirmed` | `Shipped`, `Cancelled` |
| `Shipped` | `Delivered` |
| `Delivered` | — (terminal) |
| `Cancelled` | — (terminal, **no un-cancel**) |

Payment: `Unpaid` → `Collected` only. Shipping/delivery transitions never change payment.

**FROZEN D-PAY — collection eligibility.** Collection is allowed only when
`FulfilmentStatus ∈ {Shipped, Delivered}` **and** `PaymentStatus = Unpaid`. A repeated collection by an
administrator returns 200 with the existing record (safe replay); a different amount → 409
`PaymentConflict`. Cancellation while `Collected` → 409 `PaymentCollectedCannotCancel`.

**FROZEN D-COUPON — redemption accounting.** Cancellation does **not** restore coupon usage; usage is
lifetime (MVP default, R10). `DiscountRedemptions` rows are retained and never deleted. Coupons are
archived (`IsActive = false`), never deleted, so historical orders keep resolving `discountCode`.
Concurrent redemption is guarded by a conditional update (`UsageLimit = 0 OR CurrentUsage < UsageLimit`).

**FROZEN D-INV-ADMIN — inventory adjustment conflicts.** Two accepted forms:
- `{ productId, variantId, delta, reason }` → atomic `Stock = Stock + delta`, guard `Stock + delta >= 0`.
- `{ productId, variantId, newStock, expectedVersion, reason }` → optimistic absolute set; stale version
  → 409 `InventoryConflict`.

Both reject `delta = 0` / `newStock < 0` (400) and always append an `InventoryAdjustments` audit row.

**FROZEN D-METRICS — dashboard semantics.** `totalSales` = Σ `Total` of orders **not** `Cancelled`
(order value, not collected cash); `totalOrders` = all orders; `averageOrderValue` = totalSales ÷
non-cancelled count; `ordersByStatus` always contains all five keys; `lowStockCount` /
`lowStockItems` = active variants with `0 < Stock <= 5`; `totalProducts` = non-archived products.
Additive `collectedRevenue` = Σ `Total` where `PaymentStatus = Collected`.

**FROZEN D-REL — release posture.** SQL Server Developer Edition is correct for development and tests;
production requires a supported production offering (P8.1). IIS app-pool identity, database permissions,
data-protection keys, uploads ACL, backups and readiness checks are all P8 work. No dormant tax setting is
exposed.

---

## 12. Frozen interfaces

```csharp
Task<int> IUnitOfWork.SaveChangesAsync(CancellationToken ct);

Task<Result<T>> ITransactionRunner.ExecuteAsync<T>(
    Func<TransactionAttempt, CancellationToken, Task<Result<T>>> operation, CancellationToken ct,
    Func<TransactionAttempt, CancellationToken, Task<Result<T>?>>? verifyCommitted);

Task<PagedProductsDto> IProductReadQueries.SearchAsync(
    ProductSearchRequest request, CancellationToken ct);

sealed record QuoteCheckoutRequest(
    IReadOnlyList<QuoteLineRequest> Items, string? DiscountCode, string? Governorate);
sealed record QuoteLineRequest(string VariantId, int Quantity);
// CheckoutQuoteDto: Lines[], Subtotal, DiscountAmount, AppliedDiscountCode, DeliveryFee,
//                   FreeDeliveryThreshold, AmountNeededForFreeDelivery, Total, Currency,
//                   Issues[], QuoteToken, ExpiresAt

sealed record PlaceOrderRequest(
    IReadOnlyList<PlaceOrderLine> Items, ShippingAddressDto ShippingAddress,
    string? DiscountCode, string? CustomerEmail, string QuoteToken);

sealed record PlaceOrderResponse(OrderDto Order, bool IsDuplicate, string? GuestAccessHint);

enum IdempotencyOutcome { Acquired, Replay, PayloadConflict, InProgress }
```

Repository and idempotency outcomes are application-level types; HTTP status mapping stays in the API
layer. `DbSet`, `IQueryable` and EF types never cross into Application.

## 13. Deviations from the runbook, with reason

| Runbook suggestion | Adopted | Reason |
|---|---|---|
| `Infrastructure/Persistence/CheckoutTransactionRunner.cs` | `Infrastructure/Persistence/TransactionRunner.cs` | cancellation, collection and inventory need the identical Result-aware boundary |
| `docs/backend/contracts/` flat fixtures | grouped fixture files by feature | same content, fewer files to keep in sync |

---

## 14. Implementation-time decisions (phases 1–5)

**D-IMPL-1 — development cookie security.** `.NET 10` enforces `Secure` cookies outside Development.
Because the Vite dev server is HTTP (`http://localhost:5173`) and proxies to the API, the dev cookie policy
is `SecurePolicy=None`; `appsettings` in Development is the only place this applies. Production keeps
`Secure` + HTTPS. Documented deviation from the blanket "secure cookies" rule, forced by the dev topology.

**D-IMPL-2 — order line identity.** `OrderItem.Id` is the database identity
`{orderId}_{productId}_{variantId}`; the client-facing `id` is `OrderItem.LineKey` =
`{productId}_{variantId}`, preserving the prototype's `CartItem.id` contract. A plain
`{productId}_{variantId}` cannot be a primary key because the same variant repeats across orders.

**D-IMPL-3 — batch catalog lookup.** `GET /products?ids=a,b,c` returns exactly the requested published
products (bounded by `pageSize`). Wishlist and cart resolution use it instead of assuming the first page
contains everything.

**D-IMPL-4 — admin product edit cannot change existing stock.** `PUT /admin/products/{id}` rejects a
changed `stock` on an existing variant (`400`, field `variants[i].stock`) and directs the operator to the
inventory endpoint. Variant omissions are preserved; use `isActive=false` to retire one. New variants may
set an initial stock.

**D-IMPL-5 — error payload merging.** `AppError.Body` allows a use case to return extra top-level members
in a problem response (used by `QuoteChanged` to return a fresh quote and token) without teaching the API
layer about application DTOs.

**D-IMPL-6 — quote authority in the browser.** `CartContext` requests a quote on every cart/coupon change
and exposes its totals; the local calculation is only a fallback until the first quote arrives. Checkout is
blocked while no quote exists.

**D-IMPL-7 — checkout attempt persistence.** The idempotency key and accepted quote token are stored in
`sessionStorage` before submission. A lost response is resolved through `GET /checkout/attempts/{key}`; a
`QuoteChanged` response refreshes the quote and requires a new explicit submit. Keys are never regenerated
on failure, so the same attempt stays idempotent.

**D-IMPL-8 — dev ports and the API address.** API `https://localhost:7108` (the `https` launch profile, which
`npm run dev:api` uses), Vite `http://localhost:5173` with `strictPort`. The API address is one variable,
`VITE_API_URL` (`.env.development`, `.env.production` or the shell), read in `src/api/config.ts`. The dev and preview
servers proxy `/api` and `/media` to it (D-AUTH-4 stands); a production build calls it directly, or the page's own
origin when it is empty. Replaces port 5080 and `LUMA_API_URL`. A dev page cannot call the HTTPS API directly: the
browser blocks the `SameSite=Lax` cookies of a cross-scheme request (`SchemefulSameSiteLax`), so sign-in fails.

**D-IMPL-9 — media addresses are resolved at render time.** Uploaded images are stored and returned as root-relative
`/media/...` paths. The storefront prefixes the API origin only when it renders an `<img>` (`mediaUrl`), never in the
data it loads: an administrator's save then cannot persist a host name, and a change of API address needs no data
migration.

---

## 15. Fulfilment and payment implementation (phase 6)

**D-FUL-1 — cancellation order of operations.** The guarded order update runs first:
`UPDATE Orders SET Status='Cancelled', StockRestored=1 WHERE Id=@id AND Status IN ('Pending','Confirmed')
AND PaymentStatus='Unpaid' AND StockRestored=0`. Only when it affects one row are stock units restored
(atomic delta updates with `OUTPUT deleted.Stock, inserted.Stock`), audit rows written, and the status-history
entry added — all in the same transaction. A concurrent cancellation loses the guard, rolls back, and returns
409 without touching stock. This is what guarantees exactly-once restoration.

**D-FUL-2 — cancellation and coupons.** Cancelling does **not** restore coupon usage; the redemption row is
kept and lifetime usage is documented (D-COUPON).

**D-FUL-3 — payment collection.** Collection is a separate state change: amount must equal the order total,
only from Shipped/Delivered, only while Unpaid. The guarded update records amount, actor and server time.
Repeating the same amount is a safe replay (200); any other amount or a concurrent change returns
`PaymentConflict`. Collected orders cannot be cancelled, so a collected payment is never erased.

**D-FUL-4 — legacy payment amounts.** Imported orders with `PaymentStatus='Collected'` receive
`PaymentCollectedAmount = Total` (seeder and a one-time backfill after the migration).

**D-FUL-5 — metric semantics confirmed in SQL.** `totalSales` and `averageOrderValue` exclude Cancelled
orders; `collectedRevenue` sums orders with `PaymentStatus='Collected'` regardless of fulfilment state;
`lowStockItems` includes only active variants of non-archived products with `0 < Stock <= 5`.

---

## 16. Integration, cutover and release (phases 7–8)

### Correctness found by the failure suite

**D-P7-1 — the database refuses impossible rows.** Migration `AddIntegrityConstraints` adds CHECK constraints so a
direct write (a repair script, a future bug) cannot leave an order that contradicts the application's rules:
`CK_Orders_Status`, `CK_Orders_PaymentStatus`, `CK_Orders_Origin`, `CK_Orders_DiscountWithinSubtotal`,
`CK_Orders_TotalArithmetic` (Total = Subtotal − Discount + DeliveryFee), `CK_Orders_PaymentCollection` (collected
⇔ amount = total, time and actor present; unpaid ⇔ none of them), `CK_Orders_CancelledIsUncollected`,
`CK_Orders_StockRestoredOnlyWhenCancelled` and `CK_DiscountCodes_UsageWithinLimit`. `OrderItems` reference
`Products` and `ProductVariants` with restricting foreign keys, so a referenced product can only be archived.
`DatabaseConstraintTests` writes each violation directly and pins the name of the constraint that fires.

**D-P7-2 — exact stock audit.** Stock deductions, restorations and adjustments use `UPDATE … OUTPUT deleted.Stock,
inserted.Stock`. The audit row therefore records the stock the statement really replaced, whatever else ran in
between; audit rows of purchases and cancellations carry the `OrderId`.

**D-P7-3 — variants keep the administrator's order.** `ProductVariants.SortOrder` (migration `AddVariantSortOrder`)
stores the position; reads order by it. Variant ids are random, so ordering by id reshuffled variants after
every save and could change which one the storefront selects first.

**D-P7-4 — admin reads expose each variant's concurrency version.** `variants[].version` (base64 row version) is
returned on admin product reads and on the inventory-adjust response, never on public reads. The exact-count
form of inventory adjustment needs it; a stale version is 409 `InventoryConflict`.

**D-P7-5 — order and checkout-attempt lookups without an identity are 404.** A visitor with neither a customer
session nor a guest cookie gets the same 404 as the owner of a different scope, so an order id never reveals
whether it exists (ACCEPTANCE A-21).

**D-P7-6 — signing out ends every session of the account.** Logout rotates the Identity security stamp, and the
stamp is validated on every authenticated request (`SecurityStampValidatorOptions.ValidationInterval = 0`), so a
copied cookie is dead at logout and a changed password or role applies immediately. The cost is that signing
out in one browser signs the same account out in all of them, and one indexed lookup per authenticated
request. Per-device sessions would need a server-side session store (`ITicketStore`); that is a business decision
(see §17), not a defect.

**D-P7-7 — guest access runs 30 days from placement.** Placing an order extends the guest session to 30 days and
re-issues the cookie with the same credential value and the new expiry (D-GUEST-4).

**D-P7-8 — quantities are decimals on the wire and validated once.** `1.5` is `InvalidQuantity`, never a 500 and
never rounded; quote and placement share one validation (`CheckoutLines.TryMerge`).

**D-P7-9 — upload validation.** Magic bytes decide the type and the stored extension (client name and declared type
are ignored); an image above 5 MB or of an unsupported type is 400 `ValidationFailed` on `file`; a body above
the 10 MB host limit is 413 `PayloadTooLarge`.

**D-P7-10 — retention.** A hosted service removes completed idempotency rows after `Retention:IdempotencyDays`
(30), abandoned reservations after `Retention:AbandonedReservationDays` (1) and expired guest sessions after
`Retention:GuestSessionGraceDays` (7), in batches. Orders, audit rows, redemptions and coupons are business
records and are never purged. Disabled in tests; configuration under `Retention:*`.

**D-P7-11 — rating and review count stay editable catalog fields.** The prototype carries `rating` and
`reviewsCount` on every product and the admin form edits them. No review system exists, so they remain
administrator-curated display values (default 0), unchanged by this migration.

### Cutover

**D-P7-12 — one authoritative runtime.** The Express server, its seed module and the `dev:legacy` and `start`
scripts are removed once reconciliation and the browser suite pass. `data/db.json` stays in the repository as a
read-only historical record (it is the input of `LumaBeauty.LegacyData`), and a pre-retirement source archive
is kept with the backups (docs/backend/CUTOVER.md).

### Release

**D-P8-1 — target topology.** One IIS site on Windows Server with the ASP.NET Core Hosting Bundle, in-process
hosting, an application pool with "No Managed Code", HTTPS bound to the site, SQL Server (a supported production
edition, not Developer) with a database created by `db/provision.sql`.

**D-P8-2 — unsafe settings stop the process.** Outside Development the host refuses to start and prints every
problem at once: no connection string, a quote-signing key shorter than 32 characters, relative or in-application
`DataProtection:KeysPath` / `Uploads:RootPath`, `AllowedHosts` of `*`, or `DemoSeed:Enabled`. The committed
`appsettings.json` carries no connection string; the local-SQL default lives in `appsettings.Development.json`,
which is never published.

**D-P8-3 — three database identities.** A sysadmin provisions once. A *deployment* identity
(`luma_schema_deploy`: DDL plus read/write) applies `db/LumaBeauty.sql`. The *runtime* identity
(`luma_app_runtime`: read/write plus UPDATE on the order-number sequence) cannot create, alter or drop anything.
The application never migrates itself outside Development; `/health/ready` reports the database as behind while
a migration is pending. `db/verify-runtime-permissions.sql` proves both halves.

**D-P8-4 — key ring and uploads live outside the application folder.** The data-protection key ring is persisted
to `DataProtection:KeysPath` and protected with a certificate (`DataProtection:CertificateThumbprint`, required
for a second server or a restore elsewhere) or, by default on Windows, machine-scope DPAPI. Uploads live in
`Uploads:RootPath` and are served immutably under `/media`.

**D-P8-5 — secrets.** The release package contains none. `Quotes:SigningKey` is injected through the environment;
a SQL password exists only if SQL authentication is chosen, so Windows authentication is the documented default.
The administrator is created by `dotnet LumaBeauty.Api.dll --setup-admin` (hidden password prompt, nothing
logged, nothing persisted in configuration).

**D-P8-6 — API description is off in production.** `/openapi/v1.json` and `/swagger` are served in Development
or when `OpenApi:Enabled` is true.

**D-P8-7 — hardening headers.** Responses carry `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy` and, outside Development, a Content-Security-Policy that fits the built
storefront (`Security:ContentSecurityPolicy` replaces it). HTTPS redirection and HSTS apply outside Development;
`ForwardedHeaders:*` is for a TLS-terminating proxy only and trusts nothing by default.

**D-P8-8 — logging.** Unexpected failures are logged once with their trace id by the global exception handler.
The EF command category is limited to `Critical`: a unique-key conflict on the idempotency table is normal
control flow and must not raise error-level alerts. A durable log sink is not bundled (see §17).

**D-P8-9 — connections.** The connection strings do not enable MARS. The application never needs two open readers
on one connection, and MARS disables EF's savepoint handling (a warning on every save inside a transaction).

**D-P8-10 — nothing the API says is stored.** Every `/api` and `/health` response carries `Cache-Control: no-store`: orders,
addresses and admin lists are personal, and prices and stock change. Hashed files under `/assets` and uploads under `/media` are
immutable-cached (their names never repeat); `index.html` is `no-cache`.

**D-P8-11 — every refusal is a problem document.** A rate-limited request gets 429 `RateLimited` as `application/problem+json` with
`traceId` and `Retry-After`; 401 and 403 written by middleware are `application/problem+json` too. A path with a file extension
that does not exist (an old hashed script requested by a stale page, a deleted upload) is a plain 404; only extension-less paths
fall back to the storefront shell.

## 17. Open decisions and unavailable integrations

| Item | State | Needed from |
|---|---|---|
| Production SQL Server edition and server | **open** — Developer edition is not licensed for production | business / IT |
| Durable application log sink (file, Seq, Application Insights) | **open** — only console, debug and the Windows event log are available | operations |
| Per-device sign-out | **open** — sign-out is global (D-P7-6); per-device sessions need a server-side session store | product |
| E-mail (receipts, password reset, cross-device order recovery) | **unavailable** — no provider configured; password recovery and e-mail recovery are not offered | business |
| Online payment | **out of scope** — cash on delivery only | business |
| Tax | **out of scope** — no tax is computed (no dormant setting is exposed) | business |
| Customer profile editing, category and brand management screens | **deferred** (P0.3) | product |
| Image CDN / object storage | **not used** — uploads are local files that must be backed up with the database | operations |
| Reviews system | **not built** — see D-P7-11 | product |
