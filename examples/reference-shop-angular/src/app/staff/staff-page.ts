import { Directive, inject, signal } from '@angular/core';
import { ShopService } from '../shop.service';

/** What every staff screen shares: the client, a busy flag, one error and one note line. */
@Directive()
export abstract class StaffPage {
  protected readonly shop = inject(ShopService);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly note = signal<string | null>(null);

  protected get client() {
    return this.shop.client;
  }

  /** Runs one call with the busy state on; a failure becomes the error line. */
  protected async work<T>(job: () => Promise<T>, done?: string): Promise<T | undefined> {
    this.busy.set(true);
    this.error.set(null);
    this.note.set(null);
    try {
      const result = await job();
      if (done) this.note.set(done);
      return result;
    } catch (e) {
      this.error.set(this.shop.explain(e));
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }
}

/** The status line every staff screen shows under its heading. */
export const STATUS_LINES = `
  @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
  @if (note()) { <p class="ok" role="status">{{ note() }}</p> }
`;
