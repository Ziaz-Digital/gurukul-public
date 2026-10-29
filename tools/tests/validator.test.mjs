// The validator, both directions: the templates' real bundles pass, and every
// kind of broken bundle fails (in-process, and through the CLI's exit code).
// Run after `npm run bundle` in both templates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { validateBundle } from '../validate-project-bundle.mjs';
import { readZip, writeZip } from '../../templates/grocery-react/scripts/zip.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(here, '..', '..');
const validator = join(publicRoot, 'tools', 'validate-project-bundle.mjs');
const bundles = {
  angular: join(publicRoot, 'templates', 'grocery-angular', 'project-bundle.zip'),
  react: join(publicRoot, 'templates', 'grocery-react', 'project-bundle.zip'),
};
const scratch = mkdtempSync(join(tmpdir(), 'gk-bundle-'));

/** Runs the CLI; returns its exit code. */
function cli(file) {
  try {
    execFileSync(process.execPath, [validator, file], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status;
  }
}

/** A copy of the react bundle, changed by fn(files Map, manifest). */
function variant(name, fn) {
  const files = readZip(readFileSync(bundles.react));
  const manifest = JSON.parse(files.get('gk-project.json').toString('utf8'));
  fn(files, manifest);
  if (files.has('gk-project.json')) files.set('gk-project.json', Buffer.from(JSON.stringify(manifest)));
  const zip = writeZip([...files].map(([n, data]) => ({ name: n, data })));
  const file = join(scratch, `${name}.zip`);
  writeFileSync(file, zip);
  return { zip, file };
}

for (const [framework, file] of Object.entries(bundles)) {
  test(`the ${framework} template's bundle passes (exit 0)`, () => {
    const { problems, manifest } = validateBundle(readFileSync(file));
    assert.deepEqual(problems, []);
    assert.equal(manifest.framework, framework);
    assert.equal(manifest.projectKind, 'grocery-shop');
    assert.equal(cli(file), 0);
  });
}

const broken = {
  'missing manifest': (files) => files.delete('gk-project.json'),
  'oversize (6 MB of incompressible data)': (files) => files.set('big.png', randomBytes(6 * 1024 * 1024)),
  'an html page': (files) => files.set('index.html', Buffer.from('<html></html>')),
  'a file with no allowed type': (files) => files.set('server.exe', Buffer.from('MZ')),
  'a path that climbs out': (files) => files.set('../evil.js', Buffer.from('1')),
  'a backslash path': (files) => files.set('a\\b.js', Buffer.from('1')),
  'a shop key inside': (files) => files.set('config.json', Buffer.from('{"k":"gkshop_abcdefghijklmnopqrstuvwxyz012345"}')),
  'entry not in the zip': (_files, m) => (m.entry = 'missing.js'),
  'unknown framework': (_files, m) => (m.framework = 'vue'),
  'bad version': (_files, m) => (m.version = 'latest'),
  'wrong contract version': (_files, m) => (m.contractVersion = 2),
  'capabilities not a list': (_files, m) => (m.capabilities = 'discount-codes'),
  'an unknown manifest field': (_files, m) => (m.serviceWorker = 'sw.js'),
};

for (const [name, change] of Object.entries(broken)) {
  test(`a bundle with ${name} fails (exit 1)`, () => {
    const { zip, file } = variant(name.replace(/\W+/g, '-'), change);
    const { problems } = validateBundle(zip);
    assert.ok(problems.length > 0, 'expected at least one problem');
    assert.equal(cli(file), 1);
  });
}

test('not a zip at all fails (exit 1)', () => {
  const file = join(scratch, 'not-a-zip.zip');
  writeFileSync(file, 'hello');
  assert.equal(cli(file), 1);
});

test('a missing file fails (exit 1)', () => {
  assert.equal(cli(join(scratch, 'nope.zip')), 1);
});
