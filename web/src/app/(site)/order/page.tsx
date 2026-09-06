import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

export const metadata: Metadata = { title: "Order Online" };

export default function Page() {
  return (
    <ComingSoon
      phase="Phase 5–6"
      title="Order Online"
      body="Takeaway and delivery ordering arrives with the cart in Phase 5 and checkout in Phase 6. Dine-in ordering is by QR code at the table."
    />
  );
}
