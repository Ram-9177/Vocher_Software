# Security Audit — St. Mary's Voucher System

Date: 2026-11-01 · Scope: whole repository (Cloudflare Pages static app + Pages Functions on D1).
Branch: `claude/voucher-security-audit-9ry40q`

Legend: ✅ fixed in this branch · ☑️ already OK · ⚠️ needs an owner decision or manual action · N/A doesn't apply

| # | Check | Result |
|---|-------|--------|
| 1 | Secret API keys out of frontend | ☑️ None found in any JS/HTML |
| 2 | `.env` out of Git and public folders | ✅ Nothing committed, but **the whole repo was public** (see A1). `.gitignore` now covers `.env*`, `.dev.vars`, keys |
| 3 | Scan Git history | ☑️ All 53 commits scanned: no API keys, tokens or private keys. Only the hard-coded default password `Stmarys@1234` (see #4) |
| 4 | Rotate exposed keys | ⚠️ Rotate any account still using `Stmarys@1234`. Keep `ADMIN1_INITIAL_PASSWORD` as an *encrypted* Pages secret, never in `wrangler.toml` |
| 5 | Server-side permission checks on every request | ✅ Checked on every action. Gaps fixed: A3, A4, A6 |
| 6 | Never trust IDs/roles/prices from frontend | ✅ Role, college and permissions are re-checked on the server; voucher type change bypass fixed (A6); client-sent `createdAt` validated |
| 7 | Users can't access each other's data | ✅ Account heads and blocks leaked across colleges (A5); vendor PII now needs vendor-ledger permission. ⚠️ See D1–D3 |
| 8 | Lock down DB & private storage | ✅ D1 is only reachable through the Functions. Repo files, internal docs and tests no longer served (A1) |
| 9 | Protect admin actions when called directly | ✅ Privilege escalation fixes (A2, A3); CSRF origin check added |
| 10 | Test login, logout, password reset | ✅ Covered by `tests/api-smoke.cjs`. Sessions cut from **10 years** to 14 days (sliding). Password change now signs out other devices |
| 11 | Rate-limit login, signup, expensive calls | ✅ Added (A7) |
| 12 | Usage caps on AI budget | N/A No AI or paid APIs. Bulk vendor import capped at 500 rows, audit list at 2,000 rows |
| 13 | Server-side input validation | ✅ Dates, amounts (>0), file types, record size, password length (min 8) |
| 14 | Safe DB queries | ☑️ Every query uses bound parameters (`prepare().bind()`), no string-built SQL |
| 15 | User content can't run scripts | ✅ Stored XSS fixed in the frontend (see B). Security headers + CSP added |
| 16 | Restrict upload types/sizes | ✅ Server now allow-lists PDF/DOC/DOCX/PNG/JPEG, max 3 files, total under the D1 2MB row limit, stored MIME type forced to match the extension |
| 17 | Verify payments server-side | N/A No payment processing |
| 18 | Debug off; secrets out of errors/logs | ✅ Raw DB/runtime errors were sent to the browser; now logged server-side only and the user sees a generic message |
| 19 | Backups and tested restore | ⚠️ Manual, see "Backups" below |
| 20 | Test with two accounts, then logged out | ✅ Smoke test now creates two admins with different permissions, checks the takeover is blocked, and checks logged-out access gets 401 |

## A. Server fixes (`functions/`)

**A1 — Entire repository was publicly downloadable (High).** `wrangler.toml` sets `pages_build_output_dir = "."`, so `/tests/*`, `/README.md`, `/PERFORMANCE_REVIEW.md`, `/VENDOR_SYSTEM_COMPLETE_DOCUMENTATION.md`, `/wrangler.toml` and possibly function source were all served. New `functions/_middleware.js` returns 404 for these. It also adds `X-Content-Type-Options`, `X-Frame-Options`, HSTS, `Referrer-Policy`, `Permissions-Policy` and a CSP.
*Trade-off:* a root middleware runs on every request, static files included, and counts toward Functions request quotas. The cleaner long-term fix is to move the browser files into a `public/` folder and point `pages_build_output_dir` at it.

**A2 — Anyone with `create_users` could become a super admin (Critical).** Super admin status is decided by username (`admin`, `admin_stmw`, `admin_smhyd`, `baji`). `createUser` didn't reserve those names, so creating a user called `baji` (if it didn't already exist) gave full control. Those names, plus `superadmin` and `admin1`, are now reserved.

**A3 — Account takeover by lower-privileged admins (High).** An admin with only `reset_passwords` could reset the password of an admin with more power (e.g. `create_admin`, `manage_colleges`), then log in as them. The same applied to block, delete and edit permissions. Now an admin can only manage accounts whose permissions are a subset of their own. Managing other admins needs `create_admin`. Only a super admin or Head can assign the Head role.

**A4 — Pass-the-hash login (High).** For legacy accounts the server accepted a client-sent SHA-256 `passwordHash`, so a leaked hash worked as the password. Now only the plaintext password is accepted, and legacy hashes are upgraded to PBKDF2 on the next successful login. First-run bootstrap no longer accepts a client hash either.

**A5 — Cross-college data leaks (Medium).** `listHeads` and `listBlocks` returned every college's data. They are now scoped to the colleges the user can access. Vendor records (PAN, Aadhaar, bank details) now need `view_vendor_ledger`, `manage_vendors` or admin, in both `syncData` and `listVendors`.

**A6 — Voucher permission bypass (Medium).** A user without `edit_voucher` could edit an on-account voucher and change its type to debit or credit. The type is now locked unless the user has `edit_voucher`. Amounts must be positive and dates must be valid.

**A7 — No rate limiting (Medium).** New D1 table `rate_limits`:
- Login: 10 failures per username or 200 per IP in 15 minutes (high, because a campus shares one public IP), then HTTP 429.
- Bootstrap: 5 per hour.
- Password change: 10 per hour.
- Password reset: 30 per hour.
- Create user: 60 per hour.
- Bulk vendor import: 20 per hour.

Login now returns the same "Invalid username or password" whether or not the account exists, and does the same hashing work either way. Failed logins are written to the audit log.
*Also recommended:* a Cloudflare WAF rate-limit rule on `/api/*` as an outer layer.

**A8 — Other hardening:**
- Minimum password length is 8 and `Stmarys@1234` is refused.
- `createUser` no longer falls back to a default password.
- Origin check on every API call (CSRF defence on top of the `SameSite=Lax` cookie).
- Expired sessions are cleaned up on logout.
- The colleges API now treats `admin_smhyd` as a super admin, matching the voucher API. It also enforces the forced password change and validates the logo URL.

## B. Frontend XSS fixes
The frontend (`app.old.js`, `vendor.js`, `admin1-users.js`) put server data into `innerHTML` without escaping in many places. Values like voucher fields, vendor names, file names and head names are now HTML-escaped. Values placed inside `onclick` attributes are encoded for a JS-in-HTML context, and file preview URLs are checked against a safe-scheme allow-list. The admin "Create user" form also no longer defaults to `Stmarys@1234`.

## C. Recommended, not changed (needs an owner decision)
- **D1 — Every regular user can access SMGG and SMWEC.** `parseCollegeAccess` hard-codes `['smgg','smwec']` for `role === 'user'`, ignoring the user's assigned `college_access`. If campuses must be separated, delete that line.
- **D2 — `view_vendor_ledger` shows every voucher.** It's in the default permissions for regular users, and `listVouchers`/`syncData` treat it as "show all vouchers in the college". So by default every user sees everyone's vouchers.
- **D3 — On-account vouchers can be edited by any user in the college.** This looks intentional, but it means amounts on others' on-account vouchers can be changed (the audit log records it).
- **Changing your own password doesn't ask for the current one.** A stolen session can therefore lock the real owner out. Add a `currentPassword` field to the change-password forms and check it on the server.
- **The session token is also kept in `localStorage` and sent in the request body.** An HttpOnly cookie is already set, so moving fully to the cookie would mean XSS can't steal sessions.
- **Session tokens are stored in plaintext in D1.** Storing `SHA-256(token)` would make a DB leak useless for hijacking (this logs everyone out once).
- **Super admins are identified by hard-coded usernames.** A role flag in the DB would be safer.
- **Make the CSP enforcing.** It's currently Report-Only for `script-src`/`connect-src` so printing, QZ Tray and Excel can't break. Check the browser console for violations, then switch it to enforced.

## Backups (#19)
D1 has Time Travel (point-in-time restore: 30 days on the paid plan, 7 on free). Also take regular exports and test a restore into a scratch database:
```bash
npx wrangler d1 export st-marys-vouchers --remote --output=backup-$(date +%F).sql
npx wrangler d1 create st-marys-vouchers-restore-test
npx wrangler d1 execute st-marys-vouchers-restore-test --remote --file=backup-YYYY-MM-DD.sql
npx wrangler d1 time-travel info st-marys-vouchers
```
Keep backups out of this repo, because they contain PII.

## Tests
`node tests/api-smoke.cjs` (real SQLite) now also covers:
- reserved usernames
- the missing-password default
- the cross-account takeover
- cross-origin rejection
- identical login errors and the login lockout
- error-message hiding
- upload type filtering
