import { Routes } from '@angular/router';
import { BasketComponent } from './basket.component';
import { CatalogueComponent } from './catalogue.component';
import { NotFoundComponent } from './not-found.component';

/** Your routes, relative to the base path the host gives. */
export const routes: Routes = [
  { path: '', component: CatalogueComponent },
  { path: 'basket', component: BasketComponent },
  { path: '**', component: NotFoundComponent },
];
