#!/usr/bin/env node
// Checks a project-bundle.zip against the contract (project-bundle.md). No dependencies.
//
//   node tools/validate-project-bundle.mjs path/to/project-bundle.zip [--max-mb 5]
//
// Exit code 0: the bundle passes. 1: it does not (every problem is printed). 2: bad usage.
// The reusable workflow runs it on every learner build; Gurukul's host runs the same
// checks again when it takes the bundle (Phase 8.3), so passing here is necessary, not sufficient.
import { readFileSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIMITS = {
  maxZipBytes: 5 * 1024 * 1024,
  maxUnzippedBytes: 20 * 1024 * 1024,
  maxFiles: 500,
  maxNameLength: 200,
};
export const ALLOWED_EXTENSIONS = ['js', 'mjs', 'css', 'json', 'map', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'woff', 'woff2', 'txt'];
export const FRAMEWORKS = ['angular', 'react'];
const SAFE_NAME = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECRET = /gk(shop|st|cu)_[A-Za-z0-9_-]{16,}/;

/** Reads the zip's central directory, strictly. Throws on anything malformed. */
function readEntries(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 is not accepted');
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
    const madeBy = zip.readUInt16LE(p + 4) >> 8;
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const external = zip.readUInt32LE(p + 38);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const unixMode = madeBy === 3 ? external >>> 16 : 0;
    entries.push({
      name,
      method,
      csize,
      size,
      localOffset,
      encrypted: (flags & 1) === 1,
      symlink: (unixMode & 0o170000) === 0o120000,
      dir: name.endsWith('/'),
    });
  }
  return entries;
}

function readData(zip, e) {
  const nameLen = zip.readUInt16LE(e.localOffset + 26);
  const extraLen = zip.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = zip.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: LIMITS.maxUnzippedBytes + 1 });
  throw new Error(`compression method ${e.method}`);
}

/** @returns {{ problems: string[], manifest: object | null, files: number, bytes: number }} */
export function validateBundle(zip, { maxZipBytes = LIMITS.maxZipBytes } = {}) {
  const problems = [];
  if (zip.length > maxZipBytes) problems.push(`the zip is ${(zip.length / 1048576).toFixed(2)} MB; the limit is ${(maxZipBytes / 1048576).toFixed(0)} MB`);
  let entries;
  try {
    entries = readEntries(zip);
  } catch (e) {
    return { problems: [...problems, `not a readable zip: ${e.message}`], manifest: null, files: 0, bytes: 0 };
  }

  const files = new Map();
  let total = 0;
  for (const e of entries) {
    if (e.dir) continue;
    const label = JSON.stringify(e.name);
    if (e.encrypted) problems.push(`${label}: encrypted entries are not accepted`);
    if (e.symlink) problems.push(`${label}: symbolic links are not accepted`);
    if (e.name.length > LIMITS.maxNameLength || !SAFE_NAME.test(e.name) || e.name.split('/').some((s) => s === '.' || s === '..')) {
      problems.push(`${label}: a file name may use only letters, digits, . _ - and / (no .., no leading /, no \\ or :)`);
      continue;
    }
    if (files.has(e.name)) {
      problems.push(`${label}: appears twice`);
      continue;
    }
    const ext = e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) problems.push(`${label}: .${ext || '(none)'} files are not allowed (allowed: ${ALLOWED_EXTENSIONS.join(' ')})`);
    total += e.size;
    let data = null;
    if (!e.encrypted && !e.symlink) {
      try {
        data = readData(zip, e);
        if (data.length !== e.size) problems.push(`${label}: its size does not match the zip directory`);
      } catch (err) {
        problems.push(`${label}: cannot be read (${err.message})`);
      }
    }
    files.set(e.name, data);
  }
  if (files.size > LIMITS.maxFiles) problems.push(`${files.size} files; the limit is ${LIMITS.maxFiles}`);
  if (total > LIMITS.maxUnzippedBytes) problems.push(`${(total / 1048576).toFixed(1)} MB unzipped; the limit is 20 MB`);

  for (const [name, data] of files) {
    if (data && SECRET.test(data.toString('latin1'))) problems.push(`"${name}" contains a shop key or token (gkshop_/gkst_/gkcu_…): keys never go into a bundle`);
  }

  let manifest = null;
  const raw = files.get('gk-project.json');
  if (!raw) problems.push('gk-project.json is missing from the top of the zip');
  else {
    try {
      manifest = JSON.parse(raw.toString('utf8'));
    } catch {
      problems.push('gk-project.json is not valid JSON');
    }
  }
  if (manifest) {
    const m = manifest;
    if (m.contractVersion !== 1) problems.push('gk-project.json: contractVersion must be 1');
    if (typeof m.projectKind !== 'string' || !SLUG.test(m.projectKind)) problems.push('gk-project.json: projectKind must be a kind key such as "grocery-shop"');
    if (typeof m.version !== 'string' || !SEMVER.test(m.version)) problems.push('gk-project.json: version must look like 1.2.3');
    if (!FRAMEWORKS.includes(m.framework)) problems.push(`gk-project.json: framework must be one of ${FRAMEWORKS.join(', ')}`);
    if (typeof m.frameworkVersion !== 'string' || !SEMVER.test(m.frameworkVersion)) problems.push('gk-project.json: frameworkVersion must look like 1.2.3');
    if (typeof m.templateVersion !== 'string' || !SEMVER.test(m.templateVersion)) problems.push('gk-project.json: templateVersion must look like 1.2.3');
    if (!Array.isArray(m.capabilities) || m.capabilities.some((c) => typeof c !== 'string' || !SLUG.test(c)) || new Set(m.capabilities).size !== m.capabilities.length)
      problems.push('gk-project.json: capabilities must be a list of distinct capability keys');
    if (typeof m.entry !== 'string' || !/\.m?js$/.test(m.entry)) problems.push('gk-project.json: entry must name a .js or .mjs file');
    else if (!files.has(m.entry)) problems.push(`gk-project.json: entry "${m.entry}" is not in the zip`);
    const known = new Set(['contractVersion', 'projectKind', 'version', 'framework', 'frameworkVersion', 'templateVersion', 'capabilities', 'entry']);
    for (const k of Object.keys(m)) if (!known.has(k)) problems.push(`gk-project.json: unknown field "${k}"`);
  }
  const registers = [...files].some(([n, d]) => /\.m?js$/.test(n) && d && d.includes('gk-project'));
  if (!registers) problems.push('no script mentions gk-project: the bundle must register the <gk-project> element');

  return { problems, manifest, files: files.size, bytes: total };
}

const isMain = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const mbIdx = args.indexOf('--max-mb');
  if (!file) {
    console.error('usage: node validate-project-bundle.mjs <project-bundle.zip> [--max-mb 5]');
    process.exit(2);
  }
  let zip;
  try {
    statSync(file);
    zip = readFileSync(file);
  } catch {
    console.error(`${file}: not found`);
    process.exit(1);
  }
  const maxZipBytes = mbIdx >= 0 ? Number(args[mbIdx + 1]) * 1024 * 1024 : LIMITS.maxZipBytes;
  const { problems, manifest, files, bytes } = validateBundle(zip, { maxZipBytes });
  if (problems.length) {
    console.error(`${file}: does NOT meet the Gurukul project bundle contract:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `${file}: OK — ${manifest.projectKind} ${manifest.version}, ${manifest.framework} ${manifest.frameworkVersion}, template ${manifest.templateVersion}, ` +
      `${files} files, ${(zip.length / 1024).toFixed(1)} KB zipped, ${(bytes / 1024).toFixed(1)} KB unzipped, entry ${manifest.entry}`,
  );
}
