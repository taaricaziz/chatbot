"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Client-side cart state.
 *
 * Stores REFERENCES ONLY — slug, quantity, modifier ids. Never a price.
 * Totals always come from the server via /api/cart/quote, so a customer who
 * edits localStorage changes what they see in their own cart and nothing
 * else: the price is recomputed server-side before anything is ordered.
 */

export interface CartLine {
  slug: string;
  /** Kept for display before the first quote returns. Never used in maths. */
  name: string;
  quantity: number;
  modifierIds: string[];
}

interface CartValue {
  lines: CartLine[];
  itemCount: number;
  add: (line: { slug: string; name: string; quantity?: number }) => void;
  setQuantity: (slug: string, quantity: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
  /** False until localStorage has been read, so SSR and first paint agree. */
  hydrated: boolean;
}

const CartContext = createContext<CartValue | null>(null);

const STORAGE_KEY = "gootee.cart.v1";
const MAX_QUANTITY = 20;

function readStored(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Anything in localStorage is untrusted input: it may be stale, hand-edited
    // or from an older version of the app. Validate shape before using it.
    return parsed.flatMap((entry): CartLine[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const e = entry as Record<string, unknown>;
      if (typeof e.slug !== "string" || e.slug === "") return [];
      const quantity =
        typeof e.quantity === "number" && Number.isInteger(e.quantity)
          ? Math.min(Math.max(e.quantity, 1), MAX_QUANTITY)
          : 1;
      return [
        {
          slug: e.slug,
          name: typeof e.name === "string" ? e.name : e.slug,
          quantity,
          modifierIds: Array.isArray(e.modifierIds)
            ? e.modifierIds.filter((m): m is string => typeof m === "string")
            : [],
        },
      ];
    });
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLines(readStored());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Private browsing or a full quota. The cart still works for this
      // session; losing persistence is not worth breaking checkout over.
    }
  }, [lines, hydrated]);

  const add: CartValue["add"] = useCallback((line) => {
    const qty = line.quantity ?? 1;
    setLines((prev) => {
      const existing = prev.find((l) => l.slug === line.slug);
      if (existing) {
        return prev.map((l) =>
          l.slug === line.slug
            ? { ...l, quantity: Math.min(l.quantity + qty, MAX_QUANTITY) }
            : l,
        );
      }
      return [
        ...prev,
        {
          slug: line.slug,
          name: line.name,
          quantity: Math.min(qty, MAX_QUANTITY),
          modifierIds: [],
        },
      ];
    });
  }, []);

  const setQuantity: CartValue["setQuantity"] = useCallback((slug, quantity) => {
    setLines((prev) =>
      quantity < 1
        ? prev.filter((l) => l.slug !== slug)
        : prev.map((l) =>
            l.slug === slug
              ? { ...l, quantity: Math.min(quantity, MAX_QUANTITY) }
              : l,
          ),
    );
  }, []);

  const remove: CartValue["remove"] = useCallback((slug) => {
    setLines((prev) => prev.filter((l) => l.slug !== slug));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const itemCount = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity, 0),
    [lines],
  );

  const value = useMemo(
    () => ({ lines, itemCount, add, setQuantity, remove, clear, hydrated }),
    [lines, itemCount, add, setQuantity, remove, clear, hydrated],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>.");
  return ctx;
}
