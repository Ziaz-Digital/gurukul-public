import { Component, ElementRef, Input, OnInit, ViewEncapsulation, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { GkHost } from './gk-host';
import { ShopService } from './shop.service';

/**
 * <gk-project>: your whole shop. Each @Input is an attribute the host sets
 * (apiBaseUrl = api-base-url, and so on: project-bundle.md, "Inputs").
 *
 * ViewEncapsulation.ShadowDom: your styles live inside the element. Keep every
 * style in THIS component's styleUrl (or in other ShadowDom components): a component
 * with its own styles and the default encapsulation would write them into the
 * host page's <head>, which a bundle must never do.
 */
@Component({
  selector: 'gk-project-root',
  encapsulation: ViewEncapsulation.ShadowDom,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './gk-project.component.html',
  styleUrl: './gk-project.component.css',
})
export class GkProjectComponent implements OnInit {
  protected readonly host = inject(GkHost);
  protected readonly shop = inject(ShopService);
  private readonly router = inject(Router);
  private started = false;

  constructor() {
    this.host.attach(inject(ElementRef<HTMLElement>).nativeElement);
    // The first navigation happens once the host has given an address and a key.
    effect(() => {
      if (this.host.ready() && !this.started) {
        this.started = true;
        this.router.initialNavigation();
      }
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
    if (this.host.ready() && !this.started) {
      this.started = true;
      this.router.initialNavigation();
    }
  }
}
