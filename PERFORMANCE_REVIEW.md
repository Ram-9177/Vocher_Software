# Loading and navigation review — 29 October 2026

## Fixed causes

- `app.js`: fetch the five modules together while preserving execution order; initialize after readiness once. Defer SheetJS so it does not block HTML parsing.
- `live-save-override.js`: remove the second user-module injection and duplicate account-head/vendor refreshes.
- `app.old.js`: use linear phone deduplication, skip unchanged suggestion writes, cache parsed auth data, and avoid rendering both dashboards during startup.
- `vendor.js`, `admin1-users.js`: render each vendor screen once, reuse scoped vendor data, skip unchanged/hidden refreshes and permission-style writes, and index vouchers once per financial render.
- `live-adapter.js`: refresh the visible screen, use the vendors already returned by sync, and reject stale session/college responses.
- College switching now updates the shared voucher list before vendor calculations. Vendor counts update without rebuilding a dashboard.
- Both APIs skip completed schema setup for an initialized database binding. Failed migrations retry; fresh databases receive the voucher `block` column immediately.
- User Management called a missing `listAudit` function and returned HTTP 500. Its existing authorized action now returns the audit rows.

## Measurements

Isolated, same-machine JavaScript calculations; excludes browser layout and network time:

| Workload | Before | After |
| --- | ---: | ---: |
| Phone suggestions, 25,000 unique numbers | ~680 ms | ~7 ms |
| Financials, 300 vendors / 10,000 vouchers | ~1,892 ms | ~12 ms |

Warm requests on an initialized binding avoid 24 voucher schema queries and 6 college schema queries. A new runtime/binding initializes again.

## Verification

Run with Node.js 24 or newer, including its built-in SQLite support:

```sh
node --test tests/*.cjs
```

- 25 checks pass, including real in-memory SQLite API smoke checks, migration retries, startup ordering, financial equivalence, unchanged refreshes, and college/session changes.
- All application JavaScript syntax checks and `git diff --check` pass.
- Chromium checked login, dashboard, analytics, vouchers, vendor form, new voucher, vendor ledger, User Management/audit loading, session restoration, and college switching using 20,000 generated vouchers and 200 vendors across two colleges.
- Browser inspection confirms one user-module script and parallel module requests. Existing database files and production were not modified.

## Remaining limits

These changes address the traced loading/navigation bottlenecks; they do not certify the entire product as production-ready. Live Cloudflare latency, slow networks/devices, physical printing, and linked-file permissions were not tested. Filtered tables still render all matching rows, so unusually broad date ranges can remain expensive. SheetJS and web fonts still depend on external CDNs.
