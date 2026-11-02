# Luma Beauty — release checklist, 1.0.0-rc.1

Evidence for the release candidate, recorded as **passed**, **failed** or **blocked**. A check that did not run is blocked,
never passed. Nothing here is a deployment: a live rollout is a separate, authorised action.

| | |
|---|---|
| Package | `LumaBeauty-1.0.0-rc.1.zip` (163 files) |
| SHA-256 | `a3fb79e090b6b988c331b9fd7e2b0a0caff9604909c0784f2492221f908a0172` |
| Built | 2026-11-01T20:49:43.1874346Z by `backend/scripts/Build-Release.ps1 -Version 1.0.0-rc.1` on .NET SDK 10.0.301, Node v24.11.1 |
| Rebuilds | the candidate was rebuilt twice for documentation faults found while checking the guide. First build (SHA-256 `d41dc9ca539eecabdd5ce6b8afdc337b1ac3dc57245358615c485cfeb625d849`): `DEPLOYMENT.md` gave the folder permissions to the pool identity before the pool exists. Second (`ce69f1efadd50eedab015a41d666f1e04927ed2ed4bf24cd9942b01b0388e57d`): its administrator command, run as written, left a trailing space in every value so the host refused to start, and its one-shot `runas` commands close their window together with their output (section 6). Each rebuild differs from the one before only in `docs/DEPLOYMENT.md` and the manifest: the other 162 files are byte-identical, so the build is reproducible. Every result below was obtained on the final build, except 3.10, which ran on the first |
| Source checkpoint | no version-control repository exists; the source tree without dependencies and build output is archived in `D:\Programming\luma-beauty_backups\2026-11-01_rc1-source\luma-beauty-source.tar.gz`. Its SHA-256 is in `SHA256SUMS.txt` beside it: the archive contains this file, so the hash cannot be written here |
| Machine | Windows 10 x64, SQL Server 2022 Developer 16.0.1000.6 (Windows authentication only), Chrome headless |
| Results | **passed:** 41 · **failed:** 0 · **blocked:** 8 |

## 1. Build and package

| # | Check | Result | Evidence |
|---|---|---|---|
| 1.1 | Frontend gates (`npm run lint`, `npm test`, `npm run build`) | passed | the build script runs them first and stops on a failure; `npm test` 8 of 8 |
| 1.2 | Backend unit and SQL Server integration tests | passed | 70 and 450 passed, 0 failed (output of the build script) |
| 1.3 | Integration suite limited to the runtime grant | passed | `LUMA_TEST_RUNTIME_GRANT=true`: 450 passed |
| 1.4 | Committed schema script equals what the migrations generate | passed | `Update-SchemaScript.ps1 -Check`: "backend\db\LumaBeauty.sql is current." |
| 1.5 | Publish without sample data or Development settings | passed | `IncludeDevSeed=false`; `appsettings.Development.json` absent; no `dev-catalog`/`dev-orders` resource in either assembly |
| 1.6 | Package inspected for secrets, local addresses, development content | passed | "Package inspection passed." Negative control: with a connection string and a password planted in `appsettings.json` the script failed with two problems and produced no archive |
| 1.7 | Packaged settings carry no connection string and no secret | passed | `appsettings.json` has `ConnectionStrings:Default` empty; the inspection checks it |
| 1.8 | Lockfile installs cleanly | passed | `npm ci` in a scratch folder: 86 packages |
| 1.9 | Manifest and archive hash | passed | `release-manifest.json` lists every file with its SHA-256; the archive hash is above and verified again when the rehearsal unpacks it |

## 2. Database (isolated staging database, documented commands)

| # | Check | Result | Evidence |
|---|---|---|---|
| 2.1 | `provision.sql`: Arabic_100_CI_AI, FULL recovery; refuses an existing database with another collation; harmless when repeated | passed | rehearsal "Up"; `DeploymentScriptTests.Provisioning_refuses_…` |
| 2.2 | `grant-deploy-access.sql`, schema applied **as the deployment role**, `grant-runtime-access.sql`, `verify-runtime-permissions.sql` | passed | `DeploymentScriptTests.The_provisioning_and_grant_scripts_give_each_identity_exactly_its_role`; rehearsal "Up": every probe behaved as expected (7 allowed, 6 denied) |
| 2.3 | `LumaBeauty.sql` applied with plain `sqlcmd` from an empty database, then again | passed | rehearsal "Up": both runs exit 0; `DeploymentScriptTests` shows the result equals the migrations |
| 2.4 | Catalog import and independent reconciliation with the packaged tool | passed | RESULT: PASS (11 checks, 0 differences) |
| 2.5 | `--setup-admin` creates the administrator and never prints the password | passed | rehearsal "Up": "Administrator account created…"; the script fails if the password appears in the output |
| 2.6 | Collation guard in `/health/ready` | passed | `ProductionHostingTests.Ready_refuses_a_database_created_with_the_wrong_collation` |

## 3. Startup, topology and restart (packaged application, Staging, HTTPS)

| # | Check | Result | Evidence |
|---|---|---|---|
| 3.1 | Starts in Staging with only the documented settings; `/health/ready` Healthy with the release version | passed | /health/ready Healthy, version 1.0.0-rc.1: database=Healthy, schema=Healthy, uploads=Healthy |
| 3.2 | HTTP is redirected to HTTPS, except the health probes | passed | `http://…/api/v1/products` answered 307 to `https://…`; `/health/live` answered 200 over HTTP |
| 3.3 | Security headers and Content-Security-Policy on responses | passed | `nosniff`, `DENY`, referrer and permissions policies and the policy string observed; the browser suite (below) fails on any console error, so no CSP violation occurred |
| 3.4 | `Cache-Control: no-store` on API and health; JSON 404 under `/api`; storefront fallback; missing files 404; Swagger and OpenAPI hidden | passed | observed on the staging copy: no-store, `application/problem+json` NotFound, client route 200 `text/html` with `no-cache`, missing asset and missing upload 404, `/openapi/v1.json` 404, `/swagger/index.html` 404 |
| 3.5 | HSTS on an HTTPS request | passed | `ProductionHostingTests.Https_requests_get_hsts_…` (ASP.NET deliberately omits HSTS for `localhost`, so it is not visible on the staging copy) |
| 3.6 | Key ring persisted and protected by a certificate | passed | `DataProtection:CertificateThumbprint` set in the rehearsal; the key ring survives restart and restore (checks 3.8, 5.3); `ProductionHostingTests` checks the encrypted key file for the machine-DPAPI default |
| 3.7 | Rate limits: refusal is a 429 problem document with `Retry-After`, only on the limited endpoints | passed | `ProductionHostingTests.Sign_in_attempts_are_limited_per_client_address_…` (limit 3: 401, 401, 401, 429, 429) |
| 3.8 | Restart | passed | ready again: Healthy, version 1.0.0-rc.1; the browser suite ran before it and the restore rehearsal's first step (after it) found the data and an uploaded image intact |
| 3.9 | Startup refuses unsafe settings and names every one | passed | `ProductionHostingTests.Startup_refuses_unsafe_settings_and_names_every_one`; `ProductionConfigurationTests` |
| 3.10 | Key-ring certificate rotation: the old certificate keeps old cookies valid until it is removed | passed | observed by hand on a staging copy (first build): with the new certificate configured and the old one still in the store, the existing key stayed encrypted with the old certificate and the old sign-in cookie kept working; after the old certificate was removed the old cookie got 401, a new key encrypted with the new certificate was created and a fresh sign-in worked. The procedure is in `DEPLOYMENT.md` "Rotating secrets" |

## 4. Smoke through the deployed topology (the whole browser suite against the packaged HTTPS copy)

| # | Check | Result | Evidence |
|---|---|---|---|
| 4.1 | Storefront in English and Arabic, search, filters, sorts, paging, product modal | passed | 148 of 149 passed, 0 failed, 1 skipped by design (it scans a local build output that an attached run does not have) |
| 4.2 | Guest and customer checkout, confirmation, reload, access for the owner only | passed | `storefront-checkout`, `storefront-lost-response`, `customer-account`, `customer-switching` in the same run |
| 4.3 | Administrator: products and uploads, stock, coupons, banners, fulfilment, **cash collection** | passed | `admin-products`, `admin-inventory`, `admin-promotions`, `admin-orders`, `admin-dashboard` in the same run |
| 4.4 | Accessibility, RTL and the empty/loading/error/offline states | passed | `storefront-layout-a11y`, `storefront-states`, `admin-layout` in the same run |

## 5. Backup and recovery (rehearsed on the staging copy)

| # | Check | Result | Evidence |
|---|---|---|---|
| 5.1 | Full and log backup written and verified (`CHECKSUM`, `RESTORE VERIFYONLY`) | passed | full backup written and verified; log backup written |
| 5.2 | Restore under another name equals the source, table by table | passed | 24 tables: row counts and row checksums identical |
| 5.3 | Disaster drill: database dropped, uploads and key ring emptied, all restored | passed | the old sign-in cookie still authenticates (key ring and accounts restored consistently); 48 orders and 117 products, as before; every table identical to the fingerprint taken before the disaster; /media/264c4126f72e406da73e49608a1a7231.png served byte for byte |
| 5.4 | Permissions after a restore | passed | grants re-applied and `verify-runtime-permissions.sql` passed after the restore |
| 5.5 | Teardown removes everything the rehearsal created | passed | dropped login NT AUTHORITY\LOCAL SERVICE; databases, certificate and working folder removed; no `LumaBeauty_Test_*`, `LumaBeauty_E2E_*` or staging database or created login remains |

## 6. The guide's own commands, executed where IIS is not needed

`DEPLOYMENT.md` is only useful if its commands work as written. Everything that can run without IIS or a second Windows account was executed from the guide's text, on scratch folders or on the rehearsal copy.

| # | Check | Result | Evidence |
|---|---|---|---|
| 6.1 | Every PowerShell block of the guide parses | passed | 14 blocks, 0 errors (the PowerShell parser) |
| 6.2 | The configuration reference matches the host | passed | all 24 keys of the table exist in the sources; its defaults equal the `GetValue` defaults in the code (compared by eye); the error texts the guide quotes exist |
| 6.3 | Folder grants (step 2, `icacls`) | passed | scratch folder with stand-in principals (no application pool exists here): inheritance removed; Administrators, SYSTEM and the application identity as intended |
| 6.4 | Signing-key snippet (step 4) | passed | 64 hexadecimal characters |
| 6.5 | Application files copied with `robocopy /MIR /XF …` (step 5) | passed | scratch folders: operator settings and `app_offline.htm` kept, binaries and `web.config` replaced, stale files purged, key and upload folders untouched; exit codes 3 and 2 both mean success (the guide now says so) |
| 6.6 | Administrator creation (step 6) | passed | the guide's earlier one-liner `cmd /c "set NAME=value && …"` **failed**: every value kept a trailing space and the host refused to start ("Invalid configuration for the 'Staging ' environment"). The same line with `set "NAME=value"` created the account (exit 0), a repeated run refused the existing e-mail (exit 1, nothing changed) and the password was not printed. The guide now gives the PowerShell form, which is what the rehearsal runs |
| 6.7 | Backup folder rights (section 9) | passed | `BACKUP DATABASE … TO DISK` into a folder without the SQL Server service account stops with "Operating system error 5 (Access is denied)"; after `icacls … /grant "NT SERVICE\MSSQLSERVER:(OI)(CI)M"` it succeeds (the guide now says so) |

## 7. Blocked: needs IIS or another machine

None of these could run here. Run them on a staging server by `DEPLOYMENT.md` and tick them there.

| # | Check | Result | Why |
|---|---|---|---|
| 7.1 | .NET Hosting Bundle installed; the site starts under the ASP.NET Core Module in-process | **blocked** | IIS and the Hosting Bundle are not installed on this machine |
| 7.2 | Application pool "No Managed Code", `AlwaysRunning`, identity `IIS APPPOOL\<name>` can read the app folder and write the key and upload folders | **blocked** | no IIS |
| 7.3 | HTTPS binding with the real certificate; `ASPNETCORE_HTTPS_PORT` detection for the redirect | **blocked** | no IIS; the redirect was verified under Kestrel with an explicit port |
| 7.4 | `app_offline.htm` taking a live IIS site offline while the files are copied | **blocked** | no IIS (the `robocopy` command itself is checked in 6.5) |
| 7.5 | The site runs as a different Windows identity with only the runtime role | **blocked** | no elevation to create a Windows user, and SQL authentication is disabled; the database side is proven by the whole suite under the runtime grant (1.3) |
| 7.6 | `runas /user:<deployment identity> powershell`, then the schema script, `--setup-admin` and the import in that window | **blocked** | same; the commands themselves ran under the current identity (6.6, 2.4) and the role is proven by applying the schema as that role under impersonation (2.2) |
| 7.7 | SQL Server on another machine reached through the web server's computer account | **blocked** | one machine |
| 7.8 | Application errors in the Windows event log under the pool identity; pool-environment-variable settings | **blocked** | no IIS |
| 7.9 | Production SQL Server edition, host name, certificate, log sink, monitoring | **open** | business and operations decisions (`DECISIONS.md` section 17) |

## 8. Known issues and residual risk

- Signing out ends every session of the account in every browser (D-P7-6).
- No password-reset path exists (no e-mail provider): a lost administrator password is handled by creating another administrator.
- No durable application log sink is bundled; the event log, console (when stdout logging is enabled) and IIS request logs are the sources.
- Uploaded images are local files outside the database and must be backed up with it.
- The failure suite simulates a lost COMMIT acknowledgement at the EF interceptor and cannot reproduce a real network partition on one machine (`TEST_EVIDENCE.md` section 2).
