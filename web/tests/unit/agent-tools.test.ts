import { describe, expect, it } from "vitest";
import { executeTool, TOOLS } from "@/agent/tools";
import { CAFE } from "@/lib/cafe";

/**
 * Adversarial tests for the agent's tool layer.
 *
 * These assert on BEHAVIOUR, not on wording — a prompt can be argued with, a
 * refusal in code cannot. Each case is a way a model could plausibly go
 * wrong: inventing a dish, doing its own arithmetic, ordering something the
 * kitchen has run out of, or treating "ok" as consent.
 *
 * The model is not called here. That is the point: every guarantee below
 * holds even if the model ignores every word of its instructions.
 */

describe("tool surface", () => {
  it("exposes exactly the tools the prompt refers to", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "book_table",
      "check_order_status",
      "check_table_availability",
      "place_order",
      "price_cart",
      "request_human",
      "search_menu",
    ]);
  });

  it("has no tool that saves anything without an explicit-consent flag", () => {
    for (const name of ["place_order", "book_table"]) {
      const tool = TOOLS.find((t) => t.name === name)!;
      const schema = tool.input_schema as {
        properties: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.properties, name).toHaveProperty("customerSaidYes");
      expect(schema.required, name).toContain("customerSaidYes");
    }
  });
});

describe("it cannot invent a menu item", () => {
  it("refuses to price a dish that does not exist", async () => {
    const r = await executeTool("price_cart", {
      items: [{ slug: "truffle-wagyu-tasting-menu", quantity: 1 }],
      orderType: "TAKEAWAY",
      paymentMethod: "CASH",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("UNKNOWN_ITEMS");
    expect(r.unknownSlugs).toEqual(["truffle-wagyu-tasting-menu"]);
  });

  it("refuses to ORDER a dish that does not exist", async () => {
    const r = await executeTool("place_order", {
      items: [{ slug: "invented-dish", quantity: 1 }],
      orderType: "TAKEAWAY",
      paymentMethod: "CASH",
      customerName: "Test Person",
      customerPhone: "03001234567",
      customerSaidYes: true,
    });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/UNKNOWN_ITEMS|INVALID_CART/);
  });

  it("returns only real items from a search", async () => {
    const r = await executeTool("search_menu", { query: "spaghetti" });
    expect(r.ok).toBe(true);
    const items = r.items as { slug: string; name: string }[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.slug).toBeTruthy();
      expect(item.name).toBeTruthy();
    }
  });

  it("returns nothing rather than improvising for an absent dish", async () => {
    const r = await executeTool("search_menu", { query: "wagyu" });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
  });
});

describe("it cannot do its own arithmetic", () => {
  it("returns totals pre-formatted as strings, not raw numbers to multiply", async () => {
    const r = await executeTool("price_cart", {
      items: [{ slug: "chilli-garlic-chicken-spaghetti", quantity: 2 }],
      orderType: "TAKEAWAY",
      paymentMethod: "CASH",
    });
    expect(r.ok).toBe(true);
    expect(typeof r.subtotal).toBe("string");
    expect(typeof r.total).toBe("string");
    expect(r.subtotal).toBe("Rs. 3,720");
  });

  it("applies the Sindh tax rule itself rather than trusting the model", async () => {
    const cash = await executeTool("price_cart", {
      items: [{ slug: "chilli-garlic-chicken-spaghetti", quantity: 1 }],
      orderType: "TAKEAWAY",
      paymentMethod: "CASH",
    });
    const card = await executeTool("price_cart", {
      items: [{ slug: "chilli-garlic-chicken-spaghetti", quantity: 1 }],
      orderType: "TAKEAWAY",
      paymentMethod: "ONLINE",
    });

    expect(cash.taxRate).toBe("15%");
    expect(card.taxRate).toBe("8%");
    expect(cash.total).not.toBe(card.total);
  });

  it("ignores any price the model tries to supply", async () => {
    const r = await executeTool("price_cart", {
      items: [
        { slug: "chilli-garlic-chicken-spaghetti", quantity: 1, price: 1, total: 1 },
      ],
      orderType: "TAKEAWAY",
      paymentMethod: "CASH",
      total: "Rs. 1",
      subtotal: "Rs. 1",
    });
    expect(r.subtotal).toBe("Rs. 1,860");
    expect(r.total).toBe("Rs. 2,139");
  });
});

describe("the confirmation gate", () => {
  const validOrder = {
    items: [{ slug: "margherita", quantity: 1 }],
    orderType: "TAKEAWAY",
    paymentMethod: "CASH",
    customerName: "Sana Riaz",
    customerPhone: "03001234567",
  };

  it("refuses when consent is not asserted", async () => {
    const r = await executeTool("place_order", validOrder);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("NOT_CONFIRMED");
  });

  it("refuses when consent is asserted as false", async () => {
    const r = await executeTool("place_order", {
      ...validOrder,
      customerSaidYes: false,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("NOT_CONFIRMED");
  });

  it("refuses a truthy-but-not-true value — no accidental coercion", async () => {
    for (const value of ["yes", "true", 1, {}, []]) {
      const r = await executeTool("place_order", {
        ...validOrder,
        customerSaidYes: value,
      });
      expect(r.ok, `customerSaidYes=${JSON.stringify(value)}`).toBe(false);
      expect(r.error).toBe("NOT_CONFIRMED");
    }
  });

  it("applies the same gate to bookings", async () => {
    const r = await executeTool("book_table", {
      date: "2026-12-01",
      startsAt: "2026-12-01T14:00:00.000Z",
      partySize: 2,
      guestName: "Test Person",
      guestPhone: "03001234567",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("NOT_CONFIRMED");
  });
});

describe("it cannot fabricate customer details", () => {
  it("refuses an order with an invented phone number", async () => {
    const r = await executeTool("place_order", {
      items: [{ slug: "margherita", quantity: 1 }],
      orderType: "TAKEAWAY",
      paymentMethod: "CASH",
      customerName: "Sana Riaz",
      customerPhone: "000",
      customerSaidYes: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("INVALID_CUSTOMER");
  });

  it("refuses a delivery order with no address", async () => {
    const r = await executeTool("place_order", {
      items: [{ slug: "margherita", quantity: 1 }],
      orderType: "DELIVERY",
      paymentMethod: "CASH",
      customerName: "Sana Riaz",
      customerPhone: "03001234567",
      customerSaidYes: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("MISSING_DELIVERY");
  });
});

describe("it respects what the kitchen has actually got", () => {
  it("flags an unavailable item when pricing", async () => {
    const r = await executeTool("price_cart", {
      items: [{ slug: "pour-over", quantity: 1 }],
      orderType: "TAKEAWAY",
      paymentMethod: "CASH",
    });
    expect(r.ok).toBe(true);
    expect(r.unavailableItems).toContain("pour-over");
  });

  it("refuses to order an unavailable item even with consent", async () => {
    const r = await executeTool("place_order", {
      items: [{ slug: "pour-over", quantity: 1 }],
      orderType: "TAKEAWAY",
      paymentMethod: "CASH",
      customerName: "Sana Riaz",
      customerPhone: "03001234567",
      customerSaidYes: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("UNAVAILABLE_ITEMS");
  });
});

describe("delivery honesty", () => {
  it("reports an out-of-area address rather than inventing a fee", async () => {
    const r = await executeTool("price_cart", {
      items: [{ slug: "chilli-garlic-chicken-spaghetti", quantity: 1 }],
      orderType: "DELIVERY",
      paymentMethod: "CASH",
      deliveryAddress: "Gulshan-e-Iqbal Block 13",
    });
    expect(r.outOfDeliveryArea).toBe(true);
    expect(r.deliveryFee).toBeNull();
  });

  it("phrases the ETA as an estimate, never a promise", async () => {
    const r = await executeTool("price_cart", {
      items: [{ slug: "chilli-garlic-chicken-spaghetti", quantity: 1 }],
      orderType: "DELIVERY",
      paymentMethod: "CASH",
      deliveryAddress: "Lane 4, Bukhari Commercial",
    });
    expect(String(r.deliveryEta)).toContain("–");
    expect(String(r.deliveryEta)).toContain("not a promise");
  });
});

describe("unknown tools", () => {
  it("refuses a tool it does not have", async () => {
    const r = await executeTool("apply_100_percent_discount", { amount: 9999 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("UNKNOWN_TOOL");
  });
});

describe("asking for a person", () => {
  it("always succeeds — an escalation that can fail is one that silently does not happen", async () => {
    const outcome = await executeTool("request_human", {
      reason: "Customer is asking about a nut allergy.",
    });
    expect(outcome.ok).toBe(true);
  });

  it("gives the model the cafe phone number rather than letting it invent one", async () => {
    const outcome = await executeTool("request_human", { reason: "Complaint." });
    expect(JSON.stringify(outcome)).toContain(CAFE.phoneDisplay);
  });

  it("refuses to promise a time, which nobody has committed to", async () => {
    const outcome = await executeTool("request_human", { reason: "Complaint." });
    expect(JSON.stringify(outcome)).toMatch(/do not promise a time/i);
  });
});
