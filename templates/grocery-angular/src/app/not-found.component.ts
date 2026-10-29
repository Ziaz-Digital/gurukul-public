import { Component, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-not-found',
  encapsulation: ViewEncapsulation.None,
  template: `<p class="muted">This page does not exist yet. Build it!</p>`,
})
export class NotFoundComponent {}
