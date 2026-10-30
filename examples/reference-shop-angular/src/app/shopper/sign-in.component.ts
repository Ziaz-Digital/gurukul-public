import { Component, ViewEncapsulation, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ShopService } from '../shop.service';

/**
 * Customer sign-in (shared by `customer-accounts`, `ask-unavailable-item`,
 * `favourites-reorder`): an email, then a 6-digit code. Nothing is emailed. Hosted, the
 * public key's answer carries the code and we show it; on your own machine the code is
 * in GET /dev/outbox, which this page can read for you.
 */
@Component({
  selector: 'app-sign-in',
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule],
  template: `
    <h1>Sign in</h1>
    @if (!shop.signInOn()) {
      <p class="muted">This shop has no customer accounts.</p>
    } @else if (step() === 'email') {
      <p class="muted">No password: we give you a one-time code.</p>
      <form class="narrow" (ngSubmit)="sendCode()">
        <label>Email <input name="email" type="email" required autocomplete="email" [(ngModel)]="email" /></label>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button type="submit" class="primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ busy() ? 'Getting a code…' : 'Get a sign-in code' }}</button>
      </form>
    } @else {
      <form class="narrow" (ngSubmit)="signIn()">
        @if (shownCode()) {
          <div class="codebox" role="status">
            <span class="small">Test mode — nothing is emailed. Your code is</span>
            <strong class="mono big">{{ shownCode() }}</strong>
          </div>
        } @else {
          <p class="muted small" role="status">
            Your code is in your shop’s outbox (GET /dev/outbox).
            <button type="button" class="link" [disabled]="busy()" (click)="readOutbox()">Read it from the outbox</button>
          </p>
        }
        <label>
          6-digit code for {{ email }}
          <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required [(ngModel)]="code" />
        </label>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button type="submit" class="primary" [disabled]="busy()" [attr.aria-busy]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
        <button type="button" class="link" (click)="restart()">Use another email</button>
      </form>
    }
  `,
})
export class SignInComponent {
  protected readonly shop = inject(ShopService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly step = signal<'email' | 'code'>('email');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly shownCode = signal<string | null>(null);
  protected email = '';
  protected code = '';

  protected async sendCode(): Promise<void> {
    if (!/^\S+@\S+\.\S+$/.test(this.email.trim())) {
      this.error.set('Enter an email address.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const issued = await this.shop.requestSignInCode(this.email.trim());
      this.shownCode.set(issued.code ?? null);
      this.step.set('code');
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Your own machine only: the code is a message in /dev/outbox (the public key cannot read it). */
  protected async readOutbox(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const mail = (await this.shop.client.getDevOutbox()).find((m) => m.to.toLowerCase() === this.email.trim().toLowerCase() && !m.orderNumber);
      const code = mail ? /\b(\d{6})\b/.exec(mail.subject + ' ' + mail.bodyText)?.[1] : undefined;
      if (code) this.shownCode.set(code);
      else this.error.set('No code in the outbox yet. Ask for a new one.');
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async signIn(): Promise<void> {
    if (!/^\d{6}$/.test(this.code.trim())) {
      this.error.set('The code is 6 digits.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.shop.signIn(this.email.trim(), this.code.trim());
      const back = this.route.snapshot.queryParamMap.get('returnTo');
      // Only our own routes: returnTo is a path inside the shop, never an address.
      this.router.navigateByUrl(back && back.startsWith('/') && !back.startsWith('//') ? back : '/account');
    } catch (e) {
      this.error.set(this.shop.explain(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected restart(): void {
    this.step.set('email');
    this.code = '';
    this.shownCode.set(null);
    this.error.set(null);
  }
}
