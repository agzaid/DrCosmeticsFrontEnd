# LumaBeauty — Acceptance Matrix (P0.3)

**Task:** P0.3 — Assign UI scope and acceptance fixtures
**Status:** complete
**Rule:** every promised feature has a UI action **and** a test. A deferred feature must not render a
control that fakes success.

Verification types: **U** unit · **I** SQL Server integration · **B** browser · **M** manual/visual.

---

## 1. Screen → action → contract → owner

| Screen (`src/...`) | User action | Contract | Owner | Scenario |
|---|---|---|---|---|
| `App.tsx` boot | load catalog + reference data | `GET /products?status`(implicit published), `/categories`, `/brands`, `/banners` | P4.1 | A-01 |
| `HomePage.tsx` | view hero | `GET /banners` (active, ordered) | P4.1 | A-01 |
| `HomePage.tsx` | featured / best sellers / new arrivals | `GET /products?sort=…&pageSize=…` | P4.1 | A-02 |
| `ShopPage.tsx` | filter by category/brand/price/stock/skin/finish/coverage/shade | `GET /products?…&page=1` | P4.1 | A-03…A-06 |
| `ShopPage.tsx` | sort | `GET /products?sort=…` | P4.1 | A-05 |
| `ShopPage.tsx` | search | `GET /products?search=…` | P4.1 | A-06 |
| `ShopPage.tsx` | paginate | `GET /products?page=n&pageSize=24` | P4.1 | A-04 |
| `ProductDetailsModal.tsx` | open product, pick shade/size, see price/stock | `GET /products/{id}` | P4.1 | A-07 |
| `ProductDetailsModal.tsx` | add to cart | browser-only (no reservation) | P1.2 | A-08 |
| `CartDrawer.tsx` | apply/remove coupon, see totals | `POST /checkout/quote` | P5.1 | A-09 … A-12 |
| `CheckoutPage.tsx` | fill address, submit | `POST /checkout/quote` → `POST /orders` | P5.3, P5.4 | A-13 … A-18 |
| `CheckoutPage.tsx` | retry after network loss | `GET /checkout/attempts/{key}` | P5.2, P5.4 | A-19, A-20 |
| `OrderConfirmationPage.tsx` | view receipt, reload page | `GET /orders/{id}` (owner or guest cookie) | P5.4 | A-19, A-21 |
| `AccountPage.tsx` | sign in / register / sign out | `POST /auth/login`, `/auth/register`, `/auth/logout` | P3.1, P3.2 | A-22 … A-25 |
| `AccountPage.tsx` | order history | `GET /customer/orders?page` | P6.3 | A-26 |
| `AccountPage.tsx` | cancel an order | `POST /orders/{id}/cancel` | P6.1 | A-27 |
| `AccountPage.tsx` | list / add / delete addresses | `GET|POST /customer/addresses`, `DELETE …/{id}` | P3.3 | A-28 |
| `WishlistPage.tsx` + heart toggles | wishlist | `GET /customer/wishlist`, `PUT|DELETE …/{productId}` | P3.3 | A-29 |
| `Navbar.tsx` | language switch, badges, admin link | client state + `wishlist`/`cart` | P7.2 | A-30 |
| `AdminPage.tsx` overview | metrics | `GET /admin/metrics` | P6.3 | A-31 |
| `AdminPage.tsx` products | create/edit/archive, variants, Arabic name | `POST|PUT|DELETE /admin/products…` | P4.2 | A-32 … A-34 |
| `AdminPage.tsx` inventory | adjust stock | `POST /admin/inventory/adjust` | P4.2 | A-35 |
| `AdminPage.tsx` orders | filter, change status, collect cash | `GET/PATCH /admin/orders…`, `POST …/payment/collect` | P6.2 | A-36, A-37 |
| `AdminPage.tsx` discounts | list/create/archive | `GET|POST|DELETE /admin/discounts` | P4.3 | A-38 |
| `AdminPage.tsx` banners | edit banners | `GET/PUT /admin/banners` | P4.3 | A-39 |
| `AdminPage.tsx` images | upload product/banner image | `POST /admin/images` | P4.3 | A-40 |

## 2. Included vs deferred

| Feature | Status | Task | Note |
|---|---|---|---|
| Variant editing | **included** | P4.2 | SKU, shade (en/ar), swatch, size, price, stock, active |
| Image upload | **included** | P4.3 | replaces free-text URLs; URL remains as a fallback input |
| Banner editing | **included** | P4.3 | admin UI currently read-only |
| Cancellation | **included** | P6.1 | customer + admin |
| COD collection | **included** | P6.2 | admin only |
| Confirmation recovery | **included** | P5.4 | guest cookie + attempt lookup |
| Profile editing | **deferred** | — | `'profile'` view has no UI; do not render a tab |
| Password recovery | **deferred** | — | needs an email provider (P8 documents it) |
| Category/brand CRUD UI | **deferred** | — | brand becomes a `<select>`; no create/edit UI |
| Failed/refused delivery | **deferred** | — | no status values exist for it |
| Refunds after collection | **deferred** | — | cancellation is blocked once collected |
| Server-persisted cart | **deferred** | — | browser cart is the release behaviour |
| Cross-device guest recovery | **deferred** | — | requires email |
| Multi-currency | **deferred** | — | EGP only |
| Tax | **not present** | — | no UI, no field, no setting |

## 3. Pricing and validation fixtures (from `src/utils/shopLogic.test.ts`, verified 8/8 passing)

These are the exact assertions the .NET `PricingService` and address validator must satisfy.

| # | Fixture | Expected |
|---|---|---|
| P1 | 1 × 250 | subtotal 250 · fee **50** · discount 0 · total **300** · neededForFree 350 |
| P2 | 2 × 350 | subtotal 700 · fee **0** · neededForFree 0 · total **700** |
| P3 | 1 × 800, coupon `BEAUTY20` 20 %, min 300, cap 100 | discount **100** (capped from 160) · applied `BEAUTY20` · fee 0 · total **700** |
| P4 | 1 × 200, coupon `BIGSPENDER` fixed 50, min 500 | discount **0** · applied `undefined` · total **250** |
| P5 | `formatPrice(450,'en')` | `"450 EGP"` (server returns numbers; formatting stays client-side) |
| P6 | Egyptian mobile | `01012345678`, `01198765432`, `01200000000`, `01555555555`, `010 1234 5678` → valid; `01912345678`, `0101234567`, `12345678901` → invalid |
| P7 | address `{}` | invalid; errors for `fullName`, `mobileNumber`, `governorate` |
| P8 | stock 0 / 3 / 20 | `{false,false,0}` / `{true,true,3}` / `{true,false,20}` |

Additional decimal cases required by R05/R10 (not in the JS suite):

| # | Case | Expected |
|---|---|---|
| P9 | subtotal **599** | fee 50 |
| P10 | subtotal **600** | fee 0 |
| P11 | subtotal 600 with a 15 % coupon | fee **0** (threshold uses pre-discount subtotal) |
| P12 | 10 % of 45 = 4.5, and 4.505 → 2 dp | **4.50** / **4.51** (away-from-zero midpoint) |
| P13 | fixed coupon 500 on subtotal 380 | discount **380**, total **50** (fee still applies) — discount never exceeds subtotal |
| P14 | quantity 0 / −1 / 1.5 / 100 | **400 `InvalidQuantity`** each; never clamped |
| P15 | coupon expiry exactly at `now` | **not applicable** (strict `now < expiryDate`) |
| P16 | coupon `usageLimit = 0` | unlimited |
| P17 | coupon `currentUsage = usageLimit` | not applicable |

Address fixtures (both languages must render the error):

| Field | Invalid | Valid |
|---|---|---|
| `fullName` | `"Ab"` (2 chars) | `"Sarah Ahmed"` |
| `mobileNumber` | `"01912345678"`, `"0101234567"` | `"01012345678"`, `"010 1234 5678"` |
| `governorate` | `"C"` | `"Cairo"` / `"القاهرة"` |
| `city` | `""` | `"New Cairo"` / `"القاهرة الجديدة"` |
| `streetAddress` | `"St 9"` (4 chars) | `"Street 90, Villa 12"` |

Exact English messages preserved (P1.3 must keep these strings for compatibility):
`Full name must be at least 3 characters` · `Please enter a valid 11-digit Egyptian mobile number (e.g., 01012345678)` · `Please select a governorate` · `Please enter your city/district` · `Please enter a detailed street address`.
Each also carries a stable `errorCode` so the Arabic UI can show a localized message.

## 4. Arabic / RTL fixtures

| # | Fixture | Expected |
|---|---|---|
| AR-1 | `product.name.ar` `"أحمر شفاه حريري مخملي"` | stored and returned byte-identical through save → SQL → read |
| AR-2 | `search=أحمر` | matches the product by Arabic name |
| AR-3 | Arabic governorate `"القاهرة"` in an address | accepted and echoed in the order snapshot |
| AR-4 | Arabic sort order of names | stable linguistic ordering under `Arabic_100_CI_AI`; pagination does not duplicate/skip rows |
| AR-5 | idempotency keys `"AbCdEf123456"` vs `"abcdef123456"` | **distinct** (binary collation) |
| AR-6 | SKU `"lum-lip-02"` vs `"LUM-LIP-02"` | same variant after uppercase normalisation; duplicate create rejected |
| AR-7 | Arabic validation errors | UI shows the Arabic message for the same `errorCode`; English remains the fallback |
| AR-8 | `dir=rtl` on the storefront | unchanged; no new backend dependency on direction |

## 5. Catalog fixture exceeding three pages

Seed a **deterministic** development/search fixture of **61 products** on top of the 22 seeded ones
(**83** in total; pageSize 24 → pages 1–3 are full and a 4th page holds the remaining 11), with these probes:

| # | Probe | Expected |
|---|---|---|
| C-1 | `GET /products?page=1&pageSize=24` | 24 rows, `total: 83`, `totalPages: 4` |
| C-2 | `GET /products?page=4&pageSize=24` | 11 rows |
| C-3 | unique search term matching **only** the product sorted onto page 4 | exactly that product returned (`total: 1`) |
| C-4 | `sort=priceAsc&page=2` | no row repeats or disappears across pages (tie-breaker `Id ASC`) |
| C-5 | filter change | client resets to page 1; stale responses ignored |
| C-6 | archived product | absent from every public page; present for admin |
| C-7 | variant with `stock = 0` | product still listed; `inStock=true` excludes it |
| C-8 | `pageSize=100` | **400 `InvalidPaging`** (max 60) |

## 6. Named acceptance scenarios

### Catalog

- **A-01** (I,B) Boot returns categories, brands, active banners only, ordered by `order`, and published products. An archived product never appears.
- **A-02** (I) Home collections use dedicated queries; a featured product on page 3 still appears in the featured strip.
- **A-03** (I) Category + brand filters compose; `brand` accepts slug (`luma-signature`) and display name (`Luma Signature`).
- **A-04** (I,B) Paging is complete and stable across the 61-product fixture (C-1…C-4).
- **A-05** (I) All five sort values return deterministic order with `Id` tie-break.
- **A-06** (I) Search matches English name, Arabic name, description (both), brand and subcategory; `%`/`_` are literal.
- **A-07** (I,B) Product detail returns all variants; archived → 404; inactive variant is not purchasable.
- **A-08** (U) Adding to cart performs no network write and reserves no stock.

### Pricing and checkout

- **A-09** (U,I) The eight ported pricing fixtures (P1–P8) pass in xUnit.
- **A-10** (U,I) Decimal boundary fixtures P9–P13 pass, including midpoint rounding.
- **A-11** (I) Quote rejects quantities P14; empty cart → `EmptyCart`.
- **A-12** (I) Quote reports a non-applicable coupon as an `issue` and still prices the cart.
- **A-13** (I) Client-supplied totals are ignored: a request carrying fake prices still prices from the database.
- **A-14** (I) Address validation returns the exact legacy messages plus field keys.
- **A-15** (I) Two parallel buyers on `stock = 1`: exactly one 201, one 409 `InsufficientStock`, final stock 0, one order.
- **A-16** (I) Second-line failure: first line's stock deduction is rolled back; no order, no coupon increment.
- **A-17** (I) Same key + same payload in parallel → one order, one deduction, both responses return the same `order.id`, second is `isDuplicate: true`.
- **A-18** (I) Same key + different payload → 409 `IdempotencyKeyReuse`; no new order.
- **A-19** (I,B) **Lost response:** commit succeeds but the client sees a network error; retry returns the original order and confirmation survives a hard reload.
- **A-20** (I) **Changed price:** product price edited between quote and placement → 409 `QuoteChanged` with a fresh quote; nothing is charged at the stale total; on explicit acceptance the new total is stored.
- **A-21** (I,B) **Guest access:** another browser without the guest cookie gets 404 for the same order id.

### Accounts and ownership

- **A-22** (I,B) Wrong password → 401 identical to unknown email; 5 failures → lockout.
- **A-23** (I) Registration creates `customer` only; a `role: "admin"` field in the body is ignored.
- **A-24** (I) Customer calling `/admin/*` → 403. Anonymous → 401.
- **A-25** (I,B) **Account switching:** A logs out, B logs in in the same tab → B never sees A's orders, addresses or wishlist; A's cached state is cleared; a fresh CSRF token is obtained.
- **A-26** (I) `GET /customer/orders` returns only the caller's orders, paged; guest orders are absent.
- **A-27** (I) Cancel from `Pending`/`Confirmed` restores stock exactly once; repeat/concurrent cancel restores nothing more; `Shipped`/`Delivered` → 409; collected → 409.
- **A-28** (I) Address CRUD is owner-scoped; B's address id returns 404 for A.
- **A-29** (I) Wishlist `PUT`/`DELETE` are idempotent; repeated calls never invert; archived product omitted.

### Fulfilment and admin

- **A-30** (B,M) Arabic and English both render; `dir=rtl` intact; no layout regression in changed controls.
- **A-31** (I) Metrics match fixtures exactly (1559 / 3 / 519.67 / 1 / 22 / 629) and change correctly after a new order.
- **A-32** (I) Admin creates a product with one default variant; it becomes publicly purchasable.
- **A-33** (I) Duplicate SKU → 409; unknown brand → 400; omitted variants on update are preserved.
- **A-34** (I) Archive preserves historical order references; archived product still resolves inside an old order.
- **A-35** (I) Stock adjustment: delta mode is atomic; absolute mode with a stale version → 409 `InventoryConflict`; every change is audited.
- **A-36** (I) Status transitions follow the matrix; `Shipped`/`Delivered` never set payment.
- **A-37** (I) Collection only after shipment; duplicate collection replays safely; collection then cancel → 409.
- **A-38** (I) Coupon create normalises the code; expiry/limit enforced at quote and placement; archive keeps historical references.
- **A-39** (I) Banner save persists bilingual fields; deactivated banner disappears from the public endpoint but not from admin.
- **A-40** (I,B) Upload rejects a renamed non-image, caps size, generates a safe name, and the URL survives a restart.

## 7. Cross-cutting scenarios demanded by the review

| Scenario | Requirement | Owner |
|---|---|---|
| **Changed-price acceptance** | A-20 — never confirm silently | P5.1, P5.3 |
| **Lost-response recovery** | A-19, A-21 — one order, recoverable confirmation | P5.2, P5.4 |
| **Account switching** | A-25 — no cross-account leakage of auth, CSRF, wishlist, addresses or orders | P3.2, P3.3 |
| **Isolated database cleanup** | Tests create `LumaBeauty_Test_<32-hex-guid>` on the configured test server only; cleanup drops **exactly** that recorded name, guarded by a regex and a server-identity check; a wildcard, `LIKE`, or application-connection cleanup is forbidden | P2.2 |
| **Transaction rollback** | Failure after the first mutation leaves zero changes (stock, coupon, order, idempotency) | P2.3, P5.3 |
| **Historical immutability** | Editing product name/price or the customer address after purchase does not alter any stored order field | P2.1, P6.3 |

## 8. Evidence rules

A scenario is **passed** only with recorded output:

- U/I: `dotnet test` filter output showing the named test.
- I with SQL Server: the test ran against the isolated database (connection string logged with database name only, no credentials).
- B: browser automation output or a recorded manual walkthrough with the URL and the observed result.
- A check that could not run is **blocked**, never passed. In-memory providers are never reported as
  SQL Server evidence.

## 9. Phase gates

| Gate | Must be green |
|---|---|
| P1 | build, architecture boundary tests, pricing P1–P13, React→API 404-as-JSON |
| P2 | fresh + repeated migration, seed counts, Arabic/precision/constraint checks, `TransactionBoundaryTests` |
| P3 | A-22…A-25, A-28, A-29 |
| P4 | A-01…A-08, A-32…A-35, A-38…A-40 |
| P5 | A-09…A-21 |
| P6 | A-26, A-27, A-31, A-36, A-37 |
| P7 | §7 table + A-30 full bilingual walkthrough + reconciliation |
| P8 | staging smoke, restart persistence, restore rehearsal |
