"use client";

import { useState } from "react";
import { useCart } from "./cart-context";
import styles from "./add-to-cart-button.module.css";

/**
 * The interactive island inside an otherwise server-rendered dish card.
 * Keeping it this small means the menu page ships almost no client JS
 * despite every card having a working button.
 */
export function AddToCartButton({
  slug,
  name,
  disabled = false,
  variant = "compact",
}: {
  slug: string;
  name: string;
  disabled?: boolean;
  variant?: "compact" | "full";
}) {
  const { add } = useCart();
  const [justAdded, setJustAdded] = useState(false);

  if (disabled) {
    return (
      <button
        type="button"
        className={`${styles.btn} ${styles[variant]} ${styles.disabled}`}
        disabled
        aria-label={`${name} is sold out`}
      >
        {variant === "full" ? "Unavailable today" : "Unavailable"}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.btn} ${styles[variant]} ${justAdded ? styles.added : ""}`}
      aria-label={`Add ${name} to cart`}
      onClick={() => {
        add({ slug, name });
        setJustAdded(true);
        // Confirmation, not a state change — the button reverts so it stays
        // obvious that pressing again adds another.
        window.setTimeout(() => setJustAdded(false), 1100);
      }}
    >
      {justAdded ? "Added ✓" : variant === "full" ? "Add to cart" : "Add"}
    </button>
  );
}
