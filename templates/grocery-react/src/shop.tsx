// The shop's shared state: the API client (from the host) and the basket.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { GkHostBridge } from './gurukul-shop-client/host-bridge';
import { ShopApiError, type ShopBasket, type ShopClient } from './gurukul-shop-client/shop-client';

interface ShopState {
  /** The host's inputs: storageKey(name), absoluteUrl(route) for the payment page's returnUrl. */
  bridge: GkHostBridge;
  client: ShopClient;
  basket: ShopBasket | null;
  count: number;
  addToBasket(productId: number): Promise<void>;
  removeFromBasket(productId: number): Promise<void>;
  loadBasket(): Promise<void>;
}

const ShopContext = createContext<ShopState | null>(null);

export function ShopProvider({ bridge, children }: { bridge: GkHostBridge; children: ReactNode }) {
  const client = bridge.client;
  const storageKey = bridge.storageKey('basket');
  const [basket, setBasket] = useState<ShopBasket | null>(null);

  // Your storage keys must start with gk-<project-code>- (project-bundle.md).
  const savedId = () => {
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };
  const saveId = (id: string | null) => {
    try {
      if (id) sessionStorage.setItem(storageKey, id);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* storage blocked: the basket lasts until the page closes */
    }
  };

  const loadBasket = useCallback(async () => {
    const id = savedId();
    if (!id) return setBasket(null);
    try {
      setBasket(await client.getBasketsByBasketId(id));
    } catch (e) {
      if (e instanceof ShopApiError && e.status === 404) {
        saveId(null);
        setBasket(null);
      } else throw e;
    }
  }, [client]);

  const addToBasket = useCallback(
    async (productId: number) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        let id = savedId();
        if (!id) {
          id = (await client.postBaskets()).basketId;
          saveId(id);
        }
        const current = basket?.basketId === id ? basket.lines.find((l) => l.productId === productId)?.quantity ?? 0 : 0;
        try {
          setBasket(await client.putBasketsLinesByProductId(id, productId, { body: { quantity: current + 1 } }));
          return;
        } catch (e) {
          // The basket expired (24 hours idle): start a new one once.
          if (e instanceof ShopApiError && e.code === 'basket.not_found') saveId(null);
          else throw e;
        }
      }
    },
    [client, basket],
  );

  const removeFromBasket = useCallback(
    async (productId: number) => {
      const id = savedId();
      if (id) setBasket(await client.deleteBasketsLinesByProductId(id, productId));
    },
    [client],
  );

  const value = useMemo<ShopState>(
    () => ({
      bridge,
      client,
      basket,
      count: basket?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0,
      addToBasket,
      removeFromBasket,
      loadBasket,
    }),
    [bridge, client, basket, addToBasket, removeFromBasket, loadBasket],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopState {
  const state = useContext(ShopContext);
  if (!state) throw new Error('useShop outside ShopProvider');
  return state;
}
export const useBasket = useShop;

/** Money is integer minor units (shop-server.md). */
export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

/** A sentence for an API error, with the contract's code. */
export function problemText(e: unknown): string {
  if (e instanceof ShopApiError) return `${e.message} (${e.code ?? e.status})`;
  return e instanceof Error ? e.message : String(e);
}
