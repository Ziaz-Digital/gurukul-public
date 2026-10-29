// npm run dev, step 1: reads .env.local and writes .dev/dev-config.json, which only
// the development server serves (angular.json). It never reaches the bundle.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, '.env.local');
const env = existsSync(file)
  ? Object.fromEntries(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
    )
  : {};
const apiBaseUrl = process.env.SHOP_API_BASE_URL || env.SHOP_API_BASE_URL || '';
const shopKey = process.env.SHOP_KEY || env.SHOP_KEY || '';
if (!apiBaseUrl || !shopKey) console.warn('No SHOP_API_BASE_URL / SHOP_KEY: copy .env.example to .env.local and fill it in.');
mkdirSync(join(root, '.dev'), { recursive: true });
writeFileSync(join(root, '.dev', 'dev-config.json'), JSON.stringify({ apiBaseUrl, shopKey }, null, 2));
