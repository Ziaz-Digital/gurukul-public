// npm run preview (after npm run bundle): a small local host that mounts YOUR
// project-bundle.zip exactly as Gurukul's master UI will (project-bundle.md,
// "How the host mounts a bundle"). Open the address it prints.
//
// It reads SHOP_API_BASE_URL and SHOP_KEY from the environment or from .env.local.
// Identical in every Gurukul template.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const port = Number(process.env.PORT || (pkg.gurukul.framework === 'angular' ? 4381 : 4382));

function envFile() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
  );
}
const env = { ...envFile(), ...process.env };
const apiBaseUrl = (env.SHOP_API_BASE_URL || '').replace(/\/+$/, '');
const key = env.SHOP_KEY || '';
if (!apiBaseUrl || !key) {
  console.error('preview: set SHOP_API_BASE_URL and SHOP_KEY in .env.local (see .env.example).');
  process.exit(1);
}

const zipPath = join(root, 'project-bundle.zip');
if (!existsSync(zipPath)) {
  console.error('preview: no project-bundle.zip yet. Run npm run bundle first.');
  process.exit(1);
}
const files = readZip(readFileSync(zipPath));
const manifest = JSON.parse(files.get('gk-project.json').toString('utf8'));
const bundleBase = `/b/preview/${encodeURIComponent(manifest.version)}/`;
const page = readFileSync(join(root, 'preview', 'index.html'));
const hostJs = readFileSync(join(root, 'preview', 'host.js'));

const TYPES = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain',
};
// The fence the master UI puts around every bundle: scripts only from this site,
// API calls only to the API's origin, no workers (so no service worker).
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  `connect-src 'self' ${new URL(apiBaseUrl).origin}`,
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const send = (status, type, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra });
    res.end(body);
  };
  if (path === '/preview-config.json') {
    return send(200, 'application/json', JSON.stringify({ apiBaseUrl, key, bundleBase, basePath: '/p/preview/demo', projectCode: 'demo' }));
  }
  if (path === '/host.js') return send(200, 'text/javascript', hostJs);
  if (path.startsWith(bundleBase)) {
    const data = files.get(path.slice(bundleBase.length));
    if (!data) return send(404, 'text/plain', 'not in the bundle');
    return send(200, TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', data);
  }
  if (path.startsWith('/b/')) return send(404, 'text/plain', 'not found');
  // Every other address is the host page, as on the master UI (deep links under the base path work).
  send(200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': csp });
}).listen(port, '127.0.0.1', () => {
  console.log(`Preview of project-bundle.zip ${manifest.version} (${manifest.framework}): http://localhost:${port}/p/preview/demo/`);
});
