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
(matches the prototype session length), `Secure`, `SameSite=Lax`, `Path=/`. The JSON API (`/api`) returns 401/403 as
JSON Problem Details; never a redirect. The one exception is the server-rendered administration area (D-ADMIN-2): a
browser navigating below `/admin` is redirected to that area's sign-in or access-denied page, while a script there
(`X-Requested-With: XMLHttpRequest`) still gets the bare status.

**FROZEN D-AUTH-2 — CSRF.** `GET /api/v1/auth/csrf` returns `{ token, headerName: "X-XSRF-TOKEN" }` and
sets the antiforgery cookie. Every unsafe method on a cookie-authenticated request must echo the header.
The client fetches a **fresh token after login and logout**. Same-origin hosting does not remove this
requirement. The administration pages use the same antiforgery system: their forms carry the token as a form field,
their scripts send the header, and a token from either source is accepted by both (D-ADMIN-3).

**FROZEN D-AUTH-3 — passwords are real.** Login requires and verifies the password. Public registration
creates `customer` only. Roles are assigned exclusively by an administrator. Lockout: 5 failures / 15
minutes. Rate limits: `/auth/*` 10 requests/min/IP, `/orders` 5/min per identity.

**FROZEN D-AUTH-4 — dev topology.** Vite runs as its own server (`vite`) on its own port with
`server.proxy['/api'] → https://localhost:<api-port>` (`changeOrigin: true`, `secure: false`).
`npm run dev` must be repointed explicitly; adding the proxy alone does not change what it starts. The
legacy `tsx server.ts` command is retained only as `dev:legacy` until P7.3. HTTPS dev certificate trust is
a documented prerequisite (`dotnet dev-certs https --trust`).

**FROZEN D-AUTH-5 — password recovery.** A customer who forgot the password asks for a reset link by email and then
chooses a new password. `POST /api/v1/auth/forgot-password` takes `{ email, language }`; `POST /api/v1/auth/reset-password`
takes `{ email, token, newPassword }` and does not sign the user in. Both fall under the `/auth/*` rate limit (D-AUTH-3).
- **Link in the fragment.** The email links to `<storefront origin>/#reset-password?email=…&token=…`. A URL fragment is never
  sent to a server, so the token reaches no access log, proxy log or `Referer` header; the storefront reads it in the
  browser and posts it to the API.
- **Token.** An ASP.NET Core Identity data-protection token bound to the account's security stamp: valid
  `PasswordReset:TokenLifetimeMinutes` (default 60), single use. A successful reset rotates the stamp, which ends every
  session of the account (D-P7-6), resets the failed-attempt counter and lifts an automatic (temporary) lockout. A
  rejected new password (400 `ValidationFailed`) does not consume the token, so the same link can be used again.
- **No enumeration.** `forgot-password` answers 204 for every well-formed email, whether or not an account exists.
  `reset-password` gives one 400 `InvalidResetToken` for an unknown account, a blocked account and a wrong, expired or
  already used token.
- **Cooldown.** At most one reset email per account per 60 seconds; a repeat inside the window is ignored and answered with
  the same 204. The window is kept in memory, so a restart or a second server starts it afresh.
- **Background send.** The email is handed to an in-memory queue and sent by a hosted service, so the response time does
  not depend on SMTP and cannot tell a stranger whether the address is an account. A failed delivery is logged
  ("Sending an email failed") and never shown to the caller. A message queued but not yet sent is lost if the process
  recycles; the customer asks again after 60 seconds.
- **Blocked accounts.** An account blocked by an administrator (D-ADMIN-11) gets no email and cannot reset.
- **Who.** Any account that is not blocked, administrators included: the endpoints never look at the role.
- **Transport.** SMTP through MailKit (Infrastructure project), Gmail by default (`smtp.gmail.com`, port 587, STARTTLS)
  with an App Password. The email is sent in the language the customer was using (`en` or `ar`; anything else falls back
  to English).
- **Optional configuration.** The feature is available only when SMTP credentials, a valid sender address and
  `PasswordReset:LinkBaseUrl` are set; otherwise `forgot-password` answers 503 `EmailUnavailable` (a global answer, never
  account-specific). Nothing else in the application depends on email, so the production host starts without these
  settings; refusing to start would take the whole store offline for a feature that only affects customers who forgot a
  password, and a store that has not set up a mailbox yet would be unable to deploy at all. A configured but malformed
  `LinkBaseUrl` (not an absolute `https` address outside Development) is a misconfiguration and does stop the host.

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
the 10 MB host limit is 413 `PayloadTooLarge`. Since D-P8-12 the same rules apply to documents (8 MB) through `POST /files/*`.

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
`DataProtection:KeysPath` / `FileStorage:RootPath`, `AllowedHosts` of `*`, or `DemoSeed:Enabled`. The committed
`appsettings.json` carries no connection string; the local-SQL default lives in `appsettings.Development.json`,
which is never published.

**D-P8-3 — three database identities.** A sysadmin provisions once. A *deployment* identity
(`luma_schema_deploy`: DDL plus read/write) applies `db/LumaBeauty.sql`. The *runtime* identity
(`luma_app_runtime`: read/write plus UPDATE on the order-number sequence) cannot create, alter or drop anything.
The application never migrates itself outside Development; `/health/ready` reports the database as behind while
a migration is pending. `db/verify-runtime-permissions.sql` proves both halves.

**D-P8-4 — key ring and uploaded files live outside the application folder.** The data-protection key ring is persisted
to `DataProtection:KeysPath` and protected with a certificate (`DataProtection:CertificateThumbprint`, required
for a second server or a restore elsewhere) or, by default on Windows, machine-scope DPAPI. Uploaded files live in
`FileStorage:RootPath` (images in `images\`, served immutably under `/media`; documents in `documents\`, never served publicly; D-P8-12).

**D-P8-5 — secrets.** The release package contains none. `Quotes:SigningKey` is injected through the environment;
a SQL password exists only if SQL authentication is chosen, so Windows authentication is the documented default.
The administrator is created by `dotnet LumaBeauty.Api.dll --setup-admin` (hidden password prompt, nothing
logged, nothing persisted in configuration).

**D-P8-6 — API description is off in production.** `/openapi/v1.json` and `/swagger` are served in Development
or when `OpenApi:Enabled` is true.

**D-P8-7 — hardening headers.** Responses carry `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy` and, outside Development, a Content-Security-Policy that fits the built
storefront and the administration pages (D-ADMIN-4; `Security:ContentSecurityPolicy` replaces it). HTTPS redirection
and HSTS apply outside Development; `ForwardedHeaders:*` is for a TLS-terminating proxy only and trusts nothing by
default.

**D-P8-8 — logging.** Unexpected failures are logged once with their trace id by the global exception handler.
The EF command category is limited to `Critical`: a unique-key conflict on the idempotency table is normal
control flow and must not raise error-level alerts. A durable log sink is not bundled (see §17).

**D-P8-9 — connections.** The connection strings do not enable MARS. The application never needs two open readers
on one connection, and MARS disables EF's savepoint handling (a warning on every save inside a transaction).

**D-P8-10 — nothing the API says is stored.** Every `/api`, `/health` and `/admin` response carries `Cache-Control: no-store`: orders,
addresses and admin lists are personal, and prices and stock change. Hashed files under `/assets` and uploads under `/media` are
immutable-cached (their names never repeat); `index.html` is `no-cache`. The administration area's own scripts and styles
under `/admin-assets` are revalidated on every use, except the versioned `vendor/` folder, which is immutable-cached (D-ADMIN-5).

**D-P8-11 — every refusal is a problem document.** A rate-limited request gets 429 `RateLimited` as `application/problem+json` with
`traceId` and `Retry-After`; 401 and 403 written by middleware are `application/problem+json` too. (Below `/admin` the same
refusals are the area's HTML error page with the same status and `Retry-After`, D-ADMIN-6.) A path with a file extension
that does not exist (an old hashed script requested by a stale page, a deleted upload) is a plain 404; only extension-less paths
that are not below `/admin` fall back to the storefront shell.

**D-P8-12 — File storage: images and documents, one root, records in the `document` schema.** *One root.* Where uploaded files
live is one setting, `FileStorage:RootPath` (required and absolute outside Development, outside the application folder, D-P8-2/D-P8-4;
blank in Development means `App_Data`); images are kept in `images\` and documents in `documents\` beneath it (the folder names are
settings too, single and different), so one ACL, one backup and one move cover everything and nothing else in the configuration
names a path. It replaces the `Uploads` section (`Uploads:RootPath`, `Uploads:PublicBasePath`, and the documented but never
implemented `Uploads:MaxBytes` and `Uploads:AllowedContentTypes`); an existing `Uploads:RootPath` folder is copied into
`<RootPath>\images` and its `/media/<name>` URLs keep working, as those files simply have no record. *Records hold no path.* One row
per file in `document.StoredFiles` (migration `AddFileStorage`) keeps the kind, the name as uploaded (for the download), the generated
name on disk, the recognised content type, the size, the uploader and the time; the folder comes from the kind and the setting,
so moving the files is: move the two folders, change `FileStorage:RootPath`, restart, with no data change. *Documents are private,
images are public.* An image is shop content, shown to every visitor, so it is a static file under `FileStorage:PublicBasePath`
(`/media`, immutable-cached, D-P8-10). A document (PDF, Word, Excel, CSV, text) is not: it is never a static file, and the only
way out is `GET /api/v1/files/{id}`, administrator only, as an attachment under its original name with its real content type and
`nosniff`; images can be fetched the same way too. *Content decides the type* (D-P7-9): the file's bytes (magic bytes), never the
client's name or declared type, so a renamed file is refused and the stored extension is always the one the bytes prove.
*Limits are code, not settings*: images 5 MB, documents 8 MB, as `FilePolicy` rules beside the signatures they belong to, so
a configuration change cannot loosen what the code was written and tested for; 8 MB sits under the 10 MB request cap (host and
IIS), which stays the outer limit (413). A refusal is 400 `ValidationFailed` on `file` and stores nothing, no file and no row.
*Localization.* The API words its messages in the language of the request's `Accept-Language` (`en` or `ar`, otherwise English)
from resource catalogs (`ApplicationMessages(.ar).resx` for use-case messages, `ApiMessages(.ar).resx` for the pipeline's answers
and error titles; a test fails when a key lacks either language) and switches only the UI culture, so numbers and dates keep
formatting as `en-US`. The storefront sends the language its visitor chose (`luma_language`), not the browser's. *Not localized
yet:* the messages the older use cases word themselves (catalog, checkout, orders, brands, categories, banners, discounts, ...)
stay English whatever was asked, and the pages under `/admin` stay English with their culture pinned (D-ADMIN-8); their
scripts ask the API for English too, so a control never shows an Arabic refusal on an English page. *Every caller uploads
through the API.* The server-rendered pages no longer post a file with their form: one shared control (`_Uploader.cshtml`
with `file-upload.js`) sends the chosen file to `POST /files/{images|documents}` and puts the address it gets back into the
form's address field, so a form carries text only, a refusal is shown beside the control instead of after a round trip, and
a stored picture survives a save that fails for another reason. Uploading therefore needs JavaScript; typing an address by
hand does not. *Finding a file again.* `GET /files` lists what was uploaded (newest first, by kind, by name), which is what
`Catalog → Files` in the admin area and the *Files & Documents* tab of the storefront's admin screen show; it is the only
way to reach a document, whose address is not public. Nothing deletes a stored file: products, categories, brands and
banners hold addresses as plain text, so nothing can say who still points at one.

## 17. Open decisions and unavailable integrations

| Item | State | Needed from |
|---|---|---|
| Production SQL Server edition and server | **open** — Developer edition is not licensed for production | business / IT |
| Durable application log sink (file, Seq, Application Insights) | **open** — only console, debug and the Windows event log are available | operations |
| Per-device sign-out | **open** — sign-out is global (D-P7-6); per-device sessions need a server-side session store | product |
| E-mail receipts and cross-device order recovery | **unavailable** — no mail is sent except the password-reset message (D-AUTH-5); receipts and e-mail order recovery are not offered | business |
| Online payment | **out of scope** — cash on delivery only | business |
| Tax | **out of scope** — no tax is computed (no dormant setting is exposed) | business |
| Customer profile editing | **deferred** (P0.3) | product |
| Supplier and purchasing screens, spreadsheet product import, customer feedback screens, delivery time slots, live (SignalR) updates, per-governorate shipping zones | **not built** — outside the store's scope; see D-ADMIN-9 | product |
| Image CDN / object storage | **not used** — uploaded files (images and documents) are local files that must be backed up with the database | operations |
| Reviews system | **not built** — see D-P7-11 | product |

## 18. Administration pages (server-rendered)

**D-ADMIN-1 — where it lives.** A server-rendered MVC area, `Areas/Admin` in `LumaBeauty.Api`, served under `/admin`. It is a
second consumer of the Application handlers, next to the JSON API: controllers call handlers only, never repositories, EF
or Infrastructure types (an architecture test enforces it). The React admin console keeps working on the same handlers.
`/admin` is no longer a storefront client route: an address below it that is not a page is the area's own 404 page, and
near misses of the prefix (`/administrator`) remain storefront routes.

**D-ADMIN-2 — one session.** The area uses the storefront's `luma_auth` cookie, so one sign-in serves both, and starts and
ends sessions through the same code as the API (`BrowserSession`, including the security-stamp rotation at sign-out). Every
page except sign-in, access-denied and the error pages needs the `Admin` policy (role `admin`). Only an account with the role
is signed in by the area's form; a customer's correct password gets the same "Invalid email or password" as a wrong one, and so
does an account whose sign-in is paused after five wrong passwords (the form must not tell a stranger which addresses are accounts).
A visitor is redirected to `/admin/account/login` (a customer to `/admin/account/denied`); the return address is followed only
when it points back below `/admin`.

**D-ADMIN-3 — forgery protection.** Every unsafe request to an administration controller needs the antiforgery token, as a
form field or as the `X-XSRF-TOKEN` header (global `AutoValidateAntiforgeryToken`, no per-action opt-in), with the API's
cookie and options. Every state change is a POST; no GET changes data.

**D-ADMIN-4 — Content-Security-Policy.** The area runs under the policy the storefront runs under (`script-src 'self'`).
Pages therefore contain no inline script, no inline event handler and no `javascript:` URL, and load no script or style
from another origin: behaviour lives in `AdminAssets/js` and is requested with `data-*` attributes. A test scans every
rendered page for these, and tests on the Staging-style host prove the pages run under the real policy. Bootstrap and
Bootstrap Icons (MIT) are vendored with their licences.

**D-ADMIN-5 — assets.** Scripts, styles and fonts live in `AdminAssets/`, served at `/admin-assets` ahead of
authentication, not in `wwwroot`: the release replaces the web root with the storefront build. The folder is published with
the application, and a missing folder stops the host at start instead of leaving every page unstyled.

**D-ADMIN-6 — errors.** Below `/admin` a bare 4xx/5xx (a failed forgery check, an unknown page, a rate limit) and an unhandled
exception are rendered as the area's HTML error page, with the original status, a trace reference and no internal detail.
Routing is explicit in `Program` so that the two re-executing handlers sit ahead of it.

**D-ADMIN-7 — data rules.** The server owns money and stock: pages call handlers that use `ITransactionRunner`, guarded
updates and `PricingService`, and nothing a page posts is trusted as an amount or a total. Uploads go through the files use case (`UploadFileCommand`, D-P8-12).
Concurrency tokens round-trip in the page. Handlers receive the signed-in administrator's id as the actor.

**D-ADMIN-8 — language.** The pages are in English. Product, brand and category data keep their `{ en, ar }` fields, and
both languages are editable; the pages' own text is not localized and has no resource files.

**D-ADMIN-9 — scope of the pages.** Built: dashboard; products (variants, shades, images, archive/restore); brands; categories;
stock (levels, adjustments, ledger); coupons; banners; orders (list, details, status changes, cash on delivery, printable slip,
orders entered by an administrator); customers (profile, addresses, orders, block/unblock); reports (sales, products, coupons,
stock, CSV export); price scraper (D-ADMIN-16). The inventory-management reference the pages were modelled on also had suppliers
and purchasing, spreadsheet import, feedback, delivery slots, live updates and zone-based shipping; none of those belongs to this
store (one flat delivery fee, cash on delivery, no supplier relationship in the data model) and none was ported. No data was
migrated from the reference. The React admin console remains and works on the same handlers.

**D-ADMIN-10 — orders entered by an administrator.** A phone or counter order is an ordinary order with `Origin = 'Admin'`
(`CK_Orders_Origin` allows it, migration `AllowAdminOrderOrigin`), not a separate invoice type. `PlaceAdminOrderCommandHandler`
prices it with the checkout's own pricing (`PricingService`, `QuoteCheckoutQueryHandler.EvaluateCoupon`), takes stock with the
guarded `UPDATE … WHERE Stock >= @q` inside one `ITransactionRunner` transaction, writes one ledger row per unit sold with the
administrator as actor, counts the coupon use, and is idempotent per form: the scope is `admin:{actorId}` and the key is the
form's submission id, so a double click or a reload places one order, and the same id with other content is refused. The form
carries no prices; the only money inputs are the coupon code and "waive the delivery fee" (priced as free shipping from a zero
subtotal). An order may be attached to an existing account in the customer role (an administrator's account is refused); it then
appears in that customer's own history. The live figures beside the form come from the same pricing (`PreviewAdminOrderQueryHandler`);
the order is priced again when it is placed.

**D-ADMIN-11 — blocking a customer.** A block is an Identity lockout that ends in the year 9999 together with a new security
stamp, written in one update: the sign-in cookie of every device stops working at once (the stamp is checked on every request) and
the lockout keeps the customer out afterwards. A lockout that ends sooner is the sign-in protection's own short lockout and is shown
as such. Administrator accounts are never listed, blocked or attached to orders by these pages. A blocked customer who signs in on
the storefront with the right password is told so (423 `LockedOut`, "This account has been blocked. Please contact the store."); a
wrong password gets the usual 401 "Invalid email or password" and is never counted as a failed attempt, because counting it would end
the block early (Identity would replace the lockout with its own 15 minutes). The short automatic lockout keeps its own wording.

**D-ADMIN-12 — reports.** Days, weeks and months are the shop's (Africa/Cairo), not UTC: ranges are split wherever the UTC offset
changes (Egypt's summer time starts at midnight, so one local day has 23 hours and one has 25) and grouped in SQL by the local day.
Cancelled orders are reported beside, not inside, sales. The products report ranks by order lines (unit price × quantity, before coupon
discount and delivery) and says so; coupons are dated by redemption. CSV files are UTF-8 with a byte-order mark, RFC 4180 quoting,
and any text cell that begins with `=`, `+`, `-`, `@`, tab or carriage return gets a leading apostrophe so a spreadsheet does not
run it. File names are generated, never taken from the request.

**D-ADMIN-13 — keeping the pages honest.** An action parameter named `id` is bound from the route only
(`RouteIdParameterConvention`): MVC's default reads the posted form first, so a form field called `Id` would otherwise replace the
record in the address. `Url.Action` returns null for an action that does not exist and the pages draw a link only when it is not null,
so a mistyped link vanishes silently; `AdminAreaRulesTests` checks every `Url.Action("Action", "Controller")` in the views against
the controllers. A day's first moment (`AdminFormat.StartOfStoreDayUtc`) is the jump itself on the day Egyptian summer time starts,
because local midnight does not exist then.

**D-ADMIN-14 — known limitations.** The orders list has no payment-state filter and the cash form has no note field (the handler does
not store one). Cancelling an order returns its stock but does not give back the coupon use (usage is lifetime usage, D-FUL-1). The
status-tab counts cover the whole store, not the current search. Banner order has no concurrency token: two administrators reordering
at once is last writer wins, and the next change renumbers 1..N. Category order cannot be changed from the pages.

**D-ADMIN-15 — hardening from the security review.** (a) The storefront's CORS policy (`Cors:AllowedOrigins`) is applied to everything
except `/admin` and `/admin-assets`: a page that carries the antiforgery token is never a cross-origin resource. (b) A page number is
clamped to `Paging.MaxPage` (100 000) wherever an administration list takes one, because `(page - 1) * pageSize` overflows an int
for an absurd page; such a page is empty, not a 500. (c) An order's e-mail becomes a `mailto:` link only when it is one plain
mailbox (`AdminFormat.IsPlainEmail`): guest checkout stores any text, and `?bcc=…&body=…` in a link is a message somebody else
wrote. (d) The notes entered with an order and with a status change are part of the order's status history, which the customer
can read (the storefront shows the latest one), and the pages say so. An order entered with the delivery fee waived says so in its
first history entry. Known limitation: Identity pauses an account's sign-in for 15 minutes after five wrong passwords, so anyone who
knows an administrator's e-mail can keep that sign-in paused with a few requests every quarter of an hour; the sign-in form does not
reveal the pause, the per-address rate limit only slows the guessing down, and the recovery is to wait, to reset the password by
e-mail when that is set up (D-AUTH-5: a successful reset lifts the pause), or to sign in with a second administrator account
(`DEPLOYMENT.md` step 6).

**D-ADMIN-16 — price scraper.** Catalog → Price scraper (`ScraperController`, `/admin/scraper`) compares a variant with the same
item at another shop. It keeps the reference's flow (a competitor page per item, the price read from it, our price beside theirs,
apply with an optional EGP reduction, check all, apply all) and replaces its mechanics: the reference scraped any typed address with
Puppeteer or Selenium, applied prices without a check, and cut a fixed 5 EGP from a scheduled job.

(a) *Data.* `CompetitorLinks` holds one page per variant (key: the variant; deleted with it). `CompetitorPrices` holds one row for
every check that found a price: the price, the currency the page states (null when it does not), the strategy and engine that found
it, the page's product name (cut to 200 characters) and the time; once applied, also `AppliedPrice`, `AppliedAtUtc` and `AppliedBy`,
so a price change traces back to what the other shop showed. `CK_CompetitorPrices_Price`, `_Currency` and `_Applied` hold a price
above 0, a three-letter currency and the three applied columns set together or not at all. A check that finds nothing writes no
reading: the link keeps the time and the reason (`LastError`). Readings are never purged (one small row per check); the history page
shows the latest 30.

(b) *Reading a page.* `PriceFetcher` asks a plain request first (`HttpPageSource`) and a real Chrome or Edge (`BrowserPageSource`,
PuppeteerSharp: a fresh temporary profile per page, the process tree killed afterwards, one page at a time) only when the plain
request found no price, was refused, timed out or failed; a page that does not exist, is too large or is not a page is final. Two
engines because a shop can answer an automated plain request with an empty page or put the price in with scripts. In testing, Noon
and Amazon.eg answered plain requests; Carrefour Egypt answered a probe's plain requests with an empty page (and the application's own
with the page), and dropped a headless browser whose user agent says "HeadlessChrome" until that word was removed (the engine sends
the browser's own agent without it, or `Scraper:Browser:UserAgent`); both engines read the same price from all three shops; Jumia
sits behind a Cloudflare challenge that neither engine solves (both end as "No price was found").
`PricePageParser` (AngleSharp) tries, in order, JSON-LD, meta tags, microdata and, for Amazon hosts only, the price markup (the first
visible price-to-pay block, built from its whole and fraction parts when the block itself is blank; the struck-through list price is
not read). The first strategy that gives a price wins; a product without a price does not borrow the price of a related product
nested in it; of several offers the first that can be bought is read; a currency counts only when the page states a three-letter
code. The application never executes anything from the other shop's page; the browser does, in a throwaway profile.

(c) *Safe fetching.* The server fetches an address an administrator typed, and what comes back is untrusted. Layer 1,
`CompetitorUrl`: only http(s) addresses without a user name or password, on port 80 or 443, whose host is a name containing a dot
that is not an internal suffix (`.local`, `.internal`, …) or an IP literal that is public (`PublicAddress.IsPublic`: loopback,
private, link-local including cloud metadata, carrier-grade NAT, multicast, reserved and documentation ranges are refused, and so
are the IPv6 forms that wrap one of them: IPv4-mapped, NAT64, 6to4, Teredo); the stored address is parsed again before every check.
Layer 2, `HttpPageSource`: it resolves the name itself, requires every address it gets to pass the policy and opens the socket to
one of those exact addresses, so a name cannot be checked as public and connected as internal (DNS rebinding); redirects are
followed by hand (at most 5) and every hop gets the same check; no proxy, no cookies, no credentials; the page is read up to
`Scraper:MaxPageKilobytes` *after* decompression (a compression bomb stops there) and only when it is HTML. Layer 3, the browser's
request interception: only the main page, scripts, XHR and fetch go out (no images, frames or fonts), only over http(s), only to
hosts whose every address passes the policy; WebSocket, workers and WebRTC are removed from the page because interception cannot
see them. What the other shop's page says is shown as encoded text, never as markup.

(d) *Applying.* A reading is applied only when it states EGP (a missing or other currency is refused, with the reason) and is at
most 7 days old. The new price is the reading less the typed reduction (0 or more), rounded to 2 decimals, and must be above 0 and
within the product form's ceiling. The variant's price and, when it was following the cheapest active variant (it equalled it before
the change), the product's "from" price change in one save guarded by both rows' versions; a "from" price an administrator set to
something else is left alone. A link moved or removed while its page was being read gives a 409 ("check it again"), so a reading
never lands on an address the variant no longer has. *Apply all recent prices* takes the latest reading of every linked variant that
is in EGP, recent and not applied yet, leaves alone any move of more than 50% of the current price (`CompetitorPriceRules.MaxBulkChange`:
the likeliest cause is a wrong link or another pack size) and names each variant it left alone and why. A single *Apply* has no such
limit: it is the administrator's decision, after a confirmation dialog.

(e) *No automatic runs.* The reference rescraped and repriced on a schedule. Here nothing runs unless an administrator starts it.
*Check all linked pages* is driven by the open page: one `POST /admin/scraper/scrape/{id}` per linked variant of a product that is
not archived (never-checked first, then the longest unchecked; at most 2000), one after the other and a second apart, with a
progress bar and a Stop button; closing the page stops it. No price is read or changed without an administrator, and no long job
lives inside IIS, whose pool recycling would kill it.

(f) *Known limitations.* A shop that turns automated visitors away is not read: Jumia's Cloudflare check ends as "No price was
found", a plain 403 or 429 as "The shop refused the check"; nothing here tries to defeat bot protection. A price that depends on being
signed in, or on a chosen delivery area, is not found or is the anonymous
visitor's. A page with no structured data is read only if it is an Amazon page, and Amazon lists several price blocks (a one-time
purchase and a fast-delivery offer, one of them hidden): the first visible one is read, which may differ from the offer the shop
highlights. A link is one page per variant; a different pack size or shade at the other shop is for the administrator to judge (the
page's product name is shown beside the price for that reason). The browser engine is a check before and after, not a pinned
connection: it resolves a name again by itself, so the main page's real remote address is checked after loading and the reading is
discarded when it was not allowed, but a hostile DNS server could still steer a later script request of the page to an internal
address. Where that matters set `Scraper:Browser:Enabled` to false, or keep the application pool's network access to internal
systems closed. A read in the browser is given `Scraper:Browser:TimeoutSeconds` (45 by default) and only one runs at a time.
