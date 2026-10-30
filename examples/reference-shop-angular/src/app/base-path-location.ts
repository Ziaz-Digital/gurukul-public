import { Location, LocationChangeListener, LocationStrategy, PlatformLocation } from '@angular/common';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { GkHost } from './gk-host';

/**
 * Angular's router, under the base path the host gives (project-bundle.md, "Routing").
 * Like PathLocationStrategy, but the base path is read on every call (it arrives as an
 * attribute after the app starts), and nothing outside it is ever read or written:
 * an address outside the base path is the shop's home page.
 */
@Injectable()
export class GkBasePathLocationStrategy extends LocationStrategy implements OnDestroy {
  private readonly host = inject(GkHost);
  private readonly platform = inject(PlatformLocation);
  private readonly removers: Array<() => void> = [];

  onPopState(fn: LocationChangeListener): void {
    this.removers.push(this.platform.onPopState(fn), this.platform.onHashChange(fn));
  }

  getBaseHref(): string {
    // Location strips nothing; this strategy adds and removes the base path itself.
    return '';
  }

  prepareExternalUrl(internal: string): string {
    const path = internal.startsWith('/') || internal.startsWith('?') || internal === '' ? internal : '/' + internal;
    return (this.host.basePath + path) || '/';
  }

  path(includeHash = false): string {
    const base = this.host.basePath;
    const pathname = this.platform.pathname;
    let inside = '/';
    if (!base) inside = pathname || '/';
    else if (pathname === base || pathname.startsWith(base + '/')) inside = pathname.slice(base.length) || '/';
    const search = pathname === base || pathname.startsWith(base + '/') || !base ? Location.normalizeQueryParams(this.platform.search) : '';
    return inside + search + (includeHash ? this.platform.hash : '');
  }

  pushState(state: unknown, title: string, url: string, queryParams: string): void {
    this.platform.pushState(state, title, this.prepareExternalUrl(url + Location.normalizeQueryParams(queryParams)));
  }

  replaceState(state: unknown, title: string, url: string, queryParams: string): void {
    this.platform.replaceState(state, title, this.prepareExternalUrl(url + Location.normalizeQueryParams(queryParams)));
  }

  forward(): void {
    this.platform.forward();
  }

  back(): void {
    this.platform.back();
  }

  override getState(): unknown {
    return this.platform.getState();
  }

  override historyGo(relativePosition = 0): void {
    this.platform.historyGo?.(relativePosition);
  }

  ngOnDestroy(): void {
    while (this.removers.length) this.removers.pop()!();
  }
}
