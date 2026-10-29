import { BrowserRouter, NavLink, Route, Routes } from 'react-router';
import type { GkHostBridge, GkProjectInputs } from './gurukul-shop-client/host-bridge';
import { ShopProvider, useBasket } from './shop';
import { Catalogue } from './Catalogue';
import { Basket } from './Basket';

/** Your shop. Routes live under the base path the host gives (project-bundle.md, "Routing"). */
export function App({ bridge, inputs }: { bridge: GkHostBridge; inputs: GkProjectInputs }) {
  if (!bridge.ready) return <p className="muted">Waiting for the host…</p>;
  return (
    // key: a new base path or API is a fresh app.
    <BrowserRouter key={`${inputs.basePath}|${inputs.apiBaseUrl}|${inputs.publicKey}`} basename={inputs.basePath || '/'}>
      <ShopProvider bridge={bridge}>
        <Layout />
      </ShopProvider>
    </BrowserRouter>
  );
}

function Layout() {
  const { count } = useBasket();
  return (
    <div className="shop">
      <header className="bar">
        <span className="brand">My grocery shop</span>
        <nav>
          <NavLink to="/" end>
            Shop
          </NavLink>
          <NavLink to="/basket">Basket ({count})</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Catalogue />} />
          <Route path="/basket" element={<Basket />} />
          <Route path="*" element={<p className="muted">This page does not exist yet. Build it!</p>} />
        </Routes>
      </main>
    </div>
  );
}
