// The preview host: mounts a <gk-project> bundle the way Gurukul's master UI does
// (project-bundle.md, "How the host mounts a bundle"). Identical in every template.
const status = document.getElementById('status');
const say = (text) => (status.textContent = text);

async function main() {
  const cfg = await (await fetch('/preview-config.json')).json();

  // 1. The manifest says what to load.
  const manifest = await (await fetch(cfg.bundleBase + 'gk-project.json')).json();
  if (manifest.contractVersion !== 1) return say(`This bundle is for contract ${manifest.contractVersion}; this host knows 1.`);
  document.getElementById('about').textContent = `${manifest.projectKind} ${manifest.version} · ${manifest.framework} ${manifest.frameworkVersion}`;

  // 2. The host owns the address bar: the project lives under its base path.
  if (location.pathname !== cfg.basePath && !location.pathname.startsWith(cfg.basePath + '/')) {
    history.replaceState(null, '', cfg.basePath + '/');
  }

  // 3. A published project (public key) starts a visit before anything calls the API.
  const hosted = cfg.key.startsWith('gkpub_');
  async function startVisit() {
    if (!hosted) return '';
    const res = await fetch(cfg.apiBaseUrl + '/public/visits', { method: 'POST', headers: { 'X-Shop-Key': cfg.key } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 201) return body.visitToken;
    say(res.status === 429 ? body.detail || body.title || 'This project has had all its visits for today.' : `Could not start a visit (${res.status} ${body.code ?? ''}).`);
    return null;
  }
  const visitToken = await startVisit();
  if (visitToken === null) return;

  // 4. Load the entry script once; it registers <gk-project>.
  await import(cfg.bundleBase + manifest.entry);
  await customElements.whenDefined('gk-project');

  // 5. Create the element, set every input, then put it on the page.
  const el = document.createElement('gk-project');
  el.setAttribute('api-base-url', cfg.apiBaseUrl);
  el.setAttribute('public-key', cfg.key);
  el.setAttribute('visit-token', visitToken);
  el.setAttribute('base-path', cfg.basePath);
  el.setAttribute('project-kind', manifest.projectKind);
  el.setAttribute('project-code', cfg.projectCode);

  // 6. The visit ran out: start a new one and hand it over (or unmount past the day's limit).
  el.addEventListener('gk-visit-expired', async () => {
    const fresh = await startVisit();
    if (fresh) el.setAttribute('visit-token', fresh);
    else el.remove();
  });

  document.getElementById('project').append(el);
}

main().catch((err) => say(`The preview could not mount the bundle: ${err?.message ?? err}`));
