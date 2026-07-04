# Deployment Guide - Free/Low Cost

## Recommended: Cloudflare Pages + D1

This project is designed to run on Cloudflare's free/low-cost stack.

### Steps

1. Push this repo to GitHub.
2. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect GitHub.
3. Select this repo.
4. Build command: leave empty.
5. Build output directory: `/` or `.`.
6. Create D1 database:
   - Workers & Pages → D1 → Create database
   - Name: `st-marys-vouchers`
7. Go to Pages project → Settings → Functions → D1 database bindings.
8. Add binding:
   - Variable name: `DB`
   - Database: `st-marys-vouchers`
9. Go to Settings → Environment variables.
10. Add:
   - `SMV_SETUP_KEY` = long random secret key
11. Redeploy.
12. Open website → First-time Admin Setup.
13. Create admin password.

### Suggested first users

- admin = full access
- user2 = create/view/print own vouchers
- user3 = create/view/print own vouchers

### Important

Do not expose `SMV_SETUP_KEY` publicly. Use it once, then keep it safe.
