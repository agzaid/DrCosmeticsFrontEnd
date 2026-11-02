# Luma Beauty

Bilingual (English / Arabic, RTL-aware) beauty storefront with cash-on-delivery checkout and an admin console.

- **Storefront and admin console:** React 19 + Vite + Tailwind (`src/`).
- **Backend:** ASP.NET Core 10, EF Core 10 and SQL Server (`backend/`). It is the only runtime: all catalog, account,
  order and inventory data lives in SQL Server.
- **Documentation:** `backend/README.md` (architecture, commands), `docs/backend/` (decisions, API contracts,
  acceptance, evidence, cutover, deployment).

## Prerequisites

| Tool | Version verified | Notes |
|---|---|---|
| Node.js + npm | 24.x / 11.x | frontend, unit tests, browser tests |
| .NET SDK | 10.0.x | backend |
| SQL Server | 2022 (Developer edition for development) | Windows authentication on `localhost` by default |
| Chrome or Edge | any current | only for the browser test suite |

## Run it locally

One-time setup (from the repository root):

```bash
npm install

# Administrator and demo customer for Development only; choose your own passwords. Nothing is committed.
dotnet user-secrets set "AdminSetup:Email" "admin@lumabeauty.com" --project backend/src/LumaBeauty.Api
dotnet user-secrets set "AdminSetup:Password" "<a strong password>" --project backend/src/LumaBeauty.Api
dotnet user-secrets set "DemoSeed:CustomerPassword" "<another strong password>" --project backend/src/LumaBeauty.Api
```

Every day, in two terminals:

```bash
npm run dev:api     # ASP.NET Core on https://localhost:7108 (the "https" launch profile; Swagger UI at /swagger).
                    # In Development it creates/updates the LumaBeauty database and loads the sample catalog the
                    # first time it finds the database empty. Needs the development certificate, once:
                    # dotnet dev-certs https --trust
npm run dev         # Vite on http://localhost:5173 (forwards /api and /media to the API address below)
```

Open <http://localhost:5173>. Orders, stock, accounts and uploaded images are stored in SQL Server and in
`backend/src/LumaBeauty.Api/App_Data/uploads`; they survive restarting either process. Visual Studio's `https` launch
profile starts the same API on the same address, so you can use it instead of `npm run dev:api`.

## The API address

The storefront reads where the API lives from one variable, `VITE_API_URL`, in one file (`src/api/config.ts`); no
service spells an address.

| File | Used by | Value |
|---|---|---|
| `.env.development` | `npm run dev`, `npm run preview` | `https://localhost:7108` |
| `.env.production` | `npm run build` | empty: the page's own origin (the API host serves the storefront, as in `docs/backend/DEPLOYMENT.md`); or the API's origin, for example `https://api.example.com` |

- **Development:** the browser stays on the Vite origin and Vite forwards `/api` and `/media` to that address, so the
  HttpOnly cookies stay first-party and no CORS is involved. To try another address for one run without editing a
  file, set the variable in the shell: `$env:VITE_API_URL = 'http://localhost:5001'; npm run dev`.
- **Production:** to host the storefront apart from the API, put the API's origin in `.env.production`, rebuild, and
  follow "Storefront on a separate host" in `docs/backend/DEPLOYMENT.md` (CORS, same site, HTTPS).
- The value is an origin only (scheme, host, optional port). A path such as `.../swagger/index.html` fails the build.

## Check it

```bash
npm run lint            # type-checks the app and the browser tests
npm test                # storefront pricing and validation unit tests
npm run build           # production build of the storefront
dotnet test backend/LumaBeauty.sln       # unit + SQL Server integration tests (creates and drops LumaBeauty_Test_* databases)
npm run test:e2e        # real browser (Chrome/Edge) against a fresh API publish and a disposable LumaBeauty_E2E_* database, EN + AR
```

## Release and operations

- Build the release package: `backend/scripts/Build-Release.ps1 -Version <x.y.z>`.
- Prepare and deploy an environment: `docs/backend/DEPLOYMENT.md`.
- Evidence for the current release candidate: `docs/backend/RELEASE_CHECKLIST.md`.

## The prototype's data

The Express prototype that preceded the backend was retired at cutover (`docs/backend/CUTOVER.md`).
`data/db.json` is kept as a read-only historical record. `backend/tools/LumaBeauty.LegacyData` imports it into SQL
Server and independently proves the result matches the file (`import`, `reconcile`).
