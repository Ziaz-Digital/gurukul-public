import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { money, problemText, useShop } from './shop';

/** The basket: GET /baskets/{id}. Checkout, delivery slots and payment are yours to build. */
export function Basket() {
  const { basket, loadBasket, removeFromBasket } = useShop();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBasket().catch((e) => setError(problemText(e)));
  }, [loadBasket]);

  if (error) return <p className="error">{error}</p>;
  if (!basket || !basket.lines.length)
    return (
      <p className="muted">
        Your basket is empty. <Link to="/">Go shopping</Link>
      </p>
    );
  return (
    <section aria-label="Basket">
      <ul className="lines">
        {basket.lines.map((l) => (
          <li key={l.productId}>
            <span>
              {l.quantity} × {l.name}
            </span>
            <span>{money(l.lineTotalMinor, basket.currency)}</span>
            <button type="button" onClick={() => removeFromBasket(l.productId).catch((e) => setError(problemText(e)))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p className="total">Total {money(basket.totalMinor, basket.currency)}</p>
    </section>
  );
}
