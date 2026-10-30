import { Component, ViewEncapsulation } from '@angular/core';
import { RouterLink, Routes } from '@angular/router';
import { AccountComponent } from './shopper/account.component';
import { BasketComponent } from './shopper/basket.component';
import { CatalogueComponent } from './shopper/catalogue.component';
import { CheckoutComponent } from './shopper/checkout.component';
import { ConfirmationComponent } from './shopper/confirmation.component';
import { HoursComponent } from './shopper/hours.component';
import { ProductComponent } from './shopper/product.component';
import { SignInComponent } from './shopper/sign-in.component';
import { TrackComponent } from './shopper/track.component';
import { StaffOrdersComponent } from './staff/staff-orders.component';
import { StaffProductsComponent } from './staff/staff-products.component';
import { StaffReportComponent } from './staff/staff-report.component';
import { StaffShellComponent } from './staff/staff-shell.component';
import { StaffSettingsComponent } from './staff/staff-settings.component';
import { StaffStockComponent } from './staff/staff-stock.component';
import { StaffSuppliersComponent } from './staff/staff-suppliers.component';
import { StaffViewComponent } from './staff-view/staff-view.component';

@Component({
  selector: 'app-not-found',
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink],
  template: `<h1>Page not found</h1><p><a routerLink="/">Back to the shop</a></p>`,
})
export class NotFoundComponent {}

/**
 * The shop's routes, relative to the base path the host gives. Each screen and the
 * contract capability it maps to are listed in this example's README.
 */
export const routes: Routes = [
  // Shopper
  { path: '', component: CatalogueComponent },
  { path: 'product/:id', component: ProductComponent },
  { path: 'basket', component: BasketComponent },
  { path: 'checkout', component: CheckoutComponent },
  { path: 'confirmation', component: ConfirmationComponent },
  { path: 'order/:orderNumber', component: ConfirmationComponent },
  { path: 'track', component: TrackComponent },
  { path: 'sign-in', component: SignInComponent },
  { path: 'account', component: AccountComponent },
  { path: 'hours', component: HoursComponent },
  // Staff (your own machine; hidden in the showcase)
  {
    path: 'staff',
    component: StaffShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'orders' },
      { path: 'orders', component: StaffOrdersComponent },
      { path: 'products', component: StaffProductsComponent },
      { path: 'stock', component: StaffStockComponent },
      { path: 'suppliers', component: StaffSuppliersComponent },
      { path: 'settings', component: StaffSettingsComponent },
      { path: 'report', component: StaffReportComponent },
    ],
  },
  // The read-only view of the staff side (the showcase only)
  { path: 'staff-view', component: StaffViewComponent },
  { path: '**', component: NotFoundComponent },
];
