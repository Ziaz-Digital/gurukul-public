import { Component, ViewEncapsulation, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AddOn } from '../capabilities';
import { STATUS_LINES, StaffPage } from './staff-page';

const SECTIONS: Array<{ path: string; label: string; addOn?: AddOn }> = [
  { path: 'orders', label: 'Orders' },
  { path: 'products', label: 'Products' },
  { path: 'stock', label: 'Stock' },
  { path: 'suppliers', label: 'Suppliers', addOn: 'suppliers-purchase-orders' },
  { path: 'settings', label: 'Shop settings' },
  { path: 'report', label: 'Report' },
];

/**
 * The staff side (core `staff-sign-in`). Your own machine only: with the public key
 * every staff route answers 403 shop.public_key, so in Gurukul's showcase this page
 * says so and points to the read-only view instead.
 */
@Component({
  selector: 'app-staff-shell',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    @if (shop.hosted()) {
      <h1>Staff</h1>
      <p>Staff screens work on the shop owner’s own computer. Here you can <a routerLink="/staff-view">view the shop as staff, read only</a>.</p>
    } @else if (!shop.staffSignedIn()) {
      <h1>Staff sign-in</h1>
      <form class="narrow" (ngSubmit)="signIn()">
        <p class="muted small">The staff code is on your Capstone’s Connect your shop page, next to your shop key.</p>
        <label>Staff code <input name="staffCode" type="password" autocomplete="off" required [(ngModel)]="code" /></label>
        ${STATUS_LINES}
        <button type="submit" class="primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ busy() ? 'Signing in…' : 'Sign in as staff' }}</button>
      </form>
    } @else {
      <div class="head-row">
        <h1>Staff</h1>
        <button type="button" class="link" (click)="shop.staffSignOut()">Sign out of staff</button>
      </div>
      <nav class="tabs" aria-label="Staff sections">
        @for (s of sections(); track s.path) {
          <a [routerLink]="['/staff', s.path]" routerLinkActive="on" ariaCurrentWhenActive="page">{{ s.label }}</a>
        }
      </nav>
      <router-outlet />
    }
  `,
})
export class StaffShellComponent extends StaffPage {
  protected code = '';
  protected readonly sections = computed(() => SECTIONS.filter((s) => !s.addOn || this.shop.has(s.addOn)));

  protected async signIn(): Promise<void> {
    if (!this.code.trim()) return;
    await this.work(() => this.shop.staffSignIn(this.code.trim()));
    this.code = '';
  }
}
