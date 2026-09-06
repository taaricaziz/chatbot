"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart } from "@/components/cart/cart-context";
import { CAFE } from "@/lib/cafe";
import styles from "./site-header.module.css";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/menu", label: "Menu" },
  { href: "/order", label: "Order Online" },
  { href: "/reserve", label: "Book a Table" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

export function SiteHeader() {
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const { itemCount, hydrated } = useCart();

  // The header gains a ground and a hairline once it leaves the hero, so it
  // stays legible over photography without being a solid bar at rest.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A drawer that stays open while the page scrolls behind it reads as a bug.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className={`${styles.header} ${stuck ? styles.stuck : ""}`}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} onClick={() => setOpen(false)}>
          <span className={`display ${styles.brandName}`}>{CAFE.name}</span>
          <span className={styles.brandDescriptor}>{CAFE.descriptor}</span>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          <Link
            href="/cart"
            className={styles.cart}
            aria-label={`Cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
          >
            <CartIcon />
            {/* Rendered only after hydration: a server-rendered 0 that flips
                to 3 on load is a visible flicker on every page. */}
            {hydrated && itemCount > 0 && (
              <span className={styles.cartCount} aria-hidden="true">
                {itemCount}
              </span>
            )}
          </Link>

          <Link href="/order" className={styles.orderBtn}>
            Order Now
          </Link>

          <button
            type="button"
            className={styles.burger}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <span className={`${styles.burgerBar} ${open ? styles.barTop : ""}`} />
            <span className={`${styles.burgerBar} ${open ? styles.barMid : ""}`} />
            <span className={`${styles.burgerBar} ${open ? styles.barBot : ""}`} />
          </button>
        </div>
      </div>

      <div
        id="mobile-nav"
        className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`}
        hidden={!open}
      >
        <nav aria-label="Mobile">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.drawerLink}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/reserve"
          className={styles.drawerCta}
          onClick={() => setOpen(false)}
        >
          Book a Table
        </Link>
      </div>
    </header>
  );
}

function CartIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
