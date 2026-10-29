import { Injectable, computed, signal } from '@angular/core';
import { GkHostBridge, GkProjectInputs } from '../gurukul-shop-client/host-bridge';

/**
 * What the host gave <gk-project>: the API address, the key, the visit token,
 * the base path. One per page (there is one <gk-project> on a page).
 */
@Injectable({ providedIn: 'root' })
export class GkHost {
  private bridgeRef: GkHostBridge | null = null;
  private readonly inputs = signal<GkProjectInputs>({ apiBaseUrl: '', publicKey: '', visitToken: '', basePath: '', projectKind: '', projectCode: '' });

  readonly ready = computed(() => !!this.inputs().apiBaseUrl && !!this.inputs().publicKey);
  /** Changes when the API address or key changes, so pages reload their data. */
  readonly apiIdentity = computed(() => `${this.inputs().apiBaseUrl}|${this.inputs().publicKey}`);

  /** Called by the element's component with its host element. */
  attach(element: HTMLElement): void {
    this.bridgeRef = new GkHostBridge(element);
    this.bridgeRef.set(this.inputs());
  }

  set(partial: Partial<GkProjectInputs>): void {
    this.bridge.set(partial);
    this.inputs.set({ ...this.bridge.current });
  }

  get bridge(): GkHostBridge {
    if (!this.bridgeRef) this.bridgeRef = new GkHostBridge(document.createElement('div'));
    return this.bridgeRef;
  }

  /** Read lazily by the location strategy, so the base path can arrive after start-up. */
  get basePath(): string {
    return this.bridge.basePath;
  }
}
