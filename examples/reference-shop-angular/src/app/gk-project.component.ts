import { Component, ElementRef, Input, OnDestroy, OnInit, ViewEncapsulation, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { GkHost } from './gk-host';
import { ShopService, money } from './shop.service';

/**
 * <gk-project>: the whole shop. Each @Input is an attribute the host sets
 * (apiBaseUrl = api-base-url, and so on: project-bundle.md, "Inputs").
 *
 * ViewEncapsulation.ShadowDom: the styles live inside the element. Every style is in
 * THIS component's stylesheet; the pages add none of their own (ViewEncapsulation.None),
 * so nothing is ever written into the host page's <head>.
 */
@Component({
  selector: 'gk-project-root',
  encapsulation: ViewEncapsulation.ShadowDom,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './gk-project.component.html',
  styleUrl: './gk-project.component.css',
})
export class GkProjectComponent implements OnInit, OnDestroy {
  protected readonly host = inject(GkHost);
  protected readonly shop = inject(ShopService);
  private readonly router = inject(Router);
  private readonly element = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private started = false;
  protected readonly money = money;
  protected readonly dialogBusy = signal(false);
  protected readonly dialogError = signal<string | null>(null);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    this.host.attach(this.element);
    // The first navigation happens once the host has given an address and a key.
    effect(() => {
      if (this.host.ready()) this.start();
    });
    // The "we have it now" dialog takes the focus when it opens.
    effect(() => {
      const d = this.dialog()?.nativeElement;
      if (d) queueMicrotask(() => d.querySelector<HTMLButtonElement>('button')?.focus());
    });
  }

  @Input() set apiBaseUrl(value: string | null) {
    this.host.set({ apiBaseUrl: value ?? '' });
  }
  @Input() set publicKey(value: string | null) {
    this.host.set({ publicKey: value ?? '' });
  }
  @Input() set visitToken(value: string | null) {
    this.host.set({ visitToken: value ?? '' });
  }
  @Input() set basePath(value: string | null) {
    this.host.set({ basePath: value ?? '' });
  }
  @Input() set projectKind(value: string | null) {
    this.host.set({ projectKind: value ?? '' });
  }
  @Input() set projectCode(value: string | null) {
    this.host.set({ projectCode: value ?? '' });
  }

  ngOnInit(): void {
    if (this.host.ready()) this.start();
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.shop.restoreSessions();
    this.shop.loadBasket().catch((e) => this.shop.explain(e));
    this.router.initialNavigation();
  }

  /** "Skip to content" without touching location.hash (the host may use it). */
  protected skip(): void {
    this.element.shadowRoot?.getElementById('gk-main')?.focus();
  }

  protected async addRequested(requestId: number, productId: number): Promise<void> {
    this.dialogBusy.set(true);
    this.dialogError.set(null);
    try {
      await this.shop.add(productId);
      await this.shop.dismissRequest(requestId);
    } catch (e) {
      this.dialogError.set(this.shop.explain(e));
    } finally {
      this.dialogBusy.set(false);
    }
  }

  ngOnDestroy(): void {
    this.shop.releaseImages();
  }
}
