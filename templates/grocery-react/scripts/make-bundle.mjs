// npm run bundle (after the build): packs the built files into project-bundle.zip,
// the one file Gurukul's host takes (project-bundle.md). Writes gk-project.json,
// leaves out the dev page, and refuses to pack anything that breaks the contract.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// ---- Per template ----
const DIST = join(root, 'dist', 'bundle');
const FRAMEWORK_PACKAGE = 'react';
function findEntry(files) {
  return files.find((f) => /^gk-project-[\w-]+\.js$/.test(f));
}
// ---- The same in every template ----

const MAX_ZIP_BYTES = 5 * 1024 * 1024;
const ALLOWED = /\.(js|mjs|css|json|map|svg|png|jpg|jpeg|webp|gif|ico|woff|woff2|txt)$/i;
const SAFE_NAME = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const SECRET = /gk(shop|st|cu)_[A-Za-z0-9_-]{16,}/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [relative(DIST, full).split('\\').join('/')];
  });
}

const fail = (msg) => {
  console.error(`make-bundle: ${msg}`);
  process.exit(1);
};

let files;
try {
  files = walk(DIST);
} catch {
  fail(`no build output in ${DIST}. Run npm run build first.`);
}
files = files.filter((f) => !/\.html$/i.test(f) && !/(^|\/)\.DS_Store$/.test(f) && f !== 'gk-project.json' && f !== 'prerendered-routes.json');
const entry = findEntry(files);
if (!entry) fail('could not find the entry script in the build output.');

const frameworkVersion = JSON.parse(readFileSync(join(root, 'node_modules', FRAMEWORK_PACKAGE, 'package.json'), 'utf8')).version;
const manifest = {
  contractVersion: 1,
  projectKind: pkg.gurukul.projectKind,
  version: (process.env.GK_BUNDLE_VERSION || pkg.version).replace(/^v/, ''),
  framework: pkg.gurukul.framework,
  frameworkVersion,
  templateVersion: pkg.gurukul.templateVersion,
  capabilities: pkg.gurukul.capabilities ?? [],
  entry,
};

const entries = [{ name: 'gk-project.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') }];
for (const f of files.sort()) {
  if (!SAFE_NAME.test(f)) fail(`${f}: file names may use only letters, digits, . _ - and /`);
  if (!ALLOWED.test(f)) fail(`${f}: this kind of file is not allowed in a bundle`);
  const data = readFileSync(join(DIST, f));
  if (SECRET.test(data.toString('latin1'))) fail(`${f} contains a shop key or token. Keys never go into a bundle.`);
  entries.push({ name: f, data });
}
const zip = writeZip(entries);
if (zip.length > MAX_ZIP_BYTES) fail(`project-bundle.zip is ${(zip.length / 1048576).toFixed(2)} MB; the limit is 5 MB.`);
writeFileSync(join(root, 'project-bundle.zip'), zip);
console.log(`project-bundle.zip: ${entries.length} files, ${(zip.length / 1024).toFixed(1)} KB, entry ${entry}, version ${manifest.version}`);
