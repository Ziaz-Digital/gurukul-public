// The bridge between <gk-project> and whoever hosts it: Gurukul's master UI, the
// template's preview page, or the dev page on your machine. Framework-neutral;
// the Angular and React templates both use it. Copied into each template by
// gurukul-public/tools/generate-shop-client.mjs. The rules: project-bundle.md.
/* eslint-disable */
import { ShopClient } from './shop-client';

/** The element's inputs. The host sets them as attributes (strings). */
export interface GkProjectInputs {
  /** The master API base, e.g. https://gurukul.ziaz.eu/api/gurukul/shop/v1. */
  apiBaseUrl: string;
  /** gkpub_… when hosted; your own gkshop_… on your machine. */
  publicKey: string;
  /** gkvis_… when hosted (the host starts the visit); empty on your machine. */
  visitToken: string;
  /** Where your routes live in the address bar, e.g. /p/AB12/QX7P9K. Empty = the root. */
  basePath: string;
  /** The project kind, e.g. grocery-shop. */
  projectKind: string;
  /** The project's code; your storage keys start with gk-<project-code>-. */
  projectCode: string;
}

/** Attribute names, in the order the contract lists them. */
export const GK_PROJECT_ATTRIBUTES = ['api-base-url', 'public-key', 'visit-token', 'base-path', 'project-kind', 'project-code'] as const;

const attrToInput: Record<string, keyof GkProjectInputs> = {
  'api-base-url': 'apiBaseUrl',
  'public-key': 'publicKey',
  'visit-token': 'visitToken',
  'base-path': 'basePath',
  'project-kind': 'projectKind',
  'project-code': 'projectCode',
};

/** How long to wait for the host to hand over a new visit token. */
const VISIT_RENEW_TIMEOUT_MS = 15000;

/** "", "/" and "/p/x/" become "", "", "/p/x". */
export function normaliseBasePath(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v || v === '/') return '';
  return ('/' + v.replace(/^\/+/, '')).replace(/\/+$/, '');
}

export class GkHostBridge {
  private inputs: GkProjectInputs = { apiBaseUrl: '', publicKey: '', visitToken: '', basePath: '', projectKind: '', projectCode: '' };
  private shopClient: ShopClient | null = null;
  private waiters: Array<(token: string | null) => void> = [];

  /** @param host the <gk-project> element (events are dispatched on it). */
  constructor(private readonly host: HTMLElement) {}

  /** Sets inputs from an attribute change (name, value). */
  setAttribute(name: string, value: string | null): void {
    const key = attrToInput[name];
    if (key) this.set({ [key]: value ?? '' });
  }

  /** Sets inputs (from Angular inputs or from attributes). */
  set(partial: Partial<GkProjectInputs>): void {
    const before = this.inputs;
    this.inputs = { ...before, ...partial };
    if (partial.basePath !== undefined) this.inputs.basePath = normaliseBasePath(partial.basePath);
    if (this.inputs.apiBaseUrl !== before.apiBaseUrl || this.inputs.publicKey !== before.publicKey) this.shopClient = null;
    if (partial.visitToken !== undefined && partial.visitToken !== before.visitToken && partial.visitToken) {
      const waiting = this.waiters;
      this.waiters = [];
      waiting.forEach((resolve) => resolve(partial.visitToken!));
    }
  }

  get current(): Readonly<GkProjectInputs> {
    return this.inputs;
  }

  get basePath(): string {
    return this.inputs.basePath;
  }

  /** The master API client for the current inputs (one per address and key). */
  get client(): ShopClient {
    if (!this.shopClient) {
      if (!this.inputs.apiBaseUrl || !this.inputs.publicKey) {
        throw new Error('<gk-project> needs api-base-url and public-key before it can call the API.');
      }
      this.shopClient = new ShopClient({
        baseUrl: this.inputs.apiBaseUrl,
        key: this.inputs.publicKey,
        visitToken: () => this.inputs.visitToken || null,
        renewVisit: () => this.renewVisit(),
      });
    }
    return this.shopClient;
  }

  /** True once the host has given an address and a key. */
  get ready(): boolean {
    return !!this.inputs.apiBaseUrl && !!this.inputs.publicKey;
  }

  /**
   * The visit expired (401 site.visit_required): ask the host for a new one by
   * dispatching `gk-visit-expired`, then wait for the host to set `visit-token`.
   */
  renewVisit(): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve(null);
      }, VISIT_RENEW_TIMEOUT_MS);
      const done = (token: string | null) => {
        clearTimeout(timer);
        resolve(token);
      };
      this.waiters.push(done);
      this.host.dispatchEvent(new CustomEvent('gk-visit-expired', { bubbles: true, composed: true }));
    });
  }

  /** A storage key inside your own prefix: gk-<project-code>-<name>. */
  storageKey(name: string): string {
    return `gk-${this.inputs.projectCode || 'dev'}-${name}`;
  }

  /** A full address under your base path, e.g. for the payment page's returnUrl. */
  absoluteUrl(route: string): string {
    return window.location.origin + this.inputs.basePath + (route.startsWith('/') ? route : '/' + route);
  }
}
