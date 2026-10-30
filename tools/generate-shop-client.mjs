#!/usr/bin/env node
// Generates gurukul-shop-client: the typed TypeScript client for the master API
// (the Capstone shop server), from its OpenAPI document. No dependencies.
//
//   node tools/generate-shop-client.mjs                       # from openapi/grocery-shop-v1.json
//   node tools/generate-shop-client.mjs --from https://gurukul.ziaz.eu/api/gurukul/shop/v1/openapi.json
//   node tools/generate-shop-client.mjs --check               # exit 1 if a template's copy is stale
//
// --from a URL also refreshes the checked-in snapshot openapi/grocery-shop-v1.json.
// The output goes, as SOURCE, into every template's src/gurukul-shop-client/
// (shop-client.ts, generated; host-bridge.ts, copied from tools/shop-client/).
// Learners never run this: they get the files inside their template.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = join(root, 'openapi', 'grocery-shop-v1.json');
// Every folder that carries a copy of the library: both templates and the reference shop.
const templates = ['templates/grocery-angular', 'templates/grocery-react', 'examples/reference-shop-angular'];
const API_PREFIX = '/api/gurukul/shop/v1';
// Schemas .NET describes for binary results; the client returns a Blob instead.
const SKIP_SCHEMAS = new Set(['FileContentResult', 'EntityTagHeaderValue', 'StringSegment']);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const check = args.includes('--check');
const from = opt('--from') ?? snapshot;

async function load(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`${source} answered ${res.status}`);
    const text = await res.text();
    const doc = JSON.parse(text);
    writeFileSync(snapshot, JSON.stringify(doc, null, 2) + '\n');
    console.log(`snapshot refreshed: ${snapshot}`);
    return doc;
  }
  return JSON.parse(readFileSync(source, 'utf8'));
}

const pascal = (s) => s.replace(/(^|[-_\s/])([a-z0-9])/gi, (_, __, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');
const camel = (s) => {
  const p = pascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
};
const refName = (ref) => ref.split('/').pop();

function tsType(schema) {
  if (!schema) return 'unknown';
  if (schema.$ref) {
    const n = refName(schema.$ref);
    return SKIP_SCHEMAS.has(n) ? 'Blob' : n;
  }
  if (schema.oneOf || schema.anyOf) {
    const parts = (schema.oneOf ?? schema.anyOf).map(tsType);
    return [...new Set(parts)].join(' | ');
  }
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const nullable = types.includes('null');
  let base;
  if (types.includes('integer') || types.includes('number')) base = 'number';
  else if (types.includes('string')) base = schema.format === 'binary' ? 'Blob' : 'string';
  else if (types.includes('boolean')) base = 'boolean';
  else if (types.includes('array')) base = `${wrap(tsType(schema.items))}[]`;
  else if (types.includes('object') || schema.properties) base = objectType(schema);
  else if (nullable) base = null;
  else base = 'unknown';
  if (base === null) return 'null';
  return nullable ? `${base} | null` : base;
}
const wrap = (t) => (/[|&]/.test(t) ? `(${t})` : t);
const isNullable = (schema) =>
  (Array.isArray(schema?.type) && schema.type.includes('null')) ||
  (schema?.oneOf ?? schema?.anyOf ?? []).some((s) => s.type === 'null');

function objectType(schema, indent = '') {
  const props = schema.properties ?? {};
  if (!Object.keys(props).length) {
    return schema.additionalProperties ? `Record<string, ${tsType(schema.additionalProperties)}>` : 'Record<string, unknown>';
  }
  const required = new Set(schema.required ?? []);
  const lines = Object.entries(props).map(([k, v]) => {
    // A field the server may leave out (an add-on's field, an optional input) is nullable in the document.
    const optional = !required.has(k) && isNullable(v);
    const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    return `${indent}  ${key}${optional ? '?' : ''}: ${tsType(v)};`;
  });
  return `{\n${lines.join('\n')}\n${indent}}`;
}

function successResponse(op) {
  const codes = Object.keys(op.responses ?? {}).filter((c) => /^2/.test(c)).sort();
  for (const c of codes) {
    const content = op.responses[c].content;
    if (!content) continue;
    if (content['application/json']) return tsType(content['application/json'].schema);
    if (Object.keys(content).some((t) => t.startsWith('image/') || t === 'application/octet-stream')) return 'Blob';
  }
  return 'void';
}

function methodName(method, path) {
  const segs = path.slice(API_PREFIX.length).split('/').filter(Boolean);
  let name = method.toLowerCase();
  segs.forEach((s, i) => {
    const m = /^\{(.+)\}$/.exec(s);
    if (!m) name += pascal(s);
    else if (i === segs.length - 1) name += 'By' + pascal(m[1]);
  });
  return name;
}

function generate(doc) {
  const out = [];
  const schemas = doc.components?.schemas ?? {};
  for (const [name, schema] of Object.entries(schemas)) {
    if (SKIP_SCHEMAS.has(name)) continue;
    out.push(`export interface ${name} ${objectType(schema)}\n`);
  }

  const methods = [];
  const seen = new Set();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!path.startsWith(API_PREFIX)) continue;
    for (const method of ['get', 'post', 'put', 'delete']) {
      const op = item[method];
      if (!op) continue;
      const name = methodName(method, path);
      if (seen.has(name)) throw new Error(`two operations would both be called ${name}`);
      seen.add(name);
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])];
      const pathParams = params.filter((p) => p.in === 'path');
      const query = params.filter((p) => p.in === 'query');
      const headers = params.filter((p) => p.in === 'header');
      const body = op.requestBody?.content?.['application/json']?.schema;
      const security = (op.security ?? []).flatMap((r) => Object.keys(r));
      const auth = security.includes('staffToken') ? 'staff' : security.includes('customerToken') ? 'customer' : 'none';
      const ret = successResponse(op);

      const optFields = [];
      if (query.length)
        optFields.push(`query?: { ${query.map((q) => `${q.name}?: ${tsType(q.schema)}`).join('; ')} }`);
      if (body) optFields.push(`body: ${tsType(body).split(' | ').filter((t) => t !== 'null').join(' | ')}`);
      if (headers.length)
        optFields.push(
          `headers${headers.some((h) => h.required) ? '' : '?'}: { ${headers
            .map((h) => `${JSON.stringify(h.name)}${h.required ? '' : '?'}: string`)
            .join('; ')} } & Record<string, string>`,
        );
      const optRequired = !!body || headers.some((h) => h.required);
      const sig = [
        ...pathParams.map((p) => `${camel(p.name)}: ${tsType(p.schema)}`),
        `options${optRequired ? '' : '?'}: CallOptions${optFields.length ? ` & { ${optFields.join('; ')} }` : ''}`,
      ].join(', ');
      const urlExpr = '`' + path.slice(API_PREFIX.length).replace(/\{([^}]+)\}/g, (_, n) => '${encodeURIComponent(String(' + camel(n) + '))}') + '`';
      const doc1 = [op.summary, op.description].filter(Boolean).join(' ').replace(/\*\//g, '* /').trim();
      methods.push(
        `  /** ${method.toUpperCase()} ${path.slice(API_PREFIX.length)}${doc1 ? ` — ${doc1}` : ''}${auth !== 'none' ? ` (needs a ${auth} token)` : ''} */\n` +
          `  ${name}(${sig}): Promise<${ret}> {\n` +
          `    return this.call<${ret}>(${JSON.stringify(method.toUpperCase())}, ${urlExpr}, ${JSON.stringify(auth)}, options);\n` +
          `  }\n`,
      );
    }
  }

  return `${HEADER(doc)}\n${RUNTIME}\n// ---- Schemas (from components.schemas) ----\n\n${out.join('\n')}\n// ---- The client ----\n\nexport class ShopClient extends ShopClientBase {\n${methods.join('\n')}}\n`;
}

const HEADER = (doc) => `// GENERATED by gurukul-public/tools/generate-shop-client.mjs from the shop server's
// OpenAPI document (${doc.info?.title ?? 'shop server'} ${doc.info?.version ?? ''}). Do not edit by hand:
// a newer template brings a newer copy. The contract: docs shop-server.md and project-bundle.md.
/* eslint-disable */
`;

const RUNTIME = `/** The two ways to reach the master API, with the SAME calls (project-bundle.md, "The master API library"). */
export interface ShopClientOptions {
  /** The API base, e.g. https://gurukul.ziaz.eu/api/gurukul/shop/v1 (no trailing slash needed). */
  baseUrl: string;
  /** Your own shop key gkshop_… on your machine, or the public key gkpub_… the host gives a published project. */
  key: string;
  /** Hosted only: the current visit token (gkvis_…), sent as X-Shop-Visit. */
  visitToken?: () => string | null | undefined;
  /** Hosted only: called once when the API answers 401 site.visit_required; resolve the new visit token (or null to give up). */
  renewVisit?: () => Promise<string | null | undefined>;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
}

export interface CallOptions {
  /** Overrides the stored staff or customer token for this one call. */
  token?: string;
  /** A raw body (a CSV for stock import, an image) instead of JSON. */
  raw?: { contentType: string; data: BodyInit };
  signal?: AbortSignal;
}

/** Every non-2xx answer: the problem details the contract promises (\`code\` is the stable part). */
export class ShopApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: { code?: string; title?: string; detail?: string | null; [k: string]: unknown },
    readonly retryAfterSeconds?: number,
  ) {
    super(problem.detail || problem.title || \`The shop answered \${status}\`);
    this.name = 'ShopApiError';
  }
  get code(): string | undefined {
    return this.problem.code;
  }
}

type Auth = 'none' | 'staff' | 'customer';

export class ShopClientBase {
  /** Staff session token (gkst_…), from signInStaff(). Your machine only: a public key may not use staff routes. */
  staffToken: string | null = null;
  /** Customer session token (gkcu_…), from POST /customers/sessions. Sent on customer routes and on POST /orders. */
  customerToken: string | null = null;
  private readonly baseUrl: string;

  constructor(readonly options: ShopClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\\/+$/, '');
  }

  /** True when this client carries a public key, i.e. it runs inside Gurukul's host. */
  get hosted(): boolean {
    return this.options.key.startsWith('gkpub_');
  }

  /** Signs staff in with the staff code from your Connect your shop page and keeps the token. */
  async signInStaff(staffCode: string): Promise<void> {
    const session = await this.call<{ token: string }>('POST', '/staff/sessions', 'none', { body: { staffCode } });
    this.staffToken = session.token;
  }

  protected async call<T>(method: string, path: string, auth: Auth, options: any = {}, retried = false): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Shop-Key': this.options.key, ...(options.headers ?? {}) };
    const visit = this.options.visitToken?.();
    if (visit) headers['X-Shop-Visit'] = visit;
    const bearer =
      options.token ??
      (auth === 'staff' ? this.staffToken : auth === 'customer' ? this.customerToken : path === '/orders' && method === 'POST' ? this.customerToken : null);
    if (bearer) headers['Authorization'] = \`Bearer \${bearer}\`;
    let body: BodyInit | undefined;
    if (options.raw) {
      headers['Content-Type'] = options.raw.contentType;
      body = options.raw.data;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const doFetch = this.options.fetch ?? fetch;
    const res = await doFetch(url.toString(), { method, headers, body, signal: options.signal, credentials: 'omit' });
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    if (res.ok) {
      if (type.includes('json')) return (await res.json()) as T;
      if (type.startsWith('image/') || type === 'application/octet-stream') return (await res.blob()) as T;
      return (await res.text()) as unknown as T;
    }
    const problem = type.includes('json') ? await res.json().catch(() => ({})) : { title: await res.text().catch(() => '') };
    if (res.status === 401 && problem?.code === 'site.visit_required' && !retried && this.options.renewVisit) {
      const fresh = await this.options.renewVisit();
      if (fresh) return this.call<T>(method, path, auth, options, true);
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ShopApiError(res.status, problem ?? {}, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }
}
`;

const doc = await load(from);
const code = generate(doc);
const bridge = readFileSync(join(root, 'tools', 'shop-client', 'host-bridge.ts'), 'utf8').replace(/\r\n/g, '\n');
let stale = false;
for (const t of templates) {
  const dir = join(root, t, 'src', 'gurukul-shop-client');
  const files = { 'shop-client.ts': code, 'host-bridge.ts': bridge };
  for (const [name, text] of Object.entries(files)) {
    const file = join(dir, name);
    // Line endings do not count (a Windows checkout may turn LF into CRLF).
    const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (check) {
      if (current !== text) {
        console.error(`stale: ${file}`);
        stale = true;
      }
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, text);
    console.log(`wrote ${file}`);
  }
}
if (stale) {
  console.error('Run: node tools/generate-shop-client.mjs');
  process.exit(1);
}
