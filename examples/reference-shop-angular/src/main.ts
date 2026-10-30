// The bundle's entry: registers <gk-project> with Angular Elements, the one thing
// Gurukul's master UI loads (project-bundle.md). You rarely need to change this file.
//
// Zoneless on purpose: zone.js patches the page's global timers and events, and a
// bundle must never change the host page's globals.
import { LocationStrategy } from '@angular/common';
import { provideZonelessChangeDetection } from '@angular/core';
import { createCustomElement } from '@angular/elements';
import { createApplication } from '@angular/platform-browser';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { GkBasePathLocationStrategy } from './app/base-path-location';
import { GkProjectComponent } from './app/gk-project.component';
import { routes } from './app/routes';

if (!customElements.get('gk-project')) {
  createApplication({
    providers: [
      provideZonelessChangeDetection(),
      // The first navigation waits until the host has given the base path.
      provideRouter(routes, withDisabledInitialNavigation()),
      { provide: LocationStrategy, useClass: GkBasePathLocationStrategy },
    ],
  })
    .then((app) => {
      if (!customElements.get('gk-project')) {
        customElements.define('gk-project', createCustomElement(GkProjectComponent, { injector: app.injector }));
      }
    })
    .catch((err) => console.error('gk-project could not start', err));
}
