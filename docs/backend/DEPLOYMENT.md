# Luma Beauty — deployment and operations guide

Audience: the engineer who prepares an environment and releases the application. Nothing here requires guessing a
credential, a folder owner or an order of steps.

**Status of the instructions.** Every database, packaging, tool and application step was executed for the release
candidate against a real SQL Server and the packaged application (the repository's `docs/backend/RELEASE_CHECKLIST.md`
lists each check as passed, failed or blocked, with the package hash). The IIS-specific steps (application pool, site, bindings, the ASP.NET Core Module, pool identity
permissions) are **reviewed but not executed**: IIS and the Hosting Bundle are not installed on the machine the
release was built on. Run the first deployment in a staging environment and tick the same checklist there.

A live rollout is a separate, authorised action. This guide prepares it; it does not perform it.

To rehearse the whole sequence on one machine first, `backend\scripts\Rehearse-Release.ps1` unpacks a release package, applies
sections 5.3 to 5.8 (database, grants, schema, catalog, administrator, HTTPS start) to a disposable database, restarts the
application, proves a backup and a disaster restore, and removes everything again.

---

## 1. Topology

```
 browser ──HTTPS──▶ IIS site (one host name)
                      └─ ASP.NET Core Module, in-process hosting, application pool "LumaBeauty" (No Managed Code)
                           └─ LumaBeauty.Api  ── serves the storefront (wwwroot), /api/v1/*, /admin (administration pages) with /admin-assets/*, /media/*, /health/*
                                 │
                                 ├──▶ SQL Server  (database LumaBeauty, collation Arabic_100_CI_AI)
                                 ├──▶ D:\LumaBeauty\data\storage   uploaded files: images\ (served at /media) and documents\ (administrator download only)
                                 └──▶ D:\LumaBeauty\data\keys      data-protection key ring (cookie signing)
```

One host name serves the storefront and the API, so the sign-in and guest cookies stay first-party and no CORS is
needed. The storefront is a single-page app: any path without a file extension returns `index.html`, a missing file
is a 404, and any unknown `/api/*` path is a JSON 404 (`application/problem+json`, `errorCode: NotFound`).

### Storefront on a separate host (optional)

The layout above is the supported one. If the storefront must be hosted apart from the API (a static host or CDN):

1. Build the storefront with the API's origin: set `VITE_API_URL` in `.env.production` (an origin such as
   `https://api.example.com`, no path) and run `npm run build`. Every API request and every uploaded image
   (`/media/...`) is then addressed to that origin. Leave it empty for the layout above.
2. On the API, set `Cors:AllowedOrigins` to the storefront's origin, for example `["https://shop.example.com"]`.
   Credentials are allowed for exactly those origins and no others.
3. Keep both hosts on HTTPS and on the same site (for example `shop.example.com` and `api.example.com`). The
   sign-in, antiforgery and guest cookies are `SameSite=Lax`, which a browser withholds from requests between
   different sites or schemes, so sign-in would fail otherwise.
4. The storefront host's own Content-Security-Policy must allow the API: `connect-src 'self' https://api.example.com`
   (the API's built-in policy only covers the pages the API itself serves).

## 2. Prerequisites

| Need | Requirement |
|---|---|
| Web server | Windows Server 2019 or later with the IIS role and a TLS certificate for the host name |
| Runtime | **.NET 10 Hosting Bundle**, latest 10.0 servicing release (verified on runtime 10.0.14); restart IIS after installing it |
| Database | SQL Server 2022 **Standard or Enterprise** (a licensed, supported edition: Developer edition is for development and testing only). Verified on SQL Server 2022 (compatibility level 160) |
| Client tools | `sqlcmd` and PowerShell 5.1+ on the machine that runs the SQL scripts; robocopy |
| Accounts | a SQL **sysadmin** for the one-off provisioning, a **deployment** identity, and the **application-pool** identity (section 4) |
| Names | the public host name, the SQL host, the folder root (below), the pool name |
| Price scraper (optional) | outbound HTTPS from the web server to the other shops' sites (ports 443 and 80), and Google Chrome or Microsoft Edge installed on it for the pages that need a real browser; without a browser only plain requests are used (section 6, `Scraper:*`) |

Folder layout used in this guide (change the root as you like):

```
D:\LumaBeauty\app         the release (replaced on every deployment)
D:\LumaBeauty\data\keys   data-protection keys   ┐ never inside the app folder:
D:\LumaBeauty\data\storage uploaded files         ┘ a redeploy replaces that folder (images\ and documents\ inside)
D:\LumaBeauty\backups     local staging area for backups before they are copied off the server
D:\Releases\<version>     the unpacked release package
```

## 3. The release package

`backend\scripts\Build-Release.ps1 -Version 1.0.0` produces `artifacts\release\LumaBeauty-<version>.zip` and a
`.sha256` file. The script stops at the first failing gate: frontend type-check, unit tests and build; backend unit
and SQL Server integration tests; a publish **without** the development sample data and the Development settings; a
check that `backend\db\LumaBeauty.sql` is current with the migrations; and an inspection of the finished package for
development content, secrets and local addresses.

```
app\          publish output: LumaBeauty.Api.dll, web.config, appsettings.json, wwwroot\ (the storefront build), AdminAssets\ (scripts and styles of the administration pages)
db\           provision.sql  LumaBeauty.sql  grant-deploy-access.sql  grant-runtime-access.sql  verify-runtime-permissions.sql
tools\legacy-data\   LumaBeauty.LegacyData (import / reconcile) and db.json, the prototype's catalog
docs\         this guide, CUTOVER.md, DECISIONS.md, API_CONTRACTS.md, appsettings.Production.example.json
release-manifest.json   every file with its SHA-256, the version and the build time
```

Verify the archive before using it:

```powershell
(Get-FileHash .\LumaBeauty-1.0.0.zip -Algorithm SHA256).Hash.ToLower()   # must equal the contents of the .sha256 file
Expand-Archive .\LumaBeauty-1.0.0.zip -DestinationPath D:\Releases\1.0.0
```

The package contains **no secrets**. Everything secret is supplied at deployment (section 6).

## 4. Identities and permissions

| Identity | Used for | SQL access |
|---|---|---|
| sysadmin (a person, once) | `provision.sql`, the grant scripts | `sysadmin` |
| deployment identity, for example `CONTOSO\svc-luma-deploy` | applying `LumaBeauty.sql` on each release; running `--setup-admin` | role `luma_schema_deploy`: DDL plus read/write |
| application-pool identity, `IIS APPPOOL\LumaBeauty` (or a domain / managed service account) | the running site | role `luma_app_runtime`: read/write, `UPDATE` on `OrderNumberSeq`; **no DDL** |

A compromised website must not be able to change the schema, so the site never runs as the deployment identity.
When SQL Server is **on another machine**, the pool identity reaches it as the web server's computer account
(`CONTOSO\WEB01$`); pass that name (or a managed service account) as `AppPrincipal` below instead of
`IIS APPPOOL\LumaBeauty`. Windows authentication is the recommended mode: the connection string then contains no
password at all.

## 5. First deployment, step by step

Run these in an elevated PowerShell on the web server unless stated otherwise. Variables first:

```powershell
$Pool    = 'LumaBeauty';            $Site = 'LumaBeauty';       $HostName = 'shop.example.com'
$Root    = 'D:\LumaBeauty';         $Release = 'D:\Releases\1.0.0'
$Sql     = 'SQLHOST';               $Db = 'LumaBeauty'
$Deploy  = 'CONTOSO\svc-luma-deploy'
$AppUser = "IIS APPPOOL\$Pool"      # or CONTOSO\WEB01$ when SQL is on another machine
```

**1. Folders.**

```powershell
New-Item -ItemType Directory -Force "$Root\app", "$Root\data\keys", "$Root\data\storage\images", "$Root\data\storage\documents", "$Root\backups" | Out-Null
```

**2. Application pool, site and folder permissions.** The pool comes first: Windows and SQL Server resolve
`IIS APPPOOL\<name>` only once the pool exists, so neither the folder permissions nor the database grant (step 3) can be
given before it.

```powershell
Import-Module WebAdministration
New-WebAppPool -Name $Pool
Set-ItemProperty "IIS:\AppPools\$Pool" -Name managedRuntimeVersion -Value ''            # No Managed Code
Set-ItemProperty "IIS:\AppPools\$Pool" -Name startMode -Value AlwaysRunning
Set-ItemProperty "IIS:\AppPools\$Pool" -Name processModel.idleTimeout -Value '00:00:00'  # no idle shutdown
New-Website -Name $Site -PhysicalPath "$Root\app" -ApplicationPool $Pool -Port 80 -HostHeader $HostName
New-WebBinding -Name $Site -Protocol https -Port 443 -HostHeader $HostName -SslFlags 1
(Get-WebBinding -Name $Site -Protocol https).AddSslCertificate('<certificate thumbprint>', 'My')

# durable data: the pool identity may read and write, administrators and SYSTEM keep full control, nobody else
foreach ($folder in "$Root\data\keys", "$Root\data\storage") {
  icacls $folder /inheritance:r /grant 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\SYSTEM:(OI)(CI)F' "${AppUser}:(OI)(CI)M"
}
# the application folder: read and execute for the pool; only administrators and the deployment identity write
icacls "$Root\app" /grant "BUILTIN\IIS_IUSRS:(OI)(CI)RX" "${Deploy}:(OI)(CI)M"
```

Keep the HTTP binding: the application answers it with a redirect to HTTPS (`Hosting:RedirectToHttps`), except for
the two health endpoints, which must stay reachable over HTTP for probes.

**3. Database** (from the unpacked package, `$Release\db`). Provision once as a sysadmin, give the deployment identity
its role, apply the schema **as the deployment identity**, then give the pool identity its role and prove both.

Three steps (the schema here, the administrator in step 6 and the catalog in step 7) must run as the deployment identity,
not as you. Open **one** PowerShell window for that identity and keep it until step 7 is finished. A window of its own
also keeps every command's output on screen, which a one-shot `runas "command"` does not:

```powershell
runas /user:$Deploy powershell          # asks for the deployment identity's password and opens a new window
```

In that window define `$Sql`, `$Db`, `$Root` and `$Release` again (variables do not carry over). Commands marked
**(deployment window)** run there; the others run in your administrator window.

```powershell
cd $Release\db
# sqlcmd reads its scripting variables from the environment: the reliable way to pass a value with a space
# (IIS APPPOOL\LumaBeauty has one). A trusted certificate on the SQL Server: leave -C out. -C trusts any certificate
# and is for a local test server only.
$env:DatabaseName = $Db; $env:RecoveryModel = 'FULL'; $env:DeployPrincipal = $Deploy; $env:AppPrincipal = $AppUser

sqlcmd -S $Sql -E -b -i provision.sql
sqlcmd -S $Sql -E -b -i grant-deploy-access.sql
```

```powershell
# (deployment window) apply the schema; repeat on every release, migrations already applied are skipped
sqlcmd -S $Sql -E -b -d $Db -i $Release\db\LumaBeauty.sql
```

```powershell
# (administrator window)
sqlcmd -S $Sql -E -b -i grant-runtime-access.sql
sqlcmd -S $Sql -E -b -i verify-runtime-permissions.sql
Remove-Item Env:DatabaseName, Env:RecoveryModel, Env:DeployPrincipal, Env:AppPrincipal
```

`provision.sql` refuses a database that already exists with another collation: Arabic names would otherwise sort and
compare differently from what the application and its tests expect. `verify-runtime-permissions.sql` must end with
`All permission probes behaved as expected`: it shows that the application identity can read, write and take order
numbers and that every attempt to create, alter, drop or truncate something is refused (each probe runs in a
transaction that is rolled back).

The schema now has a second part: the `document` schema (table `document.StoredFiles`, one record per uploaded file), created by `LumaBeauty.sql` under the deployment account like everything else (the rest stays in `dbo`). The runtime role is unchanged: `db_datareader` / `db_datawriter` already cover the new schema, and `verify-runtime-permissions.sql` probes it.

`RecoveryModel=FULL` allows point-in-time restore and **requires scheduled transaction-log backups** (section 9);
`SIMPLE` needs none and loses everything since the last full backup.

**4. Settings.** Non-secret settings go in `appsettings.Production.json` next to the application (copy
`docs\appsettings.Production.example.json`, replace every `<placeholder>`). Everything else is an environment
variable of the application pool. Use `__` for `:` in names.

```powershell
$appcmd = "$env:windir\system32\inetsrv\appcmd.exe"
function Set-PoolVariable([string]$Name, [string]$Value) {
  & $appcmd set config -section:system.applicationHost/applicationPools `
    "/+[name='$Pool'].environmentVariables.[name='$Name',value='$Value']" /commit:apphost
}
# 64 hex characters from the operating system's cryptographic generator (Get-Random is not suitable for secrets)
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$signingKey = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''

Set-PoolVariable 'ASPNETCORE_ENVIRONMENT' 'Production'
Set-PoolVariable 'Quotes__SigningKey' $signingKey
# or, when appsettings.Production.json is not used:  ConnectionStrings__Default, DataProtection__KeysPath, FileStorage__RootPath, ...
```

Pool environment variables live in `applicationHost.config`, which only local administrators can read, but it is not
encrypted: treat the machine's administrators as trusted. Keep the signing key in your password vault as well.
Never put a secret in `web.config`, `appsettings.json` or `appsettings.Production.json`.

**5. Deploy the application files.**

```powershell
Set-Content "$Root\app\app_offline.htm" '<html><body>Luma Beauty is being updated. Back in a moment.</body></html>'
robocopy "$Release\app" "$Root\app" /MIR /XF app_offline.htm appsettings.Production.json /NFL /NDL
Remove-Item "$Root\app\app_offline.htm"
```

`app_offline.htm` makes IIS stop the application while files are replaced. `/XF` keeps your
`appsettings.Production.json`, which is not part of the package, from being mirrored away.

robocopy's exit codes 0 to 7 all mean success (1: files were copied, 2: an extra file such as `app_offline.htm` was left
in place, 3: both); only 8 or more is a failure, so a script must not treat every non-zero code as an error.
`web.config` is part of the package and replaces the installed one at every deployment: a temporary `stdoutLogEnabled`
edit does not survive it.

**6. Create the administrator.** The one-shot command builds the application with the same settings as the site
(`appsettings.Production.json` next to it plus the three values below), creates the account and exits. It needs database
access, so run it in the deployment window; the password is typed at a hidden prompt and is never echoed, logged or
stored.

```powershell
# (deployment window)
cd $Root\app
$env:ASPNETCORE_ENVIRONMENT = 'Production'
$env:Quotes__SigningKey     = '<same key>'
$env:AdminSetup__Email      = 'owner@example.com'
dotnet LumaBeauty.Api.dll --setup-admin
Remove-Item Env:ASPNETCORE_ENVIRONMENT, Env:Quotes__SigningKey, Env:AdminSetup__Email
```

Do not squeeze this into a `cmd /c "set NAME=value && ..."` one-liner: the space before `&&` becomes part of the value,
and the host then refuses to start in an environment called `Production ` (with a trailing space).

It refuses an existing e-mail and leaves that account's password alone. To add another administrator, run it again with
another e-mail. Password reset by e-mail exists only once the e-mail settings of section 6 ("Email (Gmail) for password
reset") are configured; without them, if the only administrator's password is lost, create a second administrator.

Sign in with it at `https://<host>/admin`: that is where the shop is administered day to day (products, stock, orders,
customers, coupons, banners, reports; `DECISIONS.md` section 18). The storefront's own sign-in works for the same account.

**7. Load the catalog.** A new database is empty, so the storefront shows nothing until reference data and products
exist. Either create the brands, categories and products in the administration pages, or load the prototype's catalog first
(below) and replace it there afterwards:

```powershell
# (deployment window)
$conn = "Server=$Sql;Database=$Db;Trusted_Connection=True;Encrypt=True"
cd $Release\tools\legacy-data
dotnet LumaBeauty.LegacyData.dll import    --source db.json --connection $conn --scope catalog --dry-run
dotnet LumaBeauty.LegacyData.dll import    --source db.json --connection $conn --scope catalog
dotnet LumaBeauty.LegacyData.dll reconcile --source db.json --connection $conn --scope catalog --ignore-stock
```

Run it in the deployment window (it writes rows). `--scope catalog` imports categories, brands, banners, coupons,
products, variants and images; `--scope full` also imports the prototype's three historical orders and moves the order
number sequence past them (only for a database that must carry them). The import refuses a database that already holds
data. Exit code 0 from `reconcile` means SQL equals the file; `docs\backend\CUTOVER.md` records the run for the release
candidate. Replace the catalog through the administration pages afterwards; images are pasted URLs or uploads (stored under `FileStorage:RootPath`).

**8. Start and verify.**

```powershell
Invoke-RestMethod https://$HostName/health/live    # { status: Healthy, version: 1.0.0 }
Invoke-RestMethod https://$HostName/health/ready   # database, schema and uploads (the images and documents folders) must all be Healthy
```

`/health/ready` answers 503 with the failing check's description while: the database is unreachable, the collation is
wrong, a migration is pending, or the images or documents folder is not writable. Then walk the smoke list:

- [ ] `/health/ready` is Healthy and reports this release's version.
- [ ] The storefront opens in English and in Arabic (the language switch flips the direction) and shows the catalog.
- [ ] A product opens with its shades or sizes, and a search finds a product by an English word and by an Arabic one.
- [ ] A guest adds a product, checks out (cash on delivery) and sees the confirmation; reloading the page shows it again.
- [ ] A customer registers, signs in, saves an address and sees the order in the history; signing out and in as someone else
      shows none of the first customer's data.
- [ ] The administrator signs in at `/admin`, sees the dashboard, uploads a product image (it appears at `/media/...`),
      changes a stock count, enters an order for a customer (stock drops by the quantity ordered), moves it to Shipped,
      records the cash collection and opens the slip; the pages are styled (`/admin-assets/css/admin.css` answers 200).
- [ ] A document (for example a PDF) uploaded through `POST /api/v1/files/documents` is stored in `<FileStorage:RootPath>\documents` and downloads at its `url` for the signed-in administrator; the same address answers 401 without a session and the file is not reachable under `/media`.
- [ ] The page `https://<host>/some/unknown/page` shows the storefront, `https://<host>/admin/nothing` shows the administration
      area's own "Page not found", and `https://<host>/api/v1/nothing` answers a JSON 404.
- [ ] Recycle the application pool: the test order is still there, an administrator who was signed in is still signed in.
- [ ] No browser console error or Content-Security-Policy violation appears during the above.

The same browser
suite can be pointed at the environment:

```powershell
$env:E2E_ADMIN_EMAIL = '<admin>'; $env:E2E_ADMIN_PASSWORD = '<password>'
npm run test:e2e -- --attach https://$HostName      # creates real test products and orders: staging only
```

**9. Schedule backups** (section 9) and remove any temporary access you added.

## 6. Configuration reference

Anything not listed uses its default. Names are shown in configuration form; as an environment variable replace `:`
with `__`.

| Setting | Required | Default | Meaning |
|---|---|---|---|
| `ASPNETCORE_ENVIRONMENT` | yes | `Production` | `Production` or `Staging` enable every protection below; `Development` is for developers only |
| `ConnectionStrings:Default` | yes | — | SQL Server connection; prefer Windows authentication and `Encrypt=True` |
| `Quotes:SigningKey` | yes | — | secret, **at least 32 characters** (64 random hex recommended); signs checkout quotes |
| `DataProtection:KeysPath` | yes | — | absolute folder outside the app folder for the cookie-signing key ring |
| `DataProtection:CertificateThumbprint` | recommended | machine DPAPI | certificate (with private key readable by the pool identity) that encrypts the key ring; required to move or restore the ring to another server |
| `FileStorage:RootPath` | yes | — (blank in Development: `App_Data` under the application) | the one place that says where uploaded files live: an absolute folder outside the app folder (a redeploy replaces that folder). Images are kept in `<RootPath>\images`, documents in `<RootPath>\documents` |
| `FileStorage:ImagesFolder` / `DocumentsFolder` | no | `images` / `documents` | the two folder names under `RootPath`; each a single folder name, and different from each other |
| `FileStorage:PublicBasePath` | no | `/media` | public URL prefix of the **images** only; documents are never served as public files (administrator download through `GET /api/v1/files/{id}`) |
| `AllowedHosts` | yes | — | the site's host names separated by `;` — `*` is refused. A load-balancer probe must use one of these names too (a probe addressed by IP is answered 400) |
| `Pricing:FreeShippingThreshold` / `StandardShippingFee` | no | 600 / 50 | EGP; free delivery at or above the pre-discount subtotal |
| `Pricing:QuoteLifetimeMinutes` | no | 15 | how long an accepted checkout quote stays valid |
| `Checkout:LockTimeoutSeconds` | no | 10 | how long a duplicate submission waits for the first attempt |
| `Checkout:ReservationTimeoutSeconds` | no | 120 | age after which an unfinished idempotency reservation may be taken over |
| `Guest:SessionDays` | no | 30 | life of a guest session; placing an order extends it to this many days from placement |
| `Retention:*` | no | enabled; 30 / 1 / 7 days | purge of completed idempotency rows, abandoned reservations and expired guest sessions; orders and audit rows are never purged |
| `RateLimits:AuthPermitLimit` | no | 10 | sign-in, registration, password-reset and guest-session requests per minute per client address |
| `RateLimits:CheckoutPermitLimit` | no | 5 | order placements per minute per signed-in user (per address for guests) |
| `Email:Smtp:Host` / `Port` / `Security` | no | `smtp.gmail.com` / `587` / `StartTls` | the SMTP server that sends the password-reset email; `Security` is `StartTls`, `SslOnConnect` or `None` (`None` only for a local mail catcher such as smtp4dev or Papercut) |
| `Email:Smtp:UserName` / `Password` | no | — | secret; the Gmail address and its App Password (spaces in the 16 characters Google displays are ignored for gmail.com hosts). Without credentials the reset request answers 503 `EmailUnavailable`; both may be empty only with `Security` `None` |
| `Email:FromAddress` / `FromName` | no | `Email:Smtp:UserName` / `Luma Beauty` | sender of the email; Gmail only sends as the account itself or a verified alias |
| `PasswordReset:LinkBaseUrl` | no | — | the storefront's public address used in the emailed link, e.g. `https://shop.example.com`; must be an absolute `https` address (the host refuses to start outside Development when it is set to anything else). Without it the reset request answers 503 `EmailUnavailable` |
| `PasswordReset:TokenLifetimeMinutes` | no | 60 | how long an emailed reset link stays valid (held between 5 and 1440); a link works once |
| `Hosting:RedirectToHttps` / `HttpsPort` / `HstsMaxAgeDays` | no | true / auto / 30 | HTTPS redirection and HSTS; health endpoints are exempt |
| `ForwardedHeaders:Enabled` / `KnownProxies` | no | false / none | only when a proxy terminates TLS in front of the site: trusts `X-Forwarded-*` from the listed addresses and nothing else |
| `Security:ContentSecurityPolicy` | no | built-in policy | replaces the default policy (see section 10) |
| `OpenApi:Enabled` | no | false | serves `/openapi/v1.json` and `/swagger`; keep off in production |
| `DemoSeed:Enabled` | must be false | false | demo accounts exist only in Development; the host refuses to start with it on |
| `Cors:AllowedOrigins` | no | none | only for a storefront hosted apart from the API (section 1); not needed when one host serves everything |
| `Scraper:UserAgent` | no | `LumaBeautyPriceCheck/1.0 (price comparison for this shop)` | what plain requests call themselves; some shops turn unknown agents away |
| `Scraper:TimeoutSeconds` / `MaxPageKilobytes` | no | 20 / 4096 | time allowed for a plain request, redirects included (5–120), and the largest page read, measured after decompression (256–16384) |
| `Scraper:Browser:Enabled` | no | true | whether a real browser may read a page when a plain request found no price; it is used only when Chrome or Edge is installed |
| `Scraper:Browser:ExecutablePath` | no | found automatically | full path of `chrome.exe` or `msedge.exe` (looked for under `Program Files`, `Program Files (x86)` and the account's local app data); a path that does not exist turns the browser off instead of falling back to another one |
| `Scraper:Browser:TimeoutSeconds` | no | 45 | time allowed for one page in the browser, start-up included (10–180) |
| `Scraper:Browser:NoSandbox` | no | false | starts the browser without its sandbox; only for a host where it cannot start otherwise (some service accounts), because it opens untrusted pages |
| `Scraper:Browser:UserAgent` | no | the browser's own, minus "Headless" | what the browser calls itself; headless Chrome's default is turned away by some shops |

**Startup validation.** Outside Development the host refuses to start and prints **every** problem at once: no
connection string, a signing key shorter than 32 characters, a relative path or a path inside the application folder
for the key ring or the file storage (`FileStorage:RootPath`), `AllowedHosts` of `*`, or demo accounts enabled. Read the pool's stdout log or the Event
Viewer for the message.

**Moving the files later is one setting.** The database records hold no path (only each file's kind and generated name). Stop the site, move the two folders (`images` and `documents`) to the new location, set `FileStorage:RootPath` to it (`FileStorage__RootPath` as an environment variable), give the pool identity modify rights there and start the site. No data changes.

### Upgrading from `Uploads:RootPath`

The settings `Uploads:RootPath` and `Uploads:PublicBasePath` no longer exist (neither did the never-implemented `Uploads:MaxBytes` and `Uploads:AllowedContentTypes`); `FileStorage` replaces the whole section, and `POST /api/v1/admin/images` is replaced by `POST /api/v1/files/images`. For an existing deployment: set `FileStorage:RootPath`, copy the contents of the old `Uploads:RootPath` folder into `<FileStorage:RootPath>\images` and remove the `Uploads` section. Existing `/media/<name>` addresses keep working unchanged; the old files have no row in `document.StoredFiles` and are simply served as before. Until `FileStorage:RootPath` is set, the production host refuses to start with a message that names it.

**Rate limits behind a proxy.** The auth limiter counts per client address. With IIS in-process hosting the address is
the client's. Behind a reverse proxy or load balancer, enable `ForwardedHeaders` and list the proxy; otherwise every
visitor shares the proxy's address and one burst locks everyone out.

### Email (Gmail) for password reset

Only the "forgot password" feature sends email. The production host starts without any of these settings; until the
credentials, a sender address and `PasswordReset:LinkBaseUrl` are all set, `POST /api/v1/auth/forgot-password` answers
503 `EmailUnavailable` ("Password reset by email is not available right now. Please contact the store.").

1. In the Google account that will send the mail, turn on 2-Step Verification, then create an App Password at
   https://myaccount.google.com/apppasswords. The account's normal password does not work over SMTP. A Google Workspace
   administrator may have disabled app passwords for the domain.
2. Set the values as application-pool environment variables (section 5, step 4); the password is a secret, so keep it
   out of `appsettings.Production.json`:

   ```powershell
   Set-PoolVariable 'Email__Smtp__UserName'          'shop@gmail.com'
   Set-PoolVariable 'Email__Smtp__Password'          '<16-character app password>'
   Set-PoolVariable 'PasswordReset__LinkBaseUrl'     'https://shop.example.com'
   ```

   `Email:Smtp:Host`, `Port` and `Security` already default to Gmail (`smtp.gmail.com`, 587, `StartTls`). `Email:FromAddress`
   defaults to the Gmail address; set it only to a verified alias of that account.
3. `PasswordReset:LinkBaseUrl` must be an absolute `https` address: it is the origin of the link in the email, and the
   host refuses to start in Production or Staging when the value is set but is not one.
4. Recycle the pool, then verify: request a reset for a test account on the storefront and expect the email within a
   minute. A 503 `EmailUnavailable` means the feature is not configured (a setting from step 2 is missing). A log entry
   "Sending an email failed" means the SMTP server rejected the message or could not be reached (wrong App Password,
   2-Step Verification off, a `FromAddress` Gmail does not accept).

Limits and behaviour: consumer Gmail allows about 500 recipients per day (Google Workspace about 2,000). At most one
reset email per account per 60 seconds is sent; a repeat inside the window is ignored with the same 204 answer. The
email is sent from an in-memory queue, so a pool recycle can drop a message that was queued but not yet sent; the
customer requests the link again after 60 seconds. The emailed link is valid for `PasswordReset:TokenLifetimeMinutes`
and works once; a successful reset ends every session of that account.

## 7. Releasing an update

1. Build and verify the package (`Build-Release.ps1` stops at the first failing gate) and rehearse it if the release changes the schema (`Rehearse-Release.ps1`).
2. **Back up the database** (section 9) — schema changes are forward-only.
3. Put up `app_offline.htm`; apply `LumaBeauty.sql` in the deployment window (section 5, step 3: idempotent, applies only what is new);
   copy the new `app\` with robocopy (step 5); remove `app_offline.htm`.
4. `/health/ready` must be Healthy and report the new version; run the smoke list.

**Rollback.** Re-deploy the previous package's `app\` folder. The previous version runs against the newer schema when
every new migration is additive (add a column or table, never remove one); the release notes must say if one is not.
If a migration must be undone, restore the pre-release backup (section 9): everything written since the backup is lost,
so decide quickly. Keep the previous release folder and its package for at least two releases.

## 8. Operations

**Health.** `GET /health/live` (the process is up; use it for load-balancer probes) and `GET /health/ready` (database
reachable, collation and migrations current, the images and documents folders writable; use it for monitoring and release gates). Both
return the release version. Neither exposes exception text.

**Logs.** There are three sources, and no single durable application log is bundled (open decision, DECISIONS §17):

| Source | Where | Notes |
|---|---|---|
| IIS request log | `%SystemDrive%\inetpub\logs\LogFiles\W3SVC<site id>` | status, URL, time taken for every request |
| Application log | the Windows Application event log (warnings and errors) and the console | the ASP.NET Core Module discards console output unless `stdoutLogEnabled="true"` is set on the `<aspNetCore>` element of `web.config` with `stdoutLogFile` pointing at an existing, writable folder (set it temporarily; it is not rotated) |
| Failed commands | not logged (the EF command category is limited to `Critical`) | a unique-key conflict on the idempotency table is normal control flow; real failures are logged once with their exception by the exception handler |

Every error response and every log entry for a request carries a `traceId`: ask the customer or the admin for the
`traceId` shown with an error and search for it. Choose and install a durable sink (a file sink, Seq, Application
Insights) before go-live if you need retention beyond the event log.

**What an error means.**

| Symptom | Likely cause | Action |
|---|---|---|
| 502.5 / process failure on start | invalid settings (the message lists them), missing Hosting Bundle, pool identity cannot read the app folder | enable stdout logging, read the message, fix the setting |
| `/health/ready` 503 "database" | SQL Server unreachable or the pool identity has no login | check the connection string; rerun `grant-runtime-access.sql` |
| 503 "schema ... migration(s) behind" | the release's schema script was not applied | apply `LumaBeauty.sql` as the deployment identity |
| 503 "schema ... collation" | the database was created without `provision.sql` | create a new database with `provision.sql`, apply the schema and move the data across (the collation of a database that already holds data cannot be changed in place) |
| 503 "uploads" | the images or the documents folder is missing, or the pool identity cannot write to it | fix the folder (`<FileStorage:RootPath>\images` and `\documents`) and its ACL |
| API 503 `OutcomeUnknown` | the database connection dropped while an order or stock change was being committed | the change was **not** repeated; reload and check, or retry the checkout with the same key (it replays) |
| API 429 | a rate limit was hit | see section 6; raise the limit only after checking the traffic |
| everyone signed out after a deploy | the key ring was lost or the keys path changed | restore the keys folder; see section 9 |
| quotes keep expiring | the signing key differs between servers or changed | use the same `Quotes__SigningKey` everywhere |
| API 503 `EmailUnavailable` on "forgot password" | SMTP credentials, the sender address or `PasswordReset:LinkBaseUrl` is not set | set them (section 6, "Email (Gmail) for password reset") and recycle the pool |
| reset email never arrives (the request answered 204); log "Sending an email failed" | Gmail rejected the login (wrong or revoked App Password, 2-Step Verification off) or the sender is not the account or a verified alias; or the message was queued when the pool recycled; or the 60-second per-account window, the daily Gmail limit or the spam folder | read the log entry for the SMTP reason, fix the setting, and request the link again after 60 seconds |
| price scraper: "No price was found" for a shop that needs a browser; log "Price scraper: no Chrome or Edge was found" or "The browser at … could not be started" | no browser installed, a wrong `Scraper:Browser:ExecutablePath`, or Chrome cannot start under the pool identity | install Chrome or Edge or set the path; if it cannot start under the pool identity, give the identity a profile it can write, or set `Scraper:Browser:NoSandbox` to true (section 10); `Scraper:Browser:Enabled` false keeps plain requests only. The browser engine was verified on a developer machine, not under an IIS pool identity |
| price scraper: "The shop refused the check", or "No price was found" for a shop behind bot protection (Cloudflare and similar) | the shop turns automated visitors away | open the page yourself; nothing here bypasses bot protection |

**Retention and growth.** Completed idempotency rows, abandoned reservations and expired guest sessions are purged in
batches every `Retention:IntervalMinutes`. Orders, status history, inventory audit, coupon redemptions and price-scraper
readings (one small row per check) grow without bound by design; plan database and backup capacity for them.

**Price scraper.** Every check logs one Information line per engine: the host (never the full address), the engine, the outcome
and the milliseconds. The browser engine keeps a throwaway profile for each page in a `luma-price-scraper` folder under the temp
folder of the pool identity and deletes it afterwards; a folder left behind by a killed process can be deleted by hand.

**Rotating secrets.** Changing `Quotes__SigningKey` only invalidates quotes in flight (at most
`Pricing:QuoteLifetimeMinutes`): customers get a fresh quote, nothing is lost. Never delete old data-protection keys:
the ring creates a new key about every 90 days and the old keys keep decrypting the cookies they signed.

To change the certificate that protects the ring, import the new certificate (the pool identity needs to read its
private key), set `DataProtection__CertificateThumbprint` to its thumbprint, recycle the pool, and **leave the old
certificate in the store**. A key is encrypted once, when it is created, so the current key stays encrypted with the old
certificate until the ring replaces it shortly before it expires; the old certificate is still needed to read it. Each
`key-*.xml` file records its `expirationDate`. Remove the old certificate only when every key encrypted with it has
expired and seven days (the sign-in cookie lifetime) have passed: about 100 days after the switch at the latest.

Removing the old certificate too early signs everybody out and loses nothing else. This was rehearsed on the release
package: after the switch the existing key was still encrypted with the old certificate and the old sign-in cookie kept
working; once the old certificate was removed that key could not be read, the old cookie got 401, a new key encrypted
with the new certificate was created, and signing in again worked.

## 9. Backups and restore

What must be backed up, together, because the database refers to the files:

| Item | How | Frequency |
|---|---|---|
| Database | `BACKUP DATABASE [LumaBeauty] TO DISK = N'D:\LumaBeauty\backups\LumaBeauty_full.bak' WITH COMPRESSION, CHECKSUM, INIT;` then `RESTORE VERIFYONLY FROM DISK = ... WITH CHECKSUM;`. With `RecoveryModel=FULL` add `BACKUP LOG [LumaBeauty] TO DISK = ...` every 15 minutes | full: nightly; log: 15 min |
| Uploaded files (images and documents) | `robocopy D:\LumaBeauty\data\storage <backup share>\storage /MIR /R:2 /W:5` (the whole storage folder: `images` and `documents`) **after** the database backup (a restored database may then reference fewer files than exist, never more) | with the database |
| Key ring and its certificate | copy `D:\LumaBeauty\data\keys`; export every certificate that still encrypts a key in that folder (see "Rotating secrets") with its private key to your password vault. A key ring protected by machine DPAPI **cannot be read on another machine**, which is why production should use `DataProtection:CertificateThumbprint` | after any change |
| Configuration | `appsettings.Production.json`, the pool's environment variables (`appcmd list apppool "<name>" /config /xml`) and the secrets, kept in the vault | after any change |

SQL Server writes the `.bak` file itself, so its **service account** needs Modify on the backup folder. Find it with
`SELECT service_account FROM sys.dm_server_services WHERE servicename LIKE 'SQL Server (%'`; for a default instance
`icacls D:\LumaBeauty\backups /grant "NT SERVICE\MSSQLSERVER:(OI)(CI)M"`. Without it the backup stops with "Operating
system error 5 (Access is denied)". When SQL Server runs on another machine, back up to a folder on that machine or to a
share its service account can write, not to this web server's disk.

Copy every backup off the server. Test a restore before you need it.

**Restore procedure** (onto the same or a replacement server):

1. Prepare the server as in section 5 steps 1–2 (folders, ACLs, pool, site), then stop the site.
2. Restore the database:
   `RESTORE DATABASE [LumaBeauty] FROM DISK = N'<file>.bak' WITH REPLACE, RECOVERY;` (for point-in-time recovery restore the
   full backup `WITH NORECOVERY`, then the log backups, the last `WITH STOPAT = '<time>', RECOVERY`). The collation travels with
   the backup; do not run `provision.sql`.
3. Re-link the permissions: run `grant-runtime-access.sql` and `grant-deploy-access.sql` again (users in the database may be orphaned
   from logins on a new server), then `verify-runtime-permissions.sql`.
4. Restore the whole storage folder (`images` and `documents`; set `FileStorage:RootPath` to where it now lives) and the key ring (with its certificate in the machine store for the pool identity).
5. Deploy the application files of the version that matches the restored schema (step 5), restore the settings, start the site.
6. `/health/ready` Healthy; compare row counts with the source if you have them
   (`SELECT COUNT(*) FROM Orders`, `Products`, `ProductVariants`), open a recent order and an image.

`Rehearse-Release.ps1 -Action RestoreRehearsal` performs this procedure end to end against a disposable copy (a scratch restore compared
table by table, then a simulated disaster with the database, uploaded files and key ring destroyed and restored); the release candidate's run
is recorded in the repository's `docs/backend/RELEASE_CHECKLIST.md`.

## 10. Security notes

- **Transport.** HTTPS only: HTTP is redirected, HSTS is sent (`Hosting:HstsMaxAgeDays`, 30 by default; raise it once HTTPS
  is proven), cookies are `Secure`, `HttpOnly`, `SameSite=Lax`.
- **Browser policy.** Every response carries `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy` and a Content-Security-Policy that allows the storefront's own scripts, its Google Fonts and images from any
  HTTPS host (administrators paste image URLs). Tighten `img-src` through `Security:ContentSecurityPolicy` if images come from
  known hosts only.
- **Requests.** Every unsafe API call needs the antiforgery header; sign-in and checkout are rate-limited; request bodies
  are capped at 10 MB (IIS enforces the same limit); an uploaded image is capped at 5 MB and a document at 8 MB (limits of the code, not settings), with the file type decided by its content. Documents are never public: only an administrator can download one.
- **Sessions.** The security stamp is checked on every request and rotated at logout, so a copied cookie stops working
  and signing out ends the account's sessions everywhere.
- **Data.** Prices, totals and stock are decided by the server; the browser's numbers are never trusted. Orders keep a
  snapshot of what was bought. Referenced products and coupons are archived, never deleted.
- **Administration pages.** Every page except sign-in needs the `admin` role (a customer is sent to an access-denied page and
  cannot sign in there), every state change is a POST with the antiforgery token, and the pages run under the same
  Content-Security-Policy (no inline script). Responses below `/admin` are never cached by browsers or proxies, errors show a
  reference instead of internals, and CSV exports neutralise cells a spreadsheet would run as a formula.
- **Price scraper.** The server fetches addresses administrators type, so it refuses anything that is not a public web address on
  port 80 or 443, connects only to addresses it checked itself, follows at most 5 redirects, reads at most `Scraper:MaxPageKilobytes`
  of HTML and never runs a page itself. The browser engine runs the other shop's scripts in a throwaway profile with every request
  vetted (`DECISIONS.md` D-ADMIN-16). A price changes only when an administrator applies a reading. One residual risk is recorded
  there: the browser resolves names again by itself; if the pool must not reach internal systems, deny it that on the network as
  well, or set `Scraper:Browser:Enabled` to false. `Scraper:Browser:NoSandbox` weakens the browser's containment; leave it off
  unless the browser cannot start without it.
- **Least privilege.** The pool identity cannot change the schema; the deployment identity is not used by the site; the
  package carries no secret and no development account.

## 11. Open decisions and unavailable integrations

Not decided or not available, and therefore not built (the full list with owners is in `DECISIONS.md` section 17):

- the production SQL Server edition and server, the host name and certificate;
- a durable log sink, monitoring and alerting;
- online payment, tax, e-mail receipts and order recovery by e-mail, customer profile editing, supplier and purchasing screens;
- per-device sign-out (sign-out currently ends every session of the account);
- object storage or a CDN for uploaded files (images and documents are local files).
