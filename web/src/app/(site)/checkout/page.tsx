import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import styles from "./checkout.module.css";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <section className={`page ${styles.wrap}`}>
      <h1 className={`display ${styles.title}`}>Checkout</h1>
      <CheckoutForm />
    </section>
  );
}
