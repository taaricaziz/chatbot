import { CartProvider } from "@/components/cart/cart-context";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ChatWidget } from "@/components/agent/chat-widget";

/**
 * The customer-facing shell: header, footer and the cart provider.
 *
 * Everything under `(site)` gets this. The staff console deliberately does
 * not — nobody working the pass needs a shopping cart in the corner.
 */
export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <CartProvider>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        {/* Customer-facing only — the console has no use for it. */}
        {/* Always rendered, and hidden by the widget itself until
            /api/agent/status says otherwise. Deciding here instead would
            bake the answer into the statically-rendered marketing pages at
            BUILD time, so switching the assistant off would not take effect
            until the next deploy. */}
        <ChatWidget />
      </CartProvider>
    </>
  );
}
