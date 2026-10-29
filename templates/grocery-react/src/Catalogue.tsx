import { useEffect, useState } from 'react';
import type { ShopProduct } from './gurukul-shop-client/shop-client';
import { money, problemText, useShop } from './shop';

/** The catalogue: GET /products. Search, categories and paging are yours to build. */
export function Catalogue() {
  const { client, addToBasket, loadBasket } = useShop();
  const [products, setProducts] = useState<ShopProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    client
      .getProducts({ query: { pageSize: 50 } })
      .then((page) => live && setProducts(page.items))
      .catch((e) => live && setError(problemText(e)));
    loadBasket().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, loadBasket]);

  const add = async (id: number) => {
    setBusy(id);
    setError(null);
    try {
      await addToBasket(id);
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(null);
    }
  };

  if (error && !products) return <p className="error">{error}</p>;
  if (!products) return <p className="muted">Loading the shop…</p>;
  if (!products.length) return <p className="muted">No products yet. Add some as staff on your machine.</p>;
  return (
    <>
      {error && <p className="error">{error}</p>}
      <ul className="catalogue" aria-label="Products">
        {products.map((p) => (
          <li key={p.id} className="product">
            <span className="name">{p.name}</span>
            <span className="price">{money(p.priceMinor, p.currency)}</span>
            <button type="button" disabled={busy === p.id || p.stockAvailable <= 0} onClick={() => add(p.id)}>
              {p.stockAvailable > 0 ? 'Add to basket' : 'Out of stock'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
