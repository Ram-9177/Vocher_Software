# St. Mary's Voucher System

Secure static + serverless voucher system for St. Mary's institutions.

## Live free/low-cost stack

- Frontend: Cloudflare Pages
- Backend: Cloudflare Pages Functions
- Database: Cloudflare D1 SQLite
- Cost: starts free for small office usage

## Main features

- Admin + User role matrix
- Live sync polling
- Admin user management
- Block/unblock users
- Admin password reset
- Soft delete vouchers
- Audit logs
- Debit / On Account / Credit voucher flow
- Full filters with Apply button
- Ledger grouped by all heads or selected head
- Grand total based on filtered data
- Date-based cash book download
- Excel exports
- Amounts shown without decimals everywhere
- Account head add-with-confirmation and sync

## First-time setup

1. Create Cloudflare Pages project from this GitHub repo.
2. Create a Cloudflare D1 database.
3. Add D1 binding named `DB`.
4. Add environment variable `SMV_SETUP_KEY` with a long random value.
5. Deploy.
6. Open the site, click **First-time Admin Setup**.
7. Enter the setup key and create the `admin` password.
8. Login as `admin`.
9. Create `user2` and `user3` from User Management.

## Security notes

- Public signup is removed.
- Passwords are hashed server-side using PBKDF2 + salt.
- Sessions are server-generated tokens with expiry.
- Users cannot edit/delete vouchers.
- Admin actions are recorded in audit logs.
- Delete is soft-delete, not permanent delete.

## Local development

For UI-only preview, use Live Server. API features need Cloudflare Pages Functions + D1.

```bash
npx wrangler pages dev . --d1 DB=<your-d1-binding>
```

Use `wrangler.toml.example` as a reference.
