import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";
import styles from "./cart.module.css";

export const metadata: Metadata = {
  title: "Your Cart",
  robots: { index: false },
};

export default function CartPage() {
  return (
    <section className={`page ${styles.wrap}`}>
      <h1 className={`display ${styles.title}`}>Your cart</h1>
      <CartView />
    </section>
  );
}
