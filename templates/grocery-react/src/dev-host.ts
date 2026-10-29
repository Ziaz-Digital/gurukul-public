// The dev page's host (npm run dev only; not in the bundle). It mounts <gk-project>
// the way Gurukul's master UI does, with YOUR shop key from .env.local instead of a
// public key, and the root of the dev server as the base path.
import './gk-project';

const apiBaseUrl = import.meta.env.SHOP_API_BASE_URL as string | undefined;
const key = import.meta.env.SHOP_KEY as string | undefined;
const host = document.getElementById('host')!;

if (!apiBaseUrl || !key) {
  host.textContent = 'Copy .env.example to .env.local and fill in SHOP_API_BASE_URL and SHOP_KEY, then run npm run dev again.';
} else {
  const el = document.createElement('gk-project');
  el.setAttribute('api-base-url', apiBaseUrl);
  el.setAttribute('public-key', key);
  el.setAttribute('base-path', '');
  el.setAttribute('project-kind', 'grocery-shop');
  el.setAttribute('project-code', 'dev');
  host.append(el);
}
