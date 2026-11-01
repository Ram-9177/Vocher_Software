// Runs in front of every request (static files and /api).
//
// The Pages build output directory is the repository root (wrangler.toml:
// pages_build_output_dir = "."), so without this guard every file in the repo
// - tests, internal docs, wrangler config, function source - is downloadable.
// We block anything that is not part of the browser app and add security
// headers to every response.

const BLOCKED_PREFIXES = ['/tests/', '/functions/', '/scratch/', '/.git', '/.wrangler', '/node_modules/', '/.dev.vars', '/.env'];
const BLOCKED_EXACT = ['/wrangler.toml', '/wrangler.json', '/wrangler.jsonc', '/package.json', '/package-lock.json', '/.gitignore'];
const BLOCKED_EXTENSIONS = ['.md', '.cjs', '.mjs', '.toml', '.log', '.env', '.sql', '.sqlite', '.db', '.bak', '.map'];

// Low-risk directives are enforced. The stricter script/connect policy is sent
// as Report-Only first: check the browser console for violations across the
// whole app (printing, QZ Tray, Excel export), then move it to the enforced
// header.
const CSP_ENFORCED = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.qz.io",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' wss://localhost:* ws://localhost:*",
  "frame-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'"
].join('; ');

function isBlocked(pathname) {
  let p;
  try { p = decodeURIComponent(pathname).toLowerCase(); } catch (e) { return true; }
  if (p.includes('..') || p.includes('\\')) return true;
  if (BLOCKED_EXACT.includes(p)) return true;
  if (BLOCKED_PREFIXES.some(function (prefix) { return p.startsWith(prefix); })) return true;
  if (p.startsWith('/api/')) return false;
  return BLOCKED_EXTENSIONS.some(function (ext) { return p.endsWith(ext); });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (isBlocked(url.pathname)) {
    return withSecurityHeaders(new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
  }
  const response = await context.next();
  return withSecurityHeaders(response);
}

function withSecurityHeaders(response) {
  const res = new Response(response.body, response);
  const h = res.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'SAMEORIGIN');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  h.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (!h.has('Content-Security-Policy')) h.set('Content-Security-Policy', CSP_ENFORCED);
  if (!h.has('Content-Security-Policy-Report-Only')) h.set('Content-Security-Policy-Report-Only', CSP_REPORT_ONLY);
  return res;
}
