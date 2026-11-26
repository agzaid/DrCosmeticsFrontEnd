# LumaBeauty — API Contracts (P0.2)

**Status:** FROZEN for implementation. Base path `/api/v1`.
**Fixtures:** `docs/backend/contracts/*.json` — these are the normative JSON shapes; this document is
the prose index. Cross-fixture `{ "$ref": "file.json#/path" }` entries are documentation shorthand for
"this object is exactly that fixture"; they are not a schema language and are not resolved by tools.

---

## 1. Global conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1`. The SPA is the only client; no unversioned alias is kept. |
| Casing | JSON properties **camelCase**; C# DTOs PascalCase. |
| Enums | Serialized as **strings** with the legacy PascalCase values (`"Pending"`, `"cash_on_delivery"`). Unknown values never silently coerce. |
| Money | JSON **number**, `decimal`, up to 2 dp, `EGP`. `currency` emitted wherever a total is emitted. |
| Dates | ISO-8601 UTC with `Z` and millisecond precision (`2026-10-31T00:13:56.807Z`). Never local time. |
| IDs | Strings, legacy-compatible (`prod-1`, `var-1-2`, `user-customer`). `order.id` ≠ `order.orderNumber`; the display number is `LUM-` + sequence, never truncated to 6 digits. |
| Localized text | `{ "en": "...", "ar": "..." }` — both keys always present, `ar` may be `""` when untranslated. |
| Nullability | Optional fields are omitted or `null` exactly as the fixture shows. Arrays are never `null` — empty arrays instead. |
| Paging | `page` ≥ 1 (default 1); `pageSize` default 24, max 60 (admin orders: default 20, max 100). Out-of-range → 400 `InvalidPaging`. Responses include `page`, `pageSize`, `total`, `totalPages`. |
| Sorting | Explicit allow-list, always with a tie-breaker (`Id ASC`) for stable pages. Unknown `sort` → 400 `InvalidSort`. |
| Errors | RFC 9457 Problem Details + `errorCode`, `traceId`, optional `errors` (field → messages) and `context`. `application/problem+json`. |
| Auth | HttpOnly cookie `luma_auth`; guest cookie `luma_guest`; CSRF header `X-XSRF-TOKEN` on unsafe methods. 401/403 are JSON, never redirects. |
| Idempotency | Header `X-Idempotency-Key` on `POST /orders` only. |
| Caching | Every `/api` and `/health` response carries `Cache-Control: no-store`: nothing personal (orders, addresses, admin lists) or fast-changing (prices, stock) is stored by a browser or an intermediary. Hashed files under `/assets` and uploads under `/media` are cached as immutable; `index.html` is `no-cache`. |
| Language | The caller sends `Accept-Language` (`en` or `ar`; anything else, or no header, is English). The API words in that language the problem-details `detail`, the `errors.*` messages of the `/files` endpoints, the `title` of every error code and the answers the pipeline itself words (401, 403, 404 for an unknown `/api` path, 429, 413, CSRF failure, 409 concurrency, 503 unknown commit outcome, 500). Only the UI culture follows the header; numbers and dates stay `en-US`. **Not localized yet:** the messages other use cases word themselves (catalog, checkout, orders, brands, categories, banners, discounts, ...) stay English whatever was asked. The storefront sends the language its visitor chose (`luma_language`), not the browser's; the pages under `/admin` are always English. |
| Tracing | Every response carries `traceId` (also in Problem Details and structured logs). |
| OpenAPI | Document at `/openapi/v1.json`; interactive explorer at `/swagger`. Served in Development, or wherever `OpenApi:Enabled` is `true`; **off** in Staging/Production by default. Every operation has summary, request/response examples, and documented error codes. |

### 1.1 Error registry

| `errorCode` | HTTP | Meaning |
|---|---|---|
| `ValidationFailed` | 400 | field errors present in `errors` |
| `InvalidQuantity` | 400 | quantity not an integer in 1..99 |
| `InvalidResetToken` | 400 | password-reset link unknown, blocked, wrong, expired or already used (one identical answer for every case) |
| `InvalidIdempotencyKey` / `IdempotencyKeyRequired` | 400 | header missing or malformed |
| `InvalidPaging` / `InvalidSort` | 400 | query parameter out of contract |
| `EmptyCart` | 400 | no lines supplied |
| `NotAuthenticated` | 401 | no/expired session |
| `Forbidden` | 403 | authenticated but not permitted (admin policy or ownership) |
| `NotFound` | 404 | resource absent **or not visible to the caller** |
| `EmailAlreadyRegistered` | 409 | registration duplicate |
| `InsufficientStock` | 409 | guarded stock update affected 0 rows |
| `InvalidOrderTransition` | 409 | illegal fulfilment transition |
| `IdempotencyKeyReuse` | 409 | same scope+key, different fingerprint |
| `CheckoutInProgress` | 409 | concurrent attempt still open (`Retry-After`) |
| `QuoteChanged` | 409 | accepted quote no longer matches current prices/coupon |
| `QuoteExpired` | 409 | quote token past `expiresAt` |
| `CouponNotApplicable` | 409 | expired, exhausted, inactive, or below minimum |
| `InventoryConflict` | 409 | stale expected version / negative result |
| `PaymentConflict` | 409 | collection replay with a different amount, an amount that is not the order total, or a concurrent payment change |
| `PaymentCollectedCannotCancel` | 409 | cancellation after collection |
| `PaymentNotEligible` | 409 | collection before `Shipped` |
| `EmailUnavailable` | 503 | password reset by email is not configured on the server (global answer, never account-specific) |
| `OutcomeUnknown` | 503 | the database commit was not acknowledged and its result could not be verified; the operation was **not** re-executed (retry with the same idempotency key) |
| `RateLimited` | 429 | sign-in, registration, password-reset, guest-session or order-placement rate limit reached; `Retry-After` says when to retry (limits: `DEPLOYMENT.md` section 6) |
| `PayloadTooLarge` | 413 | request body above the host limit of 10 MB (an image above 5 MB or a document above 8 MB is a 400 `ValidationFailed` on `file`) |
| `InternalError` | 500 | no internal detail leaked; `traceId` only |

Validation field keys are the **camelCase form field paths** the UI already renders
(`fullName`, `mobileNumber`, `governorate`, `city`, `streetAddress`, `items[0].quantity`).

---

## 2. Endpoint matrix

Interactive documentation is generated from these; the table is the implementation checklist.

### 2.1 Public catalog

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/products` | none | `category, brand, search, skinType, finish, coverage, shadeFamily, inStock, minPrice, maxPrice, sort, page, pageSize` | 200 `PagedProductsDto` | 400 |
| GET | `/products/{id}` | none | — | 200 `{ product }` | 404 |
| GET | `/categories` | none | — | 200 `{ categories }` | — |
| GET | `/brands` | none | — | 200 `{ brands }` | — |
| GET | `/banners` | none | — | 200 `{ banners }` (active only, ordered) | — |

`GET /products` is **published-only, always**. `status` is not accepted here (admin uses §2.5).

`sort` values and semantics:

| `sort` | Order |
|---|---|
| `featured` | `IsFeatured DESC, IsBestSeller DESC, CreatedAtUtc DESC, Id ASC` |
| `priceAsc` | min active variant price `ASC, Id ASC` |
| `priceDesc` | min active variant price `DESC, Id ASC` |
| `newest` | `CreatedAtUtc DESC, Id ASC` |
| `bestSellers` | `IsBestSeller DESC, Rating DESC, Id ASC` |

`search` matches `name.en`, `name.ar`, `description.en`, `description.ar`, brand name, `subCategory`
(case-insensitive `contains`, `%`/`_` escaped). `brand` accepts slug or display name, case-insensitive.
`inStock=true` keeps products with at least one active variant with `Stock > 0`.

### 2.2 Guest scope

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| POST | `/guest/session` | none | — | 200 `{ guestSessionId }` + `Set-Cookie: luma_guest` | — |
| DELETE | `/guest/session` | guest cookie | — | 204 (cookie cleared, scope revoked) | — |

### 2.3 Checkout

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| POST | `/checkout/quote` | none (cookie optional) | `QuoteCheckoutRequest` | 200 `CheckoutQuoteDto` | 400, 409 `CouponNotApplicable` |
| POST | `/orders` | customer **or** guest cookie | `PlaceOrderRequest` + `X-Idempotency-Key` | 201 `PlaceOrderResponse` · 200 replay | 400, 401?, 409, 429 |
| GET | `/orders/{id}` | owner customer **or** owning guest cookie | — | 200 `{ order }` | 404 (absent, not yours, or no identity) |
| GET | `/checkout/attempts/{idempotencyKey}` | owning customer/guest scope | — | 200 `{ order, isDuplicate: true }` | 404 (unknown key, not yours, or no identity) |

`POST /orders` replays **before** any expiry or stock re-check (D-IDEM-4).

### 2.4 Authentication and customer

| Method | Path | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| GET | `/auth/csrf` | none | — | 200 `{ token, headerName }` | — |
| POST | `/auth/register` | none | `{ email, fullName, mobileNumber?, password }` | 201 `{ user }` + auth cookie | 400, 409 |
| POST | `/auth/login` | none | `{ email, password }` | 200 `{ user }` + auth cookie | 401, 423? |
| POST | `/auth/forgot-password` | none | `{ email, language }` (`language`: `en` or `ar`) | 204, always, whether or not the account exists | 400 `ValidationFailed` (`errors.email`), 429, 503 `EmailUnavailable` |
| POST | `/auth/reset-password` | none | `{ email, token, newPassword }` | 204; does **not** sign the user in | 400 `InvalidResetToken`, 400 `ValidationFailed` (`errors.newPassword`), 429 |
| POST | `/auth/logout` | cookie + CSRF | — | 204; ends **every** session of the account (security stamp rotated), so a copied cookie stops working | 401 |
| GET | `/auth/me` | cookie | — | 200 `{ user }` | 401 |
| GET | `/customer/orders` | customer | `page, pageSize` | 200 `{ orders, page, pageSize, total, totalPages }` | 401 |
| POST | `/orders/{id}/cancel` | owner customer | — | 200 `{ order }` | 401, 404, 409 |
| GET | `/customer/addresses` | customer | — | 200 `{ addresses }` | 401 |
| POST | `/customer/addresses` | customer | `UserAddress` (no `id`) | 201 `{ addresses }` | 400, 401 |
| DELETE | `/customer/addresses/{id}` | customer | — | 200 `{ addresses }` | 401, 404 |
| GET | `/customer/wishlist` | customer | — | 200 `{ productIds }` | 401 |
| PUT | `/customer/wishlist/{productId}` | customer | — | 204 | 401, 404 |
| DELETE | `/customer/wishlist/{productId}` | customer | — | 204 | 401 |

`GET /auth/me` returns `user.addresses` and `user.wishlist` so a single call rehydrates the account.

Password recovery (D-AUTH-5): the reset link is `<storefront origin>/#reset-password?email=<url-encoded>&token=<url-encoded>`.
The data is in the URL **fragment** so it never reaches a server, an access log or a `Referer` header.
`POST /auth/forgot-password` answers 204 for every well-formed email (no account enumeration); the email is sent
from a background queue, and at most one reset email per account per 60 seconds is sent (a repeat inside the window
is silently ignored, same 204). `language` selects the language of the email; anything other than `en` or `ar` falls
back to English. Both endpoints use the `auth` rate limiter. A rejected new password does not consume the token;
a successful reset rotates the security stamp (ends every session of the account) and lifts an automatic lockout.

### 2.5 Administration (policy `Admin`)

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/admin/metrics` | — | 200 `{ metrics }` |
| GET | `/admin/orders` | `status?, search?, page, pageSize` | 200 paged `{ orders, … }` |
| PATCH | `/admin/orders/{id}/status` | `{ status, note? }` | 200 `{ order }` |
| POST | `/admin/orders/{id}/payment/collect` | `{ amount?, note? }` | 200 `{ order }` |
| GET | `/admin/products` | `status=published\|archived\|all, search?, category?, brand?, page, pageSize` | 200 paged `{ products, … }` |
| GET | `/admin/products/{id}` | — | 200 `{ product }` (any status) |
| POST | `/admin/products` | `ProductWriteDto` | 201 `{ product }` |
| PUT | `/admin/products/{id}` | `ProductWriteDto` (full replace of supplied fields) | 200 `{ product }` |
| DELETE | `/admin/products/{id}` | — | 200 `{ product }` (archived, never deleted) |
| GET | `/admin/brands` | — | 200 `{ brands }`; each carries `productCount` |
| POST | `/admin/brands` | `{ name, origin?, logoUrl? }` | 201 `{ brand }` |
| PUT | `/admin/brands/{id}` | `{ name, origin?, logoUrl? }` | 200 `{ brand }` |
| DELETE | `/admin/brands/{id}` | — | 200 `{ brand }`; 409 `BrandInUse` while products still use it |
| POST | `/admin/inventory/adjust` | `{ productId, variantId, delta \| (newStock + expectedVersion), reason }` | 200 `{ product }` |
| GET | `/admin/discounts` | — | 200 `{ discounts }` |
| POST | `/admin/discounts` | `DiscountWriteDto` | 201 `{ discount }` |
| DELETE | `/admin/discounts/{code}` | — | 200 `{ discount }` (archived) |
| GET | `/admin/banners` | — | 200 `{ banners }` (including inactive) |
| PUT | `/admin/banners` | `{ banners: [...] }` | 200 `{ banners }` |
| GET | `/admin/scraper` | `search?` (SKU, product or shade), `state=all\|linked\|unlinked\|cheaper\|dearer\|failed`, `sort=product\|gap\|checked`, `page`, `pageSize` (default 24, at most 100) | 200 `{ rows, page, pageSize, total, totalPages }`; a row is `{ variantId, productId, productName, imageUrl, sku, shade, size, variantActive, price, url, lastCheckedAtUtc, lastError, lastErrorKind, latest, gap, canApply }` (`latest` is the newest reading; `gap` is the other shop's price over ours minus 1, null when they cannot be compared; `canApply` is the server's verdict on applying `latest`) |
| GET | `/admin/scraper/targets` | — | 200 `{ targets: [{ variantId, label }] }`: every linked variant that is not archived, never-checked first (at most 2000) |
| GET | `/admin/scraper/{variantId}/history` | — | 200 `{ row, readings }` (the newest readings first); 404 `NotFound` |
| PUT | `/admin/scraper/{variantId}/link` | `{ url }`; a blank address removes the link | 200 `{ row, removed }`; 400 `ValidationFailed` with `errors.url` for anything but a public web address; 404 `NotFound` |
| DELETE | `/admin/scraper/{variantId}/link` | — | 200 `{ row, removed }` (`removed` is false when there was no link) |
| POST | `/admin/scraper/{variantId}/check` | — | 200 `{ found, message, checkedAtUtc, row }`; a page that shows no price is still 200 with `found: false` and the reason in `row.lastError` / `row.lastErrorKind`; 404 `NotFound` when the variant has no link; 409 `ConcurrencyConflict` when the link moved while its page was read |
| POST | `/admin/scraper/{variantId}/apply` | `{ decrease? }` (EGP taken off the reading, 0 to 1,000,000) | 200 `{ applied: { variantId, sku, previousPrice, newPrice }, row }`; 400 when the reading cannot be applied (none, not EGP, older than 7 days) or `decrease` is out of range |
| POST | `/admin/scraper/apply-all` | `{ decrease? }` | 200 `{ summary: { applied, unchanged, skipped: [{ variantId, sku, reason }] } }`; a price that would move by more than half is skipped, not refused |
| GET | `/admin/scraper/schedule` | — | 200 `{ schedule: { enabled, time, timeZone, nextRunAtUtc, lastRun } }`: `time` is `HH:mm` on the shop's clock (off at 03:00 until someone saves one), `timeZone` its IANA name (`Africa/Cairo`), `nextRunAtUtc` is null while the schedule is off, `lastRun` is null or `{ startedAtUtc, finishedAtUtc, total, done, found, interrupted }` (`finishedAtUtc` is null while the run is going; `interrupted` means it ended before every page was read) |
| PUT | `/admin/scraper/schedule` | `{ enabled, time }`, `time` 24-hour `HH:mm` | 200 `{ schedule }` as above; 400 `ValidationFailed` with `errors.time` and/or `errors.enabled`. Saving starts the schedule afresh: the first run is the next time the clock reads `time`, not one that has just passed. A run only reads pages (the same check as `POST /admin/scraper/{variantId}/check`, one page at a time); it never applies a price |
| POST | `/files/images` | `multipart/form-data`, the first file part is the file: JPEG, PNG or WebP, at most 5 MB | 201 `{ id, kind: "image", fileName, contentType, sizeBytes, url, uploadedAtUtc }`, `url` is `/media/<32 hex>.<ext>` (public) |
| POST | `/files/documents` | same request: PDF, Word `.docx`, Excel `.xlsx`, CSV or plain text, at most 8 MB | 201 the same fields with `kind: "document"` and `url` `/api/v1/files/<id>` (an administrator-only address, not a public file) |
| GET | `/files/{id}` | — | 200 the stored file (image or document) as an attachment under the name it was uploaded with, its real content type, `X-Content-Type-Options: nosniff`; 404 `NotFound` when the id is unknown or the file has gone missing from disk |
| GET | `/files` | `?kind=image\|document`, `?search=` (a word in the uploaded name), `?page=` (default 1), `?pageSize=` (default 24, at most 100) | 200 `{ items, page, pageSize, total }`; an item is the same object an upload answers with, newest first |

The `/files` endpoints are administrator only (401 `NotAuthenticated` / 403 `Forbidden`) and the uploads need the `X-XSRF-TOKEN` header like every unsafe call. Both uploads decide the type by the file's bytes, never by its name or declared type. A refusal (wrong type, too large,
no file, not `multipart/form-data`) is 400 `ValidationFailed` with the reason in `errors.file` and, because it is the only
problem, the same text as `detail`; a malformed multipart body is a 400 `ValidationFailed` with the framework's reason
under `errors.request`; a body above the 10 MB host limit is 413 `PayloadTooLarge`. Nothing is stored and no record
is written for any refusal. `/files/*` replaces `POST /admin/images` (it answered `{ url }`); the old route no longer
exists and gives the generic 404. Files live under `FileStorage:RootPath` (`images` and `documents` beneath it; `DEPLOYMENT.md`),
one record per file in `document.StoredFiles`.

### 2.6 Operations

| Method | Path | Purpose |
|---|---|---|
| GET | `/health/live` | process liveness, no dependencies |
| GET | `/health/ready` | database readiness (real `SELECT 1` via `AddDbContextCheck`) |
| GET | `/openapi/v1.json` | OpenAPI document |
| GET | `/swagger` | interactive explorer |

---

## 3. Detailed contracts

### 3.1 `CheckoutQuoteDto`

Request:

```json
{
  "items": [{ "variantId": "var-1-2", "quantity": 1 }],
  "discountCode": "WELCOME15",
  "governorate": "Cairo"
}
```

Response (fixture `contracts/checkout-quote.json`):

```json
{
  "quote": {
    "lines": [{
      "variantId": "var-1-2", "productId": "prod-1",
      "productName": { "en": "Velvet Silk Matte Lipstick", "ar": "أحمر شفاه حريري مخملي" },
      "brand": "Luma Signature", "variantSku": "LUM-LIP-02",
      "shadeName": { "en": "Cairo Plum", "ar": "برقوقي قاهري" }, "shadeHex": "#7E3F50",
      "size": "3.8g", "unitPrice": 380, "quantity": 1, "lineTotal": 380,
      "availableStock": 11, "image": "https://…"
    }],
    "subtotal": 380, "discountAmount": 57, "appliedDiscountCode": "WELCOME15",
    "deliveryFee": 50, "freeDeliveryThreshold": 600, "amountNeededForFreeDelivery": 220,
    "total": 373, "currency": "EGP", "issues": []
  },
  "quoteToken": "v1.eyJ…​.Zm9v",
  "expiresAt": "2026-10-31T12:15:00.000Z"
}
```

Rules: duplicate `variantId` lines are merged before pricing; `issues[]` carries non-fatal problems
(`{ code, variantId?, message }`) such as `InsufficientStock` or `CouponNotApplicable` — pricing still
returns a complete quote so the UI can render it.

### 3.2 `PlaceOrderRequest` / `PlaceOrderResponse`

```json
{
  "items": [{ "variantId": "var-1-2", "quantity": 1 }],
  "shippingAddress": {
    "fullName": "Sara Ahmed", "mobileNumber": "01012345678",
    "governorate": "Cairo", "city": "Nasr City",
    "streetAddress": "12 El-Nasr Street, Apt 4", "buildingApt": "Apt 4",
    "deliveryNotes": "Call before delivery"
  },
  "discountCode": "WELCOME15",
  "customerEmail": "sara@example.com",
  "quoteToken": "v1.eyJ…​.Zm9v"
}
```

Response 201 (fixture `contracts/checkout-place-order.json`):

```json
{
  "order": {
    "id": "ord-1793405639999-100001", "orderNumber": "LUM-100001",
    "customerId": null, "customerEmail": "sara@example.com",
    "shippingAddress": { "...": "snapshot as submitted" },
    "items": [{
      "id": "prod-1_var-1-2", "productId": "prod-1",
      "productName": { "en": "Velvet Silk Matte Lipstick", "ar": "أحمر شفاه حريري مخملي" },
      "brand": "Luma Signature", "variantId": "var-1-2", "variantSku": "LUM-LIP-02",
      "shadeName": { "en": "Cairo Plum", "ar": "برقوقي قاهري" }, "shadeHex": "#7E3F50",
      "size": "3.8g", "unitPrice": 380, "quantity": 1, "image": "https://…", "stock": 11
    }],
    "subtotal": 380, "discountAmount": 57, "discountCode": "WELCOME15",
    "deliveryFee": 50, "total": 373, "currency": "EGP",
    "paymentMethod": "cash_on_delivery", "paymentStatus": "Unpaid",
    "status": "Pending",
    "statusHistory": [{ "status": "Pending", "changedAt": "…", "note": "Order placed" }],
    "stockRestored": false,
    "createdAt": "…", "updatedAt": "…"
  },
  "isDuplicate": false,
  "guestAccessHint": "Order is accessible from this browser for 30 days."
}
```

`guestAccessHint` is informational only — the credential is the `luma_guest` cookie, never a value in
the body or URL. Authenticated responses omit it.

Replay: HTTP 200 with the **original** order and `"isDuplicate": true`; no new order, no stock change, no
coupon increment.

### 3.3 Status and payment fields

`status` remains exactly `Pending | Confirmed | Shipped | Delivered | Cancelled`.
Additive: `paymentStatus` = `Unpaid | Collected`, `paymentCollectedAt?`, `currency`.
Fulfilment transitions are enforced server-side per D-STATUS; an illegal request returns
`409 InvalidOrderTransition` with `context: { from, to }`.

### 3.4 Problem Details shape

```json
{
  "type": "https://lumabeauty.local/errors/insufficient-stock",
  "title": "Insufficient stock",
  "status": 409,
  "detail": "Only 1 remaining for \"Velvet Silk Matte Lipstick\" (Cairo Plum).",
  "instance": "/api/v1/orders",
  "errorCode": "InsufficientStock",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "errors": { "items[0].quantity": ["Requested 2 but only 1 is available."] },
  "context": { "variantId": "var-1-2", "requested": 2, "available": 1 }
}
```

`errors` is present only for `ValidationFailed`/`InvalidQuantity`. `detail` is safe for display; it never
contains SQL, stack traces, or internal identifiers. `type` is stable and documented.

### 3.5 Admin metrics

`AdminMetrics` keeps the existing keys and adds `collectedRevenue` (D-METRICS):

```json
{
  "metrics": {
    "totalSales": 1559, "totalOrders": 4, "averageOrderValue": 519.67,
    "ordersByStatus": { "Pending": 2, "Confirmed": 0, "Shipped": 1, "Delivered": 1, "Cancelled": 0 },
    "lowStockCount": 3, "totalProducts": 22,
    "lowStockItems": [{ "productId": "prod-1", "productName": { "en": "…", "ar": "…" },
                        "variantSku": "LUM-LIP-02", "shadeName": { "en": "…", "ar": "…" },
                        "size": "3.8g", "stock": 3 }],
    "collectedRevenue": 629
  }
}
```

### 3.6 Frontend contract changes

Everything the UI must change is listed in `PLAN.md` §3 (C1–C12) with these amendments from R-rules:

| Plan item | Amended by |
|---|---|
| C10 (real coupon metadata) | replaced by the whole quote endpoint (D-QUOTE-1) |
| C12 (paging additive) | client must now actually page/filter server-side (D-CAT-1/4) |
| C11 (fingerprint) | header remains `X-Idempotency-Key`; key must be **stable across retries** and persisted before sending (D-IDEM-2, P5.4) |
| — | `POST /customer/wishlist/toggle` removed → `PUT`/`DELETE` (D-CONTRACT-1) |
| — | `POST /discounts/validate` removed → `POST /checkout/quote` |

---

## 4. OpenAPI requirements

Per operation: `summary`, `description` (business rule), `operationId`, tags by feature, request/response
examples drawn from the fixtures, and documented `409`/`400` problem responses. Security schemes:
`cookieAuth` (session) and `guestCookie`; the CSRF header documented as a required parameter on unsafe
operations. The generated document is the source for the NSwag TypeScript client in P1.2/P7.2.

---

## 5. Implementation status (phases 1–5)

| Area | State |
|---|---|
| Catalog read (`products`, `categories`, `brands`, `banners`) incl. `ids` batch filter | implemented |
| Auth (`csrf`, `register`, `login`, `logout`, `me`) + guest session | implemented |
| Customer (`orders` read, `addresses` CRUD, `wishlist` read/add/remove) | implemented |
| Admin products (list/create/update/archive), brands (list/create/update/delete), inventory adjust, discounts, banners, image upload | implemented |
| Checkout (`quote`, `orders`, `orders/{id}`, `checkout/attempts/{key}`) | implemented |
| Admin metrics (`GET /admin/metrics`) | implemented |
| Admin orders (`GET /admin/orders`, `PATCH …/status`) | implemented |
| COD collection (`POST …/payment/collect`) | implemented |
| Customer cancellation (`POST /orders/{id}/cancel`) | implemented |

Additional query parameter implemented on `GET /products`: `ids` (comma-separated) returns exactly the
requested published products, bounded by `pageSize`.

Data-protection note: authentication cookies are `Secure` outside Development. In Development the policy
is `None` because the Vite dev server is HTTP; see `DECISIONS.md` D-IMPL-1.

### 5.1 Fulfilment and payment (implemented)

- `POST /api/v1/orders/{id}/cancel` (customer, owner only): allowed from Pending/Confirmed while Unpaid.
  Returns 200 with the updated order; 409 `InvalidOrderTransition` / `PaymentCollectedCannotCancel`;
  404 for another customer's order. Stock is restored exactly once inside the same transaction that flips
  `stockRestored`; coupon usage is not restored.
- `PATCH /api/v1/admin/orders/{id}/status` `{ status, note? }`: matrix-enforced; cancellation via admin
  uses the same exactly-once restock; concurrent changes return 409.
- `POST /api/v1/admin/orders/{id}/payment/collect` `{ amount?, note? }`: only Shipped/Delivered and Unpaid;
  amount must equal the order total; records `paymentCollectedAmount`, actor and server time. Repeating the
  same amount returns 200 (safe replay); a different amount returns 409 `PaymentConflict`.
- `GET /api/v1/admin/orders?status&search&page&pageSize` and `GET /api/v1/admin/metrics` as specified.
  Cancelled orders are excluded from `totalSales`/`averageOrderValue`; `collectedRevenue` sums collected
  orders only.
