// Writes the kit's one-line result, and a table per capability, from
// results/results.json (Playwright's JSON reporter). In GitHub Actions it also
// appends them to the job summary ($GITHUB_STEP_SUMMARY).
//
//   Gurukul capstone kit: 41/41 passed on 3f9a2c1
//
// It never fails the job: the test step's own exit code does that.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'results', 'results.json');
const sha = (process.env.GITHUB_SHA || process.env.KIT_SHA || 'local').slice(0, 7);

if (!fs.existsSync(file)) {
  const line = `Gurukul capstone kit: no results (the tests did not run) on ${sha}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${line}\n`);
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const perTag = new Map();
let passed = 0;
let total = 0;

function walk(suite) {
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      total++;
      const ok = t.status === 'expected' || t.status === 'flaky';
      if (ok) passed++;
      for (const raw of spec.tags || []) {
        const tag = String(raw).replace(/^@/, '');
        const row = perTag.get(tag) || { passed: 0, total: 0 };
        row.total++;
        if (ok) row.passed++;
        perTag.set(tag, row);
      }
    }
  }
  for (const child of suite.suites || []) walk(child);
}
for (const suite of report.suites || []) walk(suite);

const line = `Gurukul capstone kit: ${passed}/${total} passed on ${sha}`;
const capabilities = (report.config && report.config.metadata && report.config.metadata.capabilities) || '';
const rows = [...perTag.entries()]
  .sort(([a], [b]) => (a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b)))
  .map(([tag, r]) => `| ${tag} | ${r.passed}/${r.total} |`);

console.log(line);
if (capabilities) console.log(`Capabilities: ${capabilities}`);
for (const [tag, r] of perTag) console.log(`  ${tag}: ${r.passed}/${r.total}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    `### ${line}`,
    '',
    capabilities ? `Capabilities: \`${capabilities}\`` : '',
    '',
    '| Tag | Passed |',
    '|---|---|',
    ...rows,
    '',
  ].join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
