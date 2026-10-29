// The bundle's entry: registers <gk-project>, the one thing Gurukul's master UI
// loads (project-bundle.md). Your whole shop renders inside its Shadow DOM, so your
// CSS stays yours and the host's CSS stays out. You rarely need to change this file.
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GK_PROJECT_ATTRIBUTES, GkHostBridge } from './gurukul-shop-client/host-bridge';
import { App } from './App';
import css from './styles.css?inline';

class GkProjectElement extends HTMLElement {
  static observedAttributes = [...GK_PROJECT_ATTRIBUTES];

  private readonly bridge = new GkHostBridge(this);
  private readonly mountPoint: HTMLDivElement;
  private root: Root | null = null;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    this.mountPoint = document.createElement('div');
    this.mountPoint.className = 'gk-root';
    shadow.append(style, this.mountPoint);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    this.bridge.setAttribute(name, value);
    // A new visit token is read on the next call; no need to re-render for it.
    if (name !== 'visit-token') this.render();
  }

  connectedCallback(): void {
    this.root ??= createRoot(this.mountPoint);
    this.render();
  }

  disconnectedCallback(): void {
    // Unmounted by the host: let React clean up (effects, pending requests).
    this.root?.unmount();
    this.root = null;
  }

  private render(): void {
    this.root?.render(
      <StrictMode>
        <App bridge={this.bridge} inputs={{ ...this.bridge.current }} />
      </StrictMode>,
    );
  }
}

if (!customElements.get('gk-project')) customElements.define('gk-project', GkProjectElement);
